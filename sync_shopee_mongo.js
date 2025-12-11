require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');

// ============================================
// 1. CẤU HÌNH
// ============================================

const config = {
    partner_id: parseInt(process.env.SHOPEE_PARTNER_ID),
    partner_key: process.env.SHOPEE_PARTNER_KEY,
    shop_id: parseInt(process.env.SHOPEE_SHOP_ID),
    access_token: process.env.SHOPEE_ACCESS_TOKEN,
    host: process.env.SHOPEE_HOST_V2
};

const SYNC_INTERVAL_MINUTES = parseInt(process.env.SYNC_INTERVAL_MINUTES) || 5;

// ============================================
// 2. LOGGING
// ============================================

const log = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg, err = null) => {
        console.error(`[ERROR] ${msg}`);
        if (err) console.error(err);
    },
    success: (msg) => console.log(`[OK] ${msg}`)
};

// ============================================
// 3. MONGODB SCHEMA
// ============================================

mongoose.connect(process.env.MONGODB_URI)
    .then(() => log.success('MongoDB connected'))
    .catch(err => log.error('MongoDB connection failed:', err));

const OrderSchema = new mongoose.Schema({
    order_sn: { type: String, unique: true, required: true },
    order_status: String,
    create_time: Number,
    update_time: Number,
    pay_time: Number,
    pickup_done_time: Number,
    total_amount: Number,
    estimated_shipping_fee: Number,
    actual_shipping_fee: Number,
    actual_shipping_fee_confirmed: Boolean,
    order_chargeable_weight_gram: Number,
    buyer: {
        username: String,
        user_id: Number,
        cpf_id: String
    },
    recipient: {
        name: String,
        phone: String,
        full_address: String,
        city: String,
        district: String,
        town: String,
        state: String,
        region: String,
        zipcode: String
    },
    buyer_ocr: {
        name: String,
        phone: String,
        address: String,
        raw_image_base64: String,
        extracted_at: Date
    },
    dropshipper: String,
    dropshipper_phone: String,
    items: [{
        item_id: Number,
        item_sku: String,
        item_name: String,
        model_id: Number,
        model_name: String,
        model_sku: String,
        original_price: Number,
        discounted_price: Number,
        quantity: Number,
        image_url: String,
        weight: Number,
        is_add_on_deal: Boolean,
        is_main_item: Boolean,
        add_on_deal_id: Number,
        promotion_type: String,
        promotion_id: Number
    }],
    shipping_carrier: String,
    tracking_no: String,
    fulfillment_flag: String,
    edt: {
        edt_from: Number,
        edt_to: Number
    },
    packages: [{
        package_number: String,
        logistics_status: String,
        shipping_carrier: String,
        item_list: Array
    }],
    payment_method: String,
    payment_info: mongoose.Schema.Types.Mixed,
    note: String,
    note_update_time: Number,
    cancel_by: String,
    cancel_reason: String,
    buyer_cancel_reason: String,
    split_up: Boolean,
    goods_to_declare: Boolean,
    invoice_data: mongoose.Schema.Types.Mixed,
    return_request_due_date: Number,
    last_synced_at: { type: Date, default: Date.now }
}, { timestamps: true });

const OrderModel = mongoose.model('Order', OrderSchema);

// ============================================
// 4. SHOPEE API HELPERS
// ============================================

const ALL_OPTIONAL_FIELDS = [
    "buyer_user_id", "buyer_username", "buyer_cpf_id",
    "estimated_shipping_fee", "recipient_address", "actual_shipping_fee",
    "actual_shipping_fee_confirmed", "goods_to_declare", "note", "note_update_time",
    "item_list", "pay_time", "dropshipper", "dropshipper_phone", "split_up",
    "buyer_cancel_reason", "cancel_by", "cancel_reason", "fulfillment_flag",
    "pickup_done_time", "package_list", "shipping_carrier", "payment_method",
    "total_amount", "invoice_data", "order_chargeable_weight_gram",
    "return_request_due_date", "edt", "payment_info", "tracking_no"
].join(",");

function generateSign(path, timest) {
    const baseStr = `${config.partner_id}${path}${timest}${config.access_token}${config.shop_id}`;
    return crypto.createHmac('sha256', config.partner_key).update(baseStr).digest('hex');
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// 5. API CALLS
// ============================================

async function getOrderList(timeFrom, timeTo, cursor = "") {
    const path = "/api/v2/order/get_order_list";
    const timest = Math.floor(Date.now() / 1000);
    const sign = generateSign(path, timest);

    const params = {
        access_token: config.access_token,
        partner_id: config.partner_id,
        shop_id: config.shop_id,
        sign,
        timestamp: timest,
        time_range_field: "update_time",
        time_from: timeFrom,
        time_to: timeTo,
        page_size: 100
    };

    if (cursor) params.cursor = cursor;

    const url = `${config.host}${path}?${new URLSearchParams(params)}`;

    try {
        const res = await axios.get(url);
        if (res.data.error) {
            log.error(`API Error: ${res.data.error} - ${res.data.message}`);
            return null;
        }
        return res.data.response;
    } catch (error) {
        log.error('API Call Failed:', error.response?.data || error.message);
        return null;
    }
}

async function getOrderDetails(orderSnList) {
    if (orderSnList.length === 0) return [];

    const path = "/api/v2/order/get_order_detail";
    const BATCH_SIZE = 50;
    const allOrders = [];

    for (let i = 0; i < orderSnList.length; i += BATCH_SIZE) {
        const batch = orderSnList.slice(i, i + BATCH_SIZE);
        const snString = batch.join(',');

        const timest = Math.floor(Date.now() / 1000);
        const sign = generateSign(path, timest);

        const params = {
            access_token: config.access_token,
            partner_id: config.partner_id,
            shop_id: config.shop_id,
            sign,
            timestamp: timest,
            response_optional_fields: ALL_OPTIONAL_FIELDS,
            order_sn_list: snString
        };

        const url = `${config.host}${path}?${new URLSearchParams(params)}`;

        try {
            const res = await axios.get(url);
            if (res.data.error) {
                log.error(`API Error: ${res.data.error} - ${res.data.message}`);
                continue;
            }
            const orders = res.data.response.order_list || [];
            allOrders.push(...orders);
        } catch (error) {
            log.error('Get order details failed:', error.message);
        }

        await delay(300);
    }

    return allOrders;
}

async function getShippingDocumentDataInfo(orderSn) {
    const path = "/api/v2/logistics/get_shipping_document_data_info";
    const timest = Math.floor(Date.now() / 1000);
    const sign = generateSign(path, timest);

    const params = {
        access_token: config.access_token,
        partner_id: config.partner_id,
        shop_id: config.shop_id,
        sign,
        timestamp: timest,
        order_sn: orderSn
    };

    const url = `${config.host}${path}?${new URLSearchParams(params)}`;

    try {
        const res = await axios.get(url);
        if (res.data.error) return null;
        return res.data.response;
    } catch (error) {
        return null;
    }
}

// ============================================
// 6. DATA TRANSFORMATION
// ============================================

function transformOrderData(order) {
    return {
        order_sn: order.order_sn,
        order_status: order.order_status,
        create_time: order.create_time,
        update_time: order.update_time,
        pay_time: order.pay_time,
        pickup_done_time: order.pickup_done_time,
        total_amount: order.total_amount,
        estimated_shipping_fee: order.estimated_shipping_fee,
        actual_shipping_fee: order.actual_shipping_fee,
        actual_shipping_fee_confirmed: order.actual_shipping_fee_confirmed,
        order_chargeable_weight_gram: order.order_chargeable_weight_gram,
        buyer: {
            username: order.buyer_username,
            user_id: order.buyer_user_id,
            cpf_id: order.buyer_cpf_id
        },
        recipient: order.recipient_address ? {
            name: order.recipient_address.name,
            phone: order.recipient_address.phone,
            full_address: order.recipient_address.full_address,
            city: order.recipient_address.city,
            district: order.recipient_address.district,
            town: order.recipient_address.town,
            state: order.recipient_address.state,
            region: order.recipient_address.region,
            zipcode: order.recipient_address.zipcode
        } : {},
        dropshipper: order.dropshipper,
        dropshipper_phone: order.dropshipper_phone,
        items: (order.item_list || []).map(item => ({
            item_id: item.item_id,
            item_sku: item.item_sku,
            item_name: item.item_name,
            model_id: item.model_id,
            model_name: item.model_name,
            model_sku: item.model_sku,
            original_price: item.model_original_price,
            discounted_price: item.model_discounted_price,
            quantity: item.model_quantity_purchased,
            image_url: item.image_info?.image_url,
            weight: item.weight,
            is_add_on_deal: item.is_add_on_deal,
            is_main_item: item.is_main_item,
            add_on_deal_id: item.add_on_deal_id,
            promotion_type: item.promotion_type,
            promotion_id: item.promotion_id
        })),
        shipping_carrier: order.shipping_carrier,
        tracking_no: order.tracking_no,
        fulfillment_flag: order.fulfillment_flag,
        edt: order.edt ? {
            edt_from: order.edt.edt_from,
            edt_to: order.edt.edt_to
        } : null,
        packages: (order.package_list || []).map(pkg => ({
            package_number: pkg.package_number,
            logistics_status: pkg.logistics_status,
            shipping_carrier: pkg.shipping_carrier,
            item_list: pkg.item_list
        })),
        payment_method: order.payment_method,
        payment_info: order.payment_info,
        note: order.note,
        note_update_time: order.note_update_time,
        cancel_by: order.cancel_by,
        cancel_reason: order.cancel_reason,
        buyer_cancel_reason: order.buyer_cancel_reason,
        split_up: order.split_up,
        goods_to_declare: order.goods_to_declare,
        invoice_data: order.invoice_data,
        return_request_due_date: order.return_request_due_date,
        last_synced_at: new Date()
    };
}

// ============================================
// 7. MAIN SYNC FUNCTIONS
// ============================================

async function syncAllOrders() {
    log.info('Starting full sync (2 years)...');

    const now = Math.floor(Date.now() / 1000);
    const TWO_YEARS_AGO = now - (2 * 365 * 24 * 60 * 60);
    const allOrderSns = [];
    const FIFTEEN_DAYS = 15 * 24 * 60 * 60;

    let currentEnd = now;

    while (currentEnd > TWO_YEARS_AGO) {
        const currentStart = Math.max(currentEnd - FIFTEEN_DAYS, TWO_YEARS_AGO);

        let cursor = "";
        let hasMore = true;

        while (hasMore) {
            const response = await getOrderList(currentStart, currentEnd, cursor);
            if (!response) {
                hasMore = false;
                continue;
            }

            const orderList = response.order_list || [];
            for (const order of orderList) {
                allOrderSns.push(order.order_sn);
            }

            hasMore = response.more;
            cursor = response.next_cursor || "";
            if (hasMore) await delay(300);
        }

        currentEnd = currentStart - 1;
        await delay(500);
    }

    log.success(`Found ${allOrderSns.length} orders total`);

    if (allOrderSns.length > 0) {
        await processOrders(allOrderSns);
    }
}

async function syncRecentOrders() {
    log.info('Syncing recent orders (24h)...');

    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - (24 * 60 * 60);

    const allOrderSns = [];
    let cursor = "";
    let hasMore = true;

    while (hasMore) {
        const response = await getOrderList(oneDayAgo, now, cursor);
        if (!response) {
            hasMore = false;
            continue;
        }

        const orderList = response.order_list || [];
        for (const order of orderList) {
            allOrderSns.push(order.order_sn);
        }

        hasMore = response.more;
        cursor = response.next_cursor || "";
        if (hasMore) await delay(300);
    }

    log.success(`Found ${allOrderSns.length} orders`);

    if (allOrderSns.length > 0) {
        await processOrders(allOrderSns);
    }
}

async function processOrders(orderSnList) {
    const orders = await getOrderDetails(orderSnList);
    let savedCount = 0;
    let updatedCount = 0;

    for (const order of orders) {
        try {
            const orderData = transformOrderData(order);
            const existingOrder = await OrderModel.findOne({ order_sn: order.order_sn });

            await OrderModel.findOneAndUpdate(
                { order_sn: order.order_sn },
                orderData,
                { upsert: true, new: true }
            );

            if (existingOrder) {
                if (existingOrder.order_status !== order.order_status) {
                    log.info(`Status changed: ${order.order_sn} [${existingOrder.order_status} -> ${order.order_status}]`);
                }
                updatedCount++;
            } else {
                log.info(`New order: ${order.order_sn} - ${order.order_status}`);
                savedCount++;
            }

            // Try to get shipping document for OCR
            if (order.tracking_no && order.order_status !== 'CANCELLED') {
                const shippingDoc = await getShippingDocumentDataInfo(order.order_sn);
                if (shippingDoc?.recipient_address_info) {
                    log.info(`Shipping document available for ${order.order_sn}`);
                }
            }

        } catch (err) {
            log.error(`Failed to save order ${order.order_sn}:`, err.message);
        }
    }

    log.success(`Done! New: ${savedCount}, Updated: ${updatedCount}`);
}

// ============================================
// 8. POLLING MODE
// ============================================

async function startPolling() {
    log.info(`Starting polling mode (every ${SYNC_INTERVAL_MINUTES} min)...`);

    await syncRecentOrders();

    setInterval(async () => {
        log.info(`Auto sync at ${new Date().toLocaleString()}`);
        await syncRecentOrders();
    }, SYNC_INTERVAL_MINUTES * 60 * 1000);
}

// ============================================
// 9. CLI
// ============================================

async function main() {
    const mode = process.argv[2] || 'once';

    log.info(`Partner ID: ${config.partner_id}, Shop ID: ${config.shop_id}`);
    log.info(`Mode: ${mode}`);

    try {
        switch (mode) {
            case 'all':
                await syncAllOrders();
                mongoose.disconnect();
                break;
            case 'poll':
            case 'polling':
                await startPolling();
                break;
            case 'once':
            default:
                await syncRecentOrders();
                mongoose.disconnect();
                break;
        }
    } catch (error) {
        log.error('Program error:', error);
        mongoose.disconnect();
        process.exit(1);
    }
}

main();

/*
Usage:
  node sync_shopee_mongo.js          - Sync recent (24h)
  node sync_shopee_mongo.js all      - Sync all (2 years)
  node sync_shopee_mongo.js poll     - Polling mode
*/