// netlify/functions/get-lunch-places.js

const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    const zipCode = event.queryStringParameters.zipCode;

    if (!zipCode) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Zip code is required.' }),
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

    let latitude, longitude;

    // --- Step 1: Geocode the Zip Code ---
    try {
        const geocodingApiUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${zipCode}&key=${API_KEY}`;
        const geoResponse = await fetch(geocodingApiUrl);
        const geoData = await geoResponse.json();

        if (!geoResponse.ok || geoData.status !== 'OK' || geoData.results.length === 0) {
            console.error('Geocoding API error:', geoData);
            return {
                statusCode: geoResponse.status,
                body: JSON.stringify({ message: 'Failed to geocode zip code.', details: geoData.error_message || 'No results' }),
            };
        }

        latitude = geoData.results[0].geometry.location.lat;
        longitude = geoData.results[0].geometry.location.lng;

    } catch (error) {
        console.error('Error during geocoding:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error during geocoding.', error: error.message }),
        };
    }

    // --- Step 2: Search for Places (Restaurants) using Geocoded Coordinates ---
    try {
        // Google Places Nearby Search API
        // type=restaurant for restaurants
        // rankby=distance (requires keyword or type, and radius is ignored)
        // keyword=lunch or type=restaurant
        // We'll use a radius to ensure we get places around the zip code.
        // Google recommends a radius of 50,000 meters (50km) as a maximum.
        // We'll ask for a high limit and then truncate to 5.
        const placesApiUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=10000&type=restaurant&key=${API_KEY}`; // 10km radius

        const placesResponse = await fetch(placesApiUrl);
        const placesData = await placesResponse.json();

        if (!placesResponse.ok || placesData.status !== 'OK') {
            console.error('Places API error:', placesData);
            return {
                statusCode: placesResponse.status,
                body: JSON.stringify({ message: 'Failed to fetch places.', details: placesData.error_message || 'API status not OK' }),
            };
        }

        // Extract place names, filter for open places if desired, and limit to 5
        let lunchPlaces = [];
        if (placesData.results && placesData.results.length > 0) {
            // Filter for places that are "OPEN_NOW" if that data is available and reliable
            // Note: 'opening_hours' might not always be present or accurate, especially for small businesses.
            const openPlaces = placesData.results.filter(place => place.opening_hours && place.opening_hours.open_now);

            // Prioritize open places, then fill with any places if not enough open ones
            const placesToUse = openPlaces.length >= 5 ? openPlaces : placesData.results;

            // Get the names, ensuring we only take up to 5
            lunchPlaces = placesToUse.slice(0, 5).map(place => place.name);

            // If still less than 5, fill with generic names
            while (lunchPlaces.length < 5) {
                lunchPlaces.push(`Generic Spot ${lunchPlaces.length + 1}`);
            }
        } else {
            // If no results, provide generic names
            lunchPlaces = ["Pizza Place", "Burger Joint", "Salad Bar", "Sushi Spot", "Taco Truck"];
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*', // Or restrict to your Netlify domain: 'https://thewheeloflunch.netlify.app'
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            body: JSON.stringify(lunchPlaces), // Send back the array of names
        };

    } catch (error) {
        console.error('Error during places search:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error during places search.', error: error.message }),
        };
    }
};
