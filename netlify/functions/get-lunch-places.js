// netlify/functions/get-lunch-places.js

// This function will act as a proxy to your lunch place API.
// It will receive requests from your frontend, add the API key securely,
// and then forward the request to the actual lunch place API.

// Import the node-fetch library to make HTTP requests (Netlify includes it by default)
// If you were running this locally without Netlify, you might need to 'npm install node-fetch@2'
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    // Ensure this is a GET request, as our frontend will be sending a GET request
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405, // Method Not Allowed
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    // Extract the zip code from the query parameters sent by the frontend
    // The frontend will send it like: /.netlify/functions/get-lunch-places?zipCode=12345
    const zipCode = event.queryStringParameters.zipCode;

    if (!zipCode) {
        return {
            statusCode: 400, // Bad Request
            body: JSON.stringify({ message: 'Zip code is required.' }),
        };
    }

    // Retrieve your API key from Netlify's environment variables.
    // IMPORTANT: You will set this environment variable in the Netlify UI.
    // NEVER hardcode your API key directly in this file or any file committed to Git!
    const API_KEY = process.env.LUNCH_PLACES_API_KEY;

    if (!API_KEY) {
        console.error("LUNCH_PLACES_API_KEY environment variable is not set.");
        return {
            statusCode: 500, // Internal Server Error
            body: JSON.stringify({ message: 'Server configuration error: API key missing.' }),
        };
    }

    // Construct the URL for the actual third-party lunch place API.
    // Replace 'YOUR_LUNCH_API_BASE_URL' with the actual base URL of the API you are using.
    // For example, if it's a Yelp API, it might be something like 'https://api.yelp.com/v3/businesses/search'
    // You'll also need to adjust the query parameters based on how your specific API expects them.
    // This example assumes a simple 'zip_code' parameter and a 'term' for "lunch" or "restaurants".
    const thirdPartyApiUrl = `YOUR_LUNCH_API_BASE_URL?zip_code=${zipCode}&term=restaurants&limit=20`;

    try {
        // Make the request to the third-party API, including your API key in the headers.
        // The 'Authorization' header with 'Bearer' token is common for many APIs.
        const response = await fetch(thirdPartyApiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                // Add any other headers required by your lunch place API
            },
        });

        // Check if the third-party API request was successful
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error from third-party API: ${response.status} - ${errorText}`);
            return {
                statusCode: response.status,
                body: JSON.stringify({ message: 'Failed to fetch data from lunch place API.', details: errorText }),
            };
        }

        // Parse the JSON response from the third-party API
        const data = await response.json();

        // Return the data back to your frontend
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                // Add CORS headers if your frontend is on a different domain than your Netlify function
                // For GitHub Pages, it's good practice to include them.
                'Access-Control-Allow-Origin': '*', // Or restrict to your GitHub Pages domain: 'https://neilschreiner.github.io'
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.error('Error in serverless function:', error);
        return {
            statusCode: 500, // Internal Server Error
            body: JSON.stringify({ message: 'Internal server error.', error: error.message }),
        };
    }
};
