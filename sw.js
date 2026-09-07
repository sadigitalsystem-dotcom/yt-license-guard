// Service Worker لتمكين تثبيت تطبيق (يوتيوب بلس+) على الأندرويد كـ PWA حقيقي
const CACHE_NAME = 'yt-plus-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // تمرير الطلبات للإنترنت مباشرة
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
