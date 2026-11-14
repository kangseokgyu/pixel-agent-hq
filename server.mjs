import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  MAX_PAGES,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  NOTION_API_ROOT,
  NOTION_VERSION,
  NotionApiError,
  REQUEST_TIMEOUT_MS,
  fetchNotionSnapshot as fetchSharedNotionSnapshot,
  mapNotionPage,
  parseRetryAfter,
} from "./lib/notion-client.mjs";

export const DATA_SOURCE_ID = "00000000-0000-4000-8000-000000000000";
export const SOURCE_URL = "https://app.notion.com/p/00000000000000000000000000000000";
export const POLL_COOLDOWN_MS = 30_000;
export {
  MAX_PAGES,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  NOTION_API_ROOT,
  NOTION_VERSION,
  NotionApiError,
  REQUEST_TIMEOUT_MS,
  mapNotionPage,
  parseRetryAfter,
};

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const ALLOWED_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/wips-office.html", "wips-office.html"],
  ["/wips-data.json", "wips-data.json"],
  ["/manifest.webmanifest", "manifest.webmanifest"],
  ["/pwa-register.js", "pwa-register.js"],
  ["/sw.js", "sw.js"],
  ["/icons/icon-192.png", "icons/icon-192.png"],
  ["/icons/icon-512.png", "icons/icon-512.png"],
]);

function getContentType(filename) {
  if (filename.endsWith(".webmanifest")) {
    return "application/manifest+json; charset=utf-8";
  }
  if (filename.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  if (filename.endsWith(".png")) {
    return "image/png";
  }
  if (filename.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "text/html; charset=utf-8";
}

function readDotEnv(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }

  const parsed = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

export function readConfig({ env = process.env, appDir = APP_DIR } = {}) {
  const localEnv = readDotEnv(join(appDir, ".env"));
  return {
    token: env.NOTION_TOKEN || localEnv.NOTION_TOKEN || "",
    dataSourceId: env.NOTION_DATA_SOURCE_ID || localEnv.NOTION_DATA_SOURCE_ID || DATA_SOURCE_ID,
    port: Number(env.PORT || localEnv.PORT || 8000),
    host: "127.0.0.1",
  };
}

export function fetchNotionSnapshot({
  dataSourceId = DATA_SOURCE_ID,
  sourceUrl = SOURCE_URL,
  ...rest
} = {}) {
  return fetchSharedNotionSnapshot({
    dataSourceId,
    sourceUrl,
    ...rest,
  });
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function publicError(error) {
  if (error?.code === "NOTION_TOKEN_MISSING") return "NOTION_TOKEN is not configured. Add it to .env and restart the server.";
  if (error?.code === "NOTION_TIMEOUT") return "Notion request timed out. The existing snapshot is still displayed.";
  if (error?.code === "NOTION_INCOMPLETE_RESPONSE") return "Notion returned an incomplete result. The existing snapshot is still displayed.";
  if (error?.status === 429) return "Notion rate limit reached. The next poll will wait for Retry-After.";
  if (error?.status >= 400) return `Notion request failed (HTTP ${error.status}). The existing snapshot is still displayed.`;
  return "Could not refresh Notion data. The existing snapshot is still displayed.";
}

function retryAfterSeconds(milliseconds) {
  return String(Math.max(1, Math.ceil(milliseconds / 1000)));
}

export function createWipsServer({
  staticDir = APP_DIR,
  initialSnapshot,
  token = "",
  dataSourceId = DATA_SOURCE_ID,
  fetchImpl = globalThis.fetch,
  fetchSnapshot,
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  let lastSnapshot = initialSnapshot || JSON.parse(readFileSync(join(staticDir, "wips-data.json"), "utf8"));
  let lastSuccessAt = null;
  let cooldownUntil = 0;
  let inFlightRefresh = null;
  const loadSnapshot = fetchSnapshot || ((hooks) => fetchNotionSnapshot({
    token,
    dataSourceId,
    fetchImpl,
    timeoutMs,
    now,
    ...hooks,
  }));

  function startRefresh() {
    const refresh = Promise.resolve()
      .then(() => loadSnapshot({
        onRateLimit(milliseconds) {
          if (milliseconds > 0) cooldownUntil = Math.max(cooldownUntil, now() + milliseconds);
        },
      }))
      .then((freshSnapshot) => {
        if (!freshSnapshot || !Array.isArray(freshSnapshot.results)) {
          throw new NotionApiError("Notion API response did not contain a valid snapshot.", { code: "NOTION_INVALID_RESPONSE" });
        }
        lastSnapshot = freshSnapshot;
        lastSuccessAt = new Date(now()).toISOString();
        cooldownUntil = 0;
        return { snapshot: freshSnapshot, lastSuccessAt };
      });
    inFlightRefresh = refresh;
    refresh.finally(() => {
      if (inFlightRefresh === refresh) inFlightRefresh = null;
    }).catch(() => {});
    return refresh;
  }

  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;

    if (pathname === "/api/tasks") {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET", "Cache-Control": "no-store" });
        response.end();
        return;
      }
      let refresh = inFlightRefresh;
      const currentTime = now();
      if (!refresh && currentTime < cooldownUntil) {
        const remaining = cooldownUntil - currentTime;
        sendJson(response, 429, {
          error: "Notion rate limit reached. The next poll will wait for Retry-After.",
          snapshotDate: lastSnapshot.snapshotDate,
          lastSuccessAt,
        }, { "Retry-After": retryAfterSeconds(remaining) });
        return;
      }

      try {
        refresh ||= startRefresh();
        const refreshed = await refresh;
        sendJson(response, 200, { ...refreshed.snapshot, lastSuccessAt: refreshed.lastSuccessAt });
      } catch (error) {
        const cooldownMs = Number.isFinite(error?.cooldownMs) ? Math.max(0, error.cooldownMs) : 0;
        if (cooldownMs > 0) cooldownUntil = Math.max(cooldownUntil, now() + cooldownMs);
        const status = error?.status === 429 ? 429 : error?.status === 504 ? 504 : 502;
        const headers = cooldownMs > 0 ? { "Retry-After": retryAfterSeconds(cooldownMs) } : {};
        sendJson(response, status, {
          error: publicError(error),
          snapshotDate: lastSnapshot.snapshotDate,
          lastSuccessAt,
        }, headers);
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const filename = ALLOWED_FILES.get(pathname);
    if (!filename) {
      response.writeHead(404, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end("Not found");
      return;
    }

    try {
      const content = await readFile(join(staticDir, filename));
      const contentType = getContentType(filename);
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(500, { "Cache-Control": "no-store" });
      response.end("Could not read the application file");
    }
  });
}

export function startServer(config = readConfig()) {
  const server = createWipsServer({
    staticDir: APP_DIR,
    token: config.token,
    dataSourceId: config.dataSourceId,
  });
  server.listen(config.port, config.host, () => {
    process.stdout.write(`WIPS Office server listening at http://${config.host}:${config.port}\n`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
