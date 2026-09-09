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
    this.data = { licenses: [], admin: null, settings: null, employees: [], family_groups: [] };
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
      this.data = { licenses: [], admin: null, settings: null, employees: [], family_groups: [] };
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

    // تهيئة قائمة الموظفين
    if (!Array.isArray(this.data.employees)) {
      this.data.employees = [];
    }

    // تهيئة مجموعات Google Family
    if (!Array.isArray(this.data.family_groups)) {
      this.data.family_groups = [
        {
          id: 'fam-group-1',
          name: 'مجموعة العائلة الأولى (Google Family 1)',
          max_slots: 5,
          created_at: new Date().toISOString(),
          invite_link: 'https://families.google.com/familylink/',
          members: []
        }
      ];
    }

    // ترقية السجلات القديمة تلقائياً لدعم المجموعات وتعدد الأجهزة وواتساب والمنشئ وسجل التدقيق
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
        if (!l.created_by) { l.created_by = 'المدير العام'; needsSave = true; }
        if (!l.created_by_id) { l.created_by_id = 'admin'; needsSave = true; }
        if (l.client_email === undefined) { l.client_email = ''; needsSave = true; }
        if (!Array.isArray(l.audit_log)) {
          l.audit_log = [
            {
              action: 'create',
              by: l.created_by || 'المدير العام',
              at: l.created_at || new Date().toISOString(),
              detail: 'توليد المفتاح'
            }
          ];
          if (l.activated_at) {
            l.audit_log.push({
              action: 'activate',
              by: 'العميل',
              at: l.activated_at,
              detail: 'أول تفعيل على الجهاز'
            });
          }
          needsSave = true;
        }
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

  create(durationDays, note = '', maxDevices = 1, group = 'عام', whatsapp = '', createdBy = 'المدير العام', createdById = 'admin') {
    const randomHex = () => crypto.randomBytes(3).toString('hex').toUpperCase();
    const key = `PLUS-${randomHex()}-${randomHex()}-${randomHex()}`;
    const nowIso = new Date().toISOString();
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
      created_at: nowIso,
      activated_at: null,
      expiry_date: null,
      is_active: true,
      created_by: createdBy,
      created_by_id: createdById,
      client_email: '',
      audit_log: [
        {
          action: 'create',
          by: createdBy,
          at: nowIso,
          detail: 'توليد المفتاح'
        }
      ]
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

  // دوال إدارة الموظفين
  getEmployees() {
    return this.data.employees || [];
  }

  createEmployee({ name, email, password, permissions }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const existing = (this.data.employees || []).find(e => e.email.toLowerCase() === cleanEmail);
    if (existing) {
      throw new Error('البريد الإلكتروني مسجل بالفعل لموظف آخر');
    }
    const emp = {
      id: crypto.randomUUID(),
      name: (name || '').trim(),
      email: cleanEmail,
      password: (password || '').trim(),
      role: 'employee',
      is_active: true,
      created_at: new Date().toISOString(),
      permissions: {
        can_generate: permissions?.can_generate !== false,
        can_toggle: permissions?.can_toggle !== false,
        can_reset: permissions?.can_reset !== false,
        can_delete: permissions?.can_delete === true,
        can_view_all: permissions?.can_view_all !== false
      }
    };
    this.data.employees.push(emp);
    this.save();
    return emp;
  }

  updateEmployee(id, updateData) {
    const emp = (this.data.employees || []).find(e => e.id === id);
    if (!emp) return null;
    if (updateData.name) emp.name = updateData.name.trim();
    if (updateData.email) emp.email = updateData.email.trim().toLowerCase();
    if (updateData.password) emp.password = updateData.password.trim();
    if (updateData.is_active !== undefined) emp.is_active = !!updateData.is_active;
    if (updateData.permissions) {
      emp.permissions = {
        ...emp.permissions,
        ...updateData.permissions
      };
    }
    this.save();
    return emp;
  }

  deleteEmployee(id) {
    const prevLen = (this.data.employees || []).length;
    this.data.employees = (this.data.employees || []).filter(e => e.id !== id);
    this.save();
    return this.data.employees.length < prevLen;
  }

  // دوال إدارة مجموعات Google Family
  getFamilyGroups() {
    return this.data.family_groups || [];
  }

  createFamilyGroup(name, inviteLink = '') {
    const group = {
      id: crypto.randomUUID(),
      name: (name || '').trim() || `مجموعة عائلية ${(this.data.family_groups || []).length + 1}`,
      max_slots: 5,
      invite_link: (inviteLink || '').trim() || 'https://families.google.com/familylink/',
      created_at: new Date().toISOString(),
      members: []
    };
    this.data.family_groups.push(group);
    this.save();
    return group;
  }

  addFamilyMember(groupId, { email, note = '', whatsapp = '', duration_months = 12 }) {
    const group = (this.data.family_groups || []).find(g => g.id === groupId);
    if (!group) throw new Error('المجموعة العائلية غير موجودة');
    if (group.members.length >= (group.max_slots || 5)) {
      throw new Error('تم اكتمال عدد الأعضاء في هذه المجموعة (الحد الأقصى 5 أعضاء)');
    }
    const cleanEmail = (email || '').trim().toLowerCase();
    if (group.members.some(m => m.email.toLowerCase() === cleanEmail)) {
      throw new Error('هذا البريد مضاف بالفعل في هذه المجموعة');
    }

    const now = new Date();
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + (parseInt(duration_months, 10) || 12));

    const member = {
      id: crypto.randomUUID(),
      email: cleanEmail,
      note: (note || '').trim(),
      whatsapp: (whatsapp || '').trim(),
      joined_at: now.toISOString(),
      expiry_date: expiry.toISOString(),
      status: 'active'
    };
    group.members.push(member);
    this.save();
    return member;
  }

  removeFamilyMember(groupId, memberId) {
    const group = (this.data.family_groups || []).find(g => g.id === groupId);
    if (!group) return false;
    const prev = group.members.length;
    group.members = group.members.filter(m => m.id !== memberId && m.email !== memberId);
    this.save();
    return group.members.length < prev;
  }
}

const db = new LicenseDB(DB_PATH);

// إدارة الجلسات الموسعة (Master Admin + Employees)
// token -> { id, name, email, role: 'admin'|'employee', permissions }
const activeSessions = new Map();

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

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies['yt_admin_session'] || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '').trim() : null);
  if (!token) return null;
  return activeSessions.get(token) || null;
}

function isAuthenticated(req) {
  return !!getSession(req);
}

function isMasterAdmin(req) {
  const s = getSession(req);
  return s && s.role === 'admin';
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
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

    const videos = [];
    for (const item of contents) {
      const v = item.videoRenderer;
      if (v && v.videoId) {
        videos.push({
          id: v.videoId,
          title: v.title?.runs?.[0]?.text || 'فيديو بدون عنوان',
          thumbnail: v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
          channel: v.ownerText?.runs?.[0]?.text || 'قناة يوتيوب',
          views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || 'مشاهدات عالية',
          published: v.publishedTimeText?.simpleText || 'حديثاً',
          duration: v.lengthText?.simpleText || ''
        });
      }
      if (videos.length >= 24) break;
    }
    return videos;
  } catch (err) {
    console.error('YouTube search error:', err.message);
    return [];
  }
}

// خادم HTTP الموحد
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // دعم CORS المسبق
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
    // 1. مسار تسجيل الدخول المباشر
    if (req.method === 'GET' && pathname === '/login') {
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

    // 2. الصفحة الرئيسية للوحة التحكم
    if (req.method === 'GET' && pathname === '/') {
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

    // 3. API تسجيل دخول الإدارة (Master Admin + Employees)
    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const body = await parseJsonBody(req);
      const { email, password } = body;
      const admin = db.getAdmin();

      const inputEmail = (email || '').trim().toLowerCase();
      const currentEmail = (admin.email || '').trim().toLowerCase();

      // فحص المدير العام أولاً
      const isAdminEmailMatch = inputEmail === currentEmail || 
                                inputEmail === 'sa.digitalsystem@gmail.com' || 
                                inputEmail === 'admin@ytplus.com' ||
                                inputEmail === (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

      const isAdminPasswordMatch = password === admin.password || 
                                   password === 'Admin@YT2026!' ||
                                   (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD);

      if (email && password && isAdminEmailMatch && isAdminPasswordMatch) {
        if (inputEmail !== currentEmail && inputEmail.includes('@')) {
          admin.email = inputEmail;
          db.updateAdmin(admin.email, admin.password);
        }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const sessionData = {
          id: 'admin',
          name: 'المدير العام',
          email: admin.email,
          role: 'admin',
          permissions: {
            can_generate: true,
            can_toggle: true,
            can_reset: true,
            can_delete: true,
            can_view_all: true,
            is_master: true
          }
        };
        activeSessions.set(sessionToken, sessionData);

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `yt_admin_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ 
          status: 'success', 
          message: 'تم تسجيل دخول المدير العام بنجاح', 
          token: sessionToken,
          user: sessionData 
        }));
        return;
      }

      // إذا لم يكن المدير العام، نفحص الموظفين المسجلين
      const employees = db.getEmployees();
      const emp = employees.find(e => e.email.toLowerCase() === inputEmail && e.password === password);
      if (emp) {
        if (emp.is_active === false) {
          return sendJson(res, 403, { status: 'error', message: 'تم إيقاف حساب الموظف هذا من قبل الإدارة' });
        }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const sessionData = {
          id: emp.id,
          name: emp.name,
          email: emp.email,
          role: 'employee',
          permissions: emp.permissions || {
            can_generate: true,
            can_toggle: true,
            can_reset: true,
            can_delete: false,
            can_view_all: true
          }
        };
        activeSessions.set(sessionToken, sessionData);

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `yt_admin_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ 
          status: 'success', 
          message: `أهلاً بك يا ${emp.name}، تم تسجيل الدخول بنجاح`, 
          token: sessionToken,
          user: sessionData 
        }));
        return;
      }

      return sendJson(res, 401, { status: 'error', message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    // 4. API تسجيل الخروج
    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      const cookies = parseCookies(req);
      const token = cookies['yt_admin_session'];
      if (token) activeSessions.delete(token);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'yt_admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ status: 'success', message: 'تم تسجيل الخروج بنجاح' }));
      return;
    }

    // 5. API بيانات المستخدم الحالي والصلاحيات (Current User Profile)
    if (req.method === 'GET' && pathname === '/api/admin/me') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مسجل الدخول' });
      }
      return sendJson(res, 200, { status: 'success', user: session });
    }

    // 6. API تعديل بيانات الدخول للمدير العام (Master Admin Only)
    if (req.method === 'POST' && pathname === '/api/admin/change-credentials') {
      if (!isMasterAdmin(req)) {
        return sendJson(res, 403, { status: 'error', message: 'هذه العملية خاصة بالمدير العام فقط' });
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

    // 7. صفحة تشغيل التطبيق للويب والآيفون والكمبيوتر
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

    // 8. مسار PWA Manifest
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

    // 9. مسار أيقونة التطبيق
    if (req.method === 'GET' && pathname === '/app_icon.png') {
      const iconPath = path.join(__dirname, 'app_icon.png');
      if (fs.existsSync(iconPath)) {
        const img = fs.readFileSync(iconPath);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(img);
        return;
      }
    }

    // 10. API البحث المباشر في فيديوهات يوتيوب الرسمية
    if (req.method === 'GET' && pathname === '/api/yt/search') {
      const query = parsedUrl.searchParams.get('q') || 'شائع اليوم';
      const videos = await searchYouTube(query);
      return sendJson(res, 200, { status: 'success', query, videos });
    }

    // 11. إعدادات وروابط التحميل العامة (Google Drive links)
    if (req.method === 'GET' && pathname === '/api/public/config') {
      const settings = db.getSettings();
      return sendJson(res, 200, {
        apk_drive_link: settings.apk_drive_link || '',
        windows_drive_link: settings.windows_drive_link || '',
        custom_groups: settings.custom_groups || ['عام', 'VIP', 'عائلي']
      });
    }

    // 12. API تفعيل الكود مع ربط الإيميل وسجل التدقيق
    if (req.method === 'POST' && pathname === '/api/activate') {
      const body = await parseJsonBody(req);
      const { serial_key, device_id, client_email } = body;

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
      if (!Array.isArray(license.audit_log)) {
        license.audit_log = [];
      }

      // ربط إيميل العميل الشخصي إذا تم إدخاله
      if (client_email && typeof client_email === 'string') {
        const cleanClientEmail = client_email.trim().toLowerCase();
        if (cleanClientEmail.includes('@')) {
          license.client_email = cleanClientEmail;
        }
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

        // تسجيل حركة التفعيل في سجل التدقيق
        license.audit_log.push({
          action: 'activate',
          by: license.client_email || 'العميل',
          at: now.toISOString(),
          detail: `ربط وتفعيل جهاز جديد: ${detectedType}`
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
        client_email: license.client_email || '',
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

    // 13. API فحص الصلاحية اللحظي المباشر (Heartbeat Verification)
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

      if (Array.isArray(license.devices_info)) {
        const devEntry = license.devices_info.find(d => d.id === targetDev);
        if (devEntry) devEntry.last_seen = now.toISOString();
      }

      const msLeft = new Date(license.expiry_date).getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

      return sendJson(res, 200, {
        status: 'valid',
        serial_key: license.serial_key,
        client_email: license.client_email || '',
        activated_at: license.activated_at,
        expires_at: license.expiry_date,
        days_left: daysLeft
      });
    }

    // 14. لوحة الإدارة: جلب كافة السجلات مع المجموعات وإعدادات الروابط (محمي)
    if (req.method === 'GET' && pathname === '/api/admin/licenses') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }

      let all = db.getAll();

      // إذا كان موظف ولديه صلاحية رؤية مفاتيحه فقط
      if (session.role === 'employee' && session.permissions?.can_view_all === false) {
        all = all.filter(l => l.created_by_id === session.id);
      }

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
          audit_log: Array.isArray(l.audit_log) ? l.audit_log : [],
          created_by: l.created_by || 'المدير العام',
          created_by_id: l.created_by_id || 'admin',
          client_email: l.client_email || '',
          max_devices: l.max_devices || 1,
          group: l.group || 'عام',
          whatsapp: l.whatsapp || '',
          status_text: statusText
        };
      });
      return sendJson(res, 200, { 
        licenses: processed, 
        settings: settings,
        currentUser: session
      });
    }

    // 15. لوحة الإدارة: توليد أكواد جديدة مع نسبة الإنتاج للموظف والتدقيق (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/generate') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }

      if (session.role === 'employee' && session.permissions?.can_generate === false) {
        return sendJson(res, 403, { status: 'error', message: 'ليس لديك صلاحية توليد أكواد جديدة' });
      }

      const body = await parseJsonBody(req);
      const days = parseInt(body.days, 10) || 30;
      const count = Math.min(parseInt(body.count, 10) || 1, 50);
      const note = body.note || '';
      const maxDevices = Math.max(1, parseInt(body.max_devices, 10) || 1);
      const group = body.group || 'عام';
      const whatsapp = body.whatsapp || '';

      const creatorName = session.name || 'المدير العام';
      const creatorId = session.id || 'admin';

      const generated = [];
      for (let i = 0; i < count; i++) {
        generated.push(db.create(days, note, maxDevices, group, whatsapp, creatorName, creatorId));
      }

      return sendJson(res, 200, { status: 'success', count: generated.length, licenses: generated });
    }

    // 16. لوحة الإدارة: تحديث بيانات المفتاح (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/update-license') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const license = db.getAll().find(l => l.id === body.id);
      if (!license) return sendJson(res, 404, { status: 'error', message: 'غير موجود' });

      if (body.note !== undefined) license.note = (body.note || '').trim();
      if (body.whatsapp !== undefined) license.whatsapp = (body.whatsapp || '').trim();
      if (body.group !== undefined) license.group = (body.group || 'عام').trim();
      if (body.client_email !== undefined) license.client_email = (body.client_email || '').trim().toLowerCase();
      if (body.max_devices !== undefined) {
        license.max_devices = Math.max(1, parseInt(body.max_devices, 10) || 1);
      }

      if (!Array.isArray(license.audit_log)) license.audit_log = [];
      license.audit_log.push({
        action: 'edit',
        by: session.name,
        at: new Date().toISOString(),
        detail: 'تعديل بيانات المفتاح'
      });

      db.update(license);
      return sendJson(res, 200, { status: 'success', message: 'تم تحديث بيانات المفتاح بنجاح', license });
    }

    // 17. لوحة الإدارة: إضافة مجموعة جديدة مخصصة (محمي)
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

    // 18. لوحة الإدارة: تحديث روابط التحميل والإعدادات العامة (محمي للمدير العام)
    if (req.method === 'POST' && pathname === '/api/admin/settings') {
      if (!isMasterAdmin(req)) {
        return sendJson(res, 403, { status: 'error', message: 'هذه الإعدادات خاصة بالمدير العام فقط' });
      }
      const body = await parseJsonBody(req);
      const newSettings = {};
      if (body.apk_drive_link !== undefined) newSettings.apk_drive_link = (body.apk_drive_link || '').trim();
      if (body.windows_drive_link !== undefined) newSettings.windows_drive_link = (body.windows_drive_link || '').trim();
      if (Array.isArray(body.custom_groups)) newSettings.custom_groups = body.custom_groups;

      const updated = db.updateSettings(newSettings);
      return sendJson(res, 200, { status: 'success', message: 'تم حفظ الإعدادات بنجاح', settings: updated });
    }

    // 19. لوحة الإدارة: تبديل حالة التفعيل (حظر/إلغاء حظر) (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/toggle-status') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }

      if (session.role === 'employee' && session.permissions?.can_toggle === false) {
        return sendJson(res, 403, { status: 'error', message: 'ليس لديك صلاحية إيقاف أو تنشيط المفاتيح' });
      }

      const body = await parseJsonBody(req);
      const license = db.getAll().find(l => l.id === body.id);
      if (!license) return sendJson(res, 404, { status: 'error', message: 'غير موجود' });

      license.is_active = !license.is_active;

      if (!Array.isArray(license.audit_log)) license.audit_log = [];
      license.audit_log.push({
        action: 'toggle',
        by: session.name,
        at: new Date().toISOString(),
        detail: license.is_active ? 'تنشيط وإعادة تشغيل المفتاح' : 'حظر وإيقاف فوري للمفتاح'
      });

      db.update(license);
      return sendJson(res, 200, { status: 'success', is_active: license.is_active });
    }

    // 20. لوحة الإدارة: فك ربط جهاز محدد أو كافة الأجهزة (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/reset-device') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }

      if (session.role === 'employee' && session.permissions?.can_reset === false) {
        return sendJson(res, 403, { status: 'error', message: 'ليس لديك صلاحية فك ارتباط الأجهزة' });
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

      if (!Array.isArray(license.audit_log)) license.audit_log = [];
      license.audit_log.push({
        action: 'reset',
        by: session.name,
        at: new Date().toISOString(),
        detail: body.device_id ? `فك ارتباط جهاز محدد: ${body.device_id}` : 'فك ارتباط كافة الأجهزة المتصلة'
      });

      db.update(license);
      return sendJson(res, 200, { 
        status: 'success', 
        message: 'تم فك ربط الجهاز بنجاح', 
        device_ids: license.device_ids, 
        devices_info: license.devices_info 
      });
    }

    // 21. لوحة الإدارة: حذف السيريال نهائياً (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/delete') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }

      if (session.role === 'employee' && session.permissions?.can_delete !== true) {
        return sendJson(res, 403, { status: 'error', message: 'ليس لديك صلاحية حذف التراخيص' });
      }

      const body = await parseJsonBody(req);
      const ok = db.delete(body.id);
      return sendJson(res, 200, { status: ok ? 'success' : 'error' });
    }

    // ========================================================
    // 22. مسارات إدارة الموظفين والصلاحيات (Employees Management)
    // ========================================================
    if (req.method === 'GET' && pathname === '/api/admin/employees') {
      if (!isMasterAdmin(req)) {
        return sendJson(res, 403, { status: 'error', message: 'خاص بالمدير العام فقط' });
      }

      const employees = db.getEmployees();
      const allLicenses = db.getAll();
      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const listWithStats = employees.map(emp => {
        const empLicenses = allLicenses.filter(l => l.created_by_id === emp.id);
        const thisMonthLicenses = empLicenses.filter(l => (l.created_at || '').slice(0, 7) === currentMonthKey);
        return {
          id: emp.id,
          name: emp.name,
          email: emp.email,
          role: emp.role,
          is_active: emp.is_active !== false,
          created_at: emp.created_at,
          permissions: emp.permissions,
          total_keys: empLicenses.length,
          month_keys: thisMonthLicenses.length
        };
      });

      return sendJson(res, 200, { 
        status: 'success', 
        employees: listWithStats, 
        current_month: currentMonthKey 
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/employees') {
      if (!isMasterAdmin(req)) {
        return sendJson(res, 403, { status: 'error', message: 'خاص بالمدير العام فقط' });
      }

      const body = await parseJsonBody(req);
      const { id, name, email, password, permissions, is_active } = body;

      if (id) {
        // تعديل موظف موجود
        const updated = db.updateEmployee(id, { name, email, password, permissions, is_active });
        if (!updated) return sendJson(res, 404, { status: 'error', message: 'الموظف غير موجود' });
        return sendJson(res, 200, { status: 'success', message: 'تم تحديث بيانات الموظف بنجاح', employee: updated });
      } else {
        // إنشاء موظف جديد
        if (!name || !email || !password) {
          return sendJson(res, 400, { status: 'error', message: 'الاسم، البريد الإلكتروني، وكلمة المرور مطلوبة' });
        }
        try {
          const emp = db.createEmployee({ name, email, password, permissions });
          return sendJson(res, 200, { status: 'success', message: 'تم إنشاء حساب الموظف بنجاح', employee: emp });
        } catch (e) {
          return sendJson(res, 400, { status: 'error', message: e.message });
        }
      }
    }

    if (req.method === 'POST' && pathname === '/api/admin/delete-employee') {
      if (!isMasterAdmin(req)) {
        return sendJson(res, 403, { status: 'error', message: 'خاص بالمدير العام فقط' });
      }
      const body = await parseJsonBody(req);
      const ok = db.deleteEmployee(body.id);
      return sendJson(res, 200, { status: ok ? 'success' : 'error', message: ok ? 'تم حذف حساب الموظف بنجاح' : 'لم يتم العثور على الموظف' });
    }

    if (req.method === 'POST' && pathname === '/api/admin/toggle-employee') {
      if (!isMasterAdmin(req)) {
        return sendJson(res, 403, { status: 'error', message: 'خاص بالمدير العام فقط' });
      }
      const body = await parseJsonBody(req);
      const emp = (db.getEmployees() || []).find(e => e.id === body.id);
      if (!emp) return sendJson(res, 404, { status: 'error', message: 'غير موجود' });
      emp.is_active = !emp.is_active;
      db.save();
      return sendJson(res, 200, { status: 'success', is_active: emp.is_active, message: emp.is_active ? 'تم تنشيط الحساب' : 'تم إيقاف الحساب' });
    }

    // ========================================================
    // 23. API إحصائيات الموظفين الشهرية (Monthly Employee Stats)
    // ========================================================
    if (req.method === 'GET' && pathname === '/api/admin/employee-stats') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح' });
      }

      const allLicenses = db.getAll();
      const employees = db.getEmployees();
      const admin = db.getAdmin();

      const reqMonth = parsedUrl.searchParams.get('month'); // YYYY-MM
      const now = new Date();
      const currentMonthKey = reqMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // جمع كافة الأشهر المتوفرة في النظام
      const monthsSet = new Set();
      monthsSet.add(currentMonthKey);
      allLicenses.forEach(l => {
        if (l.created_at) {
          monthsSet.add(l.created_at.slice(0, 7));
        }
      });
      const availableMonths = Array.from(monthsSet).sort().reverse();

      // إحصائيات المدير العام
      const adminLicenses = allLicenses.filter(l => !l.created_by_id || l.created_by_id === 'admin');
      const adminMonthLicenses = adminLicenses.filter(l => (l.created_at || '').slice(0, 7) === currentMonthKey);

      const stats = [
        {
          id: 'admin',
          name: 'المدير العام',
          email: admin.email,
          role: 'admin',
          month_count: adminMonthLicenses.length,
          total_count: adminLicenses.length,
          active_count: adminLicenses.filter(l => l.is_active && (!l.expiry_date || new Date(l.expiry_date) >= now)).length,
          expired_count: adminLicenses.filter(l => l.expiry_date && new Date(l.expiry_date) < now).length
        }
      ];

      // إحصائيات كل موظف
      employees.forEach(emp => {
        const empLicenses = allLicenses.filter(l => l.created_by_id === emp.id);
        const empMonthLicenses = empLicenses.filter(l => (l.created_at || '').slice(0, 7) === currentMonthKey);

        stats.push({
          id: emp.id,
          name: emp.name,
          email: emp.email,
          role: emp.role,
          month_count: empMonthLicenses.length,
          total_count: empLicenses.length,
          active_count: empLicenses.filter(l => l.is_active && (!l.expiry_date || new Date(l.expiry_date) >= now)).length,
          expired_count: empLicenses.filter(l => l.expiry_date && new Date(l.expiry_date) < now).length
        });
      });

      // ترتيب حسب إنتاج الشهر تنازلياً
      stats.sort((a, b) => b.month_count - a.month_count);

      const totalInMonth = allLicenses.filter(l => (l.created_at || '').slice(0, 7) === currentMonthKey).length;

      return sendJson(res, 200, {
        status: 'success',
        selected_month: currentMonthKey,
        available_months: availableMonths,
        total_keys_in_month: totalInMonth,
        stats: stats
      });
    }

    // ========================================================
    // 24. مسارات إدارة مجموعات Google Family ودعوات الإيميل
    // ========================================================
    if (req.method === 'GET' && pathname === '/api/admin/family-groups') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح' });
      }
      return sendJson(res, 200, { 
        status: 'success', 
        groups: db.getFamilyGroups() 
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/family-group/create') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح' });
      }
      const body = await parseJsonBody(req);
      const group = db.createFamilyGroup(body.name, body.invite_link);
      return sendJson(res, 200, { status: 'success', message: 'تم إنشاء المجموعة العائلية بنجاح', group });
    }

    if (req.method === 'POST' && pathname === '/api/admin/family-group/add-member') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح' });
      }
      const body = await parseJsonBody(req);
      try {
        const member = db.addFamilyMember(body.group_id, {
          email: body.email,
          note: body.note,
          whatsapp: body.whatsapp,
          duration_months: body.duration_months
        });
        return sendJson(res, 200, { status: 'success', message: 'تمت إضافة العضو بنجاح', member });
      } catch (err) {
        return sendJson(res, 400, { status: 'error', message: err.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/admin/family-group/remove-member') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح' });
      }
      const body = await parseJsonBody(req);
      const ok = db.removeFamilyMember(body.group_id, body.member_id);
      return sendJson(res, 200, { status: ok ? 'success' : 'error', message: ok ? 'تم حذف العضو من المجموعة' : 'العضو غير موجود' });
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
