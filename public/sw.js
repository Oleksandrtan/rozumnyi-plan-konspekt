
const CACHE_NAME = "rozumnyi-plan-v1";

// Встановлення Service Worker
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Активація Service Worker
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );

      await self.clients.claim();
    })()
  );
});

// Обробка запитів
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Не перехоплюємо API-запити Gemini
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // Інші запити пропускаємо без кешування
});
