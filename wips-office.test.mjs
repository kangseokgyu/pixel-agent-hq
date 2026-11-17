import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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
const createOfficeModel = context.window.__wipsOfficeModel;
assert.equal(typeof createOfficeModel, "function", "the office model is available to the fragment");
const model = createOfficeModel(snapshot);
const allFilters = { status: "전체 상태", project: "전체 프로젝트" };

test("embeds every task from the source snapshot", () => {
  assert.equal(embeddedSnapshot.snapshotDate, snapshot.snapshotDate);
  assert.equal(embeddedSnapshot.timezone, snapshot.timezone);
  assert.equal(embeddedSnapshot.sourceUrl, snapshot.sourceUrl);
  assert.deepEqual(embeddedSnapshot.results, snapshot.results);
});

test("renders status-driven character motion with stable personal phases", () => {
  const workstationSource = fragment.match(/function createWorkstation\(owner, filters\) \{[\s\S]*?\n  \}/)?.[0];
  const personArtSource = fragment.match(/function createPersonArt\(owner, count\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(workstationSource, "workstations have a renderer");
  assert.ok(personArtSource, "characters have a renderer");

  function createElement(tagName) {
    return {
      tagName,
      className: "",
      dataset: {},
      children: [],
      attributes: {},
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener() {},
    };
  }

  const document = { createElement };
  const addText = (parent, tagName, className, text) => {
    const node = document.createElement(tagName);
    node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    parent.append(node);
    return node;
  };
  const createPersonArt = new Function(
    "document", "addText",
    personArtSource + "\nreturn createPersonArt;",
  )(document, addText);
  const phaseFor = (owner, count) => createPersonArt(owner, count).dataset.motionPhase;
  assert.match(phaseFor("sb", 0), /^[0-4]$/);
  assert.equal(phaseFor("sb", 0), phaseFor("sb", 5), "a person's phase survives rerendering");
  assert.equal(phaseFor("공동", 1), phaseFor("공동", 4), "a person's phase does not depend on task count");

  let view = { representative: null, topLevelCount: 0, otherCount: 0 };
  const model = { viewForEmployee: () => view };
  const createWorkstation = new Function(
    "document", "model", "state", "editingSeating", "WORKING_STATUSES", "createPersonArt", "addText",
    workstationSource + "\nreturn createWorkstation;",
  )(document, model, { selectedEmployee: "sb" }, false,
    new Set(["진행", "검증", "장시간 테스트 중"]), createPersonArt, addText);

  for (const status of ["진행", "검증", "장시간 테스트 중"]) {
    view = { representative: { status, title: "task" }, topLevelCount: 1, otherCount: 0 };
    assert.equal(createWorkstation("sb", {}).dataset.activity, "working", status);
  }
  for (const status of ["대기", "예정"]) {
    view = { representative: { status, title: "task" }, topLevelCount: 1, otherCount: 0 };
    assert.equal(createWorkstation("sb", {}).dataset.activity, "idle", status);
  }
  view = { representative: null, topLevelCount: 0, otherCount: 0 };
  assert.equal(createWorkstation("sb", {}).dataset.activity, "idle", "empty workstations stay still");
});

test("uses fixed office colors and respects reduced-motion settings", () => {
  const style = fragment.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(style, "the office fragment defines its styles");
  for (const color of ["floor", "desk", "skin", "hair", "bubble", "ink"]) {
    assert.match(style, new RegExp(`--office-${color}:\\s*#[0-9a-f]{6}`, "i"), `${color} has a fixed office color`);
  }
  assert.match(style, /\.office-room\s*\{[^}]*background-color:\s*var\(--office-floor\)/s);
  assert.match(style, /\.desk-top\s*\{[^}]*background:\s*var\(--office-desk\)/s);
  assert.match(style, /\.speech-bubble\s*\{[^}]*background:\s*var\(--office-bubble\);[^}]*color:\s*var\(--office-ink\)/s);
  assert.match(style, /\.person-head\s*\{[^}]*background:\s*var\(--office-skin\)/s);
  assert.match(style, /\.person-hair\s*\{[^}]*background:\s*var\(--office-hair\)/s);
  assert.match(style, /\.workstation\[data-activity="working"\] \.person-head/);
  assert.match(style, /\.workstation\[data-activity="working"\] \.person-body::before/);
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
  let activeElement = null;
  const buttons = ["sb", "이요원", "여이전트", "석규", "UI"].map((owner) => ({
    dataset: { owner },
    focus() { activeElement = this; },
  }));

  const focused = model.focusEmployeeButton(buttons, "UI");
  assert.equal(focused, buttons[4]);
  assert.equal(activeElement, buttons[4]);
  assert.equal(model.focusEmployeeButton(buttons, "missing"), null);

  const clickHandler = fragment.match(/button\.addEventListener\("click", \(event\) => \{([\s\S]*?)\n    \}\);/)?.[1];
  assert.ok(clickHandler, "employee buttons have a selection handler");
  assert.match(clickHandler, /state\.selectedEmployee = owner/);
  assert.ok(clickHandler.indexOf("render()") < clickHandler.indexOf("focusEmployeeButton"));
});

test("does not rerender when the host echoes the current semantic widget state", () => {
  const globalsHandler = fragment.match(/window\.addEventListener\?\.\("openai:set_globals", \(event\) => \{([\s\S]*?)\n  \}\);/)?.[1];
  assert.ok(globalsHandler, "the fragment handles host global state updates");

  const state = { selectedEmployee: "UI" };
  const statusSelect = { value: "전체 상태" };
  const projectSelect = { value: "전체 프로젝트" };
  let activeElement = { dataset: { owner: "UI" } };
  let renderCount = 0;
  const handler = new Function(
    "event", "model", "hasLiveModel", "pendingHostState", "userChangedState",
    "state", "statusSelect", "projectSelect", "render",
    globalsHandler,
  );

  handler(
    { detail: { globals: { widgetState: { selectedEmployee: "UI" } } } },
    model,
    true,
    null,
    false,
    state,
    statusSelect,
    projectSelect,
    () => { renderCount += 1; activeElement = null; },
  );

  assert.equal(renderCount, 0);
  assert.equal(activeElement.dataset.owner, "UI");
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
  const updated = createOfficeModel({results: [{owner: "신입"}]});
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

test("accepts seat drops only between distinct known employees while editing", () => {
  const guardSource = fragment.match(/function canDropSeat\(owner\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(guardSource, "seat drops have one validity check");
  const canDropSeat = new Function(
    "editingSeating", "draggingOwner", "model", "owner",
    guardSource + "\nreturn canDropSeat(owner);",
  );

  assert.equal(canDropSeat(true, "sb", model, "UI"), true);
  assert.equal(canDropSeat(false, "sb", model, "UI"), false);
  assert.equal(canDropSeat(true, null, model, "UI"), false);
  assert.equal(canDropSeat(true, "sb", model, "sb"), false);
  assert.equal(canDropSeat(true, "sb", model, "missing"), false);
});

test("valid seat drops swap and persist while invalid drops leave state alone", () => {
  const guardSource = fragment.match(/function canDropSeat\(owner\) \{[\s\S]*?\n  \}/)?.[0];
  const dropBody = fragment.match(/station\.addEventListener\("drop", \(event\) => \{([\s\S]*?)\n      \}\);/)?.[1];
  assert.ok(guardSource, "seat drops have one validity check");
  assert.ok(dropBody, "workstations handle seat drops");
  const runDrop = new Function(
    "owner", "event", "editingSeating", "draggingOwner", "model", "seatingOrder", "persistSeating", "render",
    guardSource + "\n(() => {\n" + dropBody + "\n})();\nreturn { draggingOwner, seatingOrder };",
  );

  const order = Array.from(model.employees);
  const saved = [];
  let prevented = false;
  let renders = 0;
  const result = runDrop(
    "UI",
    { preventDefault() { prevented = true; } },
    true,
    "sb",
    model,
    order,
    (message) => saved.push(message),
    () => { renders += 1; },
  );
  assert.equal(prevented, true);
  assert.equal(result.draggingOwner, null);
  assert.equal(result.seatingOrder[0], "UI");
  assert.equal(result.seatingOrder[4], "sb");
  assert.deepEqual(saved, ["sb와 UI의 자리를 바꿨습니다."]);
  assert.equal(renders, 1);

  for (const [editing, source, target] of [
    [true, null, "UI"],
    [true, "sb", "sb"],
    [true, "sb", "missing"],
    [false, "sb", "UI"],
  ]) {
    let didPrevent = false;
    let didPersist = false;
    let didRender = false;
    const unchanged = Array.from(model.employees);
    const ignored = runDrop(
      target,
      { preventDefault() { didPrevent = true; } },
      editing,
      source,
      model,
      unchanged,
      () => { didPersist = true; },
      () => { didRender = true; },
    );
    assert.equal(didPrevent, false);
    assert.equal(didPersist, false);
    assert.equal(didRender, false);
    assert.deepEqual(Array.from(ignored.seatingOrder), Array.from(model.employees));
  }
});

test("clears drag state and drop highlights when a drag ends", () => {
  const dragEndBody = fragment.match(/button\.addEventListener\("dragend", (?:\(event\)|\(\)) => \{([\s\S]*?)\n      \}\);/)?.[1];
  assert.ok(dragEndBody, "employee buttons clean up after dragging");
  const runDragEnd = new Function(
    "button", "employeeNode", "window", "draggingOwner", "suppressEmployeeClick",
    dragEndBody + "\nreturn { get draggingOwner() { return draggingOwner; }, get suppressEmployeeClick() { return suppressEmployeeClick; } };",
  );

  const removedButtonClasses = [];
  const removedStationClasses = [];
  const timeouts = [];
  const button = { classList: { remove: (name) => removedButtonClasses.push(name) } };
  const stations = [{ classList: { remove: (name) => removedStationClasses.push(name) } }];
  const result = runDragEnd(
    button,
    { querySelectorAll: () => stations },
    { setTimeout: (callback) => timeouts.push(callback) },
    "sb",
    true,
  );

  assert.equal(result.draggingOwner, null);
  assert.deepEqual(removedButtonClasses, ["is-dragging"]);
  assert.deepEqual(removedStationClasses, ["is-drop-target"]);
  assert.equal(timeouts.length, 1);
  timeouts[0]();
  assert.equal(result.suppressEmployeeClick, false);
});

test("does not select an employee for a click emitted after dragging", () => {
  const clickBody = fragment.match(/button\.addEventListener\("click", \(event\) => \{([\s\S]*?)\n    \}\);/)?.[1];
  assert.ok(clickBody, "employee selection handles clicks");
  const runClick = new Function(
    "event", "owner", "suppressEmployeeClick", "state",
    "(() => {\n" + clickBody + "\n})();\nreturn { suppressEmployeeClick, selectedEmployee: state.selectedEmployee };",
  );
  let prevented = false;
  let stopped = false;
  const state = { selectedEmployee: "UI" };
  const result = runClick({
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  }, "sb", true, state);

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(result.suppressEmployeeClick, false);
  assert.equal(state.selectedEmployee, "UI");
});

test("wires drag feedback in edit mode and keeps the select-based keyboard control", () => {
  const workstation = fragment.match(/function createWorkstation\(owner, filters\) \{[\s\S]*?\n  \}\n\n  function addFact/)?.[0];
  assert.ok(workstation, "workstations have a renderer");
  assert.match(workstation, /button\.draggable = editingSeating/);
  assert.match(workstation, /button\.addEventListener\("dragstart"/);
  assert.match(workstation, /station\.addEventListener\("dragover"/);
  assert.match(workstation, /station\.addEventListener\("dragleave"/);
  assert.match(workstation, /station\.addEventListener\("drop"/);
  assert.match(workstation, /button\.addEventListener\("dragend"/);
  assert.match(workstation, /select\.addEventListener\("change"/);
  assert.match(workstation, /model\.swapSeats\(seatingOrder, owner, target\)/);
});

test("keeps the embedded office drag behavior synchronized with its source", () => {
  const index = readFileSync(folder + "/index.html", "utf8");
  const rawSrcdoc = index.match(/\bdata-srcdoc="([\s\S]*?)"/)?.[1];
  assert.ok(rawSrcdoc, "index embeds the office document");
  const srcdoc = rawSrcdoc.replace(/&(?:quot|#x27|#39|lt|gt|amp);/g, (entity) => ({
    "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&",
  })[entity]);
  const sourceGuard = fragment.match(/function canDropSeat\(owner\) \{[\s\S]*?\n  \}/)?.[0];
  const embeddedGuard = srcdoc.match(/function canDropSeat\(owner\) \{[\s\S]*?\n  \}/)?.[0];
  const sourceWorkstation = fragment.match(/function createWorkstation\(owner, filters\) \{[\s\S]*?\n  \}\n\n  function addFact/)?.[0];
  const embeddedWorkstation = srcdoc.match(/function createWorkstation\(owner, filters\) \{[\s\S]*?\n  \}\n\n  function addFact/)?.[0];
  const sourcePersonArt = fragment.match(/function createPersonArt\(owner, count\) \{[\s\S]*?\n  \}/)?.[0];
  const embeddedPersonArt = srcdoc.match(/function createPersonArt\(owner, count\) \{[\s\S]*?\n  \}/)?.[0];
  const sourceStyle = fragment.match(/<style>[\s\S]*?<\/style>/)?.[0];
  const embeddedStyle = srcdoc.match(/<style>[\s\S]*?<\/style>/g)?.find((style) => style.includes("#wips-office-root {"));
  assert.ok(sourceGuard, "source defines seat drop validation");
  assert.equal(embeddedGuard, sourceGuard);
  assert.ok(sourceWorkstation, "source renders draggable workstations");
  assert.equal(embeddedWorkstation, sourceWorkstation);
  assert.ok(sourcePersonArt, "source renders employee art");
  assert.equal(embeddedPersonArt, sourcePersonArt);
  assert.ok(sourceStyle, "source defines office colors and motion");
  assert.equal(embeddedStyle, sourceStyle);
  assert.match(srcdoc, /\.employee-button\.is-dragging/);
  assert.match(srcdoc, /\.workstation\.is-drop-target/);
});

test("excludes completed tasks from employee and communal lists for every filter", () => {
  const active = createOfficeModel({ results: [
    {title: "open", owner: "sb", status: "진행"},
    {title: "done", owner: "sb", status: "완료"},
    {title: "unassigned open", owner: null, status: "예정"},
    {title: "unassigned done", owner: null, status: "완료"},
  ] });
  assert.deepEqual(Array.from(active.employeeTasks("sb", allFilters), t => t.title), ["open"]);
  assert.deepEqual(Array.from(active.unassignedTasks(allFilters), t => t.title), ["unassigned open"]);
  assert.equal(active.employeeTasks("sb", {...allFilters, status: "완료"}).length, 0);
  assert.equal(active.unassignedTasks({...allFilters, status: "완료"}).length, 0);
  assert.equal(active.viewForEmployee("sb", allFilters).topLevelCount, 1);
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
    view.scheduleTasks.map((item) => [item.stepLabel, item.title, item.dDayLabel, item.shortDate]),
    [
      ["STEP 01", "취약점 수정 리뷰", "수시", "일정 미지정"],
      ["STEP 02", "사전 검증 준비", "D-2", "11/20"],
      ["STEP 03", "사전 검증", "D-5", "11/23~11/27"],
      ["STEP 04", "QA 입고", "D-14", "12/02"],
    ],
  );
  assert.deepEqual(
    view.tickerTasks.map((item) => [item.owner, item.title, item.shortDate]),
    [
      ["sb", "후속모델 개발", "11/13~"],
      ["여이전트", "서버 취약점 대응", "11/11~11/12"],
    ],
  );
});
