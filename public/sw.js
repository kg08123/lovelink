/* LoveLink service worker: cache the app shell (CSS/JS/icons) for fast
   loads; pages are network-first with an offline fallback. Never cache
   POSTs or API-ish responses — only same-origin GETs. */
const CACHE = 'lovelink-shell-v1';
const SHELL = [
  '/',
 '/offline.html',
  '/css/style.css?v=14',
  '/js/instant.js?v=9',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/img/hero-couple.jpg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { /* one missing file must not fail install */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // Navigations: network first, fall back to cache, then the offline page.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || caches.match('/offline.html');
        });
      })
    );
    return;
  }
  // Static assets: stale-while-revalidate (instant load, fresh next time).
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
