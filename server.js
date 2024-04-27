const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const FormData = require('form-data');

const app = express();
app.use(express.static('public'));
app.use(express.json());

// Utility to construct the API URL based on form data
function constructApiUrl(itemType, affixIdentifiers) {
    const baseUrl = 'https://diablo.trade/api/trpc/offer.search';
    const effects = affixIdentifiers.map(id => {
        return {
            id: id,
            value: {
                min: null,  // default or conditional based on input
                max: null   // default or conditional based on input
            }
        };
    });

    const inputPayload = {
        "0": {
            "json": {
                "mode": ["season softcore"],
                "itemType": itemType,
                "class": [],
                "sockets": [],
                "category": [],
                "price": { "min": 0, "max": 9999999999 },
                "powerLevel": [0, 1000],
                "levelRequired": [0, 100],
                "sort": { "updatedAt": -1, "createdAt": -1 },
                "sold": false,
                "exactPrice": false,
                "cursor": 1,
                "limit": 20,
                "effectsGroup": [{
                    "type": "and",
                    "effects": effects,
                    "value": null, // Explicitly setting this as null if required by API
                    "effectType": "affixes"
                }]
            },
            "meta": {
                "values": {
                    "effectsGroup.0.effects.0.value.min": ["undefined"],
                    "effectsGroup.0.effects.0.value.max": ["undefined"],
                    "effectsGroup.0.value": ["undefined"]
                }
            }
        }
    };
    const inputParam = encodeURIComponent(JSON.stringify(inputPayload));
    return `${baseUrl}?batch=1&input=${inputParam}`;
}

// Fetch items from the API based on data received from the form
async function fetchItems(itemType, affixIdentifiers) {
    const apiUrl = constructApiUrl(itemType, affixIdentifiers);
    const response = await axios.get(apiUrl);
    return response.data[0].result.data.json.data;
}

// POST endpoint to receive form data and process items
app.post('/construct-url', async (req, res) => {
    try {
        const formData = req.body.formData;
        const { itemType, effectsGroup } = formData;

        // Adjusting to the new data structure sent from the client
        const affixIdentifiers = effectsGroup.map(group => group.effectId); // Assuming each group directly has an effectId

        const items = await fetchItems(itemType, affixIdentifiers);
        for (const item of items) {
            const imagePath = await takeScreenshot(item._id);
            const listingAge = Date.now() - new Date(item.updatedAt);
            const embed = constructEmbed(item, imagePath, listingAge);
            await sendToDiscord({
                content: `Check out this item: ${item.name}`,
                embeds: embed,
                files: imagePath
            });
            fs.unlinkSync(imagePath);  // Clean up the screenshot file after sending
        }
        res.json({ message: 'Processed all items successfully.' });
    } catch (error) {
        console.error('Failed to process items:', error);
        res.status(500).json({ error: error.message });
    }
});

// Take a screenshot of the item listing
async function takeScreenshot(id) {
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const url = `https://diablo.trade/listings/items/${id}`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    const imagePath = path.join(__dirname, `${id}.png`);
    try {
        const element = await page.$('.relative.mx-auto.h-fit.w-64.border-\\[20px\\].sm\\:w-72.sm\\:border-\\[24px\\].flip-card-face');
        await element.screenshot({ path: imagePath });
    } finally {
        await browser.close();
    }
    return imagePath;
}

// Construct a Discord embed for the item
function constructEmbed(item, imagePath, listingAge) {
    return {
        title: item.userId.name || 'Unknown Seller',
        url: `https://diablo.trade/listings/items/${item._id}`,
        color: 0x0099ff,
        description: '**Click on the btag to view listing**',
        fields: [
            { name: 'Price', value: formatPrice(item.price), inline: true },
            { name: 'Listing Age', value: moment.duration(listingAge).humanize(), inline: true }
        ],
        image: { url: 'attachment://' + path.basename(imagePath) },
        timestamp: new Date(item.updatedAt).toISOString(),
        footer: { text: 'Diablo.trade' }
    };
}

// Format item price for the embed
function formatPrice(price) {
    return `${(price / 1000000).toFixed(2)} Million(s)`;
}

// Send the embed and screenshot to Discord
async function sendToDiscord({ content, embeds, files }) {
    const formData = new FormData();
    formData.append('payload_json', JSON.stringify({ content, embeds: [embeds] }));
    formData.append('file', fs.createReadStream(files), { filename: path.basename(files) });

    const webhookUrl = 'https://discord.com/api/webhooks/1229130694287036507/HoxAUOq2Iaq6L0eI_uUyvFmMjJ4-JdhGG-KgKwv1QPo5nwy3jlo7x0FtDM2leZxeLkce';
    await axios.post(webhookUrl, formData, { headers: formData.getHeaders() });
}

app.listen(3000, () => console.log('Server running on port 3000'));
