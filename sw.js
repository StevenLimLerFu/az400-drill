'use strict';

// Bump CACHE_VERSION whenever you change any file below, so installed apps pick up the update.
var CACHE_VERSION = 'v3';
var SHELL_CACHE = 'az400-drill-shell-' + CACHE_VERSION;
var FONT_CACHE = 'az400-drill-fonts-v1';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './questions.js',
  './manifest.webmanifest',
  './sample-questions.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];
var FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          return k.indexOf('az400-drill-') === 0 && k !== SHELL_CACHE && k !== FONT_CACHE;
        }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Google Fonts: cache first, so fonts keep working offline after the first visit.
  if (FONT_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(
      caches.open(FONT_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Page navigations: network first, fall back to the cached app shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html', { cacheName: SHELL_CACHE });
      })
    );
    return;
  }

  // App files: serve from cache, refresh the cache in the background.
  event.respondWith(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.match(req).then(function (hit) {
        var refresh = fetch(req).then(function (res) {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || refresh;
      });
    })
  );
});
