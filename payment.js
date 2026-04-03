const axios = require("axios");
const QRCode = require("qrcode");

const PAKASIR_BASE = "https://app.pakasir.com/api";

const toRupiah = (angka) => {
  return Number(angka).toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).replace("IDR", "Rp").trim();
};

function generateReffId() {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `TRX-${Date.now()}-${rand}`;
}

function sanitizeQrString(s) {
  if (!s || typeof s !== 'string') return null;
  const idx = s.indexOf('000201');
  if (idx !== -1) return s.slice(idx).trim();
  return s.trim();
}

async function downloadQrisImage(url) {
  try {
    if (!url || !url.startsWith('http')) return null;
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    });
    return Buffer.from(response.data);
  } catch (error) {
    return null;
  }
}

async function createdQris(harga, config) {
  const amount = Number(harga);
  const orderId = generateReffId();

  try {
    const payload = {
        project: config.project,
        order_id: orderId,
        amount: amount,
        api_key: config.apikey
    };

    console.log(`[PAKASIR] Creating transaction: Amount=${amount}, OrderID=${orderId}`);

    const { data } = await axios.post(`${PAKASIR_BASE}/transactioncreate/qris`, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 15000
    });

    if (!data || !data.payment) {
        console.error("[PAKASIR] Invalid response:", data);
        return null;
    }

    const payment = data.payment;
    const candidates = [payment.qr_string, payment.qr, data.qr_string, data.qr, payment.payment_number]
      .filter(v => typeof v === 'string' && v.trim().length > 0);
    let qrString = null;
    for (const c of candidates) {
      const emv = sanitizeQrString(c);
      if (emv && emv.startsWith('000201')) {
        qrString = emv;
        break;
      }
    }

    if (!qrString) {
        console.error("[PAKASIR] No valid QR string returned");
        return null;
    }

    const qrBuffer = await QRCode.toBuffer(qrString, { errorCorrectionLevel: 'M', width: 512, margin: 1 });

    return {
      idtransaksi: payment.order_id,
      jumlah: payment.total_payment,
      imageqris: qrBuffer,
      qr_string: qrString,
      nominal: payment.amount,
      expired_at: payment.expired_at
    };

  } catch (e) {
    console.error("[PAKASIR CREATE ERROR]", e.response?.data || e.message);
    return null;
  }
}

async function cekStatus(id, amount, config) {
  try {
    const url = `${PAKASIR_BASE}/transactiondetail?project=${config.project}&amount=${amount}&order_id=${id}&api_key=${config.apikey}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    if (data && data.transaction && data.transaction.status === 'completed') return true;
    return false;
  } catch (e) {
    if (e.response && e.response.status === 404) return false;
    console.error("[PAKASIR STATUS ERROR]", e.message);
    return false;
  }
}

module.exports = {
  createdQris,
  cekStatus,
  toRupiah,
  downloadQrisImage
};