// netlify/functions/get-lunch-places.js

const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    // Log the request origin IP and Referer URL
    console.log('Request Origin IP:', event.headers['x-forwarded-for']);
    console.log('Request Referer URL:', event.headers.referer);

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    const zipCode = event.queryStringParameters.zipCode;
    const minutes = parseInt(event.queryStringParameters.minutes, 10); // New: desired travel time in minutes
    const travelMode = event.queryStringParameters.travelMode; // New: 'walking' or 'driving'

    if (!zipCode || isNaN(minutes) || !travelMode) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Zip code, travel time, and travel mode are required.' }),
        };
    }

    const API_KEY = process.env.LUNCH_PLACES_API_KEY; // Your Google Places API Key

    if (!API_KEY) {
        console.error("LUNCH_PLACES_API_KEY environment variable is not set.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Server configuration error: API key missing.' }),
        };
    }

    let originLatitude, originLongitude;

    // --- Step 1: Geocode the Zip Code to get origin coordinates ---
    try {
        const geocodingApiUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${zipCode}&key=${API_KEY}`;
        console.log('Geocoding URL:', geocodingApiUrl);
        const geoResponse = await fetch(geocodingApiUrl);
        const geoData = await geoResponse.json();

        console.log('Geocoding Response Status:', geoResponse.status);
        console.log('Geocoding Response Data:', JSON.stringify(geoData, null, 2));

        if (!geoResponse.ok || geoData.status !== 'OK' || geoData.results.length === 0) {
            console.error('Geocoding API error:', geoData);
            return {
                statusCode: geoResponse.status,
                body: JSON.stringify({ message: 'Failed to geocode zip code.', details: geoData.error_message || 'No results' }),
            };
        }

        originLatitude = geoData.results[0].geometry.location.lat;
        originLongitude = geoData.results[0].geometry.location.lng;
        console.log(`Geocoded Origin: Lat ${originLatitude}, Lng ${originLongitude}`);

    } catch (error) {
        console.error('Error during geocoding:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error during geocoding.', error: error.message }),
        };
    }

    // --- Step 2: Search for Nearby Places (Restaurants) ---
    // Use a generous radius to find enough candidates for Distance Matrix
    // Max radius for Nearby Search is 50,000 meters.
    // We'll fetch more than 5, to allow for filtering by travel time.
    const searchRadius = 15000; // 15 km radius for initial search
    const placesSearchLimit = 20; // Fetch up to 20 places for distance calculation

    try {
        const placesApiUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${originLatitude},${originLongitude}&radius=${searchRadius}&type=restaurant&key=${API_KEY}`;
        console.log('Places API URL (initial search):', placesApiUrl);

        const placesResponse = await fetch(placesApiUrl);
        const placesData = await placesResponse.json();

        console.log('Places API Response Status (initial search):', placesResponse.status);
        console.log('Places API Response Data (initial search):', JSON.stringify(placesData, null, 2));

        if (!placesResponse.ok || placesData.status !== 'OK') {
            console.error('Places API error (initial search):', placesData);
            return {
                statusCode: placesResponse.status,
                body: JSON.stringify({ message: 'Failed to fetch places during initial search.', details: placesData.error_message || 'API status not OK' }),
            };
        }

        if (!placesData.results || placesData.results.length === 0) {
            console.log('No places found in initial search.');
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
                body: JSON.stringify(["Pizza Place", "Burger Joint", "Salad Bar", "Sushi Spot", "Taco Truck"]), // Generic names if no places found
            };
        }

        // Limit the number of destinations for Distance Matrix API to avoid excessive calls
        const candidatePlaces = placesData.results.slice(0, placesSearchLimit);
        const destinations = candidatePlaces.map(place => `${place.geometry.location.lat},${place.geometry.location.lng}`);

        // --- Step 3: Use Distance Matrix API to get travel times ---
        const distanceMatrixApiUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLatitude},${originLongitude}&destinations=${destinations.join('|')}&mode=${travelMode}&key=${API_KEY}`;
        console.log('Distance Matrix API URL:', distanceMatrixApiUrl);

        const distanceMatrixResponse = await fetch(distanceMatrixApiUrl);
        const distanceMatrixData = await distanceMatrixResponse.json();

        console.log('Distance Matrix Response Status:', distanceMatrixResponse.status);
        console.log('Distance Matrix Response Data:', JSON.stringify(distanceMatrixData, null, 2));

        if (!distanceMatrixResponse.ok || distanceMatrixData.status !== 'OK') {
            console.error('Distance Matrix API error:', distanceMatrixData);
            return {
                statusCode: distanceMatrixResponse.status,
                body: JSON.stringify({ message: 'Failed to get travel times.', details: distanceMatrixData.error_message || 'API status not OK' }),
            };
        }

        // --- Step 4: Filter places by travel time ---
        const filteredLunchPlaces = [];
        const maxDurationSeconds = minutes * 60; // Convert minutes to seconds

        distanceMatrixData.rows[0].elements.forEach((element, index) => {
            if (element.status === 'OK' && element.duration && element.duration.value <= maxDurationSeconds) {
                // Add the place name to our filtered list
                filteredLunchPlaces.push({
                    name: candidatePlaces[index].name,
                    duration: element.duration.value // Store duration for potential sorting
                });
            }
        });

        // Sort by duration (shortest first)
        filteredLunchPlaces.sort((a, b) => a.duration - b.duration);

        // --- Step 5: Get the top 5 names ---
        let finalLunchPlaceNames = filteredLunchPlaces.slice(0, 5).map(place => place.name);

        // If still less than 5, fill with generic names
        while (finalLunchPlaceNames.length < 5) {
            finalLunchPlaceNames.push(`Generic Spot ${finalLunchPlaceNames.length + 1}`);
        }

        console.log('Returning final lunch places:', JSON.stringify(finalLunchPlaceNames));

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            body: JSON.stringify(finalLunchPlaceNames),
        };

    } catch (error) {
        console.error('Error during places search or distance matrix calculation:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error during place search and travel time calculation.', error: error.message }),
        };
    }
};