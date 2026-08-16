/* Training Tracker service worker — offline app shell */
const CACHE = "tp-tracker-v19";
const SHELL = [
  "./",
  "./index.html",
  "./privacy.html",
  "./vendor/supabase-js-2.111.0.min.js",
  "./js/auth-config.js",
  "./js/auth-client.js",
  "./js/auth-ui.js",
  "./js/program-store.js",
  "./js/session-store.js",
  "./js/account-data.js",
  "./js/profile-ui.js",
  "./program.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Auth and future Data API traffic must reach Supabase directly. In particular,
  // never turn a failed cross-origin SDK request into a cached index.html response.
  if (url.origin !== self.location.origin) return;
  // Always try network first for program.json so an updated program is picked up,
  // fall back to cache when offline.
  if (url.pathname.endsWith("program.json")) {
    e.respondWith(
      fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }
  // Cache-first for the app shell.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return r;
    }).catch(() => caches.match("./index.html")))
  );
});
