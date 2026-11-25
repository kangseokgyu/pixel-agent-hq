import assert from "node:assert/strict";
import test from "node:test";

import { createSessionController, resolveLogoutTargetOrigin } from "../src/session-controller.mjs";
import { createEmptySnapshot } from "../lib/snapshot-schema.mjs";

function makeHooks() {
  const logs = {
    syncStates: [],
    connectionMsgs: [],
    offlineBanners: [],
    snapshots: [],
    resets: 0,
    loggedOut: 0,
  };
  return {
    logs,
    hooks: {
      formatTime: (v) => String(v || "스냅샷"),
      getLastSuccessAt: () => "2026-11-14T00:00:00.000Z",
      setRefreshDisabled() {},
      setConnectSubmitDisabled() {},
      setSyncStatus: (msg, state) => logs.syncStates.push({ msg, state }),
      setConnectionMessage: (msg, state) => logs.connectionMsgs.push({ msg, state }),
      setOfflineBanner: (msg) => logs.offlineBanners.push(msg),
      onSnapshot: (snap) => logs.snapshots.push(snap),
      onResetEmpty: () => { logs.resets += 1; },
      setStaticUnconnectedControls() {},
      onRestoredConnection() {},
      onConnected: (_conn, snap) => logs.snapshots.push(snap),
      onBeforeLogoutClear() {},
      onLoggedOut: () => { logs.loggedOut += 1; },
    },
  };
}

function makeMemoryOpfs(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    isSupported: () => true,
    async loadConnection() { return map.get("connection") ?? null; },
    async saveConnection(v) { map.set("connection", v); return v; },
    async loadSnapshot() { return map.get("snapshot") ?? null; },
    async saveSnapshot(v) { map.set("snapshot", v); return v; },
    async clearAll() { map.clear(); return { cleared: true }; },
  };
}

test("session controller transitions cleanly across unconnected, connected, offline-cached, and logout", async () => {
  const { logs, hooks } = makeHooks();
  const opfs = makeMemoryOpfs();
  const posted = [];
  let swCleared = 0;

  const windowObj = {
    location: { origin: "null" },
    origin: "https://owner.github.io",
    setInterval: () => 1,
    clearInterval: () => {},
    dispatchEvent() {},
    parent: {
      postMessage: (msg, targetOrigin) => posted.push({ msg, targetOrigin }),
      __wipsClearSwSession: async () => { swCleared += 1; },
    },
  };

  const controller = createSessionController({
    initialSnapshot: createEmptySnapshot(),
    explicitMode: "static",
    windowObj,
    navigatorObj: { onLine: true },
    opfsStore: opfs,
    hooks,
    fetchImpl: async () => new Response(JSON.stringify({
      results: [{
        id: "task-1",
        url: "https://app.notion.com/task-1",
        properties: {
          일감: { title: [{ plain_text: "세션 테스트 일감" }] },
          담당자: { select: { name: "sb" } },
          상태: { status: { name: "진행" } },
        },
      }],
      has_more: false,
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(controller.isStaticMode(), true);
  assert.equal(controller.getModeState(), "unconnected");

  await controller.initStatic();
  assert.equal(controller.getModeState(), "unconnected");

  const connected = await controller.connect({
    token: "demo_token_abc123",
    dataSourceId: "11111111-2222-4333-8444-555555555555",
  });
  assert.equal(connected.ok, true);
  assert.equal(controller.getModeState(), "connected");
  assert.equal(logs.snapshots.length, 1);

  controller.handleOffline();
  assert.equal(controller.getModeState(), "offline-cached");
  assert.match(logs.offlineBanners.at(-1), /오프라인/);

  await controller.logout();
  assert.equal(controller.getModeState(), "unconnected");
  assert.equal(controller.getActiveConnection(), null);
  assert.equal(logs.loggedOut, 1);
  assert.equal(swCleared, 1);
  assert.deepEqual(posted, [{ msg: { type: "wips:logout" }, targetOrigin: "https://owner.github.io" }]);
});

test("resolveLogoutTargetOrigin falls back to window.origin when srcdoc location.origin is null", () => {
  assert.equal(resolveLogoutTargetOrigin({ location: { origin: "null" }, origin: "https://site.test" }), "https://site.test");
  assert.equal(resolveLogoutTargetOrigin({ location: { origin: "https://a.test" }, origin: "https://b.test" }), "https://a.test");
  assert.equal(resolveLogoutTargetOrigin({ location: { origin: "null" }, origin: "null" }), null);
});

test("session controller deduplicates concurrent local refreshes and discards late connect via sessionEpoch", async () => {
  const { logs, hooks } = makeHooks();
  let resolveFetch;
  let calls = 0;

  const localController = createSessionController({
    initialSnapshot: { snapshotDate: "2026-11-14", results: [{ title: "seed" }] },
    explicitMode: "local",
    windowObj: { setInterval: () => 1, clearInterval: () => {} },
    navigatorObj: { onLine: true },
    hooks,
    fetchImpl: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
  });
  assert.equal(localController.getModeState(), "local");

  const p1 = localController.refresh();
  const p2 = localController.refresh();
  assert.equal(calls, 1);
  resolveFetch(new Response(JSON.stringify({
    snapshotDate: "2026-11-15",
    results: [{ title: "updated" }],
    lastSuccessAt: "2026-11-15T00:00:00.000Z",
  }), { status: 200 }));
  await Promise.all([p1, p2]);
  assert.equal(logs.snapshots.length, 1);
  assert.equal(logs.snapshots[0].snapshotDate, "2026-11-15");

  let releaseStatic;
  const staticHooks = makeHooks();
  const staticController = createSessionController({
    initialSnapshot: createEmptySnapshot(),
    explicitMode: "static",
    windowObj: { setInterval: () => 1, clearInterval: () => {}, dispatchEvent() {}, location: { origin: "https://a.test" } },
    navigatorObj: { onLine: true },
    opfsStore: makeMemoryOpfs(),
    hooks: staticHooks.hooks,
    fetchImpl: () => new Promise((resolve) => {
      releaseStatic = resolve;
    }),
  });

  const connectPromise = staticController.connect({
    token: "demo_token_abc123",
    dataSourceId: "11111111-2222-4333-8444-555555555555",
  });
  await staticController.logout();
  releaseStatic(new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 }));
  const connectResult = await connectPromise;
  assert.equal(connectResult.aborted, true);
  assert.equal(staticHooks.logs.snapshots.length, 0);
});
