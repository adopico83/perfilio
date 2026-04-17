/* eslint-disable no-restricted-globals */
const STATIC_CACHE = 'perfilio-static-v1';

const PRECACHE_URLS = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const path = url.pathname;
        const looksStatic =
          path.startsWith('/_next/static') ||
          /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf)$/i.test(path);
        if (looksStatic) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const icon = '/icons/icon-192x192.png';
      let title = 'Perfilio';
      let body = 'Tienes una notificación nueva';

      if (event.data) {
        let raw = '';
        try {
          raw = await event.data.text();
        } catch {
          raw = '';
        }
        const trimmed = raw.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object') {
              if (typeof parsed.title === 'string' && parsed.title.trim()) title = parsed.title;
              if (typeof parsed.body === 'string' && parsed.body.trim()) body = parsed.body;
            }
          } catch {
            /* payload vacío, texto plano u otro formato: defaults arriba */
          }
        }
      }

      await self.registration.showNotification(title, {
        body,
        icon,
        badge: '/icons/icon-192x192.png',
        tag: 'perfilio-notification',
        renotify: true,
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (!client.url.startsWith(self.location.origin) || !('focus' in client)) continue;
        if ('navigate' in client && typeof client.navigate === 'function') {
          return client.navigate(fullUrl).then(() => client.focus());
        }
        return client.focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullUrl);
      }
    })
  );
});
