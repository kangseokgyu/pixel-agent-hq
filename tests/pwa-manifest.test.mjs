import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function parsePngDimensions(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buffer.length >= 24, "PNG buffer too small");
  assert.ok(buffer.subarray(0, 8).equals(signature), "invalid PNG signature");
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("manifest.webmanifest defines subpath-relative standalone PWA metadata and icons", () => {
  const manifestPath = resolve(ROOT, "manifest.webmanifest");
  assert.ok(existsSync(manifestPath), "manifest.webmanifest must exist");

  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);

  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(typeof manifest.name === "string" && manifest.name.length > 0);
  assert.ok(typeof manifest.short_name === "string" && manifest.short_name.length > 0);
  assert.ok(typeof manifest.theme_color === "string" && manifest.theme_color.startsWith("#"));
  assert.ok(typeof manifest.background_color === "string" && manifest.background_color.startsWith("#"));

  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  const icon192 = manifest.icons.find((icon) => icon.sizes === "192x192");
  const icon512 = manifest.icons.find((icon) => icon.sizes === "512x512");
  assert.ok(icon192, "192x192 icon must be declared");
  assert.ok(icon512, "512x512 icon must be declared");
  assert.equal(icon192.src, "./icons/icon-192.png");
  assert.equal(icon512.src, "./icons/icon-512.png");
  assert.equal(icon192.type, "image/png");
  assert.equal(icon512.type, "image/png");

  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith("/"), `icon src must be relative: ${icon.src}`);
  }
});

test("PNG app icons exist with valid signatures and dimensions (192x192, 512x512)", () => {
  const icon192Path = resolve(ROOT, "icons/icon-192.png");
  const icon512Path = resolve(ROOT, "icons/icon-512.png");
  assert.ok(existsSync(icon192Path), "icons/icon-192.png must exist");
  assert.ok(existsSync(icon512Path), "icons/icon-512.png must exist");

  assert.deepEqual(parsePngDimensions(readFileSync(icon192Path)), { width: 192, height: 192 });
  assert.deepEqual(parsePngDimensions(readFileSync(icon512Path)), { width: 512, height: 512 });
});

test("pwa-register.js registers ./sw.js with relative scope and handles logout and failures safely", async () => {
  const registerPath = resolve(ROOT, "pwa-register.js");
  assert.ok(existsSync(registerPath), "pwa-register.js must exist");

  const source = readFileSync(registerPath, "utf8");
  assert.doesNotMatch(source, /\b(innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function)\b/);
  assert.doesNotMatch(source, /\blocalStorage\b/);

  const mod = await import(`../pwa-register.js?t=${Date.now()}`);
  assert.equal(typeof mod.registerPwa, "function");

  // 1. Graceful when serviceWorker is unsupported
  const listeners = new Map();
  const mockWindowUnsupported = {
    location: { origin: "https://example.github.io" },
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) || []), fn]);
    },
  };
  const unsupportedResult = await mod.registerPwa({
    windowObj: mockWindowUnsupported,
    navigatorObj: {},
  });
  assert.equal(unsupportedResult.supported, false);
  assert.equal(unsupportedResult.registration, null);

  // 2. Registers ./sw.js with { scope: "./", updateViaCache: "none" } and forwards logout
  const registerCalls = [];
  const postedMessages = [];
  const regActiveMessages = [];
  const mockController = {
    postMessage(msg) {
      postedMessages.push(msg);
    },
  };
  const mockActive = {
    postMessage(msg) {
      regActiveMessages.push(msg);
    },
  };
  const mockListeners = new Map();
  const mockWindow = {
    location: { origin: "https://owner.github.io" },
    addEventListener(type, fn) {
      mockListeners.set(type, [...(mockListeners.get(type) || []), fn]);
    },
  };
  const mockNavigator = {
    serviceWorker: {
      controller: mockController,
      async register(url, opts) {
        registerCalls.push({ url, opts });
        return { scope: "https://owner.github.io/WIPS-Office/", active: mockActive };
      },
      async getRegistration() {
        return { active: mockActive };
      },
    },
  };

  const result = await mod.registerPwa({
    windowObj: mockWindow,
    navigatorObj: mockNavigator,
  });
  assert.equal(result.supported, true);
  assert.deepEqual(registerCalls, [
    { url: "./sw.js", opts: { scope: "./", updateViaCache: "none" } },
  ]);
  assert.equal(typeof mockWindow.__wipsClearSwSession, "function");

  // Trigger via custom event
  for (const fn of mockListeners.get("wips:logout") || []) {
    fn();
  }
  // Wait microtask for getRegistration
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(postedMessages, [{ type: "WIPS_CLEAR_SESSION" }]);
  assert.deepEqual(regActiveMessages, [{ type: "WIPS_CLEAR_SESSION" }]);

  // Ignore cross-origin postMessage, accept same-origin wips:logout postMessage
  for (const fn of mockListeners.get("message") || []) {
    fn({ origin: "https://evil.example", data: { type: "wips:logout" } });
    fn({ origin: "https://owner.github.io", data: { type: "wips:logout" } });
  }
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(postedMessages.length, 2);

  // 3. Failing SW register does not throw
  const failResult = await mod.registerPwa({
    windowObj: { location: { origin: "https://owner.github.io" }, addEventListener() {} },
    navigatorObj: {
      serviceWorker: {
        async register() {
          throw new Error("SW blocked");
        },
      },
    },
  });
  assert.equal(failResult.supported, true);
  assert.equal(failResult.registration, null);
});

test("outer index.html links manifest, icons, theme-color, and pwa-register.js under strict CSP", () => {
  const indexHtml = readFileSync(resolve(ROOT, "index.html"), "utf8");
  const headAndShell = indexHtml.split("<iframe")[0] + indexHtml.slice(indexHtml.lastIndexOf("</iframe>"));

  assert.match(headAndShell, /<link\s+rel="manifest"\s+href="\.\/manifest\.webmanifest"/);
  assert.match(headAndShell, /<link\s+rel="icon"[^>]*href="\.\/icons\/icon-192\.png"/);
  assert.match(headAndShell, /<link\s+rel="apple-touch-icon"\s+href="\.\/icons\/icon-192\.png"/);
  assert.match(headAndShell, /<meta\s+name="theme-color"\s+content="#/);
  assert.match(headAndShell, /<script\s+type="module"\s+src="\.\/pwa-register\.js"><\/script>/);

  // Strict CSP preserved
  assert.match(headAndShell, /manifest-src 'self'/);
  assert.match(headAndShell, /worker-src 'self'/);
  assert.match(headAndShell, /script-src 'self' 'unsafe-inline'/);
});
