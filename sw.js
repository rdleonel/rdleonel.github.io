const CACHE = 'iron-overload-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './images/group-peito.jpg',
  './images/group-costas.jpg',
  './images/group-biceps.jpg',
  './images/group-triceps.jpg',
  './images/group-abdominal.jpg',
  './images/group-pernas.jpg',
  './images/peito-0.jpg',
  './images/peito-1.jpg',
  './images/peito-2.jpg',
  './images/peito-3.jpg',
  './images/peito-4.jpg',
  './images/peito-5.jpg',
  './images/peito-6.jpg',
  './images/costas-0.jpg',
  './images/costas-1.jpg',
  './images/costas-2.jpg',
  './images/costas-3.jpg',
  './images/costas-4.jpg',
  './images/costas-5.jpg',
  './images/biceps-0.jpg',
  './images/biceps-1.jpg',
  './images/biceps-2.jpg',
  './images/biceps-3.jpg',
  './images/biceps-4.jpg',
  './images/triceps-0.jpg',
  './images/triceps-1.jpg',
  './images/triceps-2.jpg',
  './images/triceps-3.jpg',
  './images/triceps-4.jpg',
  './images/triceps-5.jpg',
  './images/abdominal-0.jpg',
  './images/abdominal-1.jpg',
  './images/abdominal-2.jpg',
  './images/abdominal-3.jpg',
  './images/abdominal-4.jpg',
  './images/pernas-0.jpg',
  './images/pernas-1.jpg',
  './images/pernas-2.jpg',
  './images/pernas-3.jpg',
  './images/pernas-4.jpg',
  './images/pernas-5.jpg',
  './images/pernas-6.jpg',
  './images/pernas-7.jpg',
  './images/pernas-8.jpg',
  './images/pernas-9.jpg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first com atualização em segundo plano (stale-while-revalidate).
// As fontes do Google também entram no cache na primeira visita, para funcionar offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
