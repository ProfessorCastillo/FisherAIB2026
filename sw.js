/* Static shell only: published JSON is always fetched from the network. */
const CACHE_NAME = 'fisher-aib-2026-shell-v4';
const APP_DATA_PATH = new URL('data/', self.registration.scope).pathname;
const SHELL_URLS = [
  'conference-main.html', 'conference-agenda.html', 'conference-presentation-search.html',
  'constellation.html', 'manifest.json', 'assets/constellation.css', 'assets/constellation.js',
  'assets/plotly-2.35.2.min.js',
  '2026FCOB_AIinBusiness_Tagline.jpg', '2026FCOB_AIinBusiness.png', '2026FCOB_AIinBusiness_ico.ico'
];
function isPublishedData(url) {
  return url.origin === self.location.origin && url.pathname.indexOf(APP_DATA_PATH) === 0 && /\.json$/.test(url.pathname);
}
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => undefined)))));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  // GitHub Pages sites can share an origin. Do not delete caches belonging to
  // another app; only migrate this app's v1 and later named caches.
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME && name.indexOf('fisher-aib-2026-') === 0).map((name) => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (isPublishedData(url)) {
    // Never satisfy published data from any cache, including an old release.
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
