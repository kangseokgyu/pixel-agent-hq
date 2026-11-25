import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { injectEmptySnapshot } from "../scripts/sync-office.mjs";

const officeHtml = readFileSync(new URL("../wips-office.html", import.meta.url), "utf8");
const emptySnapshot = JSON.parse(readFileSync(new URL("../fixtures/empty-snapshot.json", import.meta.url), "utf8"));

function createMockOpfsStore() {
  const dirs = new Map();
  const removedEntries = [];

  function dirHandle(name) {
    if (!dirs.has(name)) dirs.set(name, new Map());
    const files = dirs.get(name);
    return {
      async getFileHandle(fileName, { create = false } = {}) {
        if (!files.has(fileName)) {
          if (!create) {
            const error = new Error(`Not found: ${fileName}`);
            error.name = "NotFoundError";
            throw error;
          }
          files.set(fileName, "");
        }
        return {
          async createWritable() {
            let next = "";
            return {
              async write(chunk) { next = String(chunk); },
              async close() { files.set(fileName, next); },
            };
          },
          async getFile() {
            return {
              async text() {
                if (!files.has(fileName)) {
                  const error = new Error(`Not found: ${fileName}`);
                  error.name = "NotFoundError";
                  throw error;
                }
                return files.get(fileName);
              },
            };
          },
        };
      },
      async removeEntry(fileName) {
        if (!files.has(fileName)) {
          const error = new Error(`Not found: ${fileName}`);
          error.name = "NotFoundError";
          throw error;
        }
        files.delete(fileName);
        removedEntries.push(fileName);
      },
    };
  }

  return {
    dirs,
    removedEntries,
    async getDirectory() {
      return {
        async getDirectoryHandle(name, { create = false } = {}) {
          if (!dirs.has(name) && !create) {
            const error = new Error(`Dir not found: ${name}`);
            error.name = "NotFoundError";
            throw error;
          }
          return dirHandle(name);
        },
      };
    },
  };
}

class MockElement {
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = "";
    this.dataset = {};
    this.style = {};
    this.open = false;
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.type = "";
    this.draggable = false;
    this._textContent = "";
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
    };
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.children = [];
    this._textContent = value == null ? "" : String(value);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node != null) this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = "";
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  async dispatchEvent(event) {
    const evt = {
      type: event.type,
      target: this,
      preventDefault() { evt.defaultPrevented = true; },
      stopPropagation() {},
      defaultPrevented: false,
      ...event,
    };
    for (const fn of this.listeners.get(evt.type) || []) {
      await fn(evt);
    }
    return evt;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (selector === "button" && child.tagName === "BUTTON") results.push(child);
        if (selector === "select" && child.tagName === "SELECT") results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  focus() {}
}

function createDomEnvironment(html, { opfs, fetchImpl, onLine = true } = {}) {
  const byId = new Map();
  const make = (tag, id, extra = {}) => {
    const el = new MockElement(tag, id);
    Object.assign(el, extra);
    if (id) byId.set(id, el);
    return el;
  };

  const dataJson = html.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/)?.[1];
  const modelScript = html.match(/<script id="office-model">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(dataJson && modelScript, "HTML must include embedded data and model script");

  make("div", "wips-office-root");
  make("script", "wips-office-data", { _textContent: dataJson });
  make("select", "wips-office-status", { value: "전체 상태" });
  make("select", "wips-office-project", { value: "전체 프로젝트" });
  make("button", "wips-office-refresh");
  make("button", "wips-office-connect-toggle", { hidden: true });
  make("button", "wips-office-logout", { hidden: true });
  make("p", "wips-office-sync-status");
  make("p", "wips-office-offline-banner", { hidden: true });
  make("section", "wips-office-connection-panel", { hidden: true });
  make("form", "wips-office-connection-form");
  make("input", "wips-office-token");
  make("input", "wips-office-datasource-id");
  make("button", "wips-office-connect-submit");
  make("button", "wips-office-connect-cancel", { hidden: true });
  make("p", "wips-office-connection-message");
  make("div", "wips-office-main-view");
  make("p", "wips-office-summary");
  make("div", "wips-office-status-counts");
  make("div", "wips-office-employees");
  make("button", "wips-office-edit-seating");
  make("button", "wips-office-reset-seating", { hidden: true });
  make("p", "wips-office-seating-message");
  make("h2", "wips-office-selected-title");
  make("p", "wips-office-selected-note");
  make("p", "wips-office-selected-empty", { hidden: true });
  make("div", "wips-office-selected-tasks");
  make("p", "wips-office-communal-count");
  make("p", "wips-office-communal-empty", { hidden: true });
  make("div", "wips-office-communal-tasks");
  make("a", "wips-office-source");

  const localStore = new Map();
  const storageApi = {
    getItem: (key) => (localStore.has(key) ? localStore.get(key) : null),
    setItem: (key, val) => localStore.set(key, String(val)),
    removeItem: (key) => localStore.delete(key),
  };

  const intervals = [];
  const windowListeners = new Map();
  const swMessages = [];
  const postedMessages = [];

  const windowObj = {
    location: { origin: "https://owner.github.io", href: "https://owner.github.io/WIPS-Office/" },
    localStorage: storageApi,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: (fn, ms) => {
      const id = intervals.length + 1;
      intervals.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearInterval: (id) => {
      const entry = intervals.find((item) => item.id === id);
      if (entry) entry.cleared = true;
    },
    addEventListener: (type, fn) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    dispatchEvent: (event) => {
      for (const fn of windowListeners.get(event.type) || []) fn(event);
    },
    __wipsClearSwSession: async () => {
      swMessages.push("cleared-via-hook");
    },
    parent: {
      postMessage: (msg, origin) => postedMessages.push({ msg, origin }),
    },
  };

  const context = {
    window: windowObj,
    globalThis: windowObj,
    document: {
      getElementById: (id) => byId.get(id) ?? null,
      createElement: (tag) => new MockElement(tag),
      createElementNS: (_ns, tag) => new MockElement(tag),
    },
    navigator: {
      onLine,
      storage: opfs ? { getDirectory: opfs.getDirectory } : undefined,
    },
    fetch: fetchImpl,
    URL,
    AbortController,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  windowObj.navigator = context.navigator;

  vm.runInNewContext(modelScript, context, { filename: "wips-office.html" });
  return { byId, localStore, intervals, swMessages, postedMessages, windowObj };
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function makeNotionResponse(title = "실시간 테스트 일감", owner = "sb") {
  return new Response(JSON.stringify({
    results: [{
      id: "aaaa1111bbbb2222cccc3333dddd4444",
      url: "https://app.notion.com/aaaa1111bbbb2222cccc3333dddd4444",
      properties: {
        일감: { title: [{ plain_text: title }] },
        담당자: { select: owner ? { name: owner } : null },
        상태: { status: { name: "진행" } },
        프로젝트: { select: { name: "2.3" } },
        우선순위: { select: { name: "P1" } },
        구분: { select: { name: "품질" } },
        "다음 조치": { rich_text: [{ plain_text: "실행" }] },
        "완료 조건": { rich_text: [{ plain_text: "완료" }] },
        목표일: { date: { start: "2026-11-14", end: null } },
        "다음 확인일": { date: null },
      },
    }],
    has_more: false,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("unconnected static mode renders zero tasks or DB IDs and displays security checklist", async () => {
  const staticHtml = injectEmptySnapshot(officeHtml, emptySnapshot);
  assert.match(staticHtml, /Read content/);
  assert.match(staticHtml, /하나에만 연결/);
  assert.match(staticHtml, /공용 PC/);

  const opfs = createMockOpfsStore();
  const env = createDomEnvironment(staticHtml, { opfs, fetchImpl: async () => assert.fail("must not fetch before connecting") });
  await flushMicrotasks();

  assert.equal(env.byId.get("wips-office-main-view").hidden, true);
  assert.equal(env.byId.get("wips-office-connection-panel").hidden, false);
  assert.equal(env.byId.get("wips-office-logout").hidden, true);
  assert.equal(env.byId.get("wips-office-employees").children.length, 0);
  assert.equal(env.byId.get("wips-office-selected-tasks").children.length, 0);
  assert.equal(env.byId.get("wips-office-communal-tasks").children.length, 0);
});

test("connects via OPFS, queries read-only Notion API directly, keeps data on transient error, and destroys everything on logout", async () => {
  const staticHtml = injectEmptySnapshot(officeHtml, emptySnapshot);
  const opfs = createMockOpfsStore();
  const fetchCalls = [];
  let mode = "ok";
  let pendingSignal = null;
  let releasePending = null;

  const fetchImpl = async (url, options) => {
    const urlStr = String(url);
    fetchCalls.push({ url: urlStr, options });
    if (mode === "ok") {
      if (urlStr.includes("/blocks/") && urlStr.includes("/children")) {
        return new Response(JSON.stringify({
          results: [
            { id: "todo-1", type: "to_do", has_children: false, to_do: { checked: true, rich_text: [{ plain_text: "정적 체크 1" }] } },
            { id: "todo-2", type: "to_do", has_children: false, to_do: { checked: false, rich_text: [{ plain_text: "정적 체크 2" }] } },
          ],
          has_more: false,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return makeNotionResponse("신규 OPFS 조회 일감", "sb");
    }
    if (mode === "fail-502") {
      return new Response(JSON.stringify({ error: "Upstream unavailable" }), { status: 502 });
    }
    if (mode === "pending") {
      pendingSignal = options.signal;
      return new Promise((_resolve, reject) => {
        releasePending = () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        };
        options.signal?.addEventListener("abort", releasePending, { once: true });
      });
    }
    return makeNotionResponse("재조회 일감", "sb");
  };

  const env = createDomEnvironment(staticHtml, { opfs, fetchImpl });
  await flushMicrotasks();

  env.byId.get("wips-office-token").value = "demo_readonly_token_123";
  env.byId.get("wips-office-datasource-id").value = "11111111-2222-4333-8444-555555555555";

  await env.byId.get("wips-office-connection-form").dispatchEvent({ type: "submit" });
  await flushMicrotasks();

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].url, "https://api.notion.com/v1/data_sources/11111111-2222-4333-8444-555555555555/query");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.equal(fetchCalls[0].options.redirect, "error");
  assert.equal(fetchCalls[0].options.credentials, "omit");
  assert.equal(fetchCalls[0].options.cache, "no-store");
  assert.equal(fetchCalls[1].url, "https://api.notion.com/v1/blocks/aaaa1111bbbb2222cccc3333dddd4444/children?page_size=100");
  assert.equal(fetchCalls[1].options.method, "GET");
  assert.equal(fetchCalls[1].options.redirect, "error");
  assert.equal(fetchCalls[1].options.credentials, "omit");
  assert.equal(fetchCalls[1].options.cache, "no-store");

  assert.equal(env.byId.get("wips-office-main-view").hidden, false);
  assert.equal(env.byId.get("wips-office-connection-panel").hidden, true);
  assert.equal(env.byId.get("wips-office-logout").hidden, false);
  assert.match(env.byId.get("wips-office-selected-tasks").textContent, /신규 OPFS 조회 일감/);
  assert.match(env.byId.get("wips-office-selected-tasks").textContent, /1\/2/);
  assert.match(env.byId.get("wips-office-selected-tasks").textContent, /정적 체크 1/);
  assert.equal(env.localStore.size, 0, "tokens and task snapshots must never be stored in localStorage");
  assert.equal(opfs.dirs.get("wips-office-private-v1").has("connection.json"), true);
  assert.equal(opfs.dirs.get("wips-office-private-v1").has("snapshot-cache.json"), true);

  // Transient failure preserves displayed data
  mode = "fail-502";
  await env.byId.get("wips-office-refresh").dispatchEvent({ type: "click" });
  await flushMicrotasks();
  assert.match(env.byId.get("wips-office-selected-tasks").textContent, /신규 OPFS 조회 일감/);
  assert.equal(env.byId.get("wips-office-sync-status").dataset.state, "error");

  // Reloading restores connection from OPFS and re-queries live data
  mode = "ok";
  const reloadedEnv = createDomEnvironment(staticHtml, { opfs, fetchImpl });
  await flushMicrotasks();
  assert.equal(reloadedEnv.byId.get("wips-office-main-view").hidden, false);
  assert.match(reloadedEnv.byId.get("wips-office-selected-tasks").textContent, /신규 OPFS 조회 일감/);

  // Start an in-flight fetch then trigger Logout
  mode = "pending";
  const pendingRefresh = reloadedEnv.byId.get("wips-office-refresh").dispatchEvent({ type: "click" });
  await flushMicrotasks();
  assert.ok(pendingSignal, "in-flight fetch received an AbortSignal");
  assert.equal(pendingSignal.aborted, false);

  await reloadedEnv.byId.get("wips-office-logout").dispatchEvent({ type: "click" });
  await pendingRefresh;
  await flushMicrotasks();

  assert.equal(pendingSignal.aborted, true, "logout aborts in-flight fetch immediately");
  assert.deepEqual(opfs.removedEntries.sort(), ["connection.json", "snapshot-cache.json"]);
  assert.equal(opfs.dirs.get("wips-office-private-v1").size, 0);
  assert.equal(reloadedEnv.swMessages.includes("cleared-via-hook"), true);
  assert.equal(reloadedEnv.byId.get("wips-office-main-view").hidden, true);
  assert.equal(reloadedEnv.byId.get("wips-office-logout").hidden, true);
  assert.equal(reloadedEnv.byId.get("wips-office-employees").children.length, 0);
  assert.equal(reloadedEnv.byId.get("wips-office-selected-tasks").children.length, 0);
  assert.equal(reloadedEnv.byId.get("wips-office-communal-tasks").children.length, 0);
  assert.match(reloadedEnv.byId.get("wips-office-connection-message").textContent, /로그아웃되었습니다/);

  // Reloading after logout stays unconnected with zero tasks
  const postLogoutEnv = createDomEnvironment(staticHtml, { opfs, fetchImpl: async () => assert.fail("must not fetch after logout") });
  await flushMicrotasks();
  assert.equal(postLogoutEnv.byId.get("wips-office-main-view").hidden, true);
  assert.equal(postLogoutEnv.byId.get("wips-office-connection-panel").hidden, false);
  assert.equal(postLogoutEnv.byId.get("wips-office-selected-tasks").children.length, 0);
});

test("preserves existing local server mode (/api/tasks) when non-empty snapshot is embedded", async () => {
  const apiCalls = [];
  const env = createDomEnvironment(officeHtml, {
    fetchImpl: async (url) => {
      apiCalls.push(String(url));
      return new Response(JSON.stringify({
        snapshotDate: "2026-11-14",
        timezone: "Asia/Seoul",
        sourceUrl: "https://app.notion.com/p/local",
        results: [{ title: "로컬 서버 일감", owner: "sb", status: "진행", project: "2.3", parentTaskIds: [] }],
        lastSuccessAt: "2026-11-14T03:00:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await flushMicrotasks();

  assert.deepEqual(apiCalls, ["/api/tasks"]);
  assert.equal(env.byId.get("wips-office-connection-panel").hidden, true);
  assert.equal(env.byId.get("wips-office-connect-toggle").hidden, true);
  assert.equal(env.byId.get("wips-office-logout").hidden, true);
  assert.match(env.byId.get("wips-office-selected-tasks").textContent, /로컬 서버 일감/);
});

test("static checklist fetcher recurses into nested blocks, skips child_page/completed tasks, and falls back on per-page errors", async () => {
  const staticHtml = injectEmptySnapshot(officeHtml, emptySnapshot);
  const opfs = createMockOpfsStore();
  const blockUrls = [];

  const fetchImpl = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/data_sources/") && urlStr.includes("/query")) {
      return new Response(JSON.stringify({
        results: [
          {
            id: "active-nested-id",
            url: "https://app.notion.com/00000000000000000000000000000201",
            properties: {
              일감: { title: [{ plain_text: "중첩 체크 일감" }] },
              담당자: { select: { name: "sb" } },
              상태: { status: { name: "진행" } },
              프로젝트: { select: { name: "2.3" } },
              "하위 일감": { relation: [{ id: "completed-child-id" }] },
            },
          },
          {
            id: "active-error-id",
            url: "https://app.notion.com/00000000000000000000000000000202",
            properties: {
              일감: { title: [{ plain_text: "블록 실패 일감" }] },
              담당자: { select: { name: "sb" } },
              상태: { status: { name: "예정" } },
              프로젝트: { select: { name: "2.3" } },
            },
          },
          {
            id: "completed-child-id",
            url: "https://app.notion.com/00000000000000000000000000000203",
            properties: {
              일감: { title: [{ plain_text: "완료된 하위 일감" }] },
              담당자: { select: { name: "sb" } },
              상태: { status: { name: "완료" } },
              프로젝트: { select: { name: "2.3" } },
            },
          },
        ],
        has_more: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    blockUrls.push(urlStr);
    if (urlStr.includes("/blocks/active-nested-id/children")) {
      return new Response(JSON.stringify({
        results: [
          { id: "toggle-1", type: "toggle", has_children: true },
          { id: "sub-page-1", type: "child_page", has_children: true },
          { id: "sub-db-1", type: "child_database", has_children: true },
        ],
        has_more: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (urlStr.includes("/blocks/toggle-1/children")) {
      return new Response(JSON.stringify({
        results: [
          { id: "todo-nested-1", type: "to_do", has_children: false, to_do: { checked: true, rich_text: [{ plain_text: "토글 내부 완료" }] } },
          { id: "todo-nested-2", type: "to_do", has_children: false, to_do: { checked: false, rich_text: [{ plain_text: "토글 내부 미완료" }] } },
        ],
        has_more: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (urlStr.includes("/blocks/active-error-id/children")) {
      return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
    }
    assert.fail(`unexpected block fetch: ${urlStr}`);
  };

  const env = createDomEnvironment(staticHtml, { opfs, fetchImpl });
  await flushMicrotasks();

  env.byId.get("wips-office-token").value = "demo_readonly_token_123";
  env.byId.get("wips-office-datasource-id").value = "11111111-2222-4333-8444-555555555555";
  await env.byId.get("wips-office-connection-form").dispatchEvent({ type: "submit" });
  await flushMicrotasks();

  assert.equal(blockUrls.some((u) => u.includes("completed-child-id")), false, "must skip completed tasks");
  assert.equal(blockUrls.some((u) => u.includes("sub-page-1")), false, "must skip child_page blocks");
  assert.equal(blockUrls.some((u) => u.includes("sub-db-1")), false, "must skip child_database blocks");
  assert.equal(blockUrls.some((u) => u.includes("toggle-1")), true, "must recurse into toggle blocks");

  const boardText = env.byId.get("wips-office-selected-tasks").textContent;
  assert.match(boardText, /중첩 체크 일감/);
  assert.match(boardText, /블록 실패 일감/);
  assert.match(boardText, /토글 내부 완료/);
  assert.match(boardText, /토글 내부 미완료/);
  assert.match(boardText, /1\/2/);
  assert.match(boardText, /완료된 하위 일감/);
  assert.match(boardText, /1\/1/);
});

test("local mode retains snapshot on refresh failure and deduplicates overlapping refresh clicks", async () => {
  let resolveSecondFetch;
  let fetchCount = 0;
  const env = createDomEnvironment(officeHtml, {
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({
          snapshotDate: "2026-11-14",
          timezone: "Asia/Seoul",
          sourceUrl: "https://app.notion.com/p/local",
          results: [{ title: "유지될 로컬 일감", owner: "sb", status: "진행", project: "2.3", parentTaskIds: [] }],
          lastSuccessAt: "2026-11-14T03:00:00.000Z",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (fetchCount === 2) {
        return new Promise((resolve) => {
          resolveSecondFetch = resolve;
        });
      }
      throw new Error("unexpected fetch");
    },
  });
  await flushMicrotasks();
  assert.equal(fetchCount, 1);
  assert.match(env.byId.get("wips-office-selected-tasks").textContent, /유지될 로컬 일감/);

  const refreshBtn = env.byId.get("wips-office-refresh");
  const p1 = refreshBtn.dispatchEvent({ type: "click" });
  const p2 = refreshBtn.dispatchEvent({ type: "click" });
  assert.equal(fetchCount, 2);

  resolveSecondFetch(new Response(JSON.stringify({ error: "Notion 일시 오류" }), { status: 502 }));
  await Promise.all([p1, p2]);
  await flushMicrotasks();

  assert.equal(fetchCount, 2);
  assert.equal(env.byId.get("wips-office-sync-status").dataset.state, "error");
  assert.match(env.byId.get("wips-office-sync-status").textContent, /Notion 일시 오류/);
  assert.match(env.byId.get("wips-office-selected-tasks").textContent, /유지될 로컬 일감/);
});

test("logout aborts in-flight static fetch and discards late response via sessionEpoch", async () => {
  const staticHtml = injectEmptySnapshot(officeHtml, emptySnapshot);
  const opfs = createMockOpfsStore();
  let capturedSignal = null;
  let resolveFetch = null;

  const env = createDomEnvironment(staticHtml, {
    opfs,
    fetchImpl: async (_url, options) => {
      capturedSignal = options?.signal;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
  });
  await flushMicrotasks();

  env.byId.get("wips-office-token").value = "demo_readonly_token_123";
  env.byId.get("wips-office-datasource-id").value = "11111111-2222-4333-8444-555555555555";
  const submitPromise = env.byId.get("wips-office-connection-form").dispatchEvent({ type: "submit" });
  await flushMicrotasks();

  assert.ok(capturedSignal);
  assert.equal(capturedSignal.aborted, false);

  await env.byId.get("wips-office-logout").dispatchEvent({ type: "click" });
  assert.equal(capturedSignal.aborted, true);

  resolveFetch(makeNotionResponse("늦게 도착한 일감", "sb"));
  await submitPromise;
  await flushMicrotasks();

  assert.equal(env.byId.get("wips-office-main-view").hidden, true);
  assert.equal(env.byId.get("wips-office-selected-tasks").children.length, 0);
  assert.equal(env.byId.get("wips-office-connection-panel").hidden, false);
});
