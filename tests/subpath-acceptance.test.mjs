import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { buildPages } from "../scripts/build-pages.mjs";
import { unescapeHtmlAttr } from "../scripts/sync-office.mjs";
import { verifyDist } from "../scripts/verify-dist.mjs";

const ROOT = resolve(import.meta.dirname, "..");

const SUBPATH_ROUTES = new Map([
  ["/WIPS-Office/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/WIPS-Office/index.html", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/WIPS-Office/manifest.webmanifest", { file: "manifest.webmanifest", contentType: "application/manifest+json; charset=utf-8" }],
  ["/WIPS-Office/pwa-register.js", { file: "pwa-register.js", contentType: "application/javascript; charset=utf-8" }],
  ["/WIPS-Office/sw.js", { file: "sw.js", contentType: "application/javascript; charset=utf-8" }],
  ["/WIPS-Office/icons/icon-192.png", { file: "icons/icon-192.png", contentType: "image/png" }],
  ["/WIPS-Office/icons/icon-512.png", { file: "icons/icon-512.png", contentType: "image/png" }],
]);

test("built dist/ serves cleanly under /WIPS-Office/ subpath and blocks non-allowlisted endpoints", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wips-subpath-http-"));
  const distDir = join(tempRoot, "dist");
  buildPages({ rootDir: ROOT, distDir });
  assert.equal(verifyDist({ rootDir: ROOT, distDir }).ok, true);

  const server = createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    const entry = SUBPATH_ROUTES.get(pathname);
    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const content = readFileSync(join(distDir, entry.file));
    res.writeHead(200, {
      "Content-Type": entry.contentType,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(content);
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const htmlRes = await fetch(`${baseUrl}/WIPS-Office/`);
    assert.equal(htmlRes.status, 200);
    const htmlBody = await htmlRes.text();
    assert.match(htmlBody, /<link\s+rel="manifest"\s+href="\.\/manifest\.webmanifest"/);
    assert.match(htmlBody, /<script\s+type="module"\s+src="\.\/pwa-register\.js"><\/script>/);
    assert.ok(!htmlBody.includes("00000000-0000-4000-8000-000000000000"));
    assert.ok(!htmlBody.includes("00000000000000000000000000000000"));

    const manifestRes = await fetch(`${baseUrl}/WIPS-Office/manifest.webmanifest`);
    assert.equal(manifestRes.status, 200);
    const manifest = await manifestRes.json();
    assert.equal(manifest.start_url, "./");
    assert.equal(manifest.scope, "./");

    const regRes = await fetch(`${baseUrl}/WIPS-Office/pwa-register.js`);
    assert.equal(regRes.status, 200);
    assert.match(await regRes.text(), /\.\/sw\.js/);

    const swRes = await fetch(`${baseUrl}/WIPS-Office/sw.js`);
    assert.equal(swRes.status, 200);
    assert.match(await swRes.text(), /const SW_VERSION = "wips-[0-9a-f]{12}";/);

    const icon192Res = await fetch(`${baseUrl}/WIPS-Office/icons/icon-192.png`);
    assert.equal(icon192Res.status, 200);
    const iconBytes = Buffer.from(await icon192Res.arrayBuffer());
    assert.ok(iconBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));

    for (const blocked of [
      "/WIPS-Office/wips-data.json",
      "/WIPS-Office/api/tasks",
      "/WIPS-Office/.env",
      "/wips-data.json",
    ]) {
      const blockedRes = await fetch(`${baseUrl}${blocked}`);
      assert.equal(blockedRes.status, 404, `Expected 404 for ${blocked}`);
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("built dist/index.html srcdoc runs zero-data boot, OPFS live query, transient error preservation, logout purge, and mobile layout", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "wips-subpath-e2e-"));
  const distDir = join(tempRoot, "dist");
  buildPages({ rootDir: ROOT, distDir });

  try {
    const builtIndex = readFileSync(join(distDir, "index.html"), "utf8");
    const srcdocMatch = builtIndex.match(/\bdata-srcdoc="([\s\S]*?)"/);
    assert.ok(srcdocMatch, "dist/index.html must embed data-srcdoc");
    const srcdoc = unescapeHtmlAttr(srcdocMatch[1]);

    // Mobile responsive viewport and CSS rules check on built artifact
    assert.match(builtIndex, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(srcdoc, /@media\s*\(max-width:\s*480px\)/);
    assert.match(srcdoc, /touch-action:\s*manipulation/);
    assert.match(srcdoc, /min-height:\s*44px/);
    assert.match(srcdoc, /font-size:\s*16px/);
    assert.match(srcdoc, /overflow-x:\s*clip/);

    const opfsFiles = new Map();
    const removed = [];
    const opfs = {
      async getDirectory() {
        return {
          async getDirectoryHandle() {
            return {
              async getFileHandle(name, { create = false } = {}) {
                if (!opfsFiles.has(name)) {
                  if (!create) {
                    const err = new Error(`NotFound: ${name}`);
                    err.name = "NotFoundError";
                    throw err;
                  }
                  opfsFiles.set(name, "");
                }
                return {
                  async getFile() {
                    return { async text() { return opfsFiles.get(name); } };
                  },
                  async createWritable() {
                    let next = "";
                    return {
                      async write(chunk) { next = String(chunk); },
                      async close() { opfsFiles.set(name, next); },
                    };
                  },
                };
              },
              async removeEntry(name) {
                if (!opfsFiles.has(name)) {
                  const err = new Error(`NotFound: ${name}`);
                  err.name = "NotFoundError";
                  throw err;
                }
                opfsFiles.delete(name);
                removed.push(name);
              },
            };
          },
        };
      },
    };

    function bootSrcdoc({ onLine, fetchImpl }) {
      const dataJson = srcdoc.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/)[1];
      const modelScript = srcdoc.match(/<script id="office-model">([\s\S]*?)<\/script>/)[1];
      const byId = new Map();
      const makeEl = (tag, id = "") => {
        const classes = new Set();
        const listeners = new Map();
        return {
          tagName: tag.toUpperCase(),
          id,
          className: "",
          dataset: {},
          style: {},
          open: false,
          attributes: {},
          children: [],
          listeners,
          hidden: false,
          disabled: false,
          value: "",
          type: "",
          draggable: false,
          _textContent: "",
          classList: {
            add: (...n) => n.forEach((x) => classes.add(x)),
            remove: (...n) => n.forEach((x) => classes.delete(x)),
            contains: (x) => classes.has(x),
          },
          setAttribute(k, v) {
            this.attributes[k] = String(v);
            if (k === "id") {
              this.id = String(v);
              byId.set(this.id, this);
            }
          },
          removeAttribute(k) { delete this.attributes[k]; },
          append(...nodes) { for (const n of nodes) if (n && typeof n === "object") this.children.push(n); },
          appendChild(node) { this.children.push(node); return node; },
          replaceChildren(...nodes) { this.children = nodes.filter((n) => n && typeof n === "object"); },
          addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
          querySelectorAll: () => [],
          focus() {},
          set textContent(v) { this._textContent = String(v ?? ""); },
          get textContent() { return this._textContent; },
        };
      };
      for (const match of srcdoc.matchAll(/id="(wips-office-[a-z-]+)"/g)) {
        byId.set(match[1], makeEl("div", match[1]));
      }
      byId.get("wips-office-data")._textContent = dataJson;
      byId.get("wips-office-status").value = "전체 상태";
      byId.get("wips-office-project").value = "전체 프로젝트";

      const swClearCalls = [];
      const windowEvents = [];
      const windowObj = {
        location: { origin: "https://owner.github.io", href: "https://owner.github.io/WIPS-Office/" },
        navigator: { onLine, storage: { getDirectory: opfs.getDirectory } },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        matchMedia: () => ({ matches: false }),
        setInterval: () => 1,
        clearInterval: () => {},
        addEventListener: () => {},
        dispatchEvent: (evt) => windowEvents.push(evt.type),
        __wipsClearSwSession: async () => swClearCalls.push("cleared"),
        parent: { postMessage: () => {} },
      };

      vm.runInNewContext(modelScript, {
        window: windowObj,
        globalThis: windowObj,
        document: {
          getElementById: (id) => byId.get(id) ?? null,
          createElement: (tag) => makeEl(tag),
        },
        navigator: windowObj.navigator,
        fetch: fetchImpl,
        URL,
        AbortController,
        CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      });
      return { byId, swClearCalls, windowEvents };
    }

    const flush = async () => {
      for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
    };

    // 1. Initial boot renders zero tasks/employees
    let mode = "ok";
    const fetchCalls = [];
    const session1 = bootSrcdoc({
      onLine: true,
      fetchImpl: async (url, init) => {
        const urlStr = String(url);
        fetchCalls.push({ url: urlStr, method: init.method });
        if (mode === "502") {
          return new Response(JSON.stringify({ error: "Upstream unavailable" }), { status: 502 });
        }
        if (urlStr.includes("/blocks/") && urlStr.includes("/children")) {
          return new Response(JSON.stringify({ results: [], has_more: false }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          results: [{
            id: "aaaa1111bbbb2222cccc3333dddd4444",
            url: "https://app.notion.com/aaaa1111bbbb2222cccc3333dddd4444",
            properties: {
              일감: { title: [{ plain_text: "GitHub Pages 검증 일감" }] },
              담당자: { select: { name: "sb" } },
              상태: { status: { name: "진행" } },
              프로젝트: { select: { name: "2.3" } },
              우선순위: { select: { name: "P1" } },
              구분: { select: { name: "품질" } },
              "다음 조치": { rich_text: [{ plain_text: "확인" }] },
              "완료 조건": { rich_text: [{ plain_text: "완료" }] },
              목표일: { date: { start: "2026-11-14", end: null } },
              "다음 확인일": { date: null },
            },
          }],
          has_more: false,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    await flush();
    assert.equal(session1.byId.get("wips-office-main-view").hidden, true);
    assert.equal(session1.byId.get("wips-office-employees").children.length, 0);

    // 2. Connect via OPFS & live query
    session1.byId.get("wips-office-token").value = "ntn_synthetic_acceptance_token";
    session1.byId.get("wips-office-datasource-id").value = "11111111-2222-3333-4444-555555555555";
    for (const fn of session1.byId.get("wips-office-connection-form").listeners.get("submit") || []) {
      await fn({ preventDefault() {} });
    }
    await flush();

    assert.equal(session1.byId.get("wips-office-main-view").hidden, false);
    assert.equal(session1.byId.get("wips-office-employees").children.length, 5);
    assert.ok(opfsFiles.has("connection.json"));
    assert.ok(opfsFiles.has("snapshot-cache.json"));
    assert.equal(fetchCalls[0].method, "POST");
    assert.equal(fetchCalls[0].url, "https://api.notion.com/v1/data_sources/11111111-2222-3333-4444-555555555555/query");

    // 3. Transient 502 error preserves rendered employees/tasks
    mode = "502";
    for (const fn of session1.byId.get("wips-office-refresh").listeners.get("click") || []) {
      await fn({ preventDefault() {} });
    }
    await flush();
    assert.equal(session1.byId.get("wips-office-main-view").hidden, false);
    assert.equal(session1.byId.get("wips-office-employees").children.length, 5);

    // 4. Logout clears OPFS, calls SW clear hook, emits wips:logout, clears DOM
    for (const fn of session1.byId.get("wips-office-logout").listeners.get("click") || []) {
      await fn({ preventDefault() {} });
    }
    await flush();
    assert.equal(opfsFiles.size, 0);
    assert.deepEqual(removed.sort(), ["connection.json", "snapshot-cache.json"]);
    assert.deepEqual(session1.swClearCalls, ["cleared"]);
    assert.ok(session1.windowEvents.includes("wips:logout"));
    assert.equal(session1.byId.get("wips-office-main-view").hidden, true);
    assert.equal(session1.byId.get("wips-office-employees").children.length, 0);

    // 5. Offline reload after logout stays empty
    const session2 = bootSrcdoc({
      onLine: false,
      fetchImpl: async () => { throw new TypeError("Offline"); },
    });
    await flush();
    assert.equal(session2.byId.get("wips-office-main-view").hidden, true);
    assert.equal(session2.byId.get("wips-office-employees").children.length, 0);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
