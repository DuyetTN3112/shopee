require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const config = {
    partner_id: parseInt(process.env.SHOPEE_PARTNER_ID),
    partner_key: process.env.SHOPEE_PARTNER_KEY,
    shop_id: parseInt(process.env.SHOPEE_SHOP_ID),
    redirect_url: process.env.SHOPEE_REDIRECT_URL,
    host: process.env.SHOPEE_HOST
};

function generateSign(path, params) {
    const timest = Math.floor(Date.now() / 1000);
    const baseStr = `${config.partner_id}${path}${timest}${config.partner_key}${config.shop_id}`;
    const sign = crypto.createHmac('sha256', config.partner_key).update(baseStr).digest('hex');
    return { sign, timestamp: timest };
}

function generateAuthUrl() {
    const path = "/api/v2/shop/auth_partner";
    const timest = Math.floor(Date.now() / 1000);
    const baseStr = `${config.partner_id}${path}${timest}`;
    const sign = crypto.createHmac('sha256', config.partner_key).update(baseStr).digest('hex');

    const url = `${config.host}${path}?partner_id=${config.partner_id}&timestamp=${timest}&sign=${sign}&redirect=${config.redirect_url}`;

    console.log("Link login:", url);
}

async function getToken(code) {
    const path = "/api/v2/auth/token/get";
    const timest = Math.floor(Date.now() / 1000);
    const body = {
        code: code,
        shop_id: config.shop_id,
        partner_id: config.partner_id
    };

    const baseStr = `${config.partner_id}${path}${timest}`;
    const sign = crypto.createHmac('sha256', config.partner_key).update(baseStr).digest('hex');

    try {
        const res = await axios.post(`${config.host}${path}?partner_id=${config.partner_id}&timestamp=${timest}&sign=${sign}`, body);
        console.log("Token:", res.data);
    } catch (error) {
        console.error("Loi lay token:", error.response ? error.response.data : error.message);
    }
}

generateAuthUrl();

// getToken(process.env.SHOPEE_AUTH_CODE);
