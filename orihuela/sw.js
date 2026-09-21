// Service worker do Orihuela Consulting (escopo: /orihuela/).
// Shell do app: cache-first com atualização em segundo plano.
// data.json: sempre tenta a rede primeiro; sem rede, usa a última cópia em cache.
const CACHE = 'orihuela-v7';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// O app pede para a versão nova assumir quando o usuário toca em "Atualizar agora".
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API etc. passam direto
  const isData = url.pathname.endsWith('/data.json');
  if (isData) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(url.pathname, res.clone()));
        return res;
      }).catch(() => caches.match(url.pathname))
    );
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
