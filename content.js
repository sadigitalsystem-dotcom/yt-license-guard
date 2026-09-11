// (يوتيوب بلس+) YouTube PLUS+ - Content Script
(function() {
  'use strict';

  const API_ENDPOINTS = [
    'https://plus.digitalsystemsa.com',
    'https://yt-license-guard.onrender.com'
  ];

  async function postLicenseApi(endpointPath, payload) {
    let lastErr = null;
    for (const base of API_ENDPOINTS) {
      try {
        const res = await fetch(`${base}${endpointPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        return { ok: res.ok, status: res.status, data };
      } catch (err) {
        lastErr = err;
      }
    }
    throw (lastErr || new Error('تعذر الاتصال بخادم الترخيص'));
  }

  // 1. حقن استايلات حجب الإعلانات بما فيها الإعلان الجانبي
  const styleEl = document.createElement('style');
  styleEl.id = 'yt-plus-adblock-styles';
  styleEl.textContent = `
    .video-ads,
    .ytp-ad-module,
    .ytp-ad-overlay-container,
    .ytp-ad-player-overlay,
    .ytp-ad-image-overlay,
    ytd-ad-slot-renderer,
    ytd-in-feed-ad-layout-renderer,
    ytd-action-companion-ad-renderer,
    ytd-companion-ad-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-display-ad-renderer,
    ytd-statement-banner-renderer,
    ytd-banner-promo-renderer,
    ytd-compact-promoted-video-renderer,
    ytd-compact-promoted-item-renderer,
    ytd-promoted-video-renderer,
    #secondary ytd-ad-slot-renderer,
    #secondary-inner > ytd-ad-slot-renderer,
    #panels:has(ytd-ad-slot-renderer),
    #panels:has(ytd-in-feed-ad-layout-renderer),
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    ytd-item-section-renderer:has(ytd-ad-slot-renderer),
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    #action-companion-ad,
    #companion,
    #player-ads,
    #masthead-ad {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      width: 0 !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(styleEl);

  let isLicensed = false;

  function checkLicense() {
    chrome.storage.local.get(['yt_plus_license', 'yt_plus_key', 'yt_plus_dev_id'], async (res) => {
      const lic = res.yt_plus_license;
      const key = res.yt_plus_key;
      const devId = res.yt_plus_dev_id;

      if (lic && lic.expiry_date && key) {
        const exp = new Date(lic.expiry_date).getTime();
        if (exp > Date.now()) {
          isLicensed = true;
          startPremiumEngine(key, devId);
          return;
        }
      }
      showGatekeeperModal();
    });
  }

  function showGatekeeperModal(bannedMsg) {
    if (document.getElementById('yt-plus-gatekeeper')) return;

    const modal = document.createElement('div');
    modal.id = 'yt-plus-gatekeeper';
    modal.innerHTML = `
      <div style="
        position: fixed; inset: 0; z-index: 9999999;
        background: rgba(10, 10, 10, 0.96); backdrop-filter: blur(12px);
        display: flex; align-items: center; justify-content: center;
        font-family: 'Cairo', system-ui, sans-serif; direction: rtl; color: #fff;
      ">
        <div style="
          background: #181818; border: 1px solid #333; border-radius: 24px;
          padding: 36px; max-width: 440px; width: 90%; text-align: center;
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7), 0 0 30px rgba(255,0,0,0.15);
        ">
          <div style="
            width: 64px; height: 64px; background: #ff0000; border-radius: 18px;
            margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;
            box-shadow: 0 8px 20px rgba(255,0,0,0.4);
          ">
            <svg style="width: 34px; height: 34px; fill: #fff;" viewBox="0 0 24 24">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          </div>

          <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 800;">
            YouTube <span style="color: #ff0000;">PLUS+</span>
          </h2>
          <p style="margin: 0 0 24px; font-size: 13px; color: #aaa; line-height: 1.6;">
            لتشغيل واجهة يوتيوب الرسمية بميزات بريميوم الكاملة وبدون إعلانات، يرجى إدخال مفتاح التفعيل:
          </p>

          <input type="text" id="yt-plus-key-input" placeholder="PLUS-XXXX-XXXX-XXXX" style="
            width: 100%; box-sizing: border-box; background: #0f0f0f; border: 2px solid #333;
            color: #fff; text-align: center; font-family: monospace; font-size: 16px;
            font-weight: 700; padding: 14px; border-radius: 14px; outline: none; margin-bottom: 16px;
            letter-spacing: 1.5px; text-transform: uppercase;
          ">

          <div id="yt-plus-error" style="color: #ff4d4d; font-size: 12px; margin-bottom: 14px; ${bannedMsg ? 'display: block;' : 'display: none;'}">
            ${bannedMsg || ''}
          </div>

          <button id="yt-plus-activate-btn" style="
            width: 100%; background: #ff0000; color: #fff; border: none; padding: 14px;
            border-radius: 14px; font-weight: 800; font-size: 15px; cursor: pointer;
            box-shadow: 0 8px 20px rgba(255,0,0,0.3); transition: all 0.2s;
          ">
            تفعيل والبدء الآن
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = document.getElementById('yt-plus-key-input');
    const btn = document.getElementById('yt-plus-activate-btn');
    const err = document.getElementById('yt-plus-error');

    btn.onclick = async () => {
      const key = input.value.trim().toUpperCase();
      if (!key) {
        err.textContent = 'يرجى إدخال مفتاح التفعيل';
        err.style.display = 'block';
        return;
      }
      btn.textContent = 'جاري التحقق...';
      btn.disabled = true;
      err.style.display = 'none';

      try {
        let deviceId = (await chrome.storage.local.get(['yt_plus_dev_id'])).yt_plus_dev_id;
        if (!deviceId) {
          deviceId = 'web_' + Math.random().toString(36).substring(2, 10);
          await chrome.storage.local.set({ yt_plus_dev_id: deviceId });
        }

        const { ok, status, data } = await postLicenseApi('/api/activate', { serial_key: key, device_id: deviceId });

        if (res.ok && data.status === 'success') {
          await chrome.storage.local.set({
            yt_plus_key: key,
            yt_plus_license: {
              expiry_date: data.expires_at,
              device_id: data.device_id,
              serial_key: data.serial_key
            }
          });
          modal.remove();
          isLicensed = true;
          startPremiumEngine(key, deviceId);
        } else {
          err.textContent = data.message || 'مفتاح التفعيل غير صالح أو منتهي الصلاحية';
          err.style.display = 'block';
          btn.textContent = 'تفعيل والبدء الآن';
          btn.disabled = false;
        }
      } catch (e) {
        err.textContent = 'تعذر الاتصال بخادم الترخيص، يرجى التحقق من اتصال الإنترنت';
        err.style.display = 'block';
        btn.textContent = 'تفعيل والبدء الآن';
        btn.disabled = false;
      }
    };
  }

  function startPremiumEngine(serialKey, devId) {
    // 1. كلمة Premium أسفل الشعار وكلمة YouTube
    function updatePremiumLogo() {
      const logoRenderer = document.querySelector('ytd-topbar-logo-renderer');
      if (!logoRenderer) return;

      const countryCode = logoRenderer.querySelector('#country-code');
      if (countryCode) countryCode.style.display = 'none';

      let premText = document.getElementById('yt-plus-premium-text');
      if (!premText) {
        premText = document.createElement('div');
        premText.id = 'yt-plus-premium-text';
        premText.textContent = 'PREMIUM';
        logoRenderer.appendChild(premText);
      }

      const isRTL = document.documentElement.getAttribute('dir') === 'rtl';

      logoRenderer.style.display = 'flex';
      logoRenderer.style.flexDirection = 'column';
      logoRenderer.style.justifyContent = 'center';
      logoRenderer.style.alignItems = isRTL ? 'flex-end' : 'flex-start';
      logoRenderer.style.height = '100%';

      premText.style.cssText = `
        color: #ffffff !important;
        font-family: "YouTube Sans", "Roboto", "Cairo", sans-serif !important;
        font-size: 9.5px !important;
        font-weight: 700 !important;
        letter-spacing: 2px !important;
        text-transform: uppercase !important;
        margin-top: -6px !important;
        ${isRTL ? 'margin-right: 28px !important;' : 'margin-left: 28px !important;'}
        line-height: 1 !important;
        opacity: 0.9 !important;
        user-select: none !important;
        pointer-events: none !important;
        display: block !important;
      `;
    }

    // 2. حرق وتخطي وحذف الإعلانات بما فيها الإعلان الجانبي
    function skipAds() {
      const skipButtons = document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-preview-container');
      skipButtons.forEach(btn => btn && btn.click && btn.click());

      const overlayCloses = document.querySelectorAll('.ytp-ad-overlay-close-button');
      overlayCloses.forEach(btn => btn && btn.click && btn.click());

      const video = document.querySelector('video');
      const isAd = document.querySelector('.ad-showing') || document.querySelector('.ad-interrupting');
      if (isAd && video && !isNaN(video.duration)) {
        video.muted = true;
        video.playbackRate = 16.0;
        video.currentTime = video.duration;
      }

      const adSelectors = [
        'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer',
        'ytd-action-companion-ad-renderer',
        'ytd-companion-ad-renderer',
        'ytd-promoted-sparkles-web-renderer',
        'ytd-display-ad-renderer',
        '#secondary ytd-ad-slot-renderer',
        '#action-companion-ad',
        '#player-ads',
        '#masthead-ad'
      ];
      document.querySelectorAll(adSelectors.join(',')).forEach(el => {
        try { el.remove(); } catch(e) { el.style.display = 'none'; }
      });
    }

    setInterval(skipAds, 80);
    setInterval(updatePremiumLogo, 600);
    updatePremiumLogo();

    const observer = new MutationObserver(skipAds);
    observer.observe(document.body, { childList: true, subtree: true });

    // تشغيل بالخلفية
    window.addEventListener('visibilitychange', (e) => {
      e.stopImmediatePropagation();
    }, true);
    Object.defineProperty(document, 'hidden', { value: false, writable: false });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });

    // 3. Heartbeat دوري كل 15 ثانية للتحقق من عدم حظر المفتاح
    if (serialKey && devId) {
      setInterval(async () => {
        try {
          const { ok, data } = await postLicenseApi('/api/verify', { serial_key: serialKey, device_id: devId });
          if (!ok || data.status !== 'valid') {
            await chrome.storage.local.remove(['yt_plus_key', 'yt_plus_license']);
            const v = document.querySelector('video');
            if (v) { v.pause(); v.src = ''; }
            showGatekeeperModal('تم إيقاف أو حظر هذا الاشتراك من قبل الإدارة فوراً!');
          }
        } catch(e) {}
      }, 15000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkLicense);
  } else {
    checkLicense();
  }
})();
