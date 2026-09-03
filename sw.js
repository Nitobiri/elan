/* ============================================================
   ÉLAN — Service Worker
   ------------------------------------------------------------
   Deux stratégies, et c'est tout ce qui compte :

   • La COQUILLE (index.html, app.js, app.css, le manifeste) est
     servie en RÉSEAU D'ABORD, avec repli sur le cache. C'est la
     correction du bug qui empêchait l'app installée de se mettre
     à jour : en « cache d'abord », on servait toujours la version
     de la veille et il fallait deux rechargements pour voir la
     nouvelle — ce que personne ne fait jamais.
   • Les ICÔNES, qui ne changent quasiment pas et qui sont lourdes,
     restent en CACHE D'ABORD.

   Hors ligne, la coquille repart du cache : l'app fonctionne
   toujours sans réseau, on n'a échangé aucune garantie.
   ============================================================ */
const CACHE = 'elan-v4';
const SHELL = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest'];
const ASSETS = ['./icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
/* Au-delà de ce délai, on considère le réseau comme absent et on sert le cache.
   Sans plafond, un réseau qui pend fait un écran blanc au lancement. */
const NET_TIMEOUT = 3500;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(SHELL.concat(ASSETS).map((u) => c.add(u).catch(() => {}))))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* L'app pilote le worker : elle demande sa version, force la bascule, ou vide tout. */
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (d.type === 'GET_VERSION') {
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ cache: CACHE });
    return;
  }
  if (d.type === 'CLEAR_CACHE') {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => { if (e.ports && e.ports[0]) e.ports[0].postMessage({ cleared: true }); }));
  }
});

function isShell(url, req) {
  if (req.mode === 'navigate') return true;
  const p = url.pathname;
  return /\.(?:html|js|css|webmanifest)$/.test(p) || p.endsWith('/');
}

/* Réseau d'abord, cache en filet — et on rafraîchit le cache au passage. */
function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const timer = setTimeout(() => {
      caches.match(req).then((c) => { if (c) done(c); });
    }, NET_TIMEOUT);

    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      done(res);
    }).catch(() => {
      clearTimeout(timer);
      caches.match(req).then((c) => done(c || Response.error()));
    });
  });
}

/* Cache d'abord, et on retélécharge en tâche de fond pour la prochaine fois. */
function cacheFirst(req) {
  return caches.match(req).then((cached) => {
    const net = fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => cached);
    return cached || net;
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // laisse passer l'API GitHub (synchro), etc.
  e.respondWith(isShell(url, req) ? networkFirst(req) : cacheFirst(req));
});
