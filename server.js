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
const LOGIN_PATH = path.join(__dirname, 'login.html');
const APP_PATH = path.join(__dirname, 'app.html');

// إدارة قاعدة البيانات كملف JSON لضمان التوافقية بنسبة 100%
class LicenseDB {
  constructor(filepath) {
    this.filepath = filepath;
    this.data = { licenses: [], admin: null };
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
      this.data = { licenses: [], admin: null };
      this.save();
    }
    // تهيئة حساب المسؤول الافتراضي إذا لم يكن موجوداً
    if (!this.data.admin) {
      this.data.admin = {
        email: process.env.ADMIN_EMAIL || 'sa.digitalsystem@gmail.com',
        password: process.env.ADMIN_PASSWORD || 'Admin@YT2026!'
      };
      this.save();
    }

    // ترقية السجلات القديمة تلقائياً لدعم المجموعات وتعدد الأجهزة وواتساب
    if (Array.isArray(this.data.licenses)) {
      let needsSave = false;
      this.data.licenses.forEach(l => {
        if (!l.max_devices) { l.max_devices = 1; needsSave = true; }
        if (!Array.isArray(l.device_ids)) {
          l.device_ids = l.device_id ? [l.device_id] : [];
          needsSave = true;
        }
        if (!l.group) { l.group = 'عام'; needsSave = true; }
        if (l.whatsapp === undefined) { l.whatsapp = ''; needsSave = true; }
      });
      if (needsSave) this.save();
    }
  }

  save() {
    fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  getAdmin() {
    if (!this.data.admin) {
      this.data.admin = { 
        email: process.env.ADMIN_EMAIL || 'sa.digitalsystem@gmail.com', 
        password: process.env.ADMIN_PASSWORD || 'Admin@YT2026!' 
      };
      this.save();
    }
    return this.data.admin;
  }

  updateAdmin(email, password) {
    this.data.admin = {
      email: (email || '').trim().toLowerCase(),
      password: password
    };
    this.save();
    return this.data.admin;
  }

  getAll() {
    return this.data.licenses;
  }

  find(serialKey) {
    return this.data.licenses.find(l => l.serial_key.toUpperCase() === serialKey.trim().toUpperCase());
  }

  create(durationDays, note = '', maxDevices = 1, group = 'عام', whatsapp = '') {
    const randomHex = () => crypto.randomBytes(3).toString('hex').toUpperCase();
    const key = `PLUS-${randomHex()}-${randomHex()}-${randomHex()}`;
    const newEntry = {
      id: crypto.randomUUID(),
      serial_key: key,
      duration_days: parseInt(durationDays, 10),
      note: (note || '').trim(),
      group: (group || 'عام').trim(),
      whatsapp: (whatsapp || '').trim(),
      max_devices: Math.max(1, parseInt(maxDevices, 10) || 1),
      device_ids: [],
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

// إدارة الجلسات الآمنة في الذاكرة
const activeAdminSessions = new Set();

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    if (key) list[key] = decodeURIComponent(parts.join('='));
  });
  return list;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies['yt_admin_session'] || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '').trim() : null);
  return token && activeAdminSessions.has(token);
}

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
    // 1. صفحة تسجيل دخول المسؤول
    if (req.method === 'GET' && pathname === '/login') {
      if (isAuthenticated(req)) {
        res.writeHead(302, { 'Location': '/dashboard' });
        res.end();
        return;
      }
      if (fs.existsSync(LOGIN_PATH)) {
        const html = fs.readFileSync(LOGIN_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ملف تسجيل الدخول غير موجود');
      }
      return;
    }

    // 2. الصفحة الرئيسية / لوحة التحكم (Dashboard) - محمية بتسجيل الدخول
    if (req.method === 'GET' && (pathname === '/' || pathname === '/dashboard')) {
      if (!isAuthenticated(req)) {
        res.writeHead(302, { 'Location': '/login' });
        res.end();
        return;
      }
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

    // 3. API تسجيل دخول المسؤول
    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const body = await parseJsonBody(req);
      const { email, password } = body;
      const admin = db.getAdmin();

      const inputEmail = (email || '').trim().toLowerCase();
      const currentEmail = (admin.email || '').trim().toLowerCase();

      // نقبل البريد المسجل حالياً، أو إيميل المشرف sa.digitalsystem@gmail.com، أو البريد الافتراضي admin@ytplus.com
      const isEmailMatch = inputEmail === currentEmail || 
                           inputEmail === 'sa.digitalsystem@gmail.com' || 
                           inputEmail === 'admin@ytplus.com';

      // نقبل كلمة المرور المسجلة، أو كلمة المرور الرئيسية Admin@YT2026! أو متغير البيئة
      const isPasswordMatch = password === admin.password || 
                              password === 'Admin@YT2026!' ||
                              (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD);

      if (email && password && isEmailMatch && isPasswordMatch) {
        // تحديث البريد المسجل إذا كان مختلفاً
        if (inputEmail !== currentEmail && inputEmail.includes('@')) {
          admin.email = inputEmail;
          db.updateAdmin(admin.email, admin.password);
        }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        activeAdminSessions.add(sessionToken);

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `yt_admin_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ status: 'success', message: 'تم تسجيل الدخول بنجاح', token: sessionToken }));
      } else {
        sendJson(res, 401, { status: 'error', message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
      }
      return;
    }

    // 4. API تسجيل خروج المسؤول
    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      const cookies = parseCookies(req);
      const token = cookies['yt_admin_session'];
      if (token) activeAdminSessions.delete(token);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'yt_admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ status: 'success', message: 'تم تسجيل الخروج بنجاح' }));
      return;
    }

    // 5. API تعديل بيانات الدخول للمسؤول (تغيير البريد أو كلمة المرور)
    if (req.method === 'POST' && pathname === '/api/admin/change-credentials') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'يرجى تسجيل الدخول كمسؤول أولاً' });
      }
      const body = await parseJsonBody(req);
      const { current_password, new_email, new_password } = body;
      const admin = db.getAdmin();

      if (!current_password || current_password !== admin.password) {
        return sendJson(res, 400, { status: 'error', message: 'كلمة المرور الحالية غير صحيحة' });
      }

      db.updateAdmin(new_email || admin.email, new_password || admin.password);
      return sendJson(res, 200, { status: 'success', message: 'تم تحديث بيانات الدخول بنجاح' });
    }

    // 6. صفحة محاكاة تطبيق الهاتف (شاشة التفعيل والمشغل)
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

    // 7. مسار PWA Manifest
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

    // 8. مسار Service Worker
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

    // 9. API تفعيل الكود وربطه بالجهاز (يدعم تعدد الأجهزة حسب الباقة)
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
      if (!Array.isArray(license.device_ids)) {
        license.device_ids = license.device_id ? [license.device_id] : [];
      }
      const maxDev = license.max_devices || 1;
      const targetDev = device_id.trim();

      const isRegistered = license.device_ids.includes(targetDev);

      if (!isRegistered) {
        if (license.device_ids.length >= maxDev) {
          return sendJson(res, 403, {
            status: 'error',
            message: `تم الوصول للحد الأقصى من الأجهزة المصرح بها لهذا الكود (${maxDev} أجهزة). يرجى فك ارتباط جهاز سابق أو ترقية الباقة.`
          });
        }
        license.device_ids.push(targetDev);
        license.device_id = license.device_ids[0];

        if (!license.activated_at) {
          license.activated_at = now.toISOString();
          const expiry = new Date();
          expiry.setDate(expiry.getDate() + license.duration_days);
          license.expiry_date = expiry.toISOString();
        }
        db.update(license);
      }

      if (license.expiry_date && new Date(license.expiry_date) < now) {
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
        device_id: targetDev,
        devices_count: license.device_ids.length,
        max_devices: maxDev,
        activated_at: license.activated_at,
        expires_at: license.expiry_date,
        days_left: daysLeft
      });
    }

    // 10. API فحص الصلاحية السريع (Heartbeat Verification اللحظي)
    if (req.method === 'POST' && pathname === '/api/verify') {
      const body = await parseJsonBody(req);
      const { serial_key, device_id } = body;

      const license = db.find(serial_key || '');
      if (!license || !license.is_active) {
        return sendJson(res, 403, { status: 'invalid', message: 'الاشتراك غير مفعّل أو تم حظره' });
      }

      if (!Array.isArray(license.device_ids)) {
        license.device_ids = license.device_id ? [license.device_id] : [];
      }
      const targetDev = (device_id || '').trim();
      const isDeviceMatched = license.device_ids.includes(targetDev) || license.device_id === targetDev;

      if (!isDeviceMatched) {
        return sendJson(res, 403, { status: 'invalid', message: 'الجهاز غير مصرح به على هذا الكود' });
      }

      const now = new Date();
      if (!license.expiry_date || new Date(license.expiry_date) < now) {
        return sendJson(res, 403, { status: 'expired', message: 'انتهت مدة الصلاحية' });
      }

      const msLeft = new Date(license.expiry_date).getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

      return sendJson(res, 200, {
        status: 'valid',
        activated_at: license.activated_at,
        expires_at: license.expiry_date,
        days_left: daysLeft
      });
    }

    // 11. لوحة الإدارة: جلب كافة السجلات (محمي)
    if (req.method === 'GET' && pathname === '/api/admin/licenses') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const all = db.getAll();
      const now = new Date();
      const processed = all.map(l => {
        let statusText = 'غير مفعّل';
        if (!l.is_active) {
          statusText = 'محظور';
        } else if (l.expiry_date) {
          statusText = new Date(l.expiry_date) < now ? 'منتهي الصلاحية' : 'نشط';
        }
        return {
          ...l,
          device_ids: Array.isArray(l.device_ids) ? l.device_ids : (l.device_id ? [l.device_id] : []),
          max_devices: l.max_devices || 1,
          group: l.group || 'عام',
          whatsapp: l.whatsapp || '',
          status_text: statusText
        };
      });
      return sendJson(res, 200, { licenses: processed });
    }

    // 12. لوحة الإدارة: توليد أكواد جديدة (محمي - يدعم المجموعات، الأجهزة، والواتساب)
    if (req.method === 'POST' && pathname === '/api/admin/generate') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const days = parseInt(body.days, 10) || 30;
      const count = Math.min(parseInt(body.count, 10) || 1, 50);
      const note = body.note || '';
      const maxDevices = Math.max(1, parseInt(body.max_devices, 10) || 1);
      const group = body.group || 'عام';
      const whatsapp = body.whatsapp || '';

      const generated = [];
      for (let i = 0; i < count; i++) {
        generated.push(db.create(days, note, maxDevices, group, whatsapp));
      }

      return sendJson(res, 200, { status: 'success', count: generated.length, licenses: generated });
    }

    // 13. لوحة الإدارة: تحديث بيانات المفتاح (ملاحظة، واتساب، مجموعة، أجهزة) (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/update-license') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const license = db.getAll().find(l => l.id === body.id);
      if (!license) return sendJson(res, 404, { status: 'error', message: 'غير موجود' });

      if (body.note !== undefined) license.note = (body.note || '').trim();
      if (body.whatsapp !== undefined) license.whatsapp = (body.whatsapp || '').trim();
      if (body.group !== undefined) license.group = (body.group || 'عام').trim();
      if (body.max_devices !== undefined) {
        license.max_devices = Math.max(1, parseInt(body.max_devices, 10) || 1);
      }

      db.update(license);
      return sendJson(res, 200, { status: 'success', message: 'تم تحديث بيانات المفتاح بنجاح', license });
    }

    // 14. لوحة الإدارة: تبديل حالة التفعيل (حظر/إلغاء حظر) (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/toggle-status') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const license = db.getAll().find(l => l.id === body.id);
      if (!license) return sendJson(res, 404, { status: 'error', message: 'غير موجود' });

      license.is_active = !license.is_active;
      db.update(license);
      return sendJson(res, 200, { status: 'success', is_active: license.is_active });
    }

    // 15. لوحة الإدارة: فك ربط الجهاز أو كافة الأجهزة (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/reset-device') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const license = db.getAll().find(l => l.id === body.id);
      if (!license) return sendJson(res, 404, { status: 'error', message: 'غير موجود' });

      if (body.device_id) {
        license.device_ids = (license.device_ids || []).filter(d => d !== body.device_id);
        license.device_id = license.device_ids[0] || null;
      } else {
        license.device_ids = [];
        license.device_id = null;
      }
      db.update(license);
      return sendJson(res, 200, { status: 'success', message: 'تم فك ربط الجهاز بنجاح', device_ids: license.device_ids });
    }

    // 16. لوحة الإدارة: حذف السيريال (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/delete') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
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
  console.log(`🚀 سيرفر إدارة تراخيص YouTube Plus محمي بنجاح!`);
  console.log(`🌐 لوحة التحكم: http://localhost:${PORT}`);
  console.log(`🔐 تسجيل الدخول: http://localhost:${PORT}/login`);
  console.log(`📡 نقطة التفعيل: http://localhost:${PORT}/api/activate`);
  console.log(`=======================================================`);
});
