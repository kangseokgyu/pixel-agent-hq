import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { createOfficeModel as createDirectOfficeModel } from "./src/office-model.mjs";

const folder = fileURLToPath(new URL(".", import.meta.url));
const snapshot = JSON.parse(readFileSync(folder + "/wips-data.json", "utf8"));
const fragment = readFileSync(folder + "/wips-office.html", "utf8");
const embeddedData = fragment.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/)?.[1];
assert.ok(embeddedData, "the fragment embeds its snapshot data");
const embeddedSnapshot = JSON.parse(embeddedData);
const modelScript = fragment.match(/<script id="office-model">([\s\S]*?)<\/script>/)?.[1];
assert.ok(modelScript, "the fragment contains the pure office model script");

const context = {
  window: {},
  document: { getElementById: () => null },
  URL,
};
vm.runInNewContext(modelScript, context, { filename: "wips-office.html" });
assert.equal(typeof context.window.__wipsOfficeModel, "function", "the office model is available to the fragment");
const createOfficeModel = createDirectOfficeModel;
const model = createOfficeModel(snapshot);
const allFilters = { status: "전체 상태", project: "전체 프로젝트" };

class DomNode {
  constructor(tagName, id = "", ownerDoc = null) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.ownerDoc = ownerDoc;
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
    this.parentNode = null;
    this.classList = {
      add: (...names) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const n of names) set.add(n);
        this.className = [...set].join(" ");
      },
      remove: (...names) => {
        const removeSet = new Set(names);
        this.className = this.className.split(/\s+/).filter((n) => n && !removeSet.has(n)).join(" ");
      },
      contains: (name) => this.className.split(/\s+/).filter(Boolean).includes(name),
    };
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }

  set textContent(value) {
    this.children = [];
    this._textContent = value == null ? "" : String(value);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node != null) {
        node.parentNode = this;
        this.children.push(node);
      }
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
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
    if (name === "href") delete this.href;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  dispatchEvent(event) {
    const evt = {
      type: event.type,
      target: this,
      preventDefault() { evt.defaultPrevented = true; },
      stopPropagation() { evt.stoppedPropagation = true; },
      defaultPrevented: false,
      stoppedPropagation: false,
      ...event,
    };
    for (const fn of this.listeners.get(evt.type) || []) fn(evt);
    return evt;
  }

  contains(other) {
    if (!other) return false;
    if (other === this) return true;
    return this.children.some((c) => c.contains(other));
  }

  matches(selector) {
    if (selector === ".workstation.is-drop-target") {
      return this.classList.contains("workstation") && this.classList.contains("is-drop-target");
    }
    if (selector.startsWith(".")) {
      return this.classList.contains(selector.slice(1));
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.matches(selector)) results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  focus() {
    if (this.ownerDoc) this.ownerDoc.activeElement = this;
  }
}

function createOfficeDomHarness({
  customSnapshot = snapshot,
  savedSeating = null,
  hostWidgetState = undefined,
  onSetWidgetState = () => {},
} = {}) {
  const byId = new Map();
  const doc = {
    activeElement: null,
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new DomNode(tag, "", doc),
    createElementNS: (_ns, tag) => new DomNode(tag, "", doc),
  };
  const make = (tag, id, extra = {}) => {
    const el = new DomNode(tag, id, doc);
    Object.assign(el, extra);
    if (id) byId.set(id, el);
    return el;
  };

  const scriptText = fragment.match(/<script id="office-model">([\s\S]*?)<\/script>/)?.[1];
  make("div", "wips-office-root");
  make("script", "wips-office-data", { _textContent: JSON.stringify(customSnapshot) });
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
  make("section", "wips-office-billboard");
  make("h2", "wips-office-selected-title");
  make("p", "wips-office-selected-note");
  make("p", "wips-office-selected-empty", { hidden: true });
  make("div", "wips-office-selected-tasks");
  make("h2", "wips-office-communal-title");
  make("p", "wips-office-communal-count");
  make("p", "wips-office-communal-empty", { hidden: true });
  make("div", "wips-office-communal-tasks");
  make("a", "wips-office-source");

  const storageMap = new Map();
  if (savedSeating !== null) {
    storageMap.set("wips-office-seating-v1", JSON.stringify(savedSeating));
  }
  const localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
  };

  const queuedTimeouts = [];
  const windowListeners = new Map();
  const win = {
    location: { origin: "http://127.0.0.1:8000", href: "http://127.0.0.1:8000/" },
    localStorage,
    openai: {
      widgetState: hostWidgetState,
      setWidgetState: onSetWidgetState,
    },
    setTimeout: (fn) => {
      queuedTimeouts.push(fn);
      return queuedTimeouts.length;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: (type, fn) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    dispatchEvent: (event) => {
      for (const fn of windowListeners.get(event.type) || []) fn(event);
    },
  };

  vm.runInNewContext(scriptText, {
    window: win,
    globalThis: win,
    document: doc,
    navigator: { onLine: true },
    fetch: async () => new Response(JSON.stringify(customSnapshot), { status: 200 }),
    URL,
    AbortController,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
  }, { filename: "wips-office.html" });

  return { byId, doc, win, storageMap, queuedTimeouts };
}

test("embeds every task from the source snapshot", () => {
  assert.equal(embeddedSnapshot.snapshotDate, snapshot.snapshotDate);
  assert.equal(embeddedSnapshot.timezone, snapshot.timezone);
  assert.equal(embeddedSnapshot.sourceUrl, snapshot.sourceUrl);
  assert.deepEqual(embeddedSnapshot.results, snapshot.results);
});

test("renders status-driven character motion with stable personal phases and zero dead spans", () => {
  for (const status of ["진행", "검증", "장시간 테스트 중"]) {
    const env = createOfficeDomHarness({
      customSnapshot: {
        snapshotDate: "2026-11-11",
        results: [{ title: "active", owner: "sb", status, project: "2.3" }],
      },
    });
    const stations = env.byId.get("wips-office-employees").querySelectorAll(".workstation");
    assert.equal(stations[0].dataset.activity, "working", status);
    const art = stations[0].querySelector(".person-art");
    assert.ok(art);
    assert.match(art.dataset.motionPhase, /^[0-4]$/);
    assert.equal(art.children.length, 0, "person-art should have zero hidden span children");
  }

  for (const status of ["대기", "예정"]) {
    const env = createOfficeDomHarness({
      customSnapshot: {
        snapshotDate: "2026-11-11",
        results: [{ title: "idle", owner: "sb", status, project: "2.3" }],
      },
    });
    const stations = env.byId.get("wips-office-employees").querySelectorAll(".workstation");
    assert.equal(stations[0].dataset.activity, "idle", status);
    assert.equal(stations[1].dataset.activity, "idle", "empty workstations stay still");
  }

  const phaseA = createOfficeDomHarness({
    customSnapshot: { snapshotDate: "2026-11-11", results: [{ title: "one", owner: "sb", status: "진행" }] },
  }).byId.get("wips-office-employees").querySelector(".person-art").dataset.motionPhase;
  const phaseB = createOfficeDomHarness({
    customSnapshot: {
      snapshotDate: "2026-11-11",
      results: Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, owner: "sb", status: "진행" })),
    },
  }).byId.get("wips-office-employees").querySelector(".person-art").dataset.motionPhase;
  assert.equal(phaseA, phaseB, "a person's phase does not depend on task count");
});

test("uses fixed office colors and respects reduced-motion settings", () => {
  const style = fragment.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(style, "the office fragment defines its styles");
  for (const color of ["floor", "bubble", "ink"]) {
    assert.match(style, new RegExp(`--office-${color}:\\s*#[0-9a-f]{6}`, "i"), `${color} has a fixed office color`);
  }
  assert.match(style, /\.office-room\s*\{[^}]*background-color:\s*var\(--office-floor\)/s);
  assert.match(style, /\.speech-bubble\s*\{[^}]*background:\s*var\(--office-bubble\);[^}]*color:\s*var\(--office-ink\)/s);
  assert.match(style, /\.workstation\[data-activity="working"\] \.person-art::before/);
  assert.match(style, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none/);
  for (let phase = 0; phase < 5; phase += 1) {
    assert.match(style, new RegExp(`\\.person-art\\[data-motion-phase="${phase}"\\]\\s*\\{[^}]*--motion-delay:`, "s"));
  }
});

test("retains all 19 tasks and reports every raw status count", () => {
  const summary = model.summary(allFilters);
  assert.equal(summary.total, 19);
  assert.equal(summary.unassigned, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.statuses)), {
    진행: 6,
    예정: 8,
    검증: 1,
    대기: 1,
    완료: 3,
    "장시간 테스트 중": 0,
  });
});

test("keeps the selected employee and ranks the representative task by raw status", () => {
  const view = model.viewForEmployee("sb", allFilters);
  assert.equal(view.owner, "sb");
  assert.equal(view.tasks.length, 6);
  assert.equal(view.representative.title, "샘플 업무 03");
  assert.equal(view.topLevelCount, 2);
  assert.equal(view.otherCount, 1);
});

test("restores keyboard focus to the selected employee after employee selection", () => {
  const env = createOfficeDomHarness();
  const uiButton = env.byId
    .get("wips-office-employees")
    .querySelectorAll("button")
    .find((b) => b.dataset.owner === "UI");
  assert.ok(uiButton);

  uiButton.dispatchEvent({ type: "click" });
  assert.equal(env.doc.activeElement?.dataset.owner, "UI");
  assert.match(env.byId.get("wips-office-selected-title").textContent, /^UI의 일감/);
  const updatedUiButton = env.byId
    .get("wips-office-employees")
    .querySelectorAll("button")
    .find((b) => b.dataset.owner === "UI");
  assert.equal(updatedUiButton.getAttribute("aria-pressed"), "true");
  assert.equal(model.focusEmployeeButton([], "missing"), null);
});

test("does not rerender when the host echoes the current semantic widget state", () => {
  const env = createOfficeDomHarness({
    hostWidgetState: { selectedEmployee: "UI" },
  });
  const employeeNode = env.byId.get("wips-office-employees");
  const initialUiBtn = employeeNode.querySelectorAll("button").find((b) => b.dataset.owner === "UI");
  initialUiBtn.focus();

  let replaceCalls = 0;
  const origReplace = employeeNode.replaceChildren.bind(employeeNode);
  employeeNode.replaceChildren = (...nodes) => {
    replaceCalls += 1;
    return origReplace(...nodes);
  };

  env.win.dispatchEvent({
    type: "openai:set_globals",
    detail: { globals: { widgetState: { selectedEmployee: "UI" } } },
  });
  assert.equal(replaceCalls, 0);
  assert.equal(env.doc.activeElement?.dataset.owner, "UI");

  env.win.dispatchEvent({
    type: "openai:set_globals",
    detail: { globals: { widgetState: { selectedEmployee: "sb" } } },
  });
  assert.equal(replaceCalls, 1);
  assert.match(env.byId.get("wips-office-selected-title").textContent, /^sb의 일감/);
});

test("filters null project separately from 기타 and preserves empty options", () => {
  const unspecified = model.filteredTasks({ status: "전체 상태", project: "프로젝트 미지정" });
  const other = model.filteredTasks({ status: "전체 상태", project: "기타" });
  const emptyProject = model.filteredTasks({ status: "전체 상태", project: "2.2.1" });
  const emptyStatus = model.filteredTasks({ status: "장시간 테스트 중", project: "전체 프로젝트" });
  assert.equal(unspecified.length, 1);
  assert.equal(unspecified[0].project, null);
  assert.equal(other.length, 1);
  assert.equal(other[0].project, "기타");
  assert.equal(emptyProject.length, 0);
  assert.equal(emptyStatus.length, 0);
});

test("filter select changes update summary, status counts, kanban view, and host widget state", () => {
  const savedStates = [];
  const env = createOfficeDomHarness({
    onSetWidgetState: (payload) => savedStates.push(payload),
  });
  const statusSelect = env.byId.get("wips-office-status");
  statusSelect.value = "진행";
  statusSelect.dispatchEvent({ type: "change" });

  assert.match(env.byId.get("wips-office-summary").textContent, /현재 표시 6 \/ 19개/);
  assert.equal(savedStates.at(-1)?.privateContent?.status, "진행");

  const projectSelect = env.byId.get("wips-office-project");
  projectSelect.value = "프로젝트 미지정";
  projectSelect.dispatchEvent({ type: "change" });
  assert.equal(savedStates.at(-1)?.privateContent?.project, "프로젝트 미지정");
});

test("returns a clear empty selected view and explicit labels for missing task fields", () => {
  const emptyView = model.viewForEmployee("UI", {
    status: "장시간 테스트 중",
    project: "전체 프로젝트",
  });
  assert.equal(emptyView.owner, "UI");
  assert.equal(emptyView.tasks.length, 0);
  assert.equal(emptyView.representative, null);
  assert.equal(emptyView.empty, true);

  const unassignedAction = snapshot.results.find((task) => task.title === "샘플 업무 12");
  const details = model.describeTask(unassignedAction);
  assert.equal(details.priority, "미지정");
  assert.equal(details.goalDate, "2026-11-11 — 2026-11-12");
  assert.equal(details.nextCheck, "미지정");
  assert.equal(details.nextAction, "미지정");
  assert.equal(details.doneCondition, "미지정");
  assert.equal(details.project, "기타");
});

test("restores saved live widget values without overwriting an earlier user choice", () => {
  const liveModel = createOfficeModel({ results: [{
    title: "live option task",
    owner: "새 담당자",
    status: "새 상태",
    project: "새 프로젝트",
  }] });
  const candidate = {
    privateContent: {
      selectedEmployee: "새 담당자",
      status: "새 상태",
      project: "새 프로젝트",
    },
  };
  const currentState = {
    selectedEmployee: "sb",
    status: "전체 상태",
    project: "전체 프로젝트",
  };

  assert.deepEqual(JSON.parse(JSON.stringify(liveModel.stateFromHost(candidate))), candidate.privateContent);
  assert.deepEqual(
    JSON.parse(JSON.stringify(liveModel.restorePendingState(candidate, currentState, false))),
    candidate.privateContent,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(liveModel.restorePendingState(candidate, currentState, true))),
    currentState,
  );
});

test("counts and represents only root tasks while retaining employee details", () => {
  const hierarchy = createOfficeModel({ results: [
    { title: "child", owner: "sb", status: "진행", project: "2.3", parentTaskIds: ["root"] },
    { title: "root", owner: "sb", status: "예정", project: "2.3", parentTaskIds: [] },
    { title: "other root", owner: "sb", status: "완료", project: "기타", parentTaskIds: [] },
    { title: "grandchild", owner: "UI", status: "진행", parentTaskIds: ["child"] },
  ] });
  const view = hierarchy.viewForEmployee("sb", allFilters);
  assert.equal(view.topLevelCount, 1);
  assert.equal(view.tasks.length, 2);
  assert.equal(view.representative.title, "root");
  assert.equal(view.otherCount, 0);
  const filtered = hierarchy.viewForEmployee("sb", { status: "진행", project: "전체 프로젝트" });
  assert.equal(filtered.topLevelCount, 0);
  assert.equal(filtered.representative, null);
  assert.equal(filtered.tasks.length, 1);
  assert.equal(hierarchy.viewForEmployee("UI", allFilters).topLevelCount, 0);
  assert.equal(hierarchy.viewForEmployee("sb", { ...allFilters, project: "2.3" }).topLevelCount, 1);
});

test("normalizes saved seating and appends new employees without duplicates", () => {
  const saved = ["UI", "sb", "UI", "removed"];
  assert.deepEqual(Array.from(model.normalizeSeating(saved)), ["UI", "sb", "이요원", "여이전트", "석규"]);
  assert.deepEqual(Array.from(model.normalizeSeating(null)), Array.from(model.employees));
  assert.deepEqual(Array.from(model.normalizeSeating({})), Array.from(model.employees));
  assert.deepEqual(saved, ["UI", "sb", "UI", "removed"]);
  const updated = createOfficeModel({ results: [{ owner: "신입" }] });
  assert.equal(updated.normalizeSeating(saved).at(-1), "신입");
});

test("swaps seats without mutating the saved order and ignores invalid moves", () => {
  const order = Array.from(model.employees);
  const swapped = model.swapSeats(order, "sb", "UI");
  assert.equal(swapped[0], "UI");
  assert.equal(swapped[4], "sb");
  assert.deepEqual(order, Array.from(model.employees));
  assert.deepEqual(Array.from(model.swapSeats(order, "sb", "missing")), order);
  assert.deepEqual(Array.from(model.swapSeats(order, "sb", "sb")), order);
  assert.deepEqual(Array.from(model.normalizeSeating(JSON.parse(JSON.stringify(swapped)))), Array.from(swapped));
});

test("handles seat drag-and-drop, click suppression, select swap, and reset through real DOM events", () => {
  const env = createOfficeDomHarness();
  const employeeNode = env.byId.get("wips-office-employees");

  const idleButtons = employeeNode.querySelectorAll("button");
  assert.equal(idleButtons[0].draggable, false);
  const blockedDrag = idleButtons[0].dispatchEvent({ type: "dragstart" });
  assert.equal(blockedDrag.defaultPrevented, true);

  env.byId.get("wips-office-edit-seating").dispatchEvent({ type: "click" });
  assert.equal(env.byId.get("wips-office-reset-seating").hidden, false);

  const stations = employeeNode.querySelectorAll(".workstation");
  const sbBtn = stations[0].querySelector("button");
  const uiStation = stations[4];
  assert.equal(sbBtn.draggable, true);

  const transfer = { effectAllowed: "", data: "", setData(_t, v) { this.data = v; } };
  sbBtn.dispatchEvent({ type: "dragstart", dataTransfer: transfer });
  assert.equal(sbBtn.classList.contains("is-dragging"), true);
  assert.equal(transfer.data, "sb");

  const postDragClick = sbBtn.dispatchEvent({ type: "click" });
  assert.equal(postDragClick.defaultPrevented, true);
  assert.equal(postDragClick.stoppedPropagation, true);

  const selfOver = stations[0].dispatchEvent({ type: "dragover" });
  assert.equal(selfOver.defaultPrevented, false);
  assert.equal(stations[0].classList.contains("is-drop-target"), false);

  const validOver = uiStation.dispatchEvent({ type: "dragover", dataTransfer: {} });
  assert.equal(validOver.defaultPrevented, true);
  assert.equal(uiStation.classList.contains("is-drop-target"), true);

  uiStation.dispatchEvent({ type: "dragleave", relatedTarget: null });
  assert.equal(uiStation.classList.contains("is-drop-target"), false);

  uiStation.dispatchEvent({ type: "dragover", dataTransfer: {} });
  const dropEvent = uiStation.dispatchEvent({ type: "drop" });
  assert.equal(dropEvent.defaultPrevented, true);
  assert.deepEqual(JSON.parse(env.storageMap.get("wips-office-seating-v1")), ["UI", "이요원", "여이전트", "석규", "sb"]);
  assert.match(env.byId.get("wips-office-seating-message").textContent, /sb와 UI의 자리를 바꿨습니다/);

  const prevBtn = sbBtn;
  prevBtn.classList.add("is-dragging");
  employeeNode.querySelectorAll(".workstation")[0].classList.add("is-drop-target");
  prevBtn.dispatchEvent({ type: "dragend" });
  assert.equal(prevBtn.classList.contains("is-dragging"), false);
  assert.equal(employeeNode.querySelectorAll(".workstation.is-drop-target").length, 0);
  env.queuedTimeouts.forEach((fn) => fn());

  env.byId.get("wips-office-reset-seating").dispatchEvent({ type: "click" });
  assert.deepEqual(JSON.parse(env.storageMap.get("wips-office-seating-v1")), ["sb", "이요원", "여이전트", "석규", "UI"]);
});

test("keeps the embedded office source, styles, and script synchronized with index.html", () => {
  const index = readFileSync(folder + "/index.html", "utf8");
  const rawSrcdoc = index.match(/\bdata-srcdoc="([\s\S]*?)"/)?.[1];
  assert.ok(rawSrcdoc, "index embeds the office document");
  const srcdoc = rawSrcdoc.replace(/&(?:quot|#x27|#39|lt|gt|amp);/g, (entity) => ({
    "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&",
  })[entity]);
  const sourceStyle = fragment.match(/<style>[\s\S]*?<\/style>/)?.[0];
  const embeddedStyle = srcdoc.match(/<style>[\s\S]*?<\/style>/g)?.find((style) => style.includes("#wips-office-root {"));
  assert.ok(sourceStyle, "source defines office colors and motion");
  assert.equal(embeddedStyle, sourceStyle);
  assert.equal(
    srcdoc.match(/<script id="office-model">([\s\S]*?)<\/script>/)?.[1],
    fragment.match(/<script id="office-model">([\s\S]*?)<\/script>/)?.[1],
  );
  assert.match(srcdoc, /\.employee-button\.is-dragging/);
  assert.match(srcdoc, /\.workstation\.is-drop-target/);
});

test("excludes completed tasks by default and includes them when status filter is 완료", () => {
  const active = createOfficeModel({ results: [
    { title: "open", owner: "sb", status: "진행" },
    { title: "done", owner: "sb", status: "완료" },
    { title: "unassigned open", owner: null, status: "예정" },
    { title: "unassigned done", owner: null, status: "완료" },
  ] });
  assert.deepEqual(Array.from(active.employeeTasks("sb", allFilters), (t) => t.title), ["open"]);
  assert.deepEqual(Array.from(active.unassignedTasks(allFilters), (t) => t.title), ["unassigned open"]);
  assert.deepEqual(Array.from(active.employeeTasks("sb", { ...allFilters, status: "완료" }), (t) => t.title), ["done"]);
  assert.deepEqual(Array.from(active.unassignedTasks({ ...allFilters, status: "완료" }), (t) => t.title), ["unassigned done"]);

  const doneView = active.viewForEmployee("sb", { ...allFilters, status: "완료" });
  assert.equal(doneView.tasks.length, 1);
  assert.equal(doneView.topLevelCount, 0);
  assert.equal(doneView.representative, null);
  assert.equal(doneView.empty, false);
  assert.equal(active.viewForEmployee("sb", allFilters).topLevelCount, 1);
});

test("renders completed tasks in a dedicated done lane and communal board when status=완료 is selected", () => {
  const custom = createOfficeModel({ results: [] });
  const mixedLanes = custom.groupTasksByLane([
    { title: "active", status: "진행" },
    { title: "finished", status: "완료" },
  ]);
  assert.deepEqual(
    mixedLanes.map((lane) => [lane.id, lane.tasks.map((t) => t.title)]),
    [
      ["planned", []],
      ["progress", ["active"]],
      ["review", []],
      ["done", ["finished"]],
    ],
  );

  const env = createOfficeDomHarness({
    customSnapshot: {
      snapshotDate: "2026-11-27",
      results: [
        { title: "진행 일감", owner: "sb", status: "진행", project: "2.3", startDate: "2026-11-26" },
        { title: "완료 일감", owner: "sb", status: "완료", project: "2.3", startDate: "2026-11-10" },
        { title: "공용 진행", owner: "공통", status: "예정", project: "2.3", startDate: "2026-11-28" },
        { title: "공용 완료", owner: "공통", status: "완료", project: "2.3", startDate: "2026-11-05" },
      ],
    },
  });

  const statusSelect = env.byId.get("wips-office-status");
  statusSelect.value = "완료";
  statusSelect.dispatchEvent({ type: "change" });

  assert.equal(env.byId.get("wips-office-selected-title").textContent, "sb의 일감 · 1개");
  assert.equal(env.byId.get("wips-office-selected-note").textContent, "완료된 일감 1개를 표시합니다.");
  assert.equal(env.byId.get("wips-office-selected-empty").hidden, true);

  const cols = env.byId.get("wips-office-selected-tasks").querySelectorAll(".kanban-col");
  assert.equal(cols.length, 1);
  assert.equal(cols[0].dataset.laneId, "done");
  assert.equal(cols[0].querySelector(".kanban-col-count")?.textContent, "1");
  const doneCard = cols[0].querySelector(".kanban-card");
  assert.equal(doneCard?.dataset.taskTitle, "완료 일감");
  assert.equal(doneCard?.querySelector(".kanban-dday")?.textContent, "완료");
  assert.equal(doneCard?.querySelector(".kanban-dday")?.dataset.tone, "green");
  assert.equal(doneCard?.querySelector(".kanban-progress-pct")?.textContent, "100%");

  const communalCards = env.byId.get("wips-office-communal-tasks").querySelectorAll(".kanban-card");
  assert.equal(env.byId.get("wips-office-communal-count").textContent, "1개");
  assert.deepEqual(communalCards.map((c) => c.dataset.taskTitle), ["공용 완료"]);

  const sbStation = env.byId.get("wips-office-employees").querySelector(".workstation");
  assert.equal(sbStation?.dataset.activity, "idle");
  assert.equal(env.byId.get("wips-office-billboard").querySelectorAll(".hq-step-card").length, 0);

  statusSelect.value = "전체 상태";
  statusSelect.dispatchEvent({ type: "change" });
  const restoredCols = env.byId.get("wips-office-selected-tasks").querySelectorAll(".kanban-col");
  assert.equal(restoredCols.length, 3);
  assert.deepEqual(
    env.byId.get("wips-office-communal-tasks").querySelectorAll(".kanban-card").map((c) => c.dataset.taskTitle),
    ["공용 진행"],
  );
});

test("treats 공통 owner as shared schedule tasks and builds stepper + live ticker data", () => {
  const custom = createOfficeModel({ results: [
    { title: "QA 입고", owner: "공통", status: "예정", project: "2.3", startDate: "2026-12-02", endDate: null },
    { title: "사전 검증", owner: null, status: "예정", project: "2.3", startDate: "2026-11-23", endDate: "2026-11-27" },
    { title: "사전 검증 준비", owner: "공통", status: "진행", project: "2.3", startDate: "2026-11-20", endDate: null },
    { title: "취약점 수정 리뷰", owner: null, status: "검증", project: "2.3", startDate: null, endDate: null },
    { title: "후속모델 개발", owner: "sb", status: "진행", project: "2.3", startDate: "2026-11-13", endDate: null },
    { title: "서버 취약점 대응", owner: "여이전트", status: "진행", project: "기타", startDate: "2026-11-11", endDate: "2026-11-12" },
    { title: "대기 작업", owner: "이요원", status: "대기", project: "2.3", startDate: "2026-11-19", endDate: null },
    { title: "완료 공통", owner: "공통", status: "완료", project: "2.3", startDate: "2026-11-10", endDate: null },
  ] });

  assert.equal(custom.employees.includes("공통"), false);
  assert.equal(custom.summary(allFilters).unassigned, 5);
  assert.equal(custom.unassignedTasks(allFilters).length, 4);

  const view = custom.billboardView(allFilters, "2026-11-18");
  assert.equal(view.todayLabel, "11/18");
  assert.deepEqual(
    view.scheduleTasks.map((item) => [
      item.stepLabel,
      item.title,
      item.dDayLabel,
      item.shortDate,
      item.progress,
      item.tone,
    ]),
    [
      ["STEP 01", "취약점 수정 리뷰", "수시", "일정 미지정", 20, "slate"],
      ["STEP 02", "사전 검증 준비", "D-2", "11/20", 87, "green"],
      ["STEP 03", "사전 검증", "D-5", "11/23~11/27", 68, "green"],
      ["STEP 04", "QA 입고", "D-14", "12/02", 10, "green"],
    ],
  );
  assert.deepEqual(
    view.tickerTasks.map((item) => [item.owner, item.title, item.shortDate]),
    [
      ["sb", "후속모델 개발", "11/13~"],
      ["여이전트", "서버 취약점 대응", "11/11~11/12"],
    ],
  );

  const env = createOfficeDomHarness({
    customSnapshot: {
      snapshotDate: "2026-11-18",
      results: [
        { title: "사전 검증", owner: null, status: "예정", project: "2.3", startDate: "2026-11-23", endDate: "2026-11-27" },
        { title: "서버 취약점 대응", owner: "여이전트", status: "진행", project: "기타", startDate: "2026-11-11", endDate: "2026-11-12" },
      ],
    },
  });
  const stepBtn = env.byId.get("wips-office-billboard").querySelector(".hq-step-card");
  assert.ok(stepBtn);
  stepBtn.dispatchEvent({ type: "click" });
  const communalCards = env.byId.get("wips-office-communal-tasks").querySelectorAll(".kanban-card");
  assert.equal(communalCards[0].classList.contains("is-billboard-highlight"), true);

  const tickerBtn = env.byId.get("wips-office-billboard").querySelector(".hq-ticker-item");
  assert.ok(tickerBtn);
  tickerBtn.dispatchEvent({ type: "click" });
  assert.match(env.byId.get("wips-office-selected-title").textContent, /^여이전트의 일감/);
});

test("groups employee tasks into 3 active kanban lanes and renders communal list with kanban cards", () => {
  const custom = createOfficeModel({ results: [] });
  const lanes = custom.groupTasksByLane([
    { title: "t-todo", status: "예정" },
    { title: "t-wait", status: "대기" },
    { title: "t-prog", status: "진행" },
    { title: "t-ver", status: "검증" },
    { title: "t-long", status: "장시간 테스트 중" },
    { title: "t-unknown", status: "알수없음" },
  ]);

  assert.deepEqual(
    Array.from(lanes, (lane) => [lane.id, lane.showExactStatus, Array.from(lane.tasks, (t) => t.title)]),
    [
      ["planned", true, ["t-todo", "t-wait", "t-unknown"]],
      ["progress", false, ["t-prog"]],
      ["review", true, ["t-ver", "t-long"]],
    ],
  );

  const env = createOfficeDomHarness();
  const selectedBoard = env.byId.get("wips-office-selected-tasks");
  const cols = selectedBoard.querySelectorAll(".kanban-col");
  assert.equal(cols.length, 3);
  assert.deepEqual(
    cols.map((col) => [
      col.dataset.laneId,
      col.querySelector(".kanban-col-count")?.textContent,
    ]),
    [
      ["planned", "4"],
      ["progress", "2"],
      ["review", "0"],
    ],
  );

  const plannedCard = cols[0].querySelector(".kanban-card");
  assert.ok(plannedCard);
  assert.match(plannedCard.querySelector(".kanban-badge")?.textContent || "", /예정 · 2\.3/);
  assert.ok(plannedCard.querySelector(".kanban-dday"));
  const plannedSourceLink = plannedCard.querySelector(".task-source");
  assert.ok(plannedSourceLink);
  assert.equal(plannedSourceLink.getAttribute("aria-label"), "Notion에서 보기");
  assert.equal(plannedSourceLink.querySelector("svg")?.getAttribute("viewBox"), "0 0 24 24");
  assert.ok(plannedCard.querySelector("h3"));
  assert.ok(plannedCard.querySelector(".kanban-progress-pct"));
  assert.match(plannedCard.querySelector(".kanban-bar-fill")?.style.width || "", /^\d+%$/);
  assert.ok(plannedCard.querySelector(".kanban-next"));
  assert.equal(cols[2].querySelector(".kanban-empty")?.textContent, "해당 일감 없음");

  const communalCards = env.byId.get("wips-office-communal-tasks").querySelectorAll(".kanban-card");
  assert.equal(communalCards.length, 4);
  assert.equal(communalCards[0].querySelector("h3")?.textContent, "샘플 업무 02");
  assert.equal(communalCards[0].querySelector(".kanban-dday")?.textContent, "수시");
  assert.equal(communalCards[0].querySelector(".kanban-progress-pct")?.textContent, "20%");
  assert.ok(communalCards[0].querySelector(".kanban-progress-box"));

  assert.deepEqual(
    [
      model.describeTask({ title: "p", status: "예정", startDate: "2026-11-16", endDate: null }, "2026-11-18"),
      model.describeTask({ title: "w", status: "대기", startDate: "2026-11-19", endDate: null }, "2026-11-18"),
      model.describeTask({ title: "g", status: "진행", startDate: "2026-11-16", endDate: null }, "2026-11-18"),
      model.describeTask({ title: "s", status: "예정", startDate: null, endDate: null }, "2026-11-18"),
    ].map((item) => [item.dDayLabel, item.progress, item.tone]),
    [
      ["D+2", 100, "red"],
      ["D-1", 94, "amber"],
      ["D+2", 100, "green"],
      ["미정", 20, "slate"],
    ],
  );

  const emptyEnv = createOfficeDomHarness({ customSnapshot: { snapshotDate: "2026-11-11", results: [] } });
  assert.equal(emptyEnv.byId.get("wips-office-selected-empty").hidden, false);
  assert.equal(emptyEnv.byId.get("wips-office-selected-tasks").children.length, 0);
});

test("converts verified Notion links to notion:// app URLs without popup target attributes", () => {
  const validEnv = createOfficeDomHarness({
    customSnapshot: {
      snapshotDate: "2026-11-11",
      sourceUrl: "https://app.notion.com/00000000000000000000000000000001",
      results: [
        {
          id: "t1",
          title: "www link",
          owner: "sb",
          status: "진행",
          url: "https://www.notion.so/Page-Title-1234?pvs=4#block",
        },
        {
          id: "t2",
          title: "bad link",
          owner: "sb",
          status: "예정",
          url: "https://evil.example/phish",
        },
        {
          id: "t3",
          title: "root notion",
          owner: "sb",
          status: "대기",
          url: "https://notion.so/abcd",
        },
        {
          id: "t4",
          title: "workspace notion",
          owner: "sb",
          status: "검증",
          url: "https://team-space.notion.so/task-123",
        },
      ],
    },
  });

  const sourceAnchor = validEnv.byId.get("wips-office-source");
  assert.equal(sourceAnchor.href, "notion://app.notion.com/00000000000000000000000000000001");
  assert.equal(sourceAnchor.getAttribute("target"), null);
  assert.equal(sourceAnchor.getAttribute("rel"), null);

  const links = validEnv.byId.get("wips-office-selected-tasks").querySelectorAll(".task-source");
  assert.deepEqual(
    links.map((a) => a.href),
    [
      "notion://notion.so/abcd",
      "notion://www.notion.so/Page-Title-1234?pvs=4#block",
      "notion://team-space.notion.so/task-123",
    ],
  );
  assert.doesNotMatch(fragment, /<a id="wips-office-source"[^>]*target="_blank"/);
});

test("outer host open-external launches allowlisted notion:// URLs directly without _blank popup", () => {
  const indexHtml = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const outerScripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const hostScript = outerScripts.map((m) => m[1]).find((s) => s.includes("open-external"));
  assert.ok(hostScript, "outer host bootstrap script exists in index.html");

  const clicked = [];
  class MockIframe {
    constructor() {
      this.dataset = { srcdoc: '<script type="application/json" id="codex-visualization-widget-state">__CODEX_VISUALIZATION_WIDGET_STATE__</script>' };
      this.style = { removeProperty() {} };
      this.listeners = new Map();
    }
    addEventListener(type, fn) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);
    }
    triggerLoad() {
      for (const fn of this.listeners.get("load") || []) fn();
    }
  }
  const frame = new MockIframe();
  let hostPort = null;
  class MockPort {
    constructor() { this.listeners = []; }
    addEventListener(type, fn) { if (type === "message") this.listeners.push(fn); }
    start() {}
    postMessage(data) { for (const fn of this.listeners) fn({ data }); }
  }
  class MockMessageChannel {
    constructor() {
      const p1 = new MockPort();
      const p2 = new MockPort();
      p1.peer = p2;
      p2.peer = p1;
      this.port1 = p1;
      this.port2 = p2;
      hostPort = p1;
    }
  }
  const win = {
    innerHeight: 800,
    location: { pathname: "/", search: "" },
    navigator: { userActivation: { isActive: true } },
    addEventListener: () => {},
    matchMedia: () => ({ matches: false }),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const mockDoc = {
    baseURI: "https://example.github.io/WIPS-Office/",
    documentElement: { classList: { contains: () => false, add() {} } },
    body: { appendChild() {} },
    getElementById: (id) => (id === "codex-visualization" ? frame : null),
    createElement(tag) {
      assert.equal(tag, "a");
      return {
        href: "",
        click() { clicked.push({ href: this.href, target: this.target, rel: this.rel }); },
        remove() {},
      };
    },
  };
  vm.runInNewContext(hostScript, {
    globalThis: win,
    window: win,
    document: mockDoc,
    HTMLIFrameElement: MockIframe,
    MessageChannel: MockMessageChannel,
    URL,
    TextEncoder,
  }, { filename: "index.html" });
  assert.ok(hostPort);

  for (const href of [
    "notion://www.notion.so/Page-1234?pvs=4",
    "notion://app.notion.com/p/1234",
    "notion://team-space.notion.so/task-123",
    "https://example.com/docs",
    "notion://evil.example/page",
    "notion://evil-notion.so/page",
    "notion://.notion.so/page",
    "notion:www.notion.so/page",
    "notion://www.notion.so:8443/page",
    "notion://user:pass@www.notion.so/page",
    "javascript:alert(1)",
    "file:///etc/passwd",
  ]) {
    hostPort.postMessage({ type: "open-external", href });
  }

  assert.deepEqual(clicked, [
    { href: "notion://www.notion.so/Page-1234?pvs=4", target: undefined, rel: undefined },
    { href: "notion://app.notion.com/p/1234", target: undefined, rel: undefined },
    { href: "notion://team-space.notion.so/task-123", target: undefined, rel: undefined },
    { href: "https://example.com/docs", target: "_blank", rel: "noopener noreferrer" },
  ]);
});

test("aggregates checklist and sub-task completion counts across completed tasks, ID formats, URLs, and deduplicates bidirectional links", () => {
  const sample03 = snapshot.results.find((task) => task.title === "샘플 업무 03");
  const sample03Details = model.describeTask(sample03);
  assert.equal(sample03Details.taskKey, "00000000-0000-4000-8000-000000000101");
  assert.equal(sample03Details.checklist.done, 3);
  assert.equal(sample03Details.checklist.total, 5);
  assert.equal(sample03Details.subtasks.done, 1);
  assert.equal(sample03Details.subtasks.total, 5);
  assert.equal(
    sample03Details.subtasks.items.find((item) => item.title === "샘플 업무 05")?.done,
    true,
  );

  const sample02 = snapshot.results.find((task) => task.title === "샘플 업무 02");
  const sample02Details = model.describeTask(sample02);
  assert.equal(sample02Details.checklist.done, 4);
  assert.equal(sample02Details.checklist.total, 4);
  assert.equal(sample02Details.subtasks, null);

  const sample08 = snapshot.results.find((task) => task.title === "샘플 업무 08");
  const sample08Details = model.describeTask(sample08);
  assert.equal(sample08Details.checklist.done, 2);
  assert.equal(sample08Details.checklist.total, 4);
  assert.equal(sample08Details.subtasks, null);

  const sample01 = snapshot.results.find((task) => task.title === "샘플 업무 01");
  const sample01Details = model.describeTask(sample01);
  assert.equal(sample01Details.checklist, null);
  assert.equal(sample01Details.subtasks, null);

  const customModel = createOfficeModel({
    results: [
      {
        url: "https://www.notion.so/Parent-Task-aaaa1111bbbb2222cccc3333dddd4444?pvs=4",
        title: "URL 기반 상위 일감",
        owner: "sb",
        status: "진행",
        subTaskIds: [
          "11111111-2222-3333-4444-555555555555",
          "22222222-2222-3333-4444-555555555555",
          "99999999-9999-9999-9999-999999999999",
        ],
        checklist: [
          { text: "  항목 1  ", done: true },
          { text: "", done: true },
          { text: "항목 2", done: false },
        ],
      },
      {
        id: "11111111222233334444555555555555",
        url: "https://app.notion.com/11111111222233334444555555555555",
        title: "양방향 연결 완료 하위",
        owner: "sb",
        status: "완료",
        parentTaskIds: ["AAAA1111-BBBB-2222-CCCC-3333DDDD4444"],
      },
      {
        id: "22222222-2222-3333-4444-555555555555",
        url: "https://evil.example/not-notion",
        title: "subTaskIds 전용 진행 하위",
        owner: "UI",
        status: "진행",
        parentTaskIds: [],
      },
      {
        id: "33333333-2222-3333-4444-555555555555",
        url: "https://app.notion.com/33333333222233334444555555555555",
        title: "parentTaskIds 전용 완료 하위",
        owner: null,
        status: "완료",
        parentTaskIds: ["aaaa1111bbbb2222cccc3333dddd4444"],
      },
    ],
  });

  const parent = customModel.describeTask(customModel.employeeTasks("sb", allFilters)[0]);
  assert.equal(parent.checklist.done, 1);
  assert.equal(parent.checklist.total, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(parent.checklist.items)),
    [{ text: "항목 1", done: true }, { text: "항목 2", done: false }],
  );
  assert.equal(parent.subtasks.done, 2);
  assert.equal(parent.subtasks.total, 3);
  assert.deepEqual(
    JSON.parse(JSON.stringify(parent.subtasks.items)),
    [
      {
        id: "11111111222233334444555555555555",
        title: "양방향 연결 완료 하위",
        status: "완료",
        owner: "sb",
        done: true,
        sourceUrl: "https://app.notion.com/11111111222233334444555555555555",
      },
      {
        id: "33333333222233334444555555555555",
        title: "parentTaskIds 전용 완료 하위",
        status: "완료",
        owner: null,
        done: true,
        sourceUrl: "https://app.notion.com/33333333222233334444555555555555",
      },
      {
        id: "22222222222233334444555555555555",
        title: "subTaskIds 전용 진행 하위",
        status: "진행",
        owner: "UI",
        done: false,
        sourceUrl: "",
      },
    ],
  );
});

test("renders Variant B progress box with segmented bars, continuous fallback (>12), read-only drawer, and persistent open state", () => {
  const manyChecklist = Array.from({ length: 15 }, (_, idx) => ({
    text: `항목 ${idx + 1}`,
    done: idx < 6,
  }));
  const completeSubtasks = Array.from({ length: 13 }, (_, idx) => ({
    id: `sub-${idx + 1}`,
    title: `하위 ${idx + 1}`,
    status: "완료",
    owner: "sb",
    url: idx === 0 ? "https://app.notion.com/00000000000000000000000000000099" : "",
    parentTaskIds: ["parent-large"],
  }));

  const env = createOfficeDomHarness({
    customSnapshot: {
      snapshotDate: "2026-11-11",
      results: [
        {
          id: "parent-both",
          url: "https://app.notion.com/00000000000000000000000000000100",
          title: "체크+하위 일감",
          owner: "sb",
          status: "진행",
          checklist: [
            { text: "체크 1", done: true },
            { text: "체크 2", done: false },
          ],
        },
        {
          id: "child-done",
          url: "https://app.notion.com/00000000000000000000000000000101",
          title: "완료된 하위",
          owner: "sb",
          status: "완료",
          parentTaskIds: ["parent-both"],
        },
        {
          id: "child-open",
          url: "",
          title: "링크 없는 하위",
          owner: "sb",
          status: "예정",
          parentTaskIds: ["parent-both"],
        },
        {
          id: "only-check-complete",
          title: "체크만 완료",
          owner: "sb",
          status: "검증",
          checklist: [
            { text: "끝 1", done: true },
            { text: "끝 2", done: true },
          ],
        },
        {
          id: "plain-task",
          title: "일반 일감",
          owner: "sb",
          status: "예정",
        },
        {
          id: "parent-large",
          title: "대용량 항목 일감",
          owner: "sb",
          status: "진행",
          checklist: manyChecklist,
        },
        ...completeSubtasks,
      ],
    },
  });

  const board = env.byId.get("wips-office-selected-tasks");
  const findCard = (title) => board.querySelectorAll(".kanban-card").find((c) => c.dataset.taskTitle === title);

  const bothCard = findCard("체크+하위 일감");
  const bothBox = bothCard.querySelector(".kanban-progress-box");
  assert.ok(bothBox, "renders progress box when checklist and subtasks exist");
  assert.equal(bothBox.tagName, "DETAILS");
  assert.equal(bothBox.querySelectorAll(".kanban-progress-row").length, 2);
  assert.deepEqual(
    bothBox.querySelectorAll(".kanban-progress-count").map((n) => n.textContent),
    ["1/2", "1/2"],
  );
  assert.equal(bothBox.querySelectorAll("input").length, 0, "checklist drawer stays strictly read-only");
  const subtaskLinks = bothBox.querySelectorAll(".kanban-subtask-link");
  assert.equal(subtaskLinks.length, 1);
  assert.equal(subtaskLinks[0].href, "notion://app.notion.com/00000000000000000000000000000101");
  assert.deepEqual(
    bothBox.querySelectorAll(".kanban-subtask-status").map((n) => n.textContent),
    ["완료", "예정"],
  );

  bothBox.open = true;
  bothBox.dispatchEvent({ type: "toggle" });
  const statusSelect = env.byId.get("wips-office-status");
  statusSelect.value = "전체 상태";
  statusSelect.dispatchEvent({ type: "change" });
  const rerenderedBox = findCard("체크+하위 일감").querySelector(".kanban-progress-box");
  assert.equal(rerenderedBox.open, true, "drawer open state survives rerenders");
  rerenderedBox.open = false;
  rerenderedBox.dispatchEvent({ type: "toggle" });
  statusSelect.dispatchEvent({ type: "change" });
  assert.equal(findCard("체크+하위 일감").querySelector(".kanban-progress-box").open, false);

  const completeBox = findCard("체크만 완료").querySelector(".kanban-progress-box");
  assert.equal(completeBox.querySelectorAll(".kanban-progress-row").length, 1);
  assert.equal(completeBox.querySelector(".kanban-progress-count").dataset.complete, "true");
  assert.equal(completeBox.querySelectorAll(".is-done-all").length, 2);

  assert.equal(findCard("일반 일감").querySelector(".kanban-progress-box"), null);

  const largeBox = findCard("대용량 항목 일감").querySelector(".kanban-progress-box");
  assert.equal(largeBox.querySelectorAll(".kanban-progress-segs").length, 0);
  const fills = largeBox.querySelectorAll(".kanban-progress-fill");
  assert.equal(fills.length, 2);
  assert.equal(fills[0].style.width, "40%");
  assert.equal(fills[0].dataset.complete, undefined);
  assert.equal(fills[1].style.width, "100%");
  assert.equal(fills[1].dataset.complete, "true");
});
