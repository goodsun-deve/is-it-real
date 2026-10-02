// is-it-real 서비스 워커 — 설치(홈 화면 추가) 가능하게 만드는 최소 기능만 수행합니다.
// 판정 결과는 항상 최신이어야 하므로 /api/ 요청은 캐시하지 않습니다.

const CACHE_NAME = 'is-it-real-shell-v1';
const SHELL_FILES = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API 호출은 항상 네트워크로만 — 절대 캐시하지 않음 (매번 새로운 AI 판정이 필요함)
  if (url.pathname.startsWith('/api/')) return;

  if (req.method !== 'GET') return;

  // 그 외(정적 파일)는 네트워크 우선, 실패하면 캐시된 걸로 대체 (오프라인 대비)
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
