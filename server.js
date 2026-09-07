import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'licenses.json');
const DASHBOARD_PATH = path.join(__dirname, 'dashboard.html');
const APP_PATH = path.join(__dirname, 'app.html');

// إدارة قاعدة البيانات كملف JSON لضمان التوافقية بنسبة 100% دون أي متطلبات تثبيت
class LicenseDB {
  constructor(filepath) {
    this.filepath = filepath;
    this.data = { licenses: [] };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filepath)) {
        const raw = fs.readFileSync(this.filepath, 'utf8');
        this.data = JSON.parse(raw);
      } else {
        this.save();
      }
    } catch (e) {
      console.error('Error loading DB, creating fresh state:', e);
      this.data = { licenses: [] };
      this.save();
    }
  }

  save() {
    fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  getAll() {
    return this.data.licenses;
  }

  find(serialKey) {
    return this.data.licenses.find(l => l.serial_key.toUpperCase() === serialKey.trim().toUpperCase());
  }

  create(durationDays, note = '') {
    const randomHex = () => crypto.randomBytes(3).toString('hex').toUpperCase();
    const key = `PLUS-${randomHex()}-${randomHex()}-${randomHex()}`;
    const newEntry = {
      id: crypto.randomUUID(),
      serial_key: key,
      duration_days: parseInt(durationDays, 10),
      note: note.trim(),
      device_id: null,
      created_at: new Date().toISOString(),
      activated_at: null,
      expiry_date: null,
      is_active: true
    };
    this.data.licenses.unshift(newEntry);
    this.save();
    return newEntry;
  }

  update(license) {
    const idx = this.data.licenses.findIndex(l => l.id === license.id);
    if (idx !== -1) {
      this.data.licenses[idx] = license;
      this.save();
      return true;
    }
    return false;
  }

  delete(id) {
    const prevLen = this.data.licenses.length;
    this.data.licenses = this.data.licenses.filter(l => l.id !== id);
    this.save();
    return this.data.licenses.length < prevLen;
  }
}

const db = new LicenseDB(DB_PATH);

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  try {
    // 1. الصفحة الرئيسية: لوحة التحكم (Dashboard)
    if (req.method === 'GET' && (pathname === '/' || pathname === '/dashboard')) {
      if (fs.existsSync(DASHBOARD_PATH)) {
        const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ملف لوحة التحكم غير موجود');
      }
      return;
    }

    // 1.5 صفحة محاكاة تطبيق الهاتف (شاشة التفعيل والقفل للأندرويد والآيفون)
    if (req.method === 'GET' && pathname === '/app') {
      if (fs.existsSync(APP_PATH)) {
        const html = fs.readFileSync(APP_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ملف التطبيق غير موجود');
      }
      return;
    }

    // 1.6 مسار PWA Manifest للتثبيت على الهواتف والشاشات
    if (req.method === 'GET' && pathname === '/manifest.json') {
      const manifestPath = path.join(__dirname, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // 1.7 مسار Service Worker لتمكين تثبيت PWA على الأندرويد
    if (req.method === 'GET' && pathname === '/sw.js') {
      const swPath = path.join(__dirname, 'sw.js');
      if (fs.existsSync(swPath)) {
        const content = fs.readFileSync(swPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // 2. API تفعيل الكود وربطه بالجهاز لأول مرة (من تطبيق الآيفون)
    if (req.method === 'POST' && pathname === '/api/activate') {
      const body = await parseJsonBody(req);
      const { serial_key, device_id } = body;

      if (!serial_key || !device_id) {
        return sendJson(res, 400, { status: 'error', message: 'مفتاح الترخيص ومعرف الجهاز مطلوبان' });
      }

      const license = db.find(serial_key);
      if (!license) {
        return sendJson(res, 404, { status: 'error', message: 'كود التفعيل غير صحيح أو غير موجود' });
      }

      if (!license.is_active) {
        return sendJson(res, 403, { status: 'error', message: 'تم إيقاف هذا الكود من قبل الإدارة' });
      }

      const now = new Date();

      // ربط الجهاز لأول مرة وتحديد تاريخ الانتهاء
      if (!license.device_id) {
        license.device_id = device_id.trim();
        license.activated_at = now.toISOString();

        const expiry = new Date();
        expiry.setDate(expiry.getDate() + license.duration_days);
        license.expiry_date = expiry.toISOString();

        db.update(license);

        return sendJson(res, 200, {
          status: 'success',
          message: 'تم تفعيل الاشتراك وربط الجهاز بنجاح!',
          serial_key: license.serial_key,
          device_id: license.device_id,
          expires_at: license.expiry_date,
          days_left: license.duration_days
        });
      }

      // إذا كان الكود مفعل مسبقاً، نتحقق هل الجهاز هو نفسه
      if (license.device_id !== device_id.trim()) {
        return sendJson(res, 403, {
          status: 'error',
          message: 'هذا الكود مفعل بالفعل على جهاز آيفون آخر! لا يمكن استخدامه على أكثر من جهاز.'
        });
      }

      // التحقق من تاريخ الانتهاء
      if (new Date(license.expiry_date) < now) {
        return sendJson(res, 403, {
          status: 'error',
          message: 'عذراً، لقد انتهت صلاحية اشتراك هذا الكود. يرجى التجديد.'
        });
      }

      const msLeft = new Date(license.expiry_date).getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

      return sendJson(res, 200, {
        status: 'success',
        message: 'الاشتراك سارٍ ونشط',
        serial_key: license.serial_key,
        device_id: license.device_id,
        expires_at: license.expiry_date,
        days_left: daysLeft
      });
    }

    // 3. API فحص الصلاحية السريع (Heartbeat Verification من الآيفون)
    if (req.method === 'POST' && pathname === '/api/verify') {
      const body = await parseJsonBody(req);
      const { serial_key, device_id } = body;

      const license = db.find(serial_key || '');
      if (!license || !license.is_active || license.device_id !== (device_id || '').trim()) {
        return sendJson(res, 403, { status: 'invalid', message: 'الاشتراك غير مفعّل أو تم حظره' });
      }

      const now = new Date();
      if (!license.expiry_date || new Date(license.expiry_date) < now) {
        return sendJson(res, 403, { status: 'expired', message: 'انتهت مدة الصلاحية' });
      }

      const msLeft = new Date(license.expiry_date).getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

      return sendJson(res, 200, {
        status: 'valid',
        expires_at: license.expiry_date,
        days_left: daysLeft
      });
    }

    // 4. لوحة الإدارة: جلب كافة السجلات
    if (req.method === 'GET' && pathname === '/api/admin/licenses') {
      const all = db.getAll();
      const now = new Date();
      const processed = all.map(l => {
        let statusText = 'غير مفعّل';
        if (!l.is_active) {
          statusText = 'محظور';
        } else if (l.expiry_date) {
          statusText = new Date(l.expiry_date) < now ? 'منتهي الصلاحية' : 'نشط';
        }
        return { ...l, status_text: statusText };
      });
      return sendJson(res, 200, { licenses: processed });
    }

    // 5. لوحة الإدارة: توليد أكواد جديدة
    if (req.method === 'POST' && pathname === '/api/admin/generate') {
      const body = await parseJsonBody(req);
      const days = parseInt(body.days, 10) || 30;
      const count = Math.min(parseInt(body.count, 10) || 1, 50);
      const note = body.note || '';

      const generated = [];
      for (let i = 0; i < count; i++) {
        generated.push(db.create(days, note));
      }

      return sendJson(res, 200, { status: 'success', count: generated.length, licenses: generated });
    }

    // 6. لوحة الإدارة: تبديل حالة التفعيل (حظر/إلغاء حظر)
    if (req.method === 'POST' && pathname === '/api/admin/toggle-status') {
      const body = await parseJsonBody(req);
      const license = db.getAll().find(l => l.id === body.id);
      if (!license) return sendJson(res, 404, { status: 'error', message: 'غير موجود' });

      license.is_active = !license.is_active;
      db.update(license);
      return sendJson(res, 200, { status: 'success', is_active: license.is_active });
    }

    // 7. لوحة الإدارة: فك ربط الجهاز (Reset Device)
    if (req.method === 'POST' && pathname === '/api/admin/reset-device') {
      const body = await parseJsonBody(req);
      const license = db.getAll().find(l => l.id === body.id);
      if (!license) return sendJson(res, 404, { status: 'error', message: 'غير موجود' });

      license.device_id = null;
      db.update(license);
      return sendJson(res, 200, { status: 'success', message: 'تم فك ربط الجهاز بنجاح' });
    }

    // 8. لوحة الإدارة: حذف السيريال
    if (req.method === 'POST' && pathname === '/api/admin/delete') {
      const body = await parseJsonBody(req);
      const ok = db.delete(body.id);
      return sendJson(res, 200, { status: ok ? 'success' : 'error' });
    }

    // 404
    sendJson(res, 404, { status: 'error', message: 'Endpoint not found' });
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { status: 'error', message: 'خطأ داخلي في الخادم' });
  }
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 سيرفر إدارة تراخيص YouTube Plus يعمل الآن بنجاح!`);
  console.log(`🌐 لوحة التحكم: http://localhost:${PORT}`);
  console.log(`📡 نقطة التفعيل: http://localhost:${PORT}/api/activate`);
  console.log(`=======================================================`);
});
