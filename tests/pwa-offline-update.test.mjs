import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

import { injectEmptySnapshot } from "../scripts/sync-office.mjs";

const ROOT = resolve(import.meta.dirname, "..");

function createMockCacheStorage(initialEntries = {}) {
  const store = new Map();
  for (const [name, entries] of Object.entries(initialEntries)) {
    store.set(name, new Map(Object.entries(entries)));
  }

  function wrapCache(cacheMap) {
    return {
      async put(req, res) {
        const key = typeof req === "string" ? req : req.url;
        cacheMap.set(key, res);
      },
      async match(req) {
        const key = typeof req === "string" ? req : req.url;
        return cacheMap.get(key);
      },
    };
  }

  return {
    store,
    async open(name) {
      if (!store.has(name)) {
        store.set(name, new Map());
      }
      return wrapCache(store.get(name));
    },
    async keys() {
      return [...store.keys()];
    },
    async delete(name) {
      return store.delete(name);
    },
    async match(req) {
      const key = typeof req === "string" ? req : req.url;
      for (const cacheMap of store.values()) {
        if (cacheMap.has(key)) {
          return cacheMap.get(key);
        }
      }
      return undefined;
    },
  };
}

function loadServiceWorker({
  scope = "https://owner.github.io/WIPS-Office/",
  initialCaches = {},
  fetchImpl,
} = {}) {
  const swPath = resolve(ROOT, "sw.js");
  assert.ok(existsSync(swPath), "sw.js must exist");
  const swSource = readFileSync(swPath, "utf8");
  assert.doesNotMatch(swSource, /\b(innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function)\b/);

  const caches = createMockCacheStorage(initialCaches);
  const listeners = new Map();
  const lifecycleCalls = { skipWaiting: 0, claim: 0 };

  const selfObj = {
    location: new URL("./sw.js", scope),
    registration: { scope },
    skipWaiting: async () => {
      lifecycleCalls.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        lifecycleCalls.claim += 1;
      },
    },
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) || []), fn]);
    },
  };

  class MockRequest {
    constructor(input, init = {}) {
      this.url = typeof input === "string" ? input : input.url;
      this.method = (init.method || "GET").toUpperCase();
      this.mode = init.mode || "cors";
      this.cache = init.cache || "default";
      this.headers = new Headers(init.headers || {});
    }
  }

  const context = {
    self: selfObj,
    caches,
    fetch: fetchImpl || (async (url) => new Response(`asset:${url}`, { status: 200 })),
    Request: MockRequest,
    Response,
    Headers,
    URL,
  };

  vm.runInNewContext(swSource, context, { filename: "sw.js" });

  async function dispatchExtendable(type, extra = {}) {
    const promises = [];
    let respondedWith = null;
    const event = {
      ...extra,
      waitUntil(promise) {
        promises.push(Promise.resolve(promise));
      },
      respondWith(promise) {
        respondedWith = Promise.resolve(promise);
      },
    };
    for (const fn of listeners.get(type) || []) {
      fn(event);
    }
    await Promise.all(promises);
    return {
      responded: respondedWith !== null,
      response: respondedWith ? await respondedWith : null,
    };
  }

  return { swSource, caches, lifecycleCalls, dispatchExtendable, Request: MockRequest };
}

test("sw.js precaches allowlisted shell with cache: reload and cleans only same-scope stale caches", async () => {
  const fetchCalls = [];
  const sw = loadServiceWorker({
    scope: "https://owner.github.io/WIPS-Office/",
    initialCaches: {
      "wips-office-shell:/WIPS-Office/:old-hash": { "https://owner.github.io/WIPS-Office/": new Response("stale") },
      "wips-office-session:/WIPS-Office/:s1": { secret: new Response("x") },
      "wips-office-shell:/Other-Repo/:v1": { ok: new Response("keep") },
      "unrelated-cache": { ok: new Response("keep") },
    },
    fetchImpl: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), cache: init.cache });
      return new Response(`fresh:${url}`, { status: 200 });
    },
  });

  await sw.dispatchExtendable("install");
  assert.equal(sw.lifecycleCalls.skipWaiting, 1);

  const expectedShellUrls = [
    "https://owner.github.io/WIPS-Office/",
    "https://owner.github.io/WIPS-Office/index.html",
    "https://owner.github.io/WIPS-Office/manifest.webmanifest",
    "https://owner.github.io/WIPS-Office/pwa-register.js",
    "https://owner.github.io/WIPS-Office/icons/icon-192.png",
    "https://owner.github.io/WIPS-Office/icons/icon-512.png",
  ];
  assert.deepEqual(fetchCalls.map((c) => c.url), expectedShellUrls);
  for (const call of fetchCalls) {
    assert.equal(call.cache, "reload");
  }

  await sw.dispatchExtendable("activate");
  assert.equal(sw.lifecycleCalls.claim, 1);

  const keysAfterActivate = await sw.caches.keys();
  assert.ok(!keysAfterActivate.includes("wips-office-shell:/WIPS-Office/:old-hash"));
  assert.ok(!keysAfterActivate.includes("wips-office-session:/WIPS-Office/:s1"));
  assert.ok(keysAfterActivate.includes("wips-office-shell:/Other-Repo/:v1"));
  assert.ok(keysAfterActivate.includes("unrelated-cache"));
  assert.equal(keysAfterActivate.filter((k) => k.startsWith("wips-office-shell:/WIPS-Office/:")).length, 1);
});

test("sw.js never intercepts or caches Notion queries, Authorization requests, /api/*, wips-data.json, or POST", async () => {
  const sw = loadServiceWorker({
    scope: "https://owner.github.io/WIPS-Office/",
  });
  await sw.dispatchExtendable("install");

  const bypassRequests = [
    new sw.Request("https://owner.github.io/WIPS-Office/api/tasks", { method: "GET" }),
    new sw.Request("https://owner.github.io/WIPS-Office/wips-data.json", { method: "GET" }),
    new sw.Request("https://relay.example.workers.dev/v1/data_sources/1234/query", {
      method: "POST",
      headers: { Authorization: "Bearer secret" },
    }),
    new sw.Request("https://owner.github.io/WIPS-Office/v1/data_sources/1234/query", { method: "GET" }),
    new sw.Request("https://owner.github.io/WIPS-Office/index.html", {
      method: "GET",
      headers: { Authorization: "Bearer secret" },
    }),
    new sw.Request("https://owner.github.io/WIPS-Office/index.html", { method: "POST" }),
    new sw.Request("https://owner.github.io/WIPS-Office/sw.js", { method: "GET" }),
  ];

  for (const req of bypassRequests) {
    const res = await sw.dispatchExtendable("fetch", { request: req });
    assert.equal(res.responded, false, `SW must bypass fetch for ${req.method} ${req.url}`);
  }
});

test("sw.js serves shell assets offline and purges session caches on WIPS_CLEAR_SESSION", async () => {
  let online = true;
  const sw = loadServiceWorker({
    scope: "https://owner.github.io/WIPS-Office/",
    initialCaches: {
      "wips-office-runtime:/WIPS-Office/:temp": { data: new Response("temp") },
      "wips-office-shell:/Other-Repo/:v1": { keep: new Response("keep") },
    },
    fetchImpl: async (url) => {
      if (!online) {
        throw new TypeError("Network offline");
      }
      return new Response(`shell-body:${typeof url === "string" ? url : url.url}`, { status: 200 });
    },
  });
  await sw.dispatchExtendable("install");
  await sw.dispatchExtendable("activate");

  // Go offline and verify navigation + icon fallback work from allowlisted shell cache
  online = false;
  const navRes = await sw.dispatchExtendable("fetch", {
    request: new sw.Request("https://owner.github.io/WIPS-Office/", { mode: "navigate", method: "GET" }),
  });
  assert.equal(navRes.responded, true);
  assert.equal(await navRes.response.text(), "shell-body:https://owner.github.io/WIPS-Office/");

  const iconRes = await sw.dispatchExtendable("fetch", {
    request: new sw.Request("https://owner.github.io/WIPS-Office/icons/icon-192.png", { method: "GET" }),
  });
  assert.equal(iconRes.responded, true);
  assert.equal(await iconRes.response.text(), "shell-body:https://owner.github.io/WIPS-Office/icons/icon-192.png");

  // Send logout cleanup message to SW
  const portMessages = [];
  await sw.dispatchExtendable("message", {
    data: { type: "WIPS_CLEAR_SESSION" },
    ports: [{ postMessage: (msg) => portMessages.push(msg) }],
  });

  const keysAfterLogout = await sw.caches.keys();
  assert.ok(!keysAfterLogout.includes("wips-office-runtime:/WIPS-Office/:temp"));
  assert.ok(keysAfterLogout.includes("wips-office-shell:/Other-Repo/:v1"));
  assert.equal(portMessages.length, 1);
  assert.equal(portMessages[0].cleared, true);
});

test("offline office app renders OPFS cached snapshot when logged in and renders zero tasks after logout", async () => {
  const officeHtml = readFileSync(resolve(ROOT, "wips-office.html"), "utf8");
  const emptySnapshot = JSON.parse(readFileSync(resolve(ROOT, "fixtures/empty-snapshot.json"), "utf8"));
  const staticHtml = injectEmptySnapshot(officeHtml, emptySnapshot);

  const sampleSnapshot = JSON.parse(readFileSync(resolve(ROOT, "fixtures/sample-snapshot.json"), "utf8"));

  // Minimal OPFS & DOM harness to test offline cached boot vs post-logout offline boot
  const opfsFiles = new Map([
    [
      "connection.json",
      JSON.stringify({
        token: "secret_offline_token",
        dataSourceId: "11111111-2222-3333-4444-555555555555",
        corsProxyUrl: "https://relay.example.workers.dev",
      }),
    ],
    [
      "snapshot-cache.json",
      JSON.stringify(sampleSnapshot),
    ],
  ]);

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
                  let val = "";
                  return {
                    async write(chunk) { val = String(chunk); },
                    async close() { opfsFiles.set(name, val); },
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
            },
          };
        },
      };
    },
  };

  function bootStaticApp({ onLine }) {
    const dataScript = staticHtml.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/)[1];
    const modelScript = staticHtml.match(/<script id="office-model">([\s\S]*?)<\/script>/)[1];
    const ids = [...staticHtml.matchAll(/id="(wips-office-[a-z-]+)"/g)].map((m) => m[1]);
    const byId = new Map();
    const makeEl = (tag, id = "") => {
      const classes = new Set();
      const listeners = new Map();
      return {
        tagName: tag.toUpperCase(),
        id,
        className: "",
        dataset: {},
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
    for (const id of ids) byId.set(id, makeEl("div", id));
    byId.get("wips-office-data").textContent = dataScript;
    byId.get("wips-office-status").value = "전체 상태";
    byId.get("wips-office-project").value = "전체 프로젝트";
    const intervals = [];
    const windowObj = {
      location: { origin: "https://owner.github.io", href: "https://owner.github.io/WIPS-Office/" },
      navigator: { onLine, storage: { getDirectory: opfs.getDirectory } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      matchMedia: () => ({ matches: false }),
      setInterval: (fn) => { const id = intervals.length + 1; intervals.push(id); return id; },
      clearInterval: () => {},
      addEventListener: () => {},
      dispatchEvent: () => {},
      __wipsClearSwSession: async () => {},
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
      fetch: async () => { throw new TypeError("Offline"); },
      URL,
      AbortController,
      CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    return byId;
  }

  // 1. Offline + logged in restores cached OPFS snapshot
  const loggedInDom = bootStaticApp({ onLine: false });
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(loggedInDom.get("wips-office-main-view").hidden, false);
  assert.equal(loggedInDom.get("wips-office-connection-panel").hidden, true);
  assert.ok(loggedInDom.get("wips-office-employees").children.length > 0);

  // 2. Click logout -> clears OPFS entries
  const logoutBtn = loggedInDom.get("wips-office-logout");
  for (const fn of logoutBtn.listeners.get("click") || []) {
    await fn({ preventDefault() {} });
  }
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(opfsFiles.size, 0);

  // 3. Reload offline after logout -> zero tasks, connection panel shown
  const loggedOutDom = bootStaticApp({ onLine: false });
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(loggedOutDom.get("wips-office-main-view").hidden, true);
  assert.equal(loggedOutDom.get("wips-office-connection-panel").hidden, false);
  assert.equal(loggedOutDom.get("wips-office-employees").children.length, 0);
  assert.equal(loggedOutDom.get("wips-office-selected-tasks").children.length, 0);
});
