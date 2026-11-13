
const CACHE_NAME = "rozumnyi-plan-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Не кешуємо запити до API та інші запити, крім GET.
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).pathname.startsWith("/api/")
  ) {
    return;
  }
});
