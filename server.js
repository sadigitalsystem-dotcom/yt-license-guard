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

// وظيفة تحديد نوع الجهاز بدقة من الـ User-Agent ومعرف الجهاز
function parseDeviceType(ua = '', devId = '', explicitType = '') {
  if (explicitType && explicitType !== 'unknown' && explicitType !== 'Web-Platform') {
    return explicitType;
  }
  const userAgent = ua || '';
  if (/iPad/i.test(userAgent)) return '📱 آيباد (iPad)';
  if (/iPhone/i.test(userAgent)) return '📱 آيفون (iPhone)';
  if (/SmartTV|Tizen|Web0S|NetCast|AppleTV|HbbTV|AndroidTV/i.test(userAgent)) return '📺 شاشة ذكية (Smart TV)';
  if (/Android/i.test(userAgent)) {
    return /Mobile/i.test(userAgent) ? '🤖 هاتف أندرويد (Android)' : '🤖 تابلت أندرويد';
  }
  if (/Windows/i.test(userAgent)) return '💻 كمبيوتر (Windows PC)';
  if (/Macintosh|Mac OS/i.test(userAgent)) return '🍏 ماك (Mac)';
  if (/Linux/i.test(userAgent)) return '🐧 لينكس (Linux)';

  // الفحص الاحتياطي بناءً على بادئة المعرف
  if (devId.startsWith('IOS-') || devId.toLowerCase().includes('iphone')) return '📱 آيفون (iOS)';
  if (devId.startsWith('IPAD-') || devId.toLowerCase().includes('ipad')) return '📱 آيباد (iPad)';
  if (devId.startsWith('AND-') || devId.toLowerCase().includes('android')) return '🤖 أندرويد (Android)';
  if (devId.startsWith('PC-') || devId.toLowerCase().includes('win')) return '💻 كمبيوتر (Windows PC)';
  if (devId.startsWith('TV-') || devId.toLowerCase().includes('tv')) return '📺 شاشة ذكية (Smart TV)';
  return '📱 جهاز متصل';
}

// إدارة قاعدة البيانات كملف JSON لضمان التوافقية بنسبة 100%
class LicenseDB {
  constructor(filepath) {
    this.filepath = filepath;
    this.data = { licenses: [], admin: null, settings: null };
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
      this.data = { licenses: [], admin: null, settings: null };
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

    // تهيئة الإعدادات العامة وروابط قوقل درايف والمجموعات
    if (!this.data.settings) {
      this.data.settings = {
        custom_groups: ['عام', 'VIP', 'عائلي'],
        apk_drive_link: '',
        windows_drive_link: ''
      };
      this.save();
    } else {
      if (!Array.isArray(this.data.settings.custom_groups)) {
        this.data.settings.custom_groups = ['عام', 'VIP', 'عائلي'];
      }
      if (this.data.settings.apk_drive_link === undefined) this.data.settings.apk_drive_link = '';
      if (this.data.settings.windows_drive_link === undefined) this.data.settings.windows_drive_link = '';
    }

    // ترقية السجلات القديمة تلقائياً لدعم المجموعات وتعدد الأجهزة وواتساب ونوع الجهاز
    if (Array.isArray(this.data.licenses)) {
      let needsSave = false;
      this.data.licenses.forEach(l => {
        if (!l.max_devices) { l.max_devices = 1; needsSave = true; }
        if (!Array.isArray(l.device_ids)) {
          l.device_ids = l.device_id ? [l.device_id] : [];
          needsSave = true;
        }
        if (!Array.isArray(l.devices_info)) {
          l.devices_info = l.device_ids.map(id => ({
            id,
            type: parseDeviceType('', id),
            activated_at: l.activated_at || l.created_at,
            last_seen: l.activated_at || l.created_at
          }));
          needsSave = true;
        }
        if (!l.group) { l.group = 'عام'; needsSave = true; }
        if (l.whatsapp === undefined) { l.whatsapp = ''; needsSave = true; }
      });
      if (needsSave) this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to write licenses file:', err);
    }
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

  getSettings() {
    if (!this.data.settings) {
      this.data.settings = {
        custom_groups: ['عام', 'VIP', 'عائلي'],
        apk_drive_link: '',
        windows_drive_link: ''
      };
      this.save();
    }
    return this.data.settings;
  }

  updateSettings(newSettings) {
    this.data.settings = {
      ...this.getSettings(),
      ...newSettings
    };
    this.save();
    return this.data.settings;
  }

  addGroup(groupName) {
    const clean = (groupName || '').trim();
    if (!clean) return this.getSettings().custom_groups;
    const settings = this.getSettings();
    if (!settings.custom_groups.includes(clean)) {
      settings.custom_groups.push(clean);
      this.save();
    }
    return settings.custom_groups;
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
      devices_info: [],
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
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', err => reject(err));
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

// دالة البحث المباشر في فيديوهات يوتيوب الرسمية (Innertube API)
async function searchYouTube(query) {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        context: {
          client: {
            hl: 'ar',
            gl: 'SA',
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00'
          }
        },
        query: query || 'شائع اليوم'
      })
    });

    if (!res.ok) return [];
    const data = await res.json();
    const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (!sections) return [];

    const videos = [];
    for (const section of sections) {
      const contents = section.itemSectionRenderer?.contents || [];
      for (const item of contents) {
        const vr = item.videoRenderer;
        if (vr && vr.videoId) {
          videos.push({
            id: vr.videoId,
            title: vr.title?.runs?.map(r => r.text).join('') || 'فيديو يوتيوب',
            channel: vr.ownerText?.runs?.map(r => r.text).join('') || 'قناة يوتيوب',
            views: vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || 'مشاهدات عالية',
            time: vr.publishedTimeText?.simpleText || '',
            dur: vr.lengthText?.simpleText || 'فيديو',
            thumb: vr.thumbnail?.thumbnails?.pop()?.url || `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`
          });
        }
      }
    }
    return videos;
  } catch (err) {
    console.error('YouTube search error:', err.message);
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. مسار تسجيل الدخول (صفحة الدخول)
    if (req.method === 'GET' && pathname === '/login') {
      if (isAuthenticated(req)) {
        res.writeHead(302, { 'Location': '/' });
        res.end();
        return;
      }
      if (fs.existsSync(LOGIN_PATH)) {
        const html = fs.readFileSync(LOGIN_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('صفحة الدخول غير موجودة');
      }
      return;
    }

    // 2. الصفحة الرئيسية (لوحة التحكم - محمية بالكامل)
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

    // 3. API تسجيل دخول المسؤول (متوافق 100% مع الجوال والكمبيوتر)
    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const body = await parseJsonBody(req);
      const { email, password } = body;
      const admin = db.getAdmin();

      const inputEmail = (email || '').trim().toLowerCase();
      const currentEmail = (admin.email || '').trim().toLowerCase();

      // نقبل البريد المسجل حالياً، أو إيميل المشرف sa.digitalsystem@gmail.com، أو البريد الافتراضي
      const isEmailMatch = inputEmail === currentEmail || 
                           inputEmail === 'sa.digitalsystem@gmail.com' || 
                           inputEmail === 'admin@ytplus.com' ||
                           inputEmail === (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

      // نقبل كلمة المرور المسجلة، أو كلمة المرور الرئيسية Admin@YT2026! أو متغير البيئة
      const isPasswordMatch = password === admin.password || 
                              password === 'Admin@YT2026!' ||
                              (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD);

      if (email && password && isEmailMatch && isPasswordMatch) {
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

    // 5. API تعديل بيانات الدخول للمسؤول
    if (req.method === 'POST' && pathname === '/api/admin/change-credentials') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'يرجى تسجيل الدخول كمسؤول أولاً' });
      }
      const body = await parseJsonBody(req);
      const { current_password, new_email, new_password } = body;
      const admin = db.getAdmin();

      const isCurrentPwValid = current_password === admin.password || current_password === 'Admin@YT2026!';
      if (!isCurrentPwValid) {
        return sendJson(res, 400, { status: 'error', message: 'كلمة المرور الحالية غير صحيحة' });
      }

      db.updateAdmin(new_email || admin.email, new_password || admin.password);
      return sendJson(res, 200, { status: 'success', message: 'تم تحديث بيانات الدخول بنجاح' });
    }

    // 6. صفحة تشغيل التطبيق للويب والآيفون والكمبيوتر
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
        const defManifest = {
          name: "YouTube PLUS+ - النظام الرقمي",
          short_name: "YouTube PLUS+",
          start_url: "/app",
          display: "standalone",
          background_color: "#0f0f0f",
          theme_color: "#0f0f0f",
          icons: [
            { src: "/app_icon.png", sizes: "192x192", type: "image/png" },
            { src: "/app_icon.png", sizes: "512x512", type: "image/png" }
          ]
        };
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
        res.end(JSON.stringify(defManifest));
      }
      return;
    }

    // 8. مسار أيقونة التطبيق
    if (req.method === 'GET' && pathname === '/app_icon.png') {
      const iconPath = path.join(__dirname, 'app_icon.png');
      if (fs.existsSync(iconPath)) {
        const img = fs.readFileSync(iconPath);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(img);
        return;
      }
    }

    // 9. API البحث المباشر في فيديوهات يوتيوب الرسمية
    if (req.method === 'GET' && pathname === '/api/yt/search') {
      const query = parsedUrl.searchParams.get('q') || 'شائع اليوم';
      const videos = await searchYouTube(query);
      return sendJson(res, 200, { status: 'success', query, videos });
    }

    // 10. إعدادات وروابط التحميل العامة (Google Drive links)
    if (req.method === 'GET' && pathname === '/api/public/config') {
      const settings = db.getSettings();
      return sendJson(res, 200, {
        apk_drive_link: settings.apk_drive_link || '',
        windows_drive_link: settings.windows_drive_link || '',
        custom_groups: settings.custom_groups || ['عام', 'VIP', 'عائلي']
      });
    }

    // 11. API تفعيل الكود وربطه بالجهاز مع كشف وتخزين نوع الجهاز تلقائياً
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
      if (!Array.isArray(license.devices_info)) {
        license.devices_info = [];
      }

      const maxDev = license.max_devices || 1;
      const targetDev = device_id.trim();
      const ua = req.headers['user-agent'] || '';
      const detectedType = parseDeviceType(ua, targetDev, body.device_type || body.device_name);

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

        // تسجيل بيانات الجهاز الجديد
        license.devices_info.push({
          id: targetDev,
          type: detectedType,
          activated_at: now.toISOString(),
          last_seen: now.toISOString()
        });

        if (!license.activated_at) {
          license.activated_at = now.toISOString();
          const expiry = new Date();
          expiry.setDate(expiry.getDate() + license.duration_days);
          license.expiry_date = expiry.toISOString();
        }
        db.update(license);
      } else {
        // تحديث آخر ظهور ونوع الجهاز
        let devEntry = license.devices_info.find(d => d.id === targetDev);
        if (!devEntry) {
          devEntry = { id: targetDev, type: detectedType, activated_at: now.toISOString(), last_seen: now.toISOString() };
          license.devices_info.push(devEntry);
        } else {
          devEntry.last_seen = now.toISOString();
          if (detectedType && detectedType !== '📱 جهاز متصل') devEntry.type = detectedType;
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
        device_type: detectedType,
        devices_count: license.device_ids.length,
        devices_info: license.devices_info,
        max_devices: maxDev,
        activated_at: license.activated_at,
        expires_at: license.expiry_date,
        days_left: daysLeft
      });
    }

    // 12. API فحص الصلاحية اللحظي المباشر (Heartbeat Verification)
    if (req.method === 'POST' && pathname === '/api/verify') {
      const body = await parseJsonBody(req);
      const { serial_key, device_id } = body;

      const license = db.find(serial_key || '');
      if (!license || !license.is_active) {
        return sendJson(res, 403, { status: 'invalid', message: 'الاشتراك غير مفعّل أو تم حظره فوراً' });
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

      // تحديث توقيت آخر فحص للجهاز
      if (Array.isArray(license.devices_info)) {
        const devEntry = license.devices_info.find(d => d.id === targetDev);
        if (devEntry) devEntry.last_seen = now.toISOString();
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

    // 13. لوحة الإدارة: جلب كافة السجلات مع المجموعات وإعدادات الروابط (محمي)
    if (req.method === 'GET' && pathname === '/api/admin/licenses') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const all = db.getAll();
      const settings = db.getSettings();
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
          devices_info: Array.isArray(l.devices_info) ? l.devices_info : [],
          max_devices: l.max_devices || 1,
          group: l.group || 'عام',
          whatsapp: l.whatsapp || '',
          status_text: statusText
        };
      });
      return sendJson(res, 200, { 
        licenses: processed, 
        settings: settings 
      });
    }

    // 14. لوحة الإدارة: توليد أكواد جديدة (محمي)
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

    // 15. لوحة الإدارة: تحديث بيانات المفتاح (ملاحظة، واتساب، مجموعة، أجهزة) (محمي)
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

    // 16. لوحة الإدارة: إضافة مجموعة جديدة مخصصة (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/create-group') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const name = (body.group_name || '').trim();
      if (!name) return sendJson(res, 400, { status: 'error', message: 'اسم المجموعة مطلوب' });

      const updatedGroups = db.addGroup(name);
      return sendJson(res, 200, { status: 'success', message: 'تم إنشاء المجموعة بنجاح', custom_groups: updatedGroups });
    }

    // 17. لوحة الإدارة: تحديث روابط التحميل والإعدادات العامة (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/settings') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const newSettings = {};
      if (body.apk_drive_link !== undefined) newSettings.apk_drive_link = (body.apk_drive_link || '').trim();
      if (body.windows_drive_link !== undefined) newSettings.windows_drive_link = (body.windows_drive_link || '').trim();
      if (Array.isArray(body.custom_groups)) newSettings.custom_groups = body.custom_groups;

      const updated = db.updateSettings(newSettings);
      return sendJson(res, 200, { status: 'success', message: 'تم حفظ الإعدادات بنجاح', settings: updated });
    }

    // 18. لوحة الإدارة: تبديل حالة التفعيل (حظر/إلغاء حظر) (محمي)
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

    // 19. لوحة الإدارة: فك ربط جهاز محدد أو كافة الأجهزة (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/reset-device') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const license = db.getAll().find(l => l.id === body.id);
      if (!license) return sendJson(res, 404, { status: 'error', message: 'غير موجود' });

      if (body.device_id) {
        const target = body.device_id.trim();
        license.device_ids = (license.device_ids || []).filter(d => d !== target);
        license.device_id = license.device_ids[0] || null;
        license.devices_info = (license.devices_info || []).filter(d => d.id !== target);
      } else {
        license.device_ids = [];
        license.devices_info = [];
        license.device_id = null;
      }
      db.update(license);
      return sendJson(res, 200, { 
        status: 'success', 
        message: 'تم فك ربط الجهاز بنجاح', 
        device_ids: license.device_ids, 
        devices_info: license.devices_info 
      });
    }

    // 20. لوحة الإدارة: حذف السيريال نهائياً (محمي)
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
  console.log('=======================================================');
  console.log('🚀 سيرفر إدارة تراخيص YouTube PLUS+ (النظام الرقمي) محمي بنجاح!');
  console.log(`🌐 لوحة التحكم: http://localhost:${PORT}`);
  console.log(`🔐 تسجيل الدخول: http://localhost:${PORT}/login`);
  console.log(`📡 نقطة التفعيل: http://localhost:${PORT}/api/activate`);
  console.log('=======================================================');
});
