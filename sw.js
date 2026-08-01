/* Training Tracker service worker — offline app shell */
const CACHE = "tp-tracker-v5";
const SHELL = [
  "./",
  "./index.html",
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
      if (r.ok && url.origin === location.origin) {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return r;
    }).catch(() => caches.match("./index.html")))
  );
});
