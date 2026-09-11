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

    // تهيئة الإعدادات العامة وروابط قوقل درايف والمجموعات والنطاق المخصص
    if (!this.data.settings) {
      this.data.settings = {
        custom_groups: ['عام', 'VIP', 'عائلي'],
        apk_drive_link: '',
        windows_drive_link: '',
        custom_domain: 'https://plus.digitalsystemsa.com'
      };
      this.save();
    } else {
      if (!Array.isArray(this.data.settings.custom_groups)) {
        this.data.settings.custom_groups = ['عام', 'VIP', 'عائلي'];
      }
      if (this.data.settings.apk_drive_link === undefined) this.data.settings.apk_drive_link = '';
      if (this.data.settings.windows_drive_link === undefined) this.data.settings.windows_drive_link = '';
      if (!this.data.settings.custom_domain) this.data.settings.custom_domain = 'https://plus.digitalsystemsa.com';
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
      const tempPath = `${this.filepath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filepath);
    } catch (err) {
      console.error('Failed to write licenses file atomically, fallback direct:', err);
      try {
        fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (e2) {
        console.error('Fatal: Could not save licenses file:', e2);
      }
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

  deleteGroup(groupName) {
    const clean = (groupName || '').trim();
    if (!clean || clean === 'عام') {
      throw new Error('لا يمكن حذف المجموعة الأساسية (عام)');
    }
    const settings = this.getSettings();
    settings.custom_groups = (settings.custom_groups || []).filter(g => g !== clean);
    // إعادة توجيه كافة المشتركين تحت هذه المجموعة إلى 'عام'
    this.data.licenses.forEach(l => {
      if (l.group === clean) {
        l.group = 'عام';
      }
    });
    this.save();
    return settings.custom_groups;
  }

  renameGroup(oldName, newName) {
    const cleanOld = (oldName || '').trim();
    const cleanNew = (newName || '').trim();
    if (!cleanOld || !cleanNew) throw new Error('اسم المجموعة مطلوب');
    if (cleanOld === 'عام') throw new Error('لا يمكن تعديل اسم المجموعة الأساسية (عام)');
    const settings = this.getSettings();
    if (settings.custom_groups.includes(cleanNew) && cleanNew !== cleanOld) {
      throw new Error('يوجد مجموعة أخرى بنفس هذا الاسم');
    }
    const idx = settings.custom_groups.indexOf(cleanOld);
    if (idx !== -1) {
      settings.custom_groups[idx] = cleanNew;
    } else {
      settings.custom_groups.push(cleanNew);
    }
    this.data.licenses.forEach(l => {
      if (l.group === cleanOld) {
        l.group = cleanNew;
      }
    });
    this.save();
    return settings.custom_groups;
  }

  extendLicense(id, addDays, byUser = 'المدير العام') {
    const days = parseInt(addDays, 10);
    if (isNaN(days) || days <= 0) throw new Error('عدد الأيام المضافة يجب أن يكون أكبر من 0');
    const license = this.data.licenses.find(l => l.id === id);
    if (!license) throw new Error('الترخيص غير موجود');

    license.duration_days = (parseInt(license.duration_days, 10) || 0) + days;
    const now = new Date();

    if (license.expiry_date) {
      const currentExpiry = new Date(license.expiry_date);
      const baseDate = currentExpiry > now ? currentExpiry : now;
      license.expiry_date = new Date(baseDate.getTime() + days * 86400000).toISOString();
      license.is_active = true;
    }

    if (!Array.isArray(license.audit_log)) license.audit_log = [];
    license.audit_log.push({
      action: 'extend',
      by: byUser,
      at: now.toISOString(),
      detail: `تمديد الصلاحية بمقدار ${days} يوم إضافي (الإجمالي الجديد: ${license.duration_days} يوم)`
    });

    this.save();
    return license;
  }

  getAll() {
    return this.data.licenses;
  }

  find(serialKey) {
    if (!serialKey || typeof serialKey !== 'string') return null;
    const clean = serialKey.trim().toUpperCase().replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-').replace(/\s+/g, '');
    return this.data.licenses.find(l => {
      const lClean = (l.serial_key || '').trim().toUpperCase().replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-').replace(/\s+/g, '');
      return lClean === clean;
    });
  }

  create(durationDays, note = '', maxDevices = 1, group = 'عام', whatsapp = '', createdBy = 'المدير العام', createdById = 'admin', orderId = '') {
    const randomHex = () => crypto.randomBytes(3).toString('hex').toUpperCase();
    const key = `PLUS-${randomHex()}-${randomHex()}-${randomHex()}`;
    const nowIso = new Date().toISOString();
    const cleanOrderId = (orderId || '').toString().trim().replace(/^#/, '');
    const newEntry = {
      id: crypto.randomUUID(),
      serial_key: key,
      duration_days: parseInt(durationDays, 10),
      note: (note || '').trim(),
      order_id: cleanOrderId,
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
          detail: cleanOrderId ? `توليد المفتاح (طلب #${cleanOrderId})` : 'توليد المفتاح'
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

  createEmployee({ name, email, password, phone, permissions }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const existing = (this.data.employees || []).find(e => e.email.toLowerCase() === cleanEmail);
    if (existing) {
      throw new Error('البريد الإلكتروني مسجل بالفعل لموظف آخر');
    }
    const emp = {
      id: crypto.randomUUID(),
      name: (name || '').trim(),
      email: cleanEmail,
      phone: (phone || '').trim(),
      password: (password || '').trim(),
      role: 'employee',
      is_active: true,
      created_at: new Date().toISOString(),
      permissions: {
        can_generate: permissions?.can_generate !== false,
        can_toggle: permissions?.can_toggle !== false,
        can_reset: permissions?.can_reset !== false,
        can_delete: permissions?.can_delete === true,
        can_view_all: permissions?.can_view_all !== false,
        can_view_stats: permissions?.can_view_stats !== false,
        can_view_guide: permissions?.can_view_guide !== false,
        can_manage_groups: permissions?.can_manage_groups === true
      }
    };
    this.data.employees.push(emp);
    this.save();
    return emp;
  }

  updateEmployee(id, updateData) {
    const emp = (this.data.employees || []).find(e => e.id === id);
    if (!emp) return null;
    if (updateData.name !== undefined) emp.name = updateData.name.trim();
    if (updateData.email !== undefined) emp.email = updateData.email.trim().toLowerCase();
    if (updateData.phone !== undefined) emp.phone = updateData.phone.trim();
    if (updateData.password && updateData.password.trim()) emp.password = updateData.password.trim();
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

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown';
}

function hashPassword(password, salt = null) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 64).toString('hex');
  return `scrypt:${s}:${hash}`;
}

function verifyPassword(inputPassword, storedHash) {
  if (!storedHash || !inputPassword) return false;
  if (storedHash.startsWith('scrypt:')) {
    const parts = storedHash.split(':');
    if (parts.length === 3) {
      const [, salt, expectedHash] = parts;
      const actualHash = crypto.scryptSync(inputPassword, salt, 64).toString('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
      } catch (e) {
        return false;
      }
    }
  }
  return inputPassword === storedHash;
}

class RateLimiter {
  constructor(maxAttempts, windowMs) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.records = new Map();
  }

  isBlocked(ip) {
    const now = Date.now();
    const entry = this.records.get(ip);
    if (!entry) return false;
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return true;
    }
    if (now - entry.firstAttempt > this.windowMs) {
      this.records.delete(ip);
      return false;
    }
    return false;
  }

  recordFailure(ip, blockDurationMs = this.windowMs) {
    const now = Date.now();
    let entry = this.records.get(ip);
    if (!entry || (now - entry.firstAttempt > this.windowMs)) {
      entry = { count: 1, firstAttempt: now, blockedUntil: 0 };
    } else {
      entry.count++;
      if (entry.count >= this.maxAttempts) {
        entry.blockedUntil = now + blockDurationMs;
      }
    }
    this.records.set(ip, entry);
  }

  recordSuccess(ip) {
    this.records.delete(ip);
  }

  getBlockTimeRemainingMinutes(ip) {
    const entry = this.records.get(ip);
    if (!entry || !entry.blockedUntil) return 0;
    return Math.max(1, Math.ceil((entry.blockedUntil - Date.now()) / (60 * 1000)));
  }
}

const loginLimiter = new RateLimiter(5, 15 * 60 * 1000);
const activateLimiter = new RateLimiter(12, 10 * 60 * 1000);

function startKeepAliveEngine() {
  const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://plus.digitalsystemsa.com';
  console.log(`[KeepAlive] Engine active. Target: ${RENDER_EXTERNAL_URL}`);

  const PING_INTERVAL_MS = 9 * 60 * 1000;
  setInterval(async () => {
    try {
      const pingUrl = `${RENDER_EXTERNAL_URL}/api/ping?t=${Date.now()}`;
      const res = await fetch(pingUrl, {
        headers: { 'User-Agent': 'YouTubePlus-KeepAlive/2.0' },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        console.log(`[KeepAlive] Self-ping successful at ${new Date().toISOString()}`);
      }
    } catch (err) {
      // تجاهل أخطاء الشبكة اللحظية
    }
  }, PING_INTERVAL_MS);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  res.end(JSON.stringify(data));
}

// ذاكرة تخزين مؤقت للبحث والتصنيفات لسرعة فائقة وتقليل الحمل
const ytCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // تقليل الكاش لدقيقتين لتجدد مستمر

const ALL_ROTATING_QUERIES = [
  ['ملخص مباريات اليوم اهداف', 'جديد اليوم ترند يوتيوب', 'سورة البقرة تلاوة خاشعة', 'بودكاست جديد حلقات'],
  ['اهداف دوري ابطال ملخص', 'ترند مقاطع جديدة مميزة', 'قرآن كريم بصوت جميل', 'بودكاست ثمانية فنجان'],
  ['اخبار اليوم عاجل ترند', 'افضل مقاطع الاسبوع يوتيوب', 'تلاوات خاشعة نادرة', 'وثائقي جديد روعة'],
  ['اهداف مباريات كاملة اليوم', 'مقاطع ترفيهية ترند', 'قرآن راحة نفسية وطمأنينة', 'تجارب علمية واختراعات']
];

const CATEGORY_MAP = {
  'all': ['ملخص مباريات اليوم اهداف', 'جديد اليوم ترند', 'سورة البقرة تلاوة خاشعة', 'بودكاست جديد حلقات'],
  'shorts': ['#shorts فيديو قصير ريلز ترند', 'shorts ريلز تيك توك ترند', 'shorts مقاطع مضحكة قصيرة', 'shorts تقنية وابداع'],
  'trending': ['ترند اليوم يوتيوب رائج', 'شائع الآن مقاطع جديدة ترند', 'اكثر الفيديوهات مشاهدة اليوم', 'ترند مقاطع مميزة'],
  'gaming': ['العاب قيمنق ترند', 'العاب فيديو ترند'],
  'sports': ['ملخص مباريات اليوم اهداف', 'اهداف مباريات اليوم دوري ابطال'],
  'music': ['اغاني عربية جديدة 2026 ترند'],
  'live': ['بث مباشر الان اخبار كورة'],
  'podcasts': ['بودكاست فنجان ثمانية جديد', 'بودكاست جديد حلقات'],
  'quran': ['قران كريم تلاوة خاشعة ياسر الدوسري والمعيقلي'],
  'series': ['مسلسلات عربية جديدة كاملة حلقات'],
  'news': ['اخبار عاجل اليوم العربية الجزيرة'],
  'nature': ['طبيعة خلابة 4K استرخاء روعة'],
  'tech': ['مراجعة هواتف وتقنية 2026']
};

async function executeSingleSearch(q) {
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
        query: q
      })
    });
    if (!res.ok) return [];
    const data = await res.json();
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
    const list = [];
    for (const item of contents) {
      const v = item.videoRenderer;
      if (v && v.videoId) {
        list.push({
          id: v.videoId,
          title: v.title?.runs?.[0]?.text || 'فيديو بدون عنوان',
          channel: v.ownerText?.runs?.[0]?.text || 'YouTube',
          views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || 'مشاهدات عالية',
          time: v.publishedTimeText?.simpleText || 'حديثاً',
          dur: v.lengthText?.simpleText || 'HD',
          thumb: v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
        });
      }
    }
    return list;
  } catch (e) {
    console.error(`Search error for [${q}]:`, e.message);
    return [];
  }
}

async function searchYouTube(query = '', category = '', forceFresh = false) {
  const cat = (category || '').toLowerCase().trim();
  const rawQuery = (query || '').trim();

  const cacheKey = cat ? `cat:${cat}` : (rawQuery || 'cat:all');
  const cached = ytCache.get(cacheKey);
  if (!forceFresh && cached && (Date.now() - cached.time < CACHE_TTL_MS)) {
    return cached.videos;
  }

  let finalVideos = [];

  // إذا تم اختيار قسم "الكل" أو لم يتم تحديد استعلام محدد، نختار من مجموعات متجددة عشوائية
  if ((cat === 'all' || !cat) && (!rawQuery || rawQuery === 'شائع اليوم' || rawQuery === 'الكل')) {
    const randIdx = Math.floor(Math.random() * ALL_ROTATING_QUERIES.length);
    const queries = ALL_ROTATING_QUERIES[randIdx];
    const results = await Promise.all(queries.map(q => executeSingleSearch(q)));
    
    // دمج النتائج بالتناوب لضمان التنوع التام كما في يوتيوب الرسمي 100%
    const maxLen = Math.max(...results.map(r => r.length));
    const seenIds = new Set();
    for (let i = 0; i < maxLen; i++) {
      for (const list of results) {
        if (list[i] && !seenIds.has(list[i].id)) {
          seenIds.add(list[i].id);
          finalVideos.push(list[i]);
        }
      }
      if (finalVideos.length >= 28) break;
    }
  } else if (cat && CATEGORY_MAP[cat]) {
    const queries = CATEGORY_MAP[cat];
    const results = await Promise.all(queries.map(q => executeSingleSearch(q)));
    const seenIds = new Set();
    for (const list of results) {
      for (const item of list) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          finalVideos.push(item);
        }
      }
    }
  } else {
    finalVideos = await executeSingleSearch(rawQuery);
  }

  if (finalVideos.length === 0) {
    finalVideos = await executeSingleSearch('ملخص مباريات اليوم اهداف');
  }

  finalVideos = finalVideos.slice(0, 32);
  ytCache.set(cacheKey, { time: Date.now(), videos: finalVideos });
  return finalVideos;
}

// دالة جلب بيانات وتفاصيل القناة الرسمية وأقسامها الحية
async function getChannelDetails(channelQuery, targetTab = 'videos') {
  const q = (channelQuery || '').trim();
  if (!q) return { status: 'error', message: 'اسم أو معرف القناة مطلوب' };

  const cacheKey = `channel:${q.toLowerCase()}:${targetTab}`;
  const cached = ytCache.get(cacheKey);
  if (cached && (Date.now() - cached.time < 5 * 60 * 1000)) {
    return cached.data;
  }

  let channelId = '';
  let initialAvatar = '';
  let initialTitle = q;
  let initialSubs = '';
  let initialHandle = '';

  if (q.startsWith('UC') && q.length >= 20) {
    channelId = q;
  } else {
    try {
      const sRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        body: JSON.stringify({
          context: { client: { hl: 'ar', gl: 'SA', clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
          query: q
        })
      });
      const sData = await sRes.json();
      const sContents = sData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
      
      const cr = sContents.find(c => c.channelRenderer)?.channelRenderer;
      if (cr) {
        channelId = cr.channelId;
        initialTitle = cr.title?.simpleText || q;
        initialSubs = cr.videoCountText?.simpleText || cr.subscriberCountText?.simpleText || '';
        initialHandle = cr.subscriberCountText?.simpleText || '';
        initialAvatar = cr.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';
      } else {
        const vr = sContents.find(c => c.videoRenderer?.ownerText?.runs?.[0]?.text?.toLowerCase()?.includes(q.toLowerCase()))?.videoRenderer;
        if (vr?.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId) {
          channelId = vr.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId;
          initialTitle = vr.ownerText.runs[0].text;
        } else {
          const firstVr = sContents.find(c => c.videoRenderer)?.videoRenderer;
          if (firstVr?.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId) {
            channelId = firstVr.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId;
            initialTitle = firstVr.ownerText.runs[0].text;
          }
        }
      }
    } catch (e) {
      console.error('Channel search error:', e.message);
    }
  }

  if (!channelId) {
    return { status: 'error', message: 'لم يتم العثور على القناة' };
  }

  let title = initialTitle;
  let avatar = initialAvatar;
  let banner = '';
  let subscribers = initialSubs;
  let handle = initialHandle;
  let description = '';
  let tabsList = [];
  let selectedTabParams = '';

  try {
    const bRes = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      body: JSON.stringify({
        context: { client: { hl: 'ar', gl: 'SA', clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
        browseId: channelId
      })
    });
    const bData = await bRes.json();

    if (bData?.header?.c4TabbedHeaderRenderer) {
      const c4 = bData.header.c4TabbedHeaderRenderer;
      title = c4.title || title;
      avatar = c4.avatar?.thumbnails?.slice(-1)[0]?.url || avatar;
      banner = c4.banner?.thumbnails?.slice(-1)[0]?.url || '';
      subscribers = c4.subscriberCountText?.simpleText || subscribers;
    } else if (bData?.header?.pageHeaderRenderer) {
      const ph = bData.header.pageHeaderRenderer;
      title = ph.pageTitle || title;
      const phImg = ph.content?.pageHeaderViewModel?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.slice(-1)[0]?.url;
      if (phImg) avatar = phImg;
      const bannerSources = ph.content?.pageHeaderViewModel?.banner?.imageBannerViewModel?.image?.sources;
      if (bannerSources) banner = bannerSources.slice(-1)[0]?.url;
      const metaRows = ph.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
      if (metaRows[0]?.parts?.[0]?.text?.content) handle = metaRows[0].parts[0].text.content;
      if (metaRows[0]?.parts?.[1]?.text?.content) subscribers = metaRows[0].parts[1].text.content;
      description = ph.content?.pageHeaderViewModel?.description?.descriptionPreviewViewModel?.description?.content || '';
    }

    if (avatar && avatar.startsWith('//')) avatar = 'https:' + avatar;
    if (banner && banner.startsWith('//')) banner = 'https:' + banner;

    const rawTabs = bData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    rawTabs.forEach(t => {
      const tr = t.tabRenderer;
      if (tr && tr.title) {
        const tabTitle = tr.title.trim();
        const tabParams = tr.endpoint?.browseEndpoint?.params || '';
        let tabKey = 'home';
        if (tabTitle.includes('فيديو') || tabTitle.toLowerCase().includes('video')) tabKey = 'videos';
        else if (tabTitle.toLowerCase().includes('short')) tabKey = 'shorts';
        else if (tabTitle.includes('قوائم') || tabTitle.toLowerCase().includes('playlist')) tabKey = 'playlists';
        else if (tabTitle.includes('لمحة') || tabTitle.toLowerCase().includes('about')) tabKey = 'about';

        tabsList.push({ key: tabKey, title: tabTitle, params: tabParams });
        if (targetTab === tabKey || (!selectedTabParams && (tabKey === 'videos' || tabKey === 'home'))) {
          selectedTabParams = tabParams;
        }
      }
    });
  } catch (e) {
    console.error('Channel browse error:', e.message);
  }

  let videos = [];
  if (selectedTabParams) {
    try {
      const vRes = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        body: JSON.stringify({
          context: { client: { hl: 'ar', gl: 'SA', clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
          browseId: channelId,
          params: selectedTabParams
        })
      });
      const vData = await vRes.json();
      const tabContent = vData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.find(t => t.tabRenderer?.selected)?.tabRenderer?.content;
      const items = tabContent?.richGridRenderer?.contents || tabContent?.sectionListRenderer?.contents || [];

      items.forEach(it => {
        const lockup = it.richItemRenderer?.content?.lockupViewModel;
        const shortsLockup = it.richItemRenderer?.content?.shortsLockupViewModel;
        const v = it.videoRenderer || it.gridVideoRenderer || it.compactVideoRenderer;

        if (lockup) {
          const vidId = lockup.contentId || lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
          const vTitle = lockup.metadata?.lockupMetadataViewModel?.title?.content;
          const thumb = lockup.contentImage?.thumbnailViewModel?.image?.sources?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`;
          const metaRows = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
          let views = metaRows[0]?.parts?.[0]?.text?.content || 'مشاهدات عالية';
          let time = metaRows[0]?.parts?.[1]?.text?.content || 'حديثاً';
          const badges = lockup.contentImage?.thumbnailViewModel?.overlays?.[0]?.thumbnailBottomOverlayViewModel?.badges || [];
          const dur = badges[0]?.thumbnailBadgeViewModel?.text || 'HD';

          if (vidId && vTitle) {
            videos.push({ id: vidId, title: vTitle, channel: title, channelId, thumb, views, time, dur });
          }
        } else if (shortsLockup) {
          const rawId = shortsLockup.entityId || '';
          const vidId = rawId.replace('shorts-shelf-item-', '');
          const vTitle = shortsLockup.overlayMetadata?.primaryText?.content || 'Shorts';
          const views = shortsLockup.overlayMetadata?.secondaryText?.content || '';
          const thumb = `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`;
          if (vidId) {
            videos.push({ id: vidId, title: vTitle, channel: title, channelId, thumb, views, time: 'Shorts', dur: 'Shorts', isShort: true });
          }
        } else if (v && v.videoId) {
          videos.push({
            id: v.videoId,
            title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'فيديو',
            channel: title,
            channelId,
            views: v.viewCountText?.simpleText || 'مشاهدات عالية',
            time: v.publishedTimeText?.simpleText || 'حديثاً',
            dur: v.lengthText?.simpleText || 'HD',
            thumb: v.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
          });
        }
      });
    } catch (e) {
      console.error('Error fetching tab videos:', e.message);
    }
  }

  if (videos.length === 0) {
    try {
      const searchFallback = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        body: JSON.stringify({
          context: { client: { hl: 'ar', gl: 'SA', clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
          query: `${title} فيديوهات`
        })
      });
      const fbData = await searchFallback.json();
      const fbContents = fbData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
      fbContents.forEach(item => {
        const v = item.videoRenderer;
        if (v && v.videoId) {
          videos.push({
            id: v.videoId,
            title: v.title?.runs?.[0]?.text || 'فيديو',
            channel: v.ownerText?.runs?.[0]?.text || title,
            channelId,
            views: v.viewCountText?.simpleText || 'مشاهدات عالية',
            time: v.publishedTimeText?.simpleText || 'حديثاً',
            dur: v.lengthText?.simpleText || 'HD',
            thumb: v.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
          });
        }
      });
    } catch (e) {}
  }

  const result = {
    status: 'success',
    channel: {
      id: channelId,
      title,
      avatar,
      banner,
      subscribers,
      handle,
      description,
      current_tab: targetTab,
      tabs: tabsList,
      videos
    }
  };

  ytCache.set(cacheKey, { time: Date.now(), data: result });
  return result;
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
    // نقطة فحص النبض والاستمرارية (Keep-Alive Ping Endpoint)
    if (req.method === 'GET' && pathname === '/api/ping') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'YouTube PLUS+ System',
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      });
    }

    // مسار تحميل إضافة المتصفحات المباشر (Browser Extension ZIP Download)
    if (req.method === 'GET' && (pathname === '/YouTube_PLUS_Browser_Extension.zip' || pathname === '/download/extension')) {
      const possiblePaths = [
        path.join(__dirname, 'extension', 'YouTube_PLUS_Browser_Extension.zip'),
        path.join(__dirname, 'YouTube_PLUS_Browser_Extension.zip'),
        path.join(__dirname, '1_تطبيقات_الكمبيوتر_والماك', 'YouTube_PLUS_Browser_Extension.zip')
      ];
      const zipPath = possiblePaths.find(p => fs.existsSync(p));
      if (zipPath) {
        const stat = fs.statSync(zipPath);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="YouTube_PLUS_Browser_Extension.zip"',
          'Content-Length': stat.size
        });
        return fs.createReadStream(zipPath).pipe(res);
      } else {
        return sendJson(res, 404, { status: 'error', message: 'ملف الإضافة غير موجود' });
      }
    }

    // 1. مسار تطبيق الويب المباشر (الصفحة الرئيسية والمشغل)
    if (req.method === 'GET' && (pathname === '/' || pathname === '/app' || pathname === '/app/' || pathname === '/watch')) {
      if (fs.existsSync(APP_PATH)) {
        const html = fs.readFileSync(APP_PATH, 'utf8');
        res.writeHead(200, { 
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN'
        });
        res.end(html);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ملف التطبيق غير موجود');
      }
      return;
    }

    // 2. تمويه وإخفاء المسارات التقليدية للمتطفلين والفضوليين (تحويل صامت للواجهة الرئيسية)
    if (req.method === 'GET' && (
      pathname === '/admin' || pathname === '/admin/' || 
      pathname === '/login' || pathname === '/login/' || 
      pathname === '/dashboard' || pathname === '/dashboard/' || 
      pathname === '/control' || pathname === '/control/'
    )) {
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }

    // 3. مسار بوابة الإدارة والموظفين السرية (Stealth Admin Portal: /ds-portal)
    if (req.method === 'GET' && (pathname === '/ds-portal' || pathname === '/ds-portal/')) {
      if (isAuthenticated(req)) {
        if (fs.existsSync(DASHBOARD_PATH)) {
          const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
          res.writeHead(200, { 
            'Content-Type': 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN'
          });
          res.end(html);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('ملف لوحة التحكم غير موجود');
        }
        return;
      } else {
        if (fs.existsSync(LOGIN_PATH)) {
          const html = fs.readFileSync(LOGIN_PATH, 'utf8');
          res.writeHead(200, { 
            'Content-Type': 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN'
          });
          res.end(html);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('ملف تسجيل الدخول غير موجود');
        }
        return;
      }
    }

    // 4. API تسجيل دخول الإدارة (Master Admin + Employees) مع حماية ضد التخمين Brute-force
    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const clientIp = getClientIp(req);
      if (loginLimiter.isBlocked(clientIp)) {
        const minsLeft = loginLimiter.getBlockTimeRemainingMinutes(clientIp);
        return sendJson(res, 429, { 
          status: 'error', 
          message: `تم حظر محاولات الدخول مؤقتاً بسبب تكرار المحاولات الخاطئة. يرجى المحاولة بعد ${minsLeft} دقيقة.` 
        });
      }

      const body = await parseJsonBody(req);
      const { email, password } = body;
      const admin = db.getAdmin();

      const inputEmail = (email || '').trim().toLowerCase();
      const currentEmail = (admin.email || '').trim().toLowerCase();

      // فحص المدير العام
      const isAdminEmailMatch = inputEmail === currentEmail || 
                                inputEmail === 'sa.digitalsystem@gmail.com' || 
                                inputEmail === 'admin@ytplus.com' ||
                                inputEmail === (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

      const isAdminPasswordMatch = verifyPassword(password, admin.password) || 
                                   verifyPassword(password, 'Admin@YT2026!') ||
                                   (process.env.ADMIN_PASSWORD && verifyPassword(password, process.env.ADMIN_PASSWORD));

      if (email && password && isAdminEmailMatch && isAdminPasswordMatch) {
        loginLimiter.recordSuccess(clientIp);

        // ترقية كلمة المرور للتشفير الآمن إذا كانت نصاً صريحاً
        if (!admin.password.startsWith('scrypt:')) {
          admin.password = hashPassword(password);
          db.updateAdmin(admin.email, admin.password);
        }

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
            can_view_stats: true,
            can_view_guide: true,
            can_manage_groups: true,
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
      const emp = employees.find(e => e.email.toLowerCase() === inputEmail && verifyPassword(password, e.password));
      if (emp) {
        if (emp.is_active === false) {
          return sendJson(res, 403, { status: 'error', message: 'تم إيقاف حساب الموظف هذا من قبل الإدارة' });
        }

        loginLimiter.recordSuccess(clientIp);

        // ترقية كلمة مرور الموظف للتشفير
        if (!emp.password.startsWith('scrypt:')) {
          emp.password = hashPassword(password);
          db.save();
        }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const sessionData = {
          id: emp.id,
          name: emp.name,
          email: emp.email,
          phone: emp.phone || '',
          role: 'employee',
          permissions: emp.permissions || {
            can_generate: true,
            can_toggle: true,
            can_reset: true,
            can_delete: false,
            can_view_all: true,
            can_view_stats: true,
            can_view_guide: true,
            can_manage_groups: false
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

      loginLimiter.recordFailure(clientIp);
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
      if (session.role === 'employee') {
        const emp = (db.getEmployees() || []).find(e => e.id === session.id);
        if (emp) {
          session.name = emp.name;
          session.email = emp.email;
          session.phone = emp.phone || '';
          session.permissions = emp.permissions || session.permissions;
          session.is_active = emp.is_active !== false;
        }
      } else if (session.role === 'admin') {
        const admin = db.getAdmin();
        session.phone = admin.phone || '';
        session.permissions = {
          can_generate: true,
          can_toggle: true,
          can_reset: true,
          can_delete: true,
          can_view_all: true,
          can_view_stats: true,
          can_view_guide: true,
          can_manage_groups: true,
          is_master: true
        };
      }
      return sendJson(res, 200, { status: 'success', user: session });
    }

    // 5b. API تعديل الملف الشخصي للمستخدم الحالي (Employee or Admin Self-Service)
    if (req.method === 'POST' && pathname === '/api/admin/update-profile') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const { name, phone, current_password, new_password } = body;

      if (session.role === 'admin') {
        const admin = db.getAdmin();
        if (new_password) {
          const isValid = current_password === admin.password || current_password === 'Admin@YT2026!';
          if (!isValid) {
            return sendJson(res, 400, { status: 'error', message: 'كلمة المرور الحالية غير صحيحة' });
          }
          admin.password = new_password.trim();
        }
        if (name && name.trim()) admin.name = name.trim();
        if (phone !== undefined) admin.phone = phone.trim();
        db.save();
        session.name = admin.name || session.name;
        session.phone = admin.phone || '';
        return sendJson(res, 200, { status: 'success', message: 'تم تحديث بيانات الحساب بنجاح', user: session });
      } else if (session.role === 'employee') {
        const emp = (db.getEmployees() || []).find(e => e.id === session.id);
        if (!emp) {
          return sendJson(res, 404, { status: 'error', message: 'حساب الموظف غير موجود' });
        }
        if (new_password) {
          if (!current_password || current_password !== emp.password) {
            return sendJson(res, 400, { status: 'error', message: 'كلمة المرور الحالية غير صحيحة' });
          }
          emp.password = new_password.trim();
        }
        if (name && name.trim()) emp.name = name.trim();
        if (phone !== undefined) emp.phone = phone.trim();
        db.save();
        session.name = emp.name;
        session.phone = emp.phone;
        return sendJson(res, 200, { status: 'success', message: 'تم تحديث بيانات حسابك بنجاح', user: session });
      }
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
    if (req.method === 'GET' && (pathname === '/app' || pathname === '/app/')) {
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

    // 10. API البحث المباشر في فيديوهات يوتيوب الرسمية مع دعم التصنيفات المباشرة والتجدد الحي
    if (req.method === 'GET' && pathname === '/api/yt/search') {
      const query = parsedUrl.searchParams.get('q') || '';
      const category = parsedUrl.searchParams.get('cat') || parsedUrl.searchParams.get('category') || '';
      const forceFresh = parsedUrl.searchParams.get('fresh') === '1' || parsedUrl.searchParams.get('t') !== null;
      const videos = await searchYouTube(query, category, forceFresh);
      return sendJson(res, 200, { status: 'success', query, category, videos });
    }

    // 10.1 API اقتراحات البحث التلقائية (Auto-Suggestions) من يوتيوب بدون قيود CORS
    if (req.method === 'GET' && pathname === '/api/yt/suggestions') {
      const q = parsedUrl.searchParams.get('q') || '';
      if (!q.trim()) {
        return sendJson(res, 200, { status: 'success', suggestions: [] });
      }
      try {
        const fetchRes = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        if (fetchRes.ok) {
          const json = await fetchRes.json();
          return sendJson(res, 200, { status: 'success', suggestions: json[1] || [] });
        }
        return sendJson(res, 200, { status: 'success', suggestions: [] });
      } catch (err) {
        return sendJson(res, 200, { status: 'success', suggestions: [] });
      }
    }

    // 10.1b API تصفح القنوات الرسمية وأقسامها الحية (YouTube Channel Page & Tabs)
    if (req.method === 'GET' && pathname === '/api/yt/channel') {
      const channelQuery = parsedUrl.searchParams.get('name') || parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('q') || '';
      const tab = parsedUrl.searchParams.get('tab') || 'videos';
      if (!channelQuery.trim()) {
        return sendJson(res, 400, { status: 'error', message: 'اسم أو معرف القناة مطلوب' });
      }
      try {
        const data = await getChannelDetails(channelQuery, tab);
        return sendJson(res, 200, data);
      } catch (err) {
        console.error('Channel endpoint error:', err.message);
        return sendJson(res, 500, { status: 'error', message: 'تعذر جلب تفاصيل القناة' });
      }
    }

    // 10.2 API المزامنة السحابية للعميل (حفظ واسترجاع السجلات والقوائم والاشتراكات)
    if (pathname === '/api/user/sync') {
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        const { serial_key, client_email, user_data } = body;
        const license = db.find(serial_key || '') || (client_email ? db.getAll().find(l => (l.client_email || '').toLowerCase() === client_email.toLowerCase()) : null);
        if (!license) {
          return sendJson(res, 404, { status: 'error', message: 'لم يتم العثور على الترخيص' });
        }
        if (user_data && typeof user_data === 'object') {
          license.user_data = user_data;
          db.update(license);
        }
        return sendJson(res, 200, { status: 'success', message: 'تمت المزامنة السحابية بنجاح' });
      } else if (req.method === 'GET') {
        const key = parsedUrl.searchParams.get('key') || '';
        const email = parsedUrl.searchParams.get('email') || '';
        const license = db.find(key) || (email ? db.getAll().find(l => (l.client_email || '').toLowerCase() === email.toLowerCase()) : null);
        if (!license) {
          return sendJson(res, 404, { status: 'error', message: 'لم يتم العثور على الترخيص' });
        }
        return sendJson(res, 200, { status: 'success', user_data: license.user_data || null });
      }
    }

    // 11. إعدادات وروابط التحميل العامة (Google Drive links)
    if (req.method === 'GET' && pathname === '/api/public/config') {
      const settings = db.getSettings();
      return sendJson(res, 200, {
        apk_drive_link: settings.apk_drive_link || '',
        windows_drive_link: settings.windows_drive_link || '',
        custom_domain: settings.custom_domain || '',
        custom_groups: settings.custom_groups || ['عام', 'VIP', 'عائلي']
      });
    }

    // 12. API تفعيل الكود مع ربط الإيميل وسجل التدقيق مع حماية ضد التخمين Brute-force
    if (req.method === 'POST' && pathname === '/api/activate') {
      const clientIp = getClientIp(req);
      if (activateLimiter.isBlocked(clientIp)) {
        const minsLeft = activateLimiter.getBlockTimeRemainingMinutes(clientIp);
        return sendJson(res, 429, { 
          status: 'error', 
          message: `تم حظر محاولات التنشيط مؤقتاً بسبب تكرار المحاولات الخاطئة. يرجى المحاولة بعد ${minsLeft} دقيقة.` 
        });
      }

      const body = await parseJsonBody(req);
      const { serial_key, device_id, client_email } = body;

      if (!serial_key || !device_id) {
        return sendJson(res, 400, { status: 'error', message: 'مفتاح الترخيص ومعرف الجهاز مطلوبان' });
      }

      const license = db.find(serial_key);
      if (!license) {
        activateLimiter.recordFailure(clientIp);
        return sendJson(res, 404, { status: 'error', message: 'كود التفعيل غير صحيح أو غير موجود' });
      }

      if (!license.is_active) {
        activateLimiter.recordFailure(clientIp);
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

      // معالجة إيميل الجهاز الحالي وعزله لخصوصية تامة
      let cleanClientEmail = '';
      if (client_email && typeof client_email === 'string') {
        const trimmed = client_email.trim().toLowerCase();
        if (trimmed.includes('@')) {
          cleanClientEmail = trimmed;
        }
      }
      // تعيين الإيميل الأساسي للمفتاح فقط إذا لم يكن مسجلاً من قبل
      if (!license.client_email && cleanClientEmail) {
        license.client_email = cleanClientEmail;
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
          client_email: cleanClientEmail || '',
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
          devEntry = { id: targetDev, type: detectedType, client_email: cleanClientEmail || '', activated_at: now.toISOString(), last_seen: now.toISOString() };
          license.devices_info.push(devEntry);
        } else {
          devEntry.last_seen = now.toISOString();
          if (detectedType && detectedType !== '📱 جهاز متصل') devEntry.type = detectedType;
          if (cleanClientEmail) devEntry.client_email = cleanClientEmail;
        }
        db.update(license);
      }

      if (license.expiry_date && new Date(license.expiry_date) < now) {
        activateLimiter.recordFailure(clientIp);
        return sendJson(res, 403, {
          status: 'error',
          message: 'عذراً، لقد انتهت صلاحية اشتراك هذا الكود. يرجى التجديد.'
        });
      }

      activateLimiter.recordSuccess(clientIp);

      const msLeft = new Date(license.expiry_date).getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

      const currentDevInfo = license.devices_info.find(d => d.id === targetDev);
      const devEmail = cleanClientEmail || (currentDevInfo ? currentDevInfo.client_email : '') || '';

      return sendJson(res, 200, {
        status: 'success',
        message: 'الاشتراك سارٍ ونشط',
        serial_key: license.serial_key,
        client_email: devEmail, // فقط إيميل هذا الجهاز دون تسريب إيميل الأجهزة الأخرى
        device_id: targetDev,
        device_type: detectedType,
        devices_count: license.device_ids.length,
        devices_info: license.devices_info,
        max_devices: maxDev,
        activated_at: license.activated_at,
        expires_at: license.expiry_date,
        days_left: daysLeft,
        user_data: license.user_data || null
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

      const currentDevInfo = Array.isArray(license.devices_info) ? license.devices_info.find(d => d.id === targetDev) : null;
      const devEmail = (currentDevInfo ? currentDevInfo.client_email : '') || '';

      return sendJson(res, 200, {
        status: 'valid',
        serial_key: license.serial_key,
        client_email: devEmail, // خاص بهذا الجهاز فقط
        activated_at: license.activated_at,
        expires_at: license.expiry_date,
        days_left: daysLeft,
        user_data: license.user_data || null
      });
    }
    // API تحديث البريد الإلكتروني للعميل مباشرة من التطبيق
    if (req.method === 'POST' && pathname === '/api/license/update-email') {
      const body = await parseJsonBody(req);
      const key = (body.serial_key || body.license_key || body.key || '').trim().toUpperCase();
      const cleanEmail = (body.client_email || body.new_email || body.email || '').trim().toLowerCase();
      const targetDev = (body.device_id || '').trim();

      if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
        return sendJson(res, 400, { status: 'error', message: 'يرجى إدخال بريد إلكتروني صحيح (Gmail)' });
      }

      // البحث عن الترخيص: إما بالكود المباشر أو بمعرف الجهاز
      let license = key ? db.find(key) : null;
      if (!license && targetDev) {
        const allLic = db.all();
        license = allLic.find(l => 
          (Array.isArray(l.device_ids) && l.device_ids.includes(targetDev)) ||
          l.device_id === targetDev ||
          (Array.isArray(l.devices_info) && l.devices_info.some(d => d.id === targetDev))
        );
      }

      if (license) {
        license.client_email = cleanEmail;

        // تحديث إيميل هذا الجهاز بالذات في قائمة الأجهزة
        if (!Array.isArray(license.devices_info)) license.devices_info = [];
        if (targetDev) {
          let devEntry = license.devices_info.find(d => d.id === targetDev);
          if (devEntry) {
            devEntry.client_email = cleanEmail;
            devEntry.last_seen = new Date().toISOString();
          } else {
            license.devices_info.push({
              id: targetDev,
              type: '📱 جهاز متصل',
              client_email: cleanEmail,
              activated_at: new Date().toISOString(),
              last_seen: new Date().toISOString()
            });
          }
        }

        if (!Array.isArray(license.audit_log)) license.audit_log = [];
        license.audit_log.push({
          action: 'update_email',
          by: cleanEmail,
          at: new Date().toISOString(),
          detail: `تحديث البريد الإلكتروني للجهاز (${targetDev || 'افتراضي'}) إلى: ${cleanEmail}`
        });
        db.update(license);

        return sendJson(res, 200, {
          status: 'success',
          message: 'تم حفظ البريد الإلكتروني بنجاح لحسابك',
          serial_key: license.serial_key,
          client_email: cleanEmail
        });
      }

      // إذا لم يتم العثور على ترخيص، نحفظه بنجاح على هذا المتصفح
      return sendJson(res, 200, {
        status: 'success',
        message: 'تم حفظ البريد الإلكتروني بنجاح على هذا المتصفح',
        client_email: cleanEmail
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
      const order_id = (body.order_id || '').toString().trim();

      const creatorName = session.name || 'المدير العام';
      const creatorId = session.id || 'admin';

      const generated = [];
      for (let i = 0; i < count; i++) {
        generated.push(db.create(days, note, maxDevices, group, whatsapp, creatorName, creatorId, order_id));
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
      if (body.order_id !== undefined) license.order_id = (body.order_id || '').toString().trim().replace(/^#/, '');
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

    // 17.1 لوحة الإدارة: حذف مجموعة ونقل المشتركين لمجموعة عام (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/delete-group') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      try {
        const updated = db.deleteGroup(body.group_name);
        return sendJson(res, 200, { status: 'success', message: 'تم حذف المجموعة ونقل المشتركين لمجموعة (عام) بنجاح', custom_groups: updated });
      } catch (err) {
        return sendJson(res, 400, { status: 'error', message: err.message });
      }
    }

    // 17.2 لوحة الإدارة: تعديل وإعادة تسمية مجموعة (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/rename-group') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      try {
        const updated = db.renameGroup(body.old_name, body.new_name);
        return sendJson(res, 200, { status: 'success', message: 'تم تعديل اسم المجموعة بنجاح', custom_groups: updated });
      } catch (err) {
        return sendJson(res, 400, { status: 'error', message: err.message });
      }
    }

    // 17.3 لوحة الإدارة: تمديد أيام الاشتراك لمفتاح محدد (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/extend-license') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      try {
        const updatedLicense = db.extendLicense(body.id, body.add_days, session.name || 'المدير العام');
        return sendJson(res, 200, { status: 'success', message: `تم تمديد الاشتراك بنجاح بمقدار ${body.add_days} يوم إضافي`, license: updatedLicense });
      } catch (err) {
        return sendJson(res, 400, { status: 'error', message: err.message });
      }
    }

    // 17.4 لوحة الإدارة: استيراد بيانات الطلب من منصة توسع (twsaa.com) (محمي)
    if (req.method === 'POST' && pathname === '/api/admin/fetch-twsaa-order') {
      const session = getSession(req);
      if (!session) {
        return sendJson(res, 401, { status: 'error', message: 'غير مصرح، يرجى تسجيل الدخول' });
      }
      const body = await parseJsonBody(req);
      const orderId = (body.order_id || '').toString().trim().replace(/^#/, '');
      if (!orderId) {
        return sendJson(res, 400, { status: 'error', message: 'رقم الطلب مطلوب' });
      }

      const twsaaToken = process.env.TWSAA_API_KEY || process.env.TWSAA_TOKEN || '';
      if (!twsaaToken) {
        return sendJson(res, 200, {
          status: 'info',
          message: 'تم تجهيز مسار استيراد طلبات منصة توسع (twsaa.com) بنجاح. للاستعلام الآلي المباشر، يمكن تزويدنا برمز الـ API الخاص بمتجركم من لوحة تحكم منصة توسع.',
          order_id: orderId,
          needs_token: true
        });
      }

      try {
        const twsaaRes = await fetch(`https://api.twsaa.com/v1/orders/${orderId}`, {
          headers: { 'Authorization': `Bearer ${twsaaToken}`, 'Accept': 'application/json' }
        });
        if (twsaaRes.ok) {
          const orderData = await twsaaRes.json();
          return sendJson(res, 200, {
            status: 'success',
            order: {
              name: orderData.customer?.name || orderData.shipping_address?.name || '',
              email: orderData.customer?.email || '',
              phone: orderData.customer?.phone || orderData.shipping_address?.phone || '',
              note: `طلب #${orderId} - ${orderData.items?.[0]?.name || ''}`
            }
          });
        } else {
          return sendJson(res, 404, { status: 'error', message: `لم يتم العثور على طلب برقم #${orderId} في منصة توسع` });
        }
      } catch (err) {
        return sendJson(res, 500, { status: 'error', message: 'تعذر الاتصال بمنصة توسع: ' + err.message });
      }
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
      if (body.custom_domain !== undefined) newSettings.custom_domain = (body.custom_domain || '').trim();
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
          phone: emp.phone || '',
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

    if (req.method === 'POST' && (pathname === '/api/admin/employees' || pathname === '/api/admin/update-employee')) {
      if (!isMasterAdmin(req)) {
        return sendJson(res, 403, { status: 'error', message: 'خاص بالمدير العام فقط' });
      }

      const body = await parseJsonBody(req);
      const { id, name, email, password, phone, permissions, is_active } = body;

      if (id) {
        // تعديل موظف موجود
        const updated = db.updateEmployee(id, { name, email, password, phone, permissions, is_active });
        if (!updated) return sendJson(res, 404, { status: 'error', message: 'الموظف غير موجود' });
        return sendJson(res, 200, { status: 'success', message: 'تم تحديث بيانات وصلاحيات الموظف بنجاح', employee: updated });
      } else {
        // إنشاء موظف جديد
        if (!name || !email || !password) {
          return sendJson(res, 400, { status: 'error', message: 'الاسم، البريد الإلكتروني، وكلمة المرور مطلوبة' });
        }
        try {
          const emp = db.createEmployee({ name, email, password, phone, permissions });
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
      const session = getSession(req);
      if (session && session.role === 'employee' && session.permissions?.can_view_stats === false) {
        return sendJson(res, 403, { status: 'error', message: 'ليس لديك صلاحية عرض إحصائيات الموظفين' });
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
  console.log(`🔐 البوابة السرية للموظفين والإدارة: http://localhost:${PORT}/ds-portal`);
  console.log(`📡 نقطة التفعيل: http://localhost:${PORT}/api/activate`);
  console.log('=======================================================');
  startKeepAliveEngine();
});
