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
        console.log('Geocoding URL:', geocodingApiUrl); // Log the Geocoding URL
        const geoResponse = await fetch(geocodingApiUrl);
        const geoData = await geoResponse.json();

        console.log('Geocoding Response Status:', geoResponse.status); // Log Geocoding response status
        console.log('Geocoding Response Data:', JSON.stringify(geoData, null, 2)); // Log full Geocoding response data

        if (!geoResponse.ok || geoData.status !== 'OK' || geoData.results.length === 0) {
            console.error('Geocoding API error:', geoData);
            return {
                statusCode: geoResponse.status,
                body: JSON.stringify({ message: 'Failed to geocode zip code.', details: geoData.error_message || 'No results' }),
            };
        }

        latitude = geoData.results[0].geometry.location.lat;
        longitude = geoData.results[0].geometry.location.lng;
        console.log(`Geocoded: Lat ${latitude}, Lng ${longitude}`); // Log geocoded coordinates

    } catch (error) {
        console.error('Error during geocoding:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error during geocoding.', error: error.message }),
        };
    }

    // --- Step 2: Search for Places (Restaurants) using Geocoded Coordinates ---
    try {
        const placesApiUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=10000&type=restaurant&key=${API_KEY}`; // 10km radius
        console.log('Places API URL:', placesApiUrl); // Log the Places API URL

        const placesResponse = await fetch(placesApiUrl);
        const placesData = await placesResponse.json();

        console.log('Places API Response Status:', placesResponse.status); // Log Places API response status
        console.log('Places API Response Data:', JSON.stringify(placesData, null, 2)); // Log full Places API response data

        if (!placesResponse.ok || placesData.status !== 'OK') {
            console.error('Places API error:', placesData);
            return {
                statusCode: placesResponse.status,
                body: JSON.stringify({ message: 'Failed to fetch places.', details: placesData.error_message || 'API status not OK' }),
            };
        }

        let lunchPlaces = [];
        if (placesData.results && placesData.results.length > 0) {
            const openPlaces = placesData.results.filter(place => place.opening_hours && place.opening_hours.open_now);
            const placesToUse = openPlaces.length >= 5 ? openPlaces : placesData.results;
            lunchPlaces = placesToUse.slice(0, 5).map(place => place.name);

            while (lunchPlaces.length < 5) {
                lunchPlaces.push(`Generic Spot ${lunchPlaces.length + 1}`);
            }
        } else {
            lunchPlaces = ["Pizza Place", "Burger Joint", "Salad Bar", "Sushi Spot", "Taco Truck"];
        }

        console.log('Returning lunch places:', JSON.stringify(lunchPlaces)); // Log final places returned

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            body: JSON.stringify(lunchPlaces),
        };

    } catch (error) {
        console.error('Error during places search:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error during places search.', error: error.message }),
        };
    }
};
