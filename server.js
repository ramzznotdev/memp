const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========== KONFIGURASI ==========
const JWT_SECRET = 'ramzz-secret-key-2024';
const WA_NUMBER = '6283862592489';

const PAKASIR_API_KEY = 'fouP2tIUrNFdQfRrMw2zkMOf0FWp38Lt';
const PAKASIR_PROJECT = 'auto-order-by-ramzz-official';
const PAKASIR_BASE = 'https://app.pakasir.com/api';

// ========== DATABASE ==========
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const usersFile = path.join(DATA_DIR, 'users.json');
const keysFile = path.join(DATA_DIR, 'keys.json');
const ordersFile = path.join(DATA_DIR, 'orders.json');

function loadData(file) {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file));
}
function saveData(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function generateKey() {
    return 'KEY-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ========== PAKASIR ==========
async function createQris(amount, orderId) {
    try {
        const response = await axios.post(`${PAKASIR_BASE}/transactioncreate/qris`, {
            project: PAKASIR_PROJECT,
            order_id: orderId,
            amount: amount,
            api_key: PAKASIR_API_KEY
        });
        if (response.data && response.data.payment) {
            const qrString = response.data.payment.qr_string;
            const qrBuffer = await QRCode.toBuffer(qrString, { width: 250 });
            return {
                success: true,
                qr_base64: qrBuffer.toString('base64'),
                order_id: response.data.payment.order_id,
                expired_at: response.data.payment.expired_at
            };
        }
        return { success: false };
    } catch (error) {
        return { success: false };
    }
}

async function checkPayment(orderId, amount) {
    try {
        const url = `${PAKASIR_BASE}/transactiondetail?project=${PAKASIR_PROJECT}&amount=${amount}&order_id=${orderId}&api_key=${PAKASIR_API_KEY}`;
        const response = await axios.get(url);
        return response.data?.transaction?.status === 'completed';
    } catch (error) {
        return false;
    }
}

// ========== MIDDLEWARE ==========
function verifyToken(req, res, next) {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token.split(' ')[1], JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// ========== ROUTING HTML (TANPA .html) ==========
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});
app.get('/dashboard-buyer', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard-buyer.html'));
});
app.get('/dashboard-admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard-admin.html'));
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== API ==========
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    const users = loadData(usersFile);
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username sudah dipakai' });
    }
    if (users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Email sudah dipakai' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: Date.now(),
        username,
        email,
        password: hashedPassword,
        role: 'buyer',
        created_at: new Date().toISOString()
    };
    users.push(newUser);
    saveData(usersFile, users);
    const token = jwt.sign({ id: newUser.id, username, role: 'buyer' }, JWT_SECRET);
    res.json({ success: true, token, user: { username, email, role: 'buyer' } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = loadData(usersFile);
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'User tidak ditemukan' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Password salah' });
    const token = jwt.sign({ id: user.id, username, role: user.role }, JWT_SECRET);
    res.json({ success: true, token, user: { username, email: user.email, role: user.role } });
});

app.get('/api/me', verifyToken, (req, res) => {
    const users = loadData(usersFile);
    const user = users.find(u => u.id === req.user.id);
    res.json({ success: true, user: { username: user.username, email: user.email, role: user.role } });
});

app.post('/api/create-order', verifyToken, async (req, res) => {
    const { amount, packageName, hours } = req.body;
    const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const qris = await createQris(amount, orderId);
    if (!qris.success) {
        return res.status(500).json({ error: 'Gagal membuat QRIS' });
    }
    const orders = loadData(ordersFile);
    orders.push({
        order_id: orderId,
        user_id: req.user.id,
        username: req.user.username,
        package: packageName,
        hours: hours || 24,
        amount: amount,
        status: 'pending',
        qr_base64: qris.qr_base64,
        expired_at: qris.expired_at,
        created_at: new Date().toISOString()
    });
    saveData(ordersFile, orders);
    res.json({
        success: true,
        order_id: orderId,
        qr_base64: qris.qr_base64,
        amount: amount,
        expired_at: qris.expired_at
    });
});

app.post('/api/check-payment', verifyToken, async (req, res) => {
    const { order_id, amount } = req.body;
    const orders = loadData(ordersFile);
    const order = orders.find(o => o.order_id === order_id && o.user_id === req.user.id);
    if (!order) return res.json({ status: 'not_found' });
    if (order.status === 'completed') {
        return res.json({ status: 'completed', key: order.generated_key });
    }
    const isPaid = await checkPayment(order_id, amount);
    if (isPaid && order.status !== 'completed') {
        const newKey = generateKey();
        const expiredDate = new Date();
        expiredDate.setDate(expiredDate.getDate() + (order.hours || 24));
        const keys = loadData(keysFile);
        keys.push({
            key: newKey,
            buyer: order.username,
            user_id: order.user_id,
            package: order.package,
            expired: expiredDate.toISOString(),
            created_at: new Date().toISOString()
        });
        saveData(keysFile, keys);
        order.status = 'completed';
        order.generated_key = newKey;
        order.completed_at = new Date().toISOString();
        saveData(ordersFile, orders);
        return res.json({ status: 'completed', key: newKey });
    }
    res.json({ status: 'pending' });
});

app.get('/api/my-keys', verifyToken, (req, res) => {
    const keys = loadData(keysFile);
    const myKeys = keys.filter(k => k.user_id === req.user.id);
    res.json({ success: true, keys: myKeys });
});

app.get('/api/my-orders', verifyToken, (req, res) => {
    const orders = loadData(ordersFile);
    const myOrders = orders.filter(o => o.user_id === req.user.id).reverse();
    res.json({ success: true, orders: myOrders });
});

app.get('/api/admin/stats', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
    const users = loadData(usersFile);
    const keys = loadData(keysFile);
    const orders = loadData(ordersFile);
    const completedOrders = orders.filter(o => o.status === 'completed');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + o.amount, 0);
    res.json({
        success: true,
        stats: {
            totalUsers: users.length,
            totalKeys: keys.length,
            totalOrders: orders.length,
            completedOrders: completedOrders.length,
            totalRevenue: totalRevenue,
            activeKeys: keys.filter(k => new Date(k.expired) > new Date()).length
        }
    });
});

app.get('/api/admin/users', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
    const users = loadData(usersFile);
    res.json({ success: true, users: users.map(u => ({ id: u.id, username: u.username, email: u.email, role: u.role })) });
});

app.get('/api/admin/keys', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
    const keys = loadData(keysFile);
    res.json({ success: true, keys });
});

app.delete('/api/admin/delete-key/:key', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
    let keys = loadData(keysFile);
    keys = keys.filter(k => k.key !== req.params.key);
    saveData(keysFile, keys);
    res.json({ success: true });
});

// ========== CREATE ADMIN DEFAULT ==========
(async () => {
    const users = loadData(usersFile);
    const adminExists = users.find(u => u.role === 'admin');
    if (!adminExists) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        users.push({
            id: 1,
            username: 'admin',
            email: 'admin@ramzz.com',
            password: hashedPassword,
            role: 'admin',
            created_at: new Date().toISOString()
        });
        saveData(usersFile, users);
        console.log('✅ Admin created: admin / admin123');
    }
})();

// ========== START SERVER ==========
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
    console.log(`📁 Login: http://localhost:${port}/login`);
    console.log(`📁 Register: http://localhost:${port}/register`);
    console.log(`📁 Dashboard Buyer: http://localhost:${port}/dashboard-buyer`);
    console.log(`📁 Dashboard Admin: http://localhost:${port}/dashboard-admin`);
});