/* The production build injects every generated asset, including lazy chunks. */
const BUILD_VERSION = /* CASH_TRACKER_VERSION */ "local";
const PRECACHE_URLS = /* CASH_TRACKER_PRECACHE */ [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/logo.svg",
  "/icons/logo-192.png",
  "/icons/logo-512.png",
  "/icons/logo-maskable-512.png",
  "/icons/logo-apple-touch.png",
];
const CACHE_PREFIX = "cash-tracker-app-";
const CACHE_NAME = CACHE_PREFIX + BUILD_VERSION;
const HASHED_ASSET_PATH = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;
const PRECACHED_ASSET_URLS = new Set(
  PRECACHE_URLS.filter(
    (path) => path !== "/" && !/\.html(?:\?|$)/.test(path),
  ).map((path) => new URL(path, self.location.origin).href),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        // Fetch with reload avoids mixing a fresh worker with an old HTTP-cached index.
        await cache.addAll(
          PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })),
        );
        for (const url of PRECACHE_URLS.filter((url) =>
          /\.(?:m?js|css)$/.test(url),
        )) {
          const response = await cache.match(url);
          if (
            !response ||
            response.headers
              .get("Content-Type")
              ?.toLowerCase()
              .includes("text/html")
          ) {
            throw new Error(
              "A atualização recebeu HTML no lugar de um recurso do aplicativo.",
            );
          }
          const beginning = (await response.clone().text())
            .trimStart()
            .slice(0, 80);
          if (/^(?:<!doctype\s+html|<html(?:\s|>))/i.test(beginning)) {
            throw new Error(
              "A atualização recebeu uma página no lugar de um recurso do aplicativo.",
            );
          }
        }
      } catch (error) {
        // A failed candidate must not become an apparent complete predecessor.
        await caches.delete(CACHE_NAME);
        throw error;
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const previous = [];
      for (const key of keys.filter(
        (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME,
      )) {
        const cache = await caches.open(key);
        // addAll is atomic: an index in a previous cache means the full batch
        // completed. Keep two versions for pages loading during the handoff.
        if (await cache.match("/index.html")) previous.push(key);
      }
      const keep = new Set([CACHE_NAME, ...previous.slice(-2)]);
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !keep.has(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const isPage =
    request.mode === "navigate" &&
    (!/\.[^/]+$/.test(url.pathname) || url.pathname.endsWith("/index.html"));
  if (isPage) {
    event.respondWith(
      (async () => {
        // Pin the shell to this worker's complete precache. A waiting update may
        // already be deployed, but its index must not run with the old asset cache.
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match("/index.html");
        if (shell) return shell;
        try {
          return await fetch(request);
        } catch {
          return new Response(
            "Cash Tracker ainda não está disponível offline. Abra o aplicativo com conexão uma vez.",
            {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            },
          );
        }
      })(),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Static build files do not vary by Origin. Module/CSS requests may send
      // Origin while addAll's request does not, and preview responds Vary: Origin.
      const cached = await cache.match(request, {
        ignoreSearch: false,
        ignoreVary: PRECACHED_ASSET_URLS.has(url.href),
      });
      if (cached) return cached;
      if (HASHED_ASSET_PATH.test(url.pathname)) {
        const previous = (await caches.keys())
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .reverse();
        for (const key of previous) {
          const old = await (
            await caches.open(key)
          ).match(request, { ignoreSearch: false, ignoreVary: true });
          if (
            old &&
            !old.headers
              .get("Content-Type")
              ?.toLowerCase()
              .includes("text/html")
          )
            return old;
        }
      }
      try {
        // Unlisted URLs are deliberately not cached; a missing JS file never gets HTML.
        const response = await fetch(request);
        if (
          response.headers
            .get("Content-Type")
            ?.toLowerCase()
            .includes("text/html")
        ) {
          return new Response("Recurso não encontrado.", {
            status: 404,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        return response;
      } catch {
        return new Response("Recurso indisponível offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })(),
  );
});
