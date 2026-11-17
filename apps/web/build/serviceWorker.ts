import type { Plugin } from 'vite';

/**
 * Offline support: a service worker that keeps the whole app (page, code, styles, the barcode
 * reader, icons and fonts) on the phone, so the app opens and sells with no internet at all.
 * It is generated at build time with the exact list of built files; every deploy gets a new
 * version, the phone downloads it in the background and the next opening uses it.
 * Supabase requests are never cached: invoices go through the app's own outbox.
 */

/** Files from public/ that the app needs offline. */
const PUBLIC_FILES = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-64.png',
];

/** Short, stable fingerprint of the file list (FNV-1a), so the worker changes whenever the build does. */
function fingerprint(values: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const char of values.join('|')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function source(version: string, precache: readonly string[]): string {
  return `/* RAVIN Sales service worker ${version}: keeps the app on the phone so it opens and sells offline. */
const APP_CACHE = 'ravin-app-${version}';
const FONT_CACHE = 'ravin-fonts-v1';
const PRECACHE = ${JSON.stringify(precache)};
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const PAGE_TIMEOUT_MS = 4000;
// Servers add "Vary" headers (Origin, Accept-Encoding); the saved copies must match whatever the
// browser sends, so lookups ignore them.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('ravin-app-') && key !== APP_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function savedPage() {
  const cache = await caches.open(APP_CACHE);
  return (await cache.match('/', MATCH)) || (await caches.match('/', MATCH)) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // The page: the latest version when the network answers quickly, the saved copy otherwise.
  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(
      withTimeout(fetch(request), PAGE_TIMEOUT_MS)
        .then((response) => {
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(APP_CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(savedPage),
    );
    return;
  }

  // Built files never change under the same name: the saved copy first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request, MATCH).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && url.pathname.startsWith('/assets/')) {
              const copy = response.clone();
              caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Fonts: the saved copy straight away, refreshed in the background.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(request, MATCH);
        const network = fetch(request)
          .then((response) => {
            if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached || Response.error());
        return cached || network;
      }),
    );
  }
  // Anything else (the Supabase API) goes to the network as usual.
});
`;
}

export function serviceWorker(): Plugin {
  return {
    name: 'ravin-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((file) => !file.endsWith('.map') && file !== 'index.html' && file !== 'sw.js')
        .map((file) => `/${file}`)
        .sort();
      // "/" is the page itself (Cloudflare serves index.html there without a redirect).
      const precache = ['/', ...built, ...PUBLIC_FILES];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source(fingerprint(precache), precache) });
    },
  };
}
