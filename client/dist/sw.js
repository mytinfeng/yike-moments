/* 壹刻 · Service Worker
 *
 * 只做三件事：
 *   1. 带 hash 的 /assets/* 静态资源缓存优先（文件名唯一，永不过期）
 *   2. 页面导航网络优先（HTML 里有服务端注入的 TDK，不能缓存旧版）
 *   3. 断网时回落到离线页
 *
 * 明确不碰：/api/*（接口数据必须新鲜）、/uploads/*（用户图不占手机空间）、
 * 跨域请求（外站图片、联邦头像）。
 */

const CACHE = 'yike-shell-v1';

const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {}) // 单个资源缺失不该让整个安装失败
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/uploads/')) return;

  /* 页面：网络优先，拿不到才用离线页。绝不缓存 index.html，
     否则发版后用户会一直看到旧的前端入口 */
  if (req.mode === 'navigate') {
    event.respondWith(
      /* cache: 'no-cache' 是必须的：默认的 fetch 在断网时会直接命中浏览器的
         HTTP 缓存，把旧 HTML 当成功响应返回，离线页就永远看不到 */
      fetch(req, { cache: 'no-cache' }).catch(() =>
        caches.match('/offline.html').then((hit) => hit || new Response('离线', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }))
      )
    );
    return;
  }

  /* 构建产物：缓存优先 */
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
  }
});
