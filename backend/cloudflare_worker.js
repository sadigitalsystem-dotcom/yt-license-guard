/**
 * Cloudflare Worker - خادم سحابي مجاني للأبد لإدارة تراخيص يوتيوب iOS
 * 
 * طريقة الاستخدام:
 * 1. سجل حساب مجاني على https://workers.cloudflare.com
 * 2. أنشئ Worker جديد والصق هذا الكود
 * 3. اربط KV Namespace باسم "LICENSES_KV" لحفظ الأكواد
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json; charset=utf-8'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. فحص وتفعيل السيريال من تطبيق الآيفون
      if (request.method === 'POST' && url.pathname === '/api/activate') {
        const { serial_key, device_id } = await request.json();

        if (!serial_key || !device_id) {
          return new Response(JSON.stringify({ status: 'error', message: 'السيريال ومعرف الجهاز مطلوبان' }), { status: 400, headers: corsHeaders });
        }

        const raw = await env.LICENSES_KV.get(serial_key.toUpperCase());
        if (!raw) {
          return new Response(JSON.stringify({ status: 'error', message: 'كود التفعيل غير صحيح أو غير موجود' }), { status: 404, headers: corsHeaders });
        }

        const license = JSON.parse(raw);
        if (!license.is_active) {
          return new Response(JSON.stringify({ status: 'error', message: 'تم إيقاف هذا الكود من قبل الإدارة' }), { status: 403, headers: corsHeaders });
        }

        const now = new Date();

        // التفعيل لأول مرة
        if (!license.device_id) {
          license.device_id = device_id.trim();
          license.activated_at = now.toISOString();

          const expiry = new Date();
          expiry.setDate(expiry.getDate() + license.duration_days);
          license.expiry_date = expiry.toISOString();

          await env.LICENSES_KV.put(serial_key.toUpperCase(), JSON.stringify(license));

          return new Response(JSON.stringify({
            status: 'success',
            message: 'تم تفعيل الاشتراك بنجاح',
            expires_at: license.expiry_date,
            days_left: license.duration_days
          }), { headers: corsHeaders });
        }

        // إذا كان مستخدم على جهاز آخر
        if (license.device_id !== device_id.trim()) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'هذا الكود مرتبط بجهاز آيفون آخر!'
          }), { status: 403, headers: corsHeaders });
        }

        // فحص الصلاحية
        if (new Date(license.expiry_date) < now) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'انتهت فترة صلاحية هذا الاشتراك'
          }), { status: 403, headers: corsHeaders });
        }

        const msLeft = new Date(license.expiry_date).getTime() - now.getTime();
        const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

        return new Response(JSON.stringify({
          status: 'success',
          message: 'الاشتراك نشط',
          expires_at: license.expiry_date,
          days_left: daysLeft
        }), { headers: corsHeaders });
      }

      // 2. فحص سريع للحالة من الآيفون
      if (request.method === 'POST' && url.pathname === '/api/verify') {
        const { serial_key, device_id } = await request.json();
        const raw = await env.LICENSES_KV.get((serial_key || '').toUpperCase());
        if (!raw) {
          return new Response(JSON.stringify({ status: 'invalid' }), { status: 403, headers: corsHeaders });
        }

        const license = JSON.parse(raw);
        if (!license.is_active || license.device_id !== (device_id || '').trim()) {
          return new Response(JSON.stringify({ status: 'invalid' }), { status: 403, headers: corsHeaders });
        }

        const now = new Date();
        if (new Date(license.expiry_date) < now) {
          return new Response(JSON.stringify({ status: 'expired' }), { status: 403, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ status: 'valid', expires_at: license.expiry_date }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ message: 'YouTube iOS License Worker Running' }), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ status: 'error', error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
};
