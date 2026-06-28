// RoadWatch Ghana — App Shell Service Worker
const CACHE = "roadwatch-v4";
const SHELL = ["/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = e.request.url;

  // API calls: network only, offline fallback
  if (url.includes("/api/")) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ success: false, error: "Offline" }), {
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // HTML documents: network-first so page updates are always picked up
  if (e.request.mode === "navigate" || e.request.headers.get("accept")?.includes("text/html")) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets (JS, CSS, images): cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok && e.request.method === "GET") {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});

// Push notifications
self.addEventListener("push", e => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch { payload = { title: "RoadWatch Ghana", body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(payload.title || "RoadWatch Ghana", {
      body:    payload.body || "New road hazard reported near you.",
      icon:    payload.icon || "/icons/icon-192.svg",
      badge:   "/icons/icon-192.svg",
      vibrate: [200, 100, 200],
      data:    payload.data || {},
      actions: [{ action: "view", title: "View Map" }],
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window" }).then(ws => {
      if (ws.length > 0) { ws[0].focus(); return ws[0].navigate("/"); }
      return clients.openWindow("/");
    })
  );
});
