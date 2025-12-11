require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const config = {
    partner_id: parseInt(process.env.SHOPEE_PARTNER_ID),
    partner_key: process.env.SHOPEE_PARTNER_KEY,
    shop_id: parseInt(process.env.SHOPEE_SHOP_ID),
    host: process.env.SHOPEE_HOST_V2
};

const AUTH_CODE = process.env.SHOPEE_AUTH_CODE;

async function getToken() {
    const path = "/api/v2/auth/token/get";
    const timest = Math.floor(Date.now() / 1000);

    const body = {
        code: AUTH_CODE,
        shop_id: config.shop_id,
        partner_id: config.partner_id
    };

    const baseStr = `${config.partner_id}${path}${timest}`;
    const sign = crypto.createHmac('sha256', config.partner_key).update(baseStr).digest('hex');

    const url = `${config.host}${path}?partner_id=${config.partner_id}&timestamp=${timest}&sign=${sign}`;

    try {
        const res = await axios.post(url, body, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("Token:", JSON.stringify(res.data, null, 2));
    } catch (error) {
        console.error("Loi:", error.response ? error.response.data : error.message);
    }
}

getToken();