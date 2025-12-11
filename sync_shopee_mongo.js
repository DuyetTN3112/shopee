require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');

// --- 1. CẤU HÌNH TỪ BIẾN MÔI TRƯỜNG ---
const config = {
    partner_id: parseInt(process.env.SHOPEE_PARTNER_ID),
    partner_key: process.env.SHOPEE_PARTNER_KEY,
    shop_id: parseInt(process.env.SHOPEE_SHOP_ID),
    access_token: process.env.SHOPEE_ACCESS_TOKEN,
    host: process.env.SHOPEE_HOST_V2
};

// --- 2. THIẾT KẾ DATABASE (MONGODB SCHEMA) ---
// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Da ket noi MongoDB thanh cong!'))
    .catch(err => console.error('Loi ket noi MongoDB:', err));

// Định nghĩa cấu trúc Đơn hàng sẽ lưu
const OrderSchema = new mongoose.Schema({
    order_sn: { type: String, unique: true },
    order_status: String,
    create_time: Number,
    update_time: Number,
    total_amount: Number,

    buyer: {
        username: String,
        user_id: Number
    },

    recipient: {
        name: String,
        phone: String,
        full_address: String,
        zipcode: String
    },

    items: [{
        item_id: Number,
        item_name: String,
        model_name: String,
        price: Number,
        quantity: Number,
        image_url: String
    }],

    shipping_carrier: String,
    tracking_no: String,
    note: String
}, { timestamps: true });

const OrderModel = mongoose.model('Order', OrderSchema);

// --- 3. CÁC HÀM GỌI API SHOPEE ---

function generateSign(path, timest) {
    const baseStr = `${config.partner_id}${path}${timest}${config.access_token}${config.shop_id}`;
    return crypto.createHmac('sha256', config.partner_key).update(baseStr).digest('hex');
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getOrderListByTimeRange(fromDate, toDate, cursor = "") {
    const path = "/api/v2/order/get_order_list";
    const timest = Math.floor(Date.now() / 1000);
    const sign = generateSign(path, timest);

    let url = `${config.host}${path}?access_token=${config.access_token}&partner_id=${config.partner_id}&shop_id=${config.shop_id}&sign=${sign}&timestamp=${timest}&time_range_field=create_time&time_from=${fromDate}&time_to=${toDate}&page_size=100`;

    if (cursor) {
        url += `&cursor=${cursor}`;
    }

    try {
        const res = await axios.get(url);
        if (res.data.error) throw new Error(res.data.message);
        return res.data.response;
    } catch (error) {
        console.error("Loi goi API:", error.response ? error.response.data : error.message);
        return null;
    }
}

function getMonthRanges(startDate, endDate) {
    const ranges = [];
    let current = new Date(endDate * 1000);
    const start = new Date(startDate * 1000);

    while (current > start) {
        const year = current.getFullYear();
        const month = current.getMonth();

        // Nua sau thang (16 - cuoi thang)
        const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
        const midMonth = new Date(year, month, 16, 0, 0, 0);

        if (current >= midMonth) {
            const rangeEnd = Math.min(Math.floor(current.getTime() / 1000), Math.floor(endOfMonth.getTime() / 1000));
            const rangeStart = Math.max(Math.floor(midMonth.getTime() / 1000), Math.floor(start.getTime() / 1000));
            if (rangeEnd > rangeStart) {
                ranges.push({ from: rangeStart, to: rangeEnd, label: `${month + 1}/${year} (16-${endOfMonth.getDate()})` });
            }
            current = new Date(midMonth.getTime() - 1000);
        }

        // Nua dau thang (1 - 15)
        if (current > start) {
            const startOfMonth = new Date(year, month, 1, 0, 0, 0);
            const day15 = new Date(year, month, 15, 23, 59, 59);

            const rangeEnd = Math.min(Math.floor(current.getTime() / 1000), Math.floor(day15.getTime() / 1000));
            const rangeStart = Math.max(Math.floor(startOfMonth.getTime() / 1000), Math.floor(start.getTime() / 1000));
            if (rangeEnd > rangeStart) {
                ranges.push({ from: rangeStart, to: rangeEnd, label: `${month + 1}/${year} (1-15)` });
            }
            current = new Date(startOfMonth.getTime() - 1000);
        }
    }

    return ranges;
}

async function getAllOrders() {
    const allOrderSns = [];
    const now = Math.floor(Date.now() / 1000);
    const TWO_YEARS_AGO = now - (2 * 365 * 24 * 60 * 60);

    const monthRanges = getMonthRanges(TWO_YEARS_AGO, now);
    let totalFound = 0;

    for (const range of monthRanges) {
        let cursor = "";
        let hasMore = true;
        let periodOrderCount = 0;

        while (hasMore) {
            const response = await getOrderListByTimeRange(range.from, range.to, cursor);

            if (!response) {
                hasMore = false;
                continue;
            }

            const orderList = response.order_list || [];
            periodOrderCount += orderList.length;

            for (const order of orderList) {
                allOrderSns.push(order.order_sn);
            }

            hasMore = response.more;
            cursor = response.next_cursor || "";

            if (hasMore) {
                await delay(300);
            }
        }

        totalFound += periodOrderCount;
        await delay(500);
    }

    console.log(`Tong cong: ${totalFound} don hang duoc tim thay`);
    return allOrderSns;
}

async function getOrderDetails(orderSnList) {
    if (orderSnList.length === 0) return [];

    const path = "/api/v2/order/get_order_detail";
    const fields = "buyer_user_id,buyer_username,recipient_address,item_list,note,shipping_carrier,total_amount,tracking_no,pay_time";
    const BATCH_SIZE = 50;
    const allOrders = [];

    for (let i = 0; i < orderSnList.length; i += BATCH_SIZE) {
        const batch = orderSnList.slice(i, i + BATCH_SIZE);
        const snString = batch.join(',');

        const timest = Math.floor(Date.now() / 1000);
        const sign = generateSign(path, timest);
        const url = `${config.host}${path}?access_token=${config.access_token}&partner_id=${config.partner_id}&shop_id=${config.shop_id}&sign=${sign}&timestamp=${timest}&response_optional_fields=${fields}&order_sn_list=${snString}`;

        try {
            const res = await axios.get(url);
            if (res.data.error) throw new Error(res.data.message);

            const orders = res.data.response.order_list || [];
            allOrders.push(...orders);
        } catch (error) {
            console.error(`Loi lay chi tiet batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
        }

        await delay(300);
    }

    return allOrders;
}

// --- 4. HÀM CHÍNH (MAIN) ---
async function runSync() {
    try {
        const orderSns = await getAllOrders();

        if (orderSns.length > 0) {
            const orders = await getOrderDetails(orderSns);
            let savedCount = 0;

            for (const order of orders) {
                try {
                    const orderData = {
                        order_sn: order.order_sn,
                        order_status: order.order_status,
                        create_time: order.create_time,
                        update_time: order.update_time,
                        total_amount: order.total_amount,
                        buyer: {
                            username: order.buyer_username,
                            user_id: order.buyer_user_id
                        },
                        recipient: order.recipient_address ? {
                            name: order.recipient_address.name,
                            phone: order.recipient_address.phone,
                            full_address: order.recipient_address.full_address,
                            zipcode: order.recipient_address.zipcode
                        } : {},
                        items: (order.item_list || []).map(item => ({
                            item_id: item.item_id,
                            item_name: item.item_name,
                            model_name: item.model_name,
                            price: item.model_discounted_price,
                            quantity: item.model_quantity_purchased,
                            image_url: item.image_info ? item.image_info.image_url : ""
                        })),
                        shipping_carrier: order.shipping_carrier,
                        tracking_no: order.tracking_no,
                        note: order.note
                    };

                    await OrderModel.findOneAndUpdate(
                        { order_sn: order.order_sn },
                        orderData,
                        { upsert: true, new: true }
                    );
                    savedCount++;
                } catch (err) {
                    console.error(`Loi luu don ${order.order_sn}:`, err.message);
                }
            }

            console.log(`Hoan tat! Da dong bo ${savedCount}/${orders.length} don hang.`);
        } else {
            console.log("Khong tim thay don hang nao de dong bo.");
        }

    } catch (error) {
        console.error("Loi chuong trinh:", error);
    } finally {
        mongoose.disconnect();
    }
}

runSync();