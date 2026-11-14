const SW_VERSION = "wips-dev-1";
const SCOPE_URL = new URL(self.registration?.scope || self.location?.href || "http://localhost/");
const SCOPE_PATH = SCOPE_URL.pathname.endsWith("/") ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;
const SHELL_CACHE_PREFIX = `wips-office-shell:${SCOPE_PATH}:`;
const SHELL_CACHE_NAME = `${SHELL_CACHE_PREFIX}${SW_VERSION}`;
const SESSION_CACHE_PREFIX = `wips-office-session:${SCOPE_PATH}:`;

const SHELL_RELATIVE_PATHS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./pwa-register.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

function normalizeUrl(urlOrPath) {
  const url = new URL(urlOrPath, SCOPE_URL.href);
  return `${url.origin}${url.pathname}`;
}

const ROOT_URL = normalizeUrl("./");
const INDEX_URL = normalizeUrl("./index.html");
const SW_SCRIPT_URL = normalizeUrl("./sw.js");
const SHELL_ASSET_URLS = SHELL_RELATIVE_PATHS.map((rel) => normalizeUrl(rel));
const SHELL_ASSET_URL_SET = new Set(SHELL_ASSET_URLS);

function isBlacklistedPath(pathname) {
  if (pathname.includes("/api/")) return true;
  if (pathname.includes("/v1/data_sources/")) return true;
  if (pathname.includes("/v1/databases/")) return true;
  if (pathname.includes("/v1/pages/")) return true;
  if (pathname.includes("/v1/blocks/")) return true;
  if (pathname.includes("/v1/search")) return true;
  if (pathname.endsWith("/wips-data.json") || pathname === "/wips-data.json") return true;
  return false;
}

function shouldBypassCache(request) {
  if (!request || (request.method || "GET").toUpperCase() !== "GET") {
    return true;
  }
  if (
    request.headers &&
    typeof request.headers.has === "function" &&
    (request.headers.has("authorization") || request.headers.has("Authorization"))
  ) {
    return true;
  }
  let url;
  try {
    url = new URL(request.url, SCOPE_URL.href);
  } catch {
    return true;
  }
  if (url.origin !== SCOPE_URL.origin) {
    return true;
  }
  const normalized = `${url.origin}${url.pathname}`;
  if (normalized === SW_SCRIPT_URL) {
    return true;
  }
  if (isBlacklistedPath(url.pathname)) {
    return true;
  }
  const isScopeNavigation = request.mode === "navigate" && url.pathname.startsWith(SCOPE_PATH);
  if (!isScopeNavigation && !SHELL_ASSET_URL_SET.has(normalized)) {
    return true;
  }
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE_NAME);
    await Promise.all(
      SHELL_ASSET_URLS.map(async (assetUrl) => {
        const response = await fetch(assetUrl, { cache: "reload" });
        if (!response || !response.ok) {
          throw new Error(`Failed to precache static shell asset: ${assetUrl}`);
        }
        await cache.put(assetUrl, response);
      }),
    );
    if (typeof self.skipWaiting === "function") {
      await self.skipWaiting();
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(async (key) => {
        if (
          (key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE_NAME) ||
          key.startsWith(SESSION_CACHE_PREFIX)
        ) {
          await caches.delete(key);
        }
      }),
    );
    if (self.clients && typeof self.clients.claim === "function") {
      await self.clients.claim();
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event?.request;
  if (shouldBypassCache(request)) {
    return;
  }

  const url = new URL(request.url, SCOPE_URL.href);
  const normalized = `${url.origin}${url.pathname}`;
  const isHtmlShell = request.mode === "navigate" || normalized === ROOT_URL || normalized === INDEX_URL;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE_NAME);
    if (isHtmlShell) {
      const cacheKey = normalized === INDEX_URL ? INDEX_URL : ROOT_URL;
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok && SHELL_ASSET_URL_SET.has(cacheKey)) {
          await cache.put(cacheKey, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        const cached =
          (await cache.match(cacheKey)) ||
          (await cache.match(ROOT_URL)) ||
          (await cache.match(INDEX_URL));
        return cached || new Response("Offline", { status: 503, statusText: "Offline" });
      }
    }

    const cached = await cache.match(normalized);
    if (cached) {
      return cached;
    }
    try {
      const networkResponse = await fetch(request);
      if (networkResponse && networkResponse.ok && SHELL_ASSET_URL_SET.has(normalized)) {
        await cache.put(normalized, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});

self.addEventListener("message", (event) => {
  const data = event?.data;
  if (!data || data.type !== "WIPS_CLEAR_SESSION") {
    return;
  }

  const cleanup = (async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(async (key) => {
        if (
          key.startsWith(SESSION_CACHE_PREFIX) ||
          key.startsWith("wips-office-session:") ||
          key.startsWith(`wips-office-runtime:${SCOPE_PATH}:`) ||
          key.startsWith("wips-office-runtime:") ||
          key.startsWith("wips-office-data:") ||
          (key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE_NAME)
        ) {
          await caches.delete(key);
        }
      }),
    );
    if (event.ports && event.ports[0] && typeof event.ports[0].postMessage === "function") {
      event.ports[0].postMessage({ cleared: true });
    }
  })();

  if (typeof event.waitUntil === "function") {
    event.waitUntil(cleanup);
  }
});
