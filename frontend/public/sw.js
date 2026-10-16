const CACHE = "gia-chuan-static-v7";
const PAGES = ["/", "/staff", "/shop"];
const SHELL = [...PAGES, "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith("gia-chuan-") && key !== CACHE)
      .map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Cache only the generic POS app shell and static files. API responses and user-specific data stay out of Cache Storage.
  if (PAGES.includes(url.pathname) && event.request.mode !== "navigate") return;
  if (!url.pathname.startsWith("/_next/static/") && !SHELL.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    if (PAGES.includes(url.pathname) && event.request.mode === "navigate") {
      try {
        const response = await fetch(event.request);
        if (response.ok && response.type === "basic") await cache.put(url.pathname, response.clone());
        return response;
      } catch {
        const offlineShell = await cache.match(url.pathname);
        if (offlineShell) return offlineShell;
        throw new Error("Offline app shell has not been cached yet.");
      }
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok && response.type === "basic") await cache.put(event.request, response.clone());
    return response;
  }));
});
