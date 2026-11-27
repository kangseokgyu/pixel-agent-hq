import { ACTIVE_TICKER_STATUSES, ALL_PROJECTS, toNotionAppUrl } from "./office-model.mjs";
import { addText, createSvgNode, createTaskProgressBox, setSafeHref as setAnchorSafeHref } from "./progress-drawer.mjs";

export const NOTION_ICON_PATHS = [
  { d: "M3.5 4.8L16.8 3.5L20 6.1L6.7 7.4L3.5 4.8Z", fill: "currentColor", "fill-opacity": "0.16" },
  { d: "M3.5 4.8L6.7 7.4V20.6L3.5 18V4.8Z", fill: "currentColor", "fill-opacity": "0.28" },
  { d: "M3.5 4.8L16.8 3.5L20 6.1V19.3L6.7 20.6L3.5 18V4.8Z", stroke: "currentColor", "stroke-width": "1.5", "stroke-linejoin": "round" },
  { d: "M3.5 4.8L6.7 7.4L20 6.1M6.7 7.4V20.6", stroke: "currentColor", "stroke-width": "1.5", "stroke-linejoin": "round" },
  { d: "M9.1 9.6L11.9 9.4L15.1 14V9.7L14.3 9.8V9L17.5 8.7V9.5L16.8 9.6V17L15.2 17.1L11.7 12.1V16.6L12.5 16.5V17.3L9.1 17.6V16.8L10 16.7V10.4L9.1 10.5V9.6Z", fill: "currentColor" },
];

const STATUS_LABELS_EN = {
  진행: "RUNNING",
  검증: "TESTING",
  "장시간 테스트 중": "LONG TEST",
  대기: "WAITING",
  예정: "STANDBY",
  완료: "DONE",
};

export function setSafeHref(anchor, url) {
  return setAnchorSafeHref(anchor, url, toNotionAppUrl);
}

export function createPersonArt(owner) {
  const art = document.createElement("span");
  art.className = "person-art";
  art.dataset.employee = owner;
  art.dataset.agentStyle = owner === "석규" || owner === "UI" ? "cyber" : "suit";
  let motionPhase = 0;
  for (const character of owner) motionPhase = (motionPhase * 31 + character.codePointAt(0)) % 5;
  art.dataset.motionPhase = String(motionPhase);
  art.setAttribute("aria-hidden", "true");
  return art;
}

export function createKanbanCard(model, task, showExactStatus, openProgressDrawers) {
  const details = model.describeTask(task);
  const card = document.createElement("article");
  card.className = "kanban-card";
  card.dataset.taskTitle = details.title;

  const top = document.createElement("div");
  top.className = "kanban-card-top";
  const badge = document.createElement("span");
  badge.className = "kanban-badge";
  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.dataset.status = details.status;
  dot.setAttribute("aria-hidden", "true");
  badge.append(dot);
  addText(badge, "span", "", showExactStatus ? details.status + " · " + details.project : details.project);
  top.append(badge);

  const tags = document.createElement("div");
  tags.className = "kanban-card-tags";
  if (details.priority && details.priority !== "미지정") {
    addText(tags, "span", "kanban-priority", details.priority);
  }
  const dday = addText(tags, "span", "kanban-dday", details.dDayLabel);
  dday.dataset.tone = details.tone;
  if (details.sourceUrl) {
    const link = document.createElement("a");
    link.className = "task-source";
    link.setAttribute("aria-label", "Notion에서 보기");
    link.setAttribute("title", "Notion에서 보기");
    setSafeHref(link, details.sourceUrl);
    const svg = createSvgNode("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
    });
    svg.append(...NOTION_ICON_PATHS.map((attrs) => createSvgNode("path", attrs)));
    link.append(svg);
    tags.append(link);
  }
  top.append(tags);
  card.append(top);

  addText(card, "h3", "", details.title);

  const metaParts = ["일정 " + details.goalDate];
  if (details.nextCheck && details.nextCheck !== "미지정") {
    metaParts.push("확인 " + details.nextCheck);
  }
  const meta = document.createElement("div");
  meta.className = "kanban-meta";
  addText(meta, "span", "", metaParts.join(" · "));
  const pct = addText(meta, "span", "kanban-progress-pct", details.progress + "%");
  pct.dataset.tone = details.tone;
  card.append(meta);

  const bar = document.createElement("div");
  bar.className = "kanban-bar";
  const fill = document.createElement("span");
  fill.className = "kanban-bar-fill";
  fill.dataset.tone = details.tone;
  if (fill.style) fill.style.width = details.progress + "%";
  bar.append(fill);
  card.append(bar);

  if (details.nextAction && details.nextAction !== "미지정") {
    const next = document.createElement("div");
    next.className = "kanban-next";
    addText(next, "span", "kanban-next-label", "다음");
    addText(next, "span", "", details.nextAction);
    card.append(next);
  }

  const progressBox = createTaskProgressBox(details, openProgressDrawers, toNotionAppUrl);
  if (progressBox) card.append(progressBox);

  if (details.doneCondition && details.doneCondition !== "미지정") {
    const cond = document.createElement("details");
    cond.className = "kanban-details";
    addText(cond, "summary", "", "완료 조건 보기");
    addText(cond, "p", "", details.doneCondition);
    card.append(cond);
  }

  return card;
}

export function renderKanbanBoard(model, container, tasks, openProgressDrawers) {
  const lanes = model.groupTasksByLane(tasks);
  container.replaceChildren(...lanes.map((lane) => {
    const col = document.createElement("section");
    col.className = "kanban-col";
    col.dataset.laneId = lane.id;

    const head = document.createElement("header");
    head.className = "kanban-col-head";
    const titleWrap = document.createElement("span");
    titleWrap.className = "kanban-col-title";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.dataset.status = lane.dot;
    dot.setAttribute("aria-hidden", "true");
    titleWrap.append(dot);
    addText(titleWrap, "span", "", lane.title);
    head.append(titleWrap);
    addText(head, "span", "kanban-col-count tabular-nums", lane.tasks.length);
    col.append(head);

    const body = document.createElement("div");
    body.className = "kanban-col-body";
    if (lane.tasks.length === 0) {
      addText(body, "p", "kanban-empty", "해당 일감 없음");
    } else {
      body.append(...lane.tasks.map((task) => createKanbanCard(model, task, lane.showExactStatus, openProgressDrawers)));
    }
    col.append(body);
    return col;
  }));
}

export function renderTaskList(model, container, tasks, openProgressDrawers) {
  container.replaceChildren(...tasks.map((task) => createKanbanCard(model, task, true, openProgressDrawers)));
}

export function renderStatusCounts(model, countsNode, summary) {
  countsNode.replaceChildren();
  model.statuses.forEach((status) => {
    const item = document.createElement("span");
    item.className = "status-count";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.dataset.status = status;
    dot.setAttribute("aria-hidden", "true");
    item.append(dot);
    addText(item, "span", "", status);
    addText(item, "strong", "tabular-nums", summary.statuses[status]);
    countsNode.append(item);
  });
}

function createWorkstation(ctx, owner) {
  const {
    filters,
    model,
    selectedEmployee,
    seatingOrder,
    seatingStore,
    employeeNode,
    onSelectEmployee,
    onRender,
  } = ctx;
  const view = model.viewForEmployee(owner, filters);
  const station = document.createElement("article");
  station.className = "workstation";
  const isWorking = Boolean(view.representative && ACTIVE_TICKER_STATUSES.has(view.representative.status));
  station.dataset.activity = isWorking ? "working" : "idle";
  station.dataset.status = view.representative ? view.representative.status : "idle";

  const bubble = document.createElement("div");
  bubble.className = "speech-bubble";
  bubble.title = view.representative
    ? view.representative.status + " · " + view.representative.title + " (" + view.topLevelCount + "건)"
    : "할당된 활성 일감 없음";

  const rawStatus = view.representative ? view.representative.status : null;
  const statusEn = rawStatus ? (STATUS_LABELS_EN[rawStatus] || rawStatus) : "IDLE";
  const taskCount = view.topLevelCount || 0;
  const taskCountLabel = taskCount + (taskCount === 1 ? " TASK" : " TASKS");
  const hudStatusText = view.representative ? statusEn + " · " + taskCountLabel : "IDLE · 0 TASKS";
  const hudHeader = document.createElement("div");
  hudHeader.className = "hud-header";
  addText(hudHeader, "span", "hud-tag", "[" + owner + "]");
  addText(hudHeader, "span", "hud-state", hudStatusText);
  bubble.append(hudHeader);
  const hudMeter = document.createElement("div");
  hudMeter.className = "hud-meter";
  const hudMeterFill = document.createElement("span");
  hudMeterFill.className = "hud-meter-fill";
  hudMeter.append(hudMeterFill);
  bubble.append(hudMeter);

  const editingSeating = seatingStore.isEditing();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "employee-button";
  button.dataset.owner = owner;
  button.setAttribute("aria-label", owner + "의 최상위 일감 " + view.topLevelCount + "개 보기");
  button.setAttribute("aria-pressed", String(selectedEmployee === owner));
  button.draggable = editingSeating;
  button.append(createPersonArt(owner));
  button.addEventListener("click", (event) => {
    if (seatingStore.consumeClickSuppression()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onSelectEmployee(owner);
  });
  button.addEventListener("dragstart", (event) => {
    if (!seatingStore.isEditing()) {
      event.preventDefault();
      return;
    }
    seatingStore.startDrag(owner);
    button.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", owner);
    }
  });

  station.append(bubble, button);
  if (editingSeating) {
    station.addEventListener("dragover", (event) => {
      if (!seatingStore.canDrop(owner, model.employees)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      station.classList.add("is-drop-target");
    });
    station.addEventListener("dragleave", (event) => {
      if (station.contains(event.relatedTarget)) return;
      station.classList.remove("is-drop-target");
    });
    station.addEventListener("drop", (event) => {
      if (!seatingStore.canDrop(owner, model.employees)) return;
      event.preventDefault();
      seatingStore.dropOn(owner);
      onRender();
    });
    button.addEventListener("dragend", () => {
      seatingStore.endDrag();
      button.classList.remove("is-dragging");
      employeeNode.querySelectorAll(".workstation.is-drop-target").forEach((target) => {
        target.classList.remove("is-drop-target");
      });
      window.setTimeout(() => seatingStore.clearClickSuppression(), 0);
    });
    const label = document.createElement("label");
    label.className = "seat-control";
    addText(label, "span", "", (seatingOrder.indexOf(owner) + 1) + "번 자리 · " + owner);
    const select = document.createElement("select");
    select.className = "form-select";
    select.dataset.seatOwner = owner;
    select.setAttribute("aria-label", owner + " 이동할 자리");
    seatingOrder.forEach((occupant, index) => {
      const option = document.createElement("option");
      option.value = occupant;
      option.textContent = (index + 1) + "번 · " + occupant + (occupant === owner ? " (현재)" : "와 교환");
      select.append(option);
    });
    select.value = owner;
    select.addEventListener("change", () => {
      seatingStore.swapWith(owner, select.value);
      onRender();
      Array.from(employeeNode.querySelectorAll("select")).find((node) => node.dataset.seatOwner === owner)?.focus();
    });
    label.append(select);
    station.append(label);
  }
  return station;
}

export function renderBillboard(model, filters, nodes, onSelectEmployee) {
  const { billboardNode, communalTasksNode, communalTitleNode } = nodes;
  if (!billboardNode) return;
  const view = model.billboardView(filters);
  const head = document.createElement("div");
  head.className = "hq-billboard-head";
  const titleWrap = document.createElement("span");
  titleWrap.className = "hq-billboard-title";
  const dot = document.createElement("span");
  dot.className = "hq-billboard-dot";
  dot.setAttribute("aria-hidden", "true");
  titleWrap.append(dot);
  const projectSuffix = filters.project !== ALL_PROJECTS ? " · " + filters.project : "";
  addText(titleWrap, "span", "", "SHARED SCHEDULE" + projectSuffix);
  head.append(titleWrap);
  addText(
    head,
    "span",
    "hq-billboard-meta",
    "TODAY " + view.todayLabel + " · 공통 " + view.scheduleTasks.length + " · 진행 " + view.tickerTasks.length,
  );

  let upperNode;
  if (view.scheduleTasks.length === 0) {
    upperNode = document.createElement("div");
    upperNode.className = "hq-billboard-empty";
    upperNode.textContent = "표시할 공통 일정이 없습니다.";
  } else {
    upperNode = document.createElement("div");
    upperNode.className = "hq-stepper";
    upperNode.append(...view.scheduleTasks.slice(0, 4).map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hq-step-card";
      button.dataset.tone = item.tone;
      button.title = item.title + " (" + item.shortDate + ")";

      const labelRow = document.createElement("div");
      labelRow.className = "hq-step-label";
      addText(labelRow, "span", "", item.stepLabel);
      addText(labelRow, "span", "", item.status);
      button.append(labelRow);

      addText(button, "div", "hq-step-title", item.title);

      const bar = document.createElement("div");
      bar.className = "hq-step-bar";
      const fill = document.createElement("span");
      fill.className = "hq-step-bar-fill";
      if (fill.style) fill.style.width = item.progress + "%";
      bar.append(fill);
      button.append(bar);

      const foot = document.createElement("div");
      foot.className = "hq-step-foot";
      addText(foot, "span", "hq-step-dday", item.dDayLabel);
      addText(foot, "span", "hq-step-date", item.shortDate);
      button.append(foot);

      button.addEventListener("click", () => {
        const cards = Array.from(communalTasksNode.querySelectorAll(".kanban-card"));
        cards.forEach((card) => card.classList.remove("is-billboard-highlight"));
        const match = cards.find((card) => card.dataset.taskTitle === item.title);
        if (match) {
          match.classList.add("is-billboard-highlight");
          match.scrollIntoView?.({ behavior: "smooth", block: "center" });
        } else {
          communalTitleNode?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        }
      });
      return button;
    }));
  }

  const tickerBar = document.createElement("div");
  tickerBar.className = "hq-ticker-bar";
  addText(tickerBar, "span", "hq-ticker-badge", "LIVE");
  const viewport = document.createElement("div");
  viewport.className = "hq-ticker-viewport";
  if (view.tickerTasks.length === 0) {
    addText(viewport, "span", "hq-ticker-empty", "진행 중인 요원 일감이 없습니다.");
  } else {
    const track = document.createElement("div");
    track.className = "hq-ticker-track";
    const sequence = view.tickerTasks.concat(view.tickerTasks);
    sequence.forEach((item, index) => {
      if (index > 0) addText(track, "span", "hq-ticker-sep", "·");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hq-ticker-item";
      button.title = "[" + item.owner + "] " + item.title + " (" + item.shortDate + ")";
      addText(button, "span", "hq-ticker-owner", "[" + item.owner + "]");
      addText(button, "span", "", item.title);
      addText(button, "span", "hq-ticker-date", "(" + item.shortDate + ")");
      button.addEventListener("click", () => onSelectEmployee(item.owner));
      track.append(button);
    });
    viewport.append(track);
  }
  tickerBar.append(viewport);

  billboardNode.replaceChildren(head, upperNode, tickerBar);
}

export function renderOfficeView(ctx) {
  const { model, filters, selectedEmployee, seatingStore, openProgressDrawers, nodes, onSelectEmployee, onRender } = ctx;
  const summary = model.summary(filters);
  const view = model.viewForEmployee(selectedEmployee, filters);
  nodes.summaryNode.textContent = "현재 표시 " + summary.total + " / " + summary.snapshotTotal + "개 · 미배정 " + summary.unassigned + "개";
  renderStatusCounts(model, nodes.countsNode, summary);
  renderBillboard(model, filters, nodes, onSelectEmployee);

  const seatingOrder = seatingStore.syncEmployees(model.employees);
  const wsCtx = {
    filters,
    model,
    selectedEmployee,
    seatingOrder,
    seatingStore,
    employeeNode: nodes.employeeNode,
    onSelectEmployee,
    onRender,
  };
  nodes.employeeNode.replaceChildren(...seatingOrder.map((owner) => createWorkstation(wsCtx, owner)));

  nodes.selectedTitle.textContent = selectedEmployee + "의 일감 · " + view.tasks.length + "개";
  nodes.selectedNote.textContent = view.empty
    ? "선택한 직원은 유지되며, 조건에 맞는 일감이 없습니다."
    : filters.status === "완료"
      ? "완료된 일감 " + view.tasks.length + "개를 표시합니다."
      : "대표 일감 외 " + view.otherCount + "개를 포함합니다.";
  nodes.selectedEmpty.hidden = !view.empty;
  nodes.selectedEmpty.textContent = "현재 필터에 맞는 " + selectedEmployee + "의 일감이 없습니다.";
  if (view.empty) {
    nodes.selectedTasksNode.replaceChildren();
  } else {
    renderKanbanBoard(model, nodes.selectedTasksNode, view.tasks, openProgressDrawers);
  }

  const unassigned = model.unassignedTasks(filters);
  nodes.communalCount.textContent = unassigned.length + "개";
  nodes.communalEmpty.hidden = unassigned.length > 0;
  nodes.communalEmpty.textContent = "현재 조건에 맞는 미배정 일감이 없습니다.";
  renderTaskList(model, nodes.communalTasksNode, unassigned, openProgressDrawers);
}
