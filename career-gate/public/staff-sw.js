/* global self, caches, Request, Response, URL */
/* Only the generic recovery page is cached. Private pages, API data, documents and credentials never enter this cache. */
const CACHE = "career-gate-staff-recovery-v1";
const FALLBACK = "/staff-offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(FALLBACK, { cache: "reload", credentials: "omit" }))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("career-gate-staff-recovery-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || event.request.mode !== "navigate" || url.origin !== self.location.origin || !(url.pathname === "/staff" || url.pathname.startsWith("/staff/"))) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(FALLBACK)) || new Response("Connection unavailable. Reconnect to open your staff workspace.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
});
