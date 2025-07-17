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
    const minutes = parseInt(event.queryStringParameters.minutes, 10); // Desired travel time in minutes
    const travelMode = event.queryStringParameters.travelMode; // 'walking' or 'driving'

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

    // --- Determine dynamic search radius based on travel mode and time ---
    let searchRadius; // in meters
    if (travelMode === 'walking') {
        if (minutes <= 10) {
            searchRadius = 1000; // 1 km for short walks (5-10 mins)
        } else if (minutes <= 20) {
            searchRadius = 2000; // 2 km for medium walks (15-20 mins)
        } else if (minutes <= 30) {
            searchRadius = 3500; // 3.5 km for longer walks (up to 30 mins)
        } else {
            searchRadius = 4000; // Default fallback, though frontend limits to 30 mins now
        }
    } else { // driving mode
        if (minutes <= 10) {
            searchRadius = 8000; // 8 km for short drives (5-10 mins)
        } else if (minutes <= 20) {
            searchRadius = 15000; // 15 km for medium drives (15-20 mins)
        } else if (minutes <= 30) {
            searchRadius = 25000; // 25 km for longer drives (up to 30 mins)
        } else {
            searchRadius = 25000; // Default fallback, though frontend limits to 30 mins now
        }
    }
    console.log(`Dynamic Search Radius set to: ${searchRadius} meters for ${minutes} minutes ${travelMode}`);


    // --- Step 2: Search for Nearby Places (Restaurants) ---
    // Fetch a larger number of candidates, as the frontend will now handle the 3-10 chunk logic.
    // Google Places API allows up to 20 results per page, and up to 3 pages using next_page_token.
    // For simplicity, we'll stick to one page (max 20 results) for now.
    const placesSearchLimit = 20;

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
            // Return an empty array; frontend will handle generic spots
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
                body: JSON.stringify([]),
            };
        }

        // Limit the number of destinations for Distance Matrix API to avoid excessive calls
        // We'll calculate distance for up to 20 places, then filter.
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

        // --- Step 5: Return all filtered names (frontend will handle slicing/generics) ---
        // Return up to 10 places, as this is the max the wheel can show.
        let finalLunchPlaceNames = filteredLunchPlaces.slice(0, 10).map(place => place.name);

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
