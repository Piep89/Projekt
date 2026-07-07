// Service Worker (NFA-03): App-Shell aus dem Cache, API-Lesezugriffe network-first
// mit Cache-Rückfall – so bleibt das Projekt ohne Netz lesbar (letzter bekannter Stand).
const VERSION = 'ggp-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;

const SHELL = [
  '/', '/index.html', '/css/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/objekt.js', '/js/offline.js',
  '/js/views/portfolio.js', '/js/views/dashboard.js', '/js/views/checkliste.js',
  '/js/views/setup.js', '/js/views/raumbuch.js', '/js/views/dokumente.js',
  '/js/views/besprechungen.js', '/js/views/besprechung.js', '/js/views/journal.js',
  '/js/views/maengel.js', '/js/views/kontakte.js', '/js/views/berichte.js',
  '/js/views/meintag.js', '/js/views/notizen.js', '/js/views/suche.js',
  '/js/views/admin.js', '/js/views/projekt-einstellungen.js', '/js/views/hilfe.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((namen) => Promise.all(
      namen.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n))
    )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API: network-first, bei Netzausfall letzter bekannter Stand aus dem Cache.
  // Downloads/Exporte (PDF/ZIP/CSV/Bilder) werden nicht zwischengespeichert.
  if (url.pathname.startsWith('/api/')) {
    const cachebar = !/\.(pdf|csv|doc|ics)$|\/export$|\/download$|\/datei$/.test(url.pathname)
      && !url.pathname.startsWith('/api/auth/');
    e.respondWith(
      fetch(e.request).then((res) => {
        if (cachebar && res.ok) {
          const kopie = res.clone();
          caches.open(API_CACHE).then((c) => c.put(e.request, kopie));
        }
        return res;
      }).catch(async () => {
        const cache = await caches.match(e.request);
        if (cache) return cache;
        return new Response(JSON.stringify({ error: 'Offline – keine zwischengespeicherten Daten vorhanden' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } });
      }));
    return;
  }

  // Shell/Statisches: cache-first mit Hintergrund-Aktualisierung
  e.respondWith(
    caches.match(e.request).then((cache) => {
      const netz = fetch(e.request).then((res) => {
        if (res.ok) {
          const kopie = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(e.request, kopie));
        }
        return res;
      }).catch(() => cache);
      return cache || netz;
    }));
});
