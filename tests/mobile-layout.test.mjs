import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const officeHtml = readFileSync(new URL("../wips-office.html", import.meta.url), "utf8");

test("includes responsive mobile touch targets, input zoom prevention, and overflow protection", () => {
  const style = officeHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  assert.match(style, /touch-action:\s*manipulation/);
  assert.match(style, /box-sizing:\s*border-box/);
  assert.match(style, /min-height:\s*(?:40|44)px/);
  assert.match(style, /@media\s*\(max-width:\s*(?:430|480)px\)[\s\S]*font-size:\s*16px/);
  assert.match(style, /overflow-x:\s*(?:hidden|clip)/);
});

test("uses a 6-column 3+2 pixel stage on mobile viewports instead of a 1-column vertical stack", () => {
  const style = officeHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  assert.match(style, /@media\s*\(max-width:\s*620px\)[\s\S]*#wips-office-root\s+\.office-grid[\s\S]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(style, /#wips-office-root\s+\.workstation[\s\S]*grid-column:\s*span\s+2/);
  assert.match(style, /#wips-office-root\s+\.workstation:nth-child\(3n\s*\+\s*1\):nth-last-child\(2\)[\s\S]*grid-column:\s*span\s+3/);
  assert.doesNotMatch(style, /#wips-office-root\s+\.office-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("swaps seats via select control, persists in localStorage, and handles blocked storage gracefully", () => {
  const modelScript = officeHtml.match(/<script id="office-model">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(modelScript);

  class Node {
    constructor(tag, id = "") {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.className = "";
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this.value = "";
      this._textContent = "";
      this.classList = { add() {}, remove() {}, contains: () => false };
    }
    get textContent() {
      return this.children.length === 0 ? this._textContent : this._textContent + this.children.map((c) => c.textContent).join("");
    }
    set textContent(v) {
      this.children = [];
      this._textContent = v == null ? "" : String(v);
    }
    append(...nodes) { this.children.push(...nodes.filter(Boolean)); }
    replaceChildren(...nodes) { this.children = []; this._textContent = ""; this.append(...nodes); }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatchEvent(evt) {
      for (const fn of this.listeners.get(evt.type) || []) fn(evt);
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (c.tagName.toLowerCase() === sel.toLowerCase()) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    focus() {}
  }

  function runWithStorage(storageImpl) {
    const byId = new Map();
    const make = (tag, id, extra = {}) => {
      const n = new Node(tag, id);
      Object.assign(n, extra);
      if (id) byId.set(id, n);
      return n;
    };
    const dataJson = officeHtml.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/)?.[1];
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

    const win = {
      localStorage: storageImpl,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: () => 1,
      clearInterval: () => {},
      addEventListener: () => {},
    };
    const ctx = {
      window: win,
      globalThis: win,
      document: {
        getElementById: (id) => byId.get(id) ?? null,
        createElement: (tag) => new Node(tag),
      },
      navigator: {},
      fetch: async () => new Response("{}", { status: 503 }),
      URL,
      AbortController,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
    vm.runInNewContext(modelScript, ctx, { filename: "wips-office.html" });
    return { byId };
  }

  const memory = new Map();
  const workingStorage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
  };

  const firstRun = runWithStorage(workingStorage);
  firstRun.byId.get("wips-office-edit-seating").dispatchEvent({ type: "click" });
  const selects = firstRun.byId.get("wips-office-employees").querySelectorAll("select");
  assert.ok(selects.length >= 2);
  selects[0].value = "UI";
  selects[0].dispatchEvent({ type: "change" });
  assert.match(firstRun.byId.get("wips-office-seating-message").textContent, /저장했습니다/);

  const secondRun = runWithStorage(workingStorage);
  const restoredOwners = secondRun.byId.get("wips-office-employees").querySelectorAll("button").map((b) => b.dataset.owner);
  assert.equal(restoredOwners[0], "UI");
  assert.equal(restoredOwners[4], "sb");

  const blockedStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("Storage blocked"); },
  };
  const blockedRun = runWithStorage(blockedStorage);
  blockedRun.byId.get("wips-office-edit-seating").dispatchEvent({ type: "click" });
  const blockedSelect = blockedRun.byId.get("wips-office-employees").querySelectorAll("select")[0];
  blockedSelect.value = "UI";
  blockedSelect.dispatchEvent({ type: "change" });
  assert.match(blockedRun.byId.get("wips-office-seating-message").textContent, /저장할 수 없어/);
});

test("uses Option A-1 two-row appbar header with right-aligned ghost icon buttons", () => {
  const style = officeHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  assert.match(style, /#wips-office-root\s+\.office-header-top\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(style, /#wips-office-root\s+\.sync-button--icon\s*\{[\s\S]*?border-color:\s*transparent;[\s\S]*?background:\s*transparent/);
  assert.match(style, /@media\s*\(max-width:\s*480px\)[\s\S]*?#wips-office-root\s+\.title-sub\s*\{\s*display:\s*none;\s*\}/);
  assert.match(style, /@media\s*\(max-width:\s*480px\)[\s\S]*?#wips-office-root\s+\.sync-button--icon\s*\{[\s\S]*?width:\s*36px;[\s\S]*?height:\s*44px;/);
  assert.match(style, /@media\s*\(max-width:\s*480px\)[\s\S]*?#wips-office-root\s+\.viz-controls\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(officeHtml, /<a id="wips-office-source">Notion 원본<\/a>/);

  for (const [id, label] of [
    ["wips-office-refresh", "지금 갱신"],
    ["wips-office-connect-toggle", "연결 설정"],
    ["wips-office-logout", "로그아웃"],
  ]) {
    const pattern = new RegExp(
      `<button\\s+class="sync-button\\s+sync-button--icon(?:\\s+sync-button--danger)?"\\s+id="${id}"[^>]*aria-label="${label}"[^>]*title="${label}"[^>]*>\\s*<svg[^>]*aria-hidden="true"`,
    );
    assert.match(officeHtml, pattern, `${id} should be a labeled ghost icon button with aria-hidden SVG`);
  }
});
