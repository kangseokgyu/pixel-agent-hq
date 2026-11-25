import {
  createEmptySnapshot,
  detectRuntimeMode,
  isEmptySnapshot,
  validateConnectionConfig,
} from "../lib/snapshot-schema.mjs";
import { createOpfsStore } from "../lib/opfs-store.mjs";
import { fetchNotionSnapshot } from "../lib/notion-client.mjs";
const STATUS_ORDER = ["진행", "검증", "장시간 테스트 중", "대기", "예정", "완료"];
const STATUS_RANK = new Map(STATUS_ORDER.map((status, index) => [status, index]));
const KANBAN_LANES = [
  { id: "planned", title: "예정 · 대기", dot: "대기", statuses: ["대기", "예정"] },
  { id: "progress", title: "진행", dot: "진행", statuses: ["진행"] },
  { id: "review", title: "검증 · 테스트", dot: "검증", statuses: ["검증", "장시간 테스트 중"] },
];
const EMPLOYEES = ["sb", "이요원", "여이전트", "석규", "UI"];
const SHARED_OWNER = "공통";
const ACTIVE_TICKER_STATUSES = new Set(["진행", "검증", "장시간 테스트 중"]);
const NOTION_ICON_PATHS = [
  { d: "M3.5 4.8L16.8 3.5L20 6.1L6.7 7.4L3.5 4.8Z", fill: "currentColor", "fill-opacity": "0.16" },
  { d: "M3.5 4.8L6.7 7.4V20.6L3.5 18V4.8Z", fill: "currentColor", "fill-opacity": "0.28" },
  { d: "M3.5 4.8L16.8 3.5L20 6.1V19.3L6.7 20.6L3.5 18V4.8Z", stroke: "currentColor", "stroke-width": "1.5", "stroke-linejoin": "round" },
  { d: "M3.5 4.8L6.7 7.4L20 6.1M6.7 7.4V20.6", stroke: "currentColor", "stroke-width": "1.5", "stroke-linejoin": "round" },
  { d: "M9.1 9.6L11.9 9.4L15.1 14V9.7L14.3 9.8V9L17.5 8.7V9.5L16.8 9.6V17L15.2 17.1L11.7 12.1V16.6L12.5 16.5V17.3L9.1 17.6V16.8L10 16.7V10.4L9.1 10.5V9.6Z", fill: "currentColor" },
];
const ALL_STATUS = "전체 상태";
const ALL_PROJECTS = "전체 프로젝트";
const UNSPECIFIED_PROJECT = "프로젝트 미지정";

function isSharedOwner(owner) {
  return owner === null || owner === undefined || owner === "" || owner === SHARED_OWNER;
}

function todayKstIso() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function parseIsoDayMs(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatMmDd(value) {
  if (typeof value !== "string") return "";
  const match = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? match[1] + "/" + match[2] : value;
}

function formatScheduleShort(task, includeTrailingTilde) {
  if (task.startDate && task.endDate) {
    return formatMmDd(task.startDate) + "~" + formatMmDd(task.endDate);
  }
  if (task.startDate) {
    return formatMmDd(task.startDate) + (includeTrailingTilde ? "~" : "");
  }
  if (task.endDate) return "~" + formatMmDd(task.endDate);
  return "일정 미지정";
}

function projectLabel(task) {
  return task.project === null || task.project === undefined ? UNSPECIFIED_PROJECT : task.project;
}

function matches(task, filters) {
  const statusMatches = filters.status === ALL_STATUS || task.status === filters.status;
  const projectMatches = filters.project === ALL_PROJECTS || projectLabel(task) === filters.project;
  return statusMatches && projectMatches;
}

function safeNotionUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    const notionHosts = ["app.notion.com", "notion.so", "www.notion.so"];
    return parsed.protocol === "https:" &&
      notionHosts.includes(parsed.hostname) &&
      parsed.host === parsed.hostname &&
      parsed.username === "" &&
      parsed.password === ""
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

function toNotionAppUrl(value) {
  const safeUrl = safeNotionUrl(value);
  return safeUrl ? safeUrl.replace(/^https:/, "notion:") : "";
}

function formatGoalDate(task) {
  if (task.startDate && task.endDate) return task.startDate + " — " + task.endDate;
  if (task.startDate) return task.startDate + " · 종료일 미지정";
  if (task.endDate) return "시작일 미지정 · " + task.endDate;
  return "미지정";
}

function computeScheduleGauge(task, referenceDateIso) {
  const todayIso = referenceDateIso || todayKstIso();
  const todayMs = parseIsoDayMs(todayIso);
  const targetIso = task?.startDate || task?.endDate || null;
  const targetMs = parseIsoDayMs(targetIso);
  let dDayLabel = ACTIVE_TICKER_STATUSES.has(task?.status) ? "수시" : "미정";
  let diffDays = null;
  if (todayMs !== null && targetMs !== null) {
    diffDays = Math.round((targetMs - todayMs) / 86_400_000);
    if (diffDays > 0) dDayLabel = "D-" + diffDays;
    else if (diffDays === 0) dDayLabel = "D-DAY";
    else dDayLabel = "D+" + Math.abs(diffDays);
  }

  let progress = 20;
  if (diffDays !== null) {
    if (diffDays <= 0) progress = 100;
    else if (diffDays >= 14) progress = 10;
    else progress = Math.round(100 - (diffDays / 14) * 90);
  }

  let tone = "slate";
  if (diffDays !== null) {
    if (diffDays >= 2) {
      tone = "green";
    } else if (diffDays === 1 || diffDays === 0) {
      tone = "amber";
    } else if (Boolean(task?.startDate) && ACTIVE_TICKER_STATUSES.has(task?.status)) {
      tone = "green";
    } else {
      tone = "red";
    }
  }

  return { dDayLabel, diffDays, progress, tone };
}

function normalizeTaskId(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/-/g, "");
}

function extractTaskId(task) {
  const direct = normalizeTaskId(task?.id);
  if (direct) return direct;
  if (typeof task?.url !== "string" || !task.url) return "";
  const pathOnly = task.url.split(/[?#]/)[0].replace(/\/+$/, "");
  const match = pathOnly.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? normalizeTaskId(match[1]) : "";
}

function createOfficeModel(snapshot) {
  const tasks = Array.isArray(snapshot.results) ? snapshot.results.slice() : [];
  const statuses = STATUS_ORDER.concat([...new Set(tasks.map((task) => task.status).filter(Boolean))]
    .filter((status) => !STATUS_ORDER.includes(status)));
  const employees = EMPLOYEES.concat([...new Set(tasks.map((task) => task.owner).filter((owner) => owner && !isSharedOwner(owner)))]
    .filter((owner) => !EMPLOYEES.includes(owner)));
  const projects = ["2.3", "2.2.1", "기타"].concat([...new Set(tasks.map((task) => task.project).filter(Boolean))]
    .filter((project) => !["2.3", "2.2.1", "기타"].includes(project)));

  // Index all tasks including completed ones so sub-task completion counts remain accurate.
  const tasksById = new Map();
  for (const task of tasks) {
    const id = extractTaskId(task);
    if (id && !tasksById.has(id)) {
      tasksById.set(id, task);
    }
  }

  const childrenByParentId = new Map();
  const seenChildrenByParent = new Map();
  function addChildLink(parentId, childTask) {
    if (!parentId || !childTask) return;
    const childId = extractTaskId(childTask);
    if (childId && childId === parentId) return;
    const childKey = childId || childTask;
    let seen = seenChildrenByParent.get(parentId);
    if (!seen) {
      seen = new Set();
      seenChildrenByParent.set(parentId, seen);
    }
    if (seen.has(childKey)) return;
    seen.add(childKey);
    let list = childrenByParentId.get(parentId);
    if (!list) {
      list = [];
      childrenByParentId.set(parentId, list);
    }
    list.push(childTask);
  }

  for (const task of tasks) {
    if (Array.isArray(task.parentTaskIds)) {
      for (const rawParentId of task.parentTaskIds) {
        addChildLink(normalizeTaskId(rawParentId), task);
      }
    }
  }
  for (const task of tasks) {
    const parentId = extractTaskId(task);
    if (!parentId || !Array.isArray(task.subTaskIds)) continue;
    for (const rawChildId of task.subTaskIds) {
      const childTask = tasksById.get(normalizeTaskId(rawChildId));
      if (childTask) addChildLink(parentId, childTask);
    }
  }

  function computeTaskProgress(task) {
    const rawChecklist = Array.isArray(task?.checklist) ? task.checklist : [];
    const checklistItems = rawChecklist
      .filter((item) => item && typeof item === "object" && typeof item.text === "string" && item.text.trim())
      .map((item) => ({ text: item.text.trim(), done: Boolean(item.done) }));
    const checklist = checklistItems.length > 0
      ? {
          done: checklistItems.filter((item) => item.done).length,
          total: checklistItems.length,
          items: checklistItems,
        }
      : null;

    const taskId = extractTaskId(task);
    const linkedChildren = taskId ? (childrenByParentId.get(taskId) || []) : [];
    const subtaskItems = linkedChildren.map((child) => ({
      id: extractTaskId(child) || child.title || "",
      title: child.title || "제목 없음",
      status: child.status || "미지정",
      owner: child.owner ?? null,
      done: child.status === "완료",
      sourceUrl: safeNotionUrl(child.url),
    }));
    const subtasks = subtaskItems.length > 0
      ? {
          done: subtaskItems.filter((item) => item.done).length,
          total: subtaskItems.length,
          items: subtaskItems,
        }
      : null;

    return { checklist, subtasks };
  }

  function describeTask(task, referenceDateIso) {
    const gauge = computeScheduleGauge(task, referenceDateIso);
    const progressDetail = computeTaskProgress(task);
    return {
      taskKey: task.id || task.url || task.title || "",
      title: task.title,
      status: task.status,
      project: projectLabel(task),
      priority: task.priority ?? "미지정",
      goalDate: formatGoalDate(task),
      nextCheck: task.checkDate ?? "미지정",
      nextAction: task.nextAction ?? "미지정",
      doneCondition: task.doneCondition ?? "미지정",
      sourceUrl: safeNotionUrl(task.url),
      dDayLabel: gauge.dDayLabel,
      progress: gauge.progress,
      tone: gauge.tone,
      checklist: progressDetail.checklist,
      subtasks: progressDetail.subtasks,
    };
  }

  function parseStateCandidate(candidate) {
    if (typeof candidate === "string") {
      try { return JSON.parse(candidate); } catch { return null; }
    }
    return candidate && typeof candidate === "object" ? candidate : null;
  }

  function stateFromHost(candidate) {
    const outer = parseStateCandidate(candidate);
    if (!outer) return null;
    const nested = parseStateCandidate(outer.privateContent) || parseStateCandidate(outer.modelContent);
    const saved = nested || outer;
    const selectedEmployee = employees.includes(saved.selectedEmployee) ? saved.selectedEmployee : "sb";
    const status = [ALL_STATUS].concat(statuses).includes(saved.status) ? saved.status : ALL_STATUS;
    const projectOptions = [ALL_PROJECTS, ...projects, UNSPECIFIED_PROJECT];
    const project = projectOptions.includes(saved.project) ? saved.project : ALL_PROJECTS;
    return { selectedEmployee, status, project };
  }

  function restorePendingState(candidate, currentState, userChangedState) {
    if (userChangedState) return currentState;
    return stateFromHost(candidate) || currentState;
  }

  function filteredTasks(filters) {
    return tasks.filter((task) => matches(task, filters));
  }

  function summary(filters) {
    const shown = filteredTasks(filters);
    const statusCounts = Object.fromEntries(statuses.map((status) => [
      status,
      shown.filter((task) => task.status === status).length,
    ]));
    return {
      total: shown.length,
      snapshotTotal: tasks.length,
      unassigned: shown.filter((task) => isSharedOwner(task.owner)).length,
      statuses: statusCounts,
    };
  }

  function employeeTasks(owner, filters) {
    return filteredTasks(filters).filter((task) => task.owner === owner && task.status !== "완료");
  }

  function unassignedTasks(filters) {
    return filteredTasks(filters).filter((task) => isSharedOwner(task.owner) && task.status !== "완료");
  }

  function billboardView(filters, referenceDateIso) {
    const todayIso = referenceDateIso || todayKstIso();
    const shared = unassignedTasks(filters);
    const scheduleTasks = shared
      .map((task, index) => ({
        task,
        index,
        targetIso: task.startDate || task.endDate || null,
        rank: STATUS_RANK.get(task.status) ?? STATUS_ORDER.length,
      }))
      .sort((left, right) => {
        const leftActiveUndated = !left.targetIso && ACTIVE_TICKER_STATUSES.has(left.task.status);
        const rightActiveUndated = !right.targetIso && ACTIVE_TICKER_STATUSES.has(right.task.status);
        if (leftActiveUndated !== rightActiveUndated) return leftActiveUndated ? -1 : 1;
        if (left.targetIso && right.targetIso && left.targetIso !== right.targetIso) {
          return left.targetIso.localeCompare(right.targetIso);
        }
        if (Boolean(left.targetIso) !== Boolean(right.targetIso)) return left.targetIso ? -1 : 1;
        return left.rank - right.rank || left.index - right.index;
      })
      .map(({ task }, idx) => {
        const gauge = computeScheduleGauge(task, todayIso);
        return {
          stepLabel: "STEP " + String(idx + 1).padStart(2, "0"),
          title: task.title,
          status: task.status || "미정",
          dDayLabel: gauge.dDayLabel,
          shortDate: formatScheduleShort(task, false),
          progress: gauge.progress,
          tone: gauge.tone,
          task,
        };
      });

    const tickerTasks = filteredTasks(filters)
      .filter((task) => !isSharedOwner(task.owner) && ACTIVE_TICKER_STATUSES.has(task.status))
      .map((task) => ({
        owner: task.owner,
        title: task.title,
        status: task.status,
        shortDate: formatScheduleShort(task, true),
        task,
      }));

    return {
      todayLabel: formatMmDd(todayIso),
      scheduleTasks,
      tickerTasks,
    };
  }

  function representativeTask(owner, filters) {
    const owned = employeeTasks(owner, filters).filter((task) => task.status !== "완료" && !task.parentTaskIds?.length);
    if (owned.length === 0) return null;
    return owned
      .map((task, index) => ({ task, index }))
      .sort((left, right) => {
        const leftRank = STATUS_RANK.get(left.task.status) ?? STATUS_ORDER.length;
        const rightRank = STATUS_RANK.get(right.task.status) ?? STATUS_ORDER.length;
        return leftRank - rightRank || left.index - right.index;
      })[0].task;
  }

  function viewForEmployee(owner, filters) {
    const owned = employeeTasks(owner, filters);
    const topLevelCount = owned.filter((task) => task.status !== "완료" && !task.parentTaskIds?.length).length;
    const representative = representativeTask(owner, filters);
    return {
      owner,
      tasks: owned,
      topLevelCount,
      representative,
      otherCount: representative ? topLevelCount - 1 : 0,
      empty: owned.length === 0,
    };
  }

  function normalizeSeating(saved) {
    const valid = Array.isArray(saved) ? saved.filter((owner) => employees.includes(owner)) : [];
    return [...new Set([...valid, ...employees])];
  }

  function swapSeats(saved, owner, target) {
    const order = normalizeSeating(saved);
    const from = order.indexOf(owner);
    const to = order.indexOf(target);
    if (from >= 0 && to >= 0) [order[from], order[to]] = [order[to], order[from]];
    return order;
  }

  function focusEmployeeButton(buttons, owner) {
    const button = buttons.find((candidate) => candidate.dataset.owner === owner);
    if (!button || typeof button.focus !== "function") return null;
    button.focus();
    return button;
  }

  function groupTasksByLane(tasks) {
    const byStatus = new Map();
    for (const lane of KANBAN_LANES) {
      for (const status of lane.statuses) byStatus.set(status, lane.id);
    }
    const buckets = new Map(KANBAN_LANES.map((lane) => [lane.id, []]));
    for (const task of Array.isArray(tasks) ? tasks : []) {
      const laneId = byStatus.get(task?.status) || KANBAN_LANES[0].id;
      buckets.get(laneId).push(task);
    }
    return KANBAN_LANES.map((lane) => ({
      id: lane.id,
      title: lane.title,
      dot: lane.dot,
      showExactStatus: lane.statuses.length > 1,
      tasks: buckets.get(lane.id),
    }));
  }

  return {
    employees,
    statuses,
    projects,
    kanbanLanes: KANBAN_LANES,
    groupTasksByLane,
    stateFromHost,
    restorePendingState,
    filteredTasks,
    summary,
    employeeTasks,
    unassignedTasks,
    representativeTask,
    viewForEmployee,
    focusEmployeeButton,
    normalizeSeating,
    swapSeats,
    describeTask,
    billboardView,
  };
}

window.__wipsOfficeModel = createOfficeModel;

const root = document.getElementById("wips-office-root");
if (!root) return;

const dataNode = document.getElementById("wips-office-data");
let snapshot = JSON.parse(dataNode.textContent);
let model = createOfficeModel(snapshot);
const statusSelect = document.getElementById("wips-office-status");
const projectSelect = document.getElementById("wips-office-project");
const refreshButton = document.getElementById("wips-office-refresh");
const syncStatus = document.getElementById("wips-office-sync-status");
const summaryNode = document.getElementById("wips-office-summary");
const countsNode = document.getElementById("wips-office-status-counts");
const employeeNode = document.getElementById("wips-office-employees");
const seatingEdit = document.getElementById("wips-office-edit-seating");
const seatingReset = document.getElementById("wips-office-reset-seating");
const seatingMessage = document.getElementById("wips-office-seating-message");
const seatingKey = "wips-office-seating-v1";
let editingSeating = false;
let draggingOwner = null;
let suppressEmployeeClick = false;
let savedSeating = [];
try { savedSeating = JSON.parse(window.localStorage.getItem(seatingKey)); } catch {}
let seatingOrder = model.normalizeSeating(savedSeating);

function persistSeating(message) {
  try {
    window.localStorage.setItem(seatingKey, JSON.stringify(seatingOrder));
    seatingMessage.textContent = message + " 이 브라우저에 저장했습니다.";
  } catch {
    seatingMessage.textContent = message + " 저장할 수 없어 현재 화면에만 적용됩니다.";
  }
}

function canDropSeat(owner) {
  return editingSeating && draggingOwner !== null && draggingOwner !== owner &&
    model.employees.includes(draggingOwner) && model.employees.includes(owner);
}

seatingEdit.addEventListener("click", () => {
  editingSeating = !editingSeating;
  seatingEdit.setAttribute("aria-pressed", String(editingSeating));
  seatingEdit.textContent = editingSeating ? "배치 완료" : "자리 배치";
  seatingReset.hidden = !editingSeating;
  seatingMessage.textContent = editingSeating
    ? "요원을 다른 자리로 끌거나 아래 선택 메뉴에서 고르면 두 요원의 자리를 서로 바꿉니다. 변경 즉시 저장됩니다."
    : "자리 배치는 이 브라우저에 저장됩니다.";
  render();
});
seatingReset.addEventListener("click", () => {
  seatingOrder = model.normalizeSeating([]);
  persistSeating("기본 배치로 되돌렸습니다.");
  render();
});
const selectedTitle = document.getElementById("wips-office-selected-title");
const selectedNote = document.getElementById("wips-office-selected-note");
const selectedEmpty = document.getElementById("wips-office-selected-empty");
const selectedTasksNode = document.getElementById("wips-office-selected-tasks");
const communalCount = document.getElementById("wips-office-communal-count");
const communalEmpty = document.getElementById("wips-office-communal-empty");
const communalTasksNode = document.getElementById("wips-office-communal-tasks");
const communalTitleNode = document.getElementById("wips-office-communal-title");
const billboardNode = document.getElementById("wips-office-billboard");
const sourceNode = document.getElementById("wips-office-source");
let pendingHostState = window.openai && window.openai.widgetState;
let hasLiveModel = false;
let userChangedState = false;
const initialState = model.stateFromHost(pendingHostState);
const state = initialState || {
  selectedEmployee: "sb",
  status: ALL_STATUS,
  project: ALL_PROJECTS,
};
const openProgressDrawers = new Set();
statusSelect.value = state.status;
projectSelect.value = state.project;

function setSafeHref(anchor, url) {
  const appUrl = toNotionAppUrl(url);
  if (appUrl) {
    anchor.href = appUrl;
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
  } else {
    anchor.removeAttribute("href");
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
  }
}

function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  parent.append(node);
  return node;
}

function createPersonArt(owner) {
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

function createWorkstation(owner, filters) {
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
  const STATUS_LABELS_EN = {
    진행: "RUNNING",
    검증: "TESTING",
    "장시간 테스트 중": "LONG TEST",
    대기: "WAITING",
    예정: "STANDBY",
    완료: "DONE",
  };
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

  const button = document.createElement("button");
  button.type = "button";
  button.className = "employee-button";
  button.dataset.owner = owner;
  button.setAttribute("aria-label", owner + "의 최상위 일감 " + view.topLevelCount + "개 보기");
  button.setAttribute("aria-pressed", String(state.selectedEmployee === owner));
  button.draggable = editingSeating;
  button.append(createPersonArt(owner));
  button.addEventListener("click", (event) => {
    if (suppressEmployeeClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressEmployeeClick = false;
      return;
    }
    userChangedState = true;
    state.selectedEmployee = owner;
    render();
    model.focusEmployeeButton(Array.from(employeeNode.querySelectorAll("button")), owner);
    saveState();
  });
  button.addEventListener("dragstart", (event) => {
    if (!editingSeating) {
      event.preventDefault();
      return;
    }
    draggingOwner = owner;
    suppressEmployeeClick = true;
    button.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", owner);
    }
  });

  station.append(bubble, button);
  if (editingSeating) {
    station.addEventListener("dragover", (event) => {
      if (!canDropSeat(owner)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      station.classList.add("is-drop-target");
    });
    station.addEventListener("dragleave", (event) => {
      if (station.contains(event.relatedTarget)) return;
      station.classList.remove("is-drop-target");
    });
    station.addEventListener("drop", (event) => {
      if (!canDropSeat(owner)) return;
      event.preventDefault();
      const source = draggingOwner;
      draggingOwner = null;
      seatingOrder = model.swapSeats(seatingOrder, source, owner);
      persistSeating(source + "와 " + owner + "의 자리를 바꿨습니다.");
      render();
    });
    button.addEventListener("dragend", () => {
      draggingOwner = null;
      button.classList.remove("is-dragging");
      employeeNode.querySelectorAll(".workstation.is-drop-target").forEach((target) => {
        target.classList.remove("is-drop-target");
      });
      window.setTimeout(() => { suppressEmployeeClick = false; }, 0);
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
      const target = select.value;
      seatingOrder = model.swapSeats(seatingOrder, owner, target);
      persistSeating(owner + "와 " + target + "의 자리를 바꿨습니다.");
      render();
      Array.from(employeeNode.querySelectorAll("select")).find((node) => node.dataset.seatOwner === owner)?.focus();
    });
    label.append(select);
    station.append(label);
  }
  return station;
}

function renderTaskList(container, tasks) {
  container.replaceChildren(...tasks.map((task) => createKanbanCard(task, true)));
}

function createSvgNode(tag, attrs) {
  const node = document.createElementNS
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function createTaskProgressBox(details) {
  if (!details.checklist && !details.subtasks) return null;

  const SEGMENT_LIMIT = 12;
  const box = document.createElement("details");
  box.className = "kanban-progress-box";
  if (openProgressDrawers.has(details.taskKey)) {
    box.open = true;
  }
  box.addEventListener("toggle", () => {
    if (box.open) openProgressDrawers.add(details.taskKey);
    else openProgressDrawers.delete(details.taskKey);
  });

  const summary = document.createElement("summary");
  summary.className = "kanban-progress-summary";
  const rows = document.createElement("div");
  rows.className = "kanban-progress-rows";

  function createBar(done, total) {
    const complete = total > 0 && done === total;
    if (total <= SEGMENT_LIMIT) {
      const segs = document.createElement("div");
      segs.className = "kanban-progress-segs";
      segs.setAttribute("aria-hidden", "true");
      for (let idx = 0; idx < total; idx += 1) {
        const seg = document.createElement("span");
        seg.className = idx < done
          ? (complete ? "kanban-progress-seg is-done-all" : "kanban-progress-seg is-filled")
          : "kanban-progress-seg";
        segs.append(seg);
      }
      return segs;
    }
    const track = document.createElement("div");
    track.className = "kanban-progress-track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = "kanban-progress-fill";
    if (complete) fill.dataset.complete = "true";
    if (fill.style) fill.style.width = Math.round((done / total) * 100) + "%";
    track.append(fill);
    return track;
  }

  function createRow(kind, labelText, iconNodes, done, total) {
    const row = document.createElement("div");
    row.className = "kanban-progress-row";
    row.dataset.kind = kind;

    const kindNode = document.createElement("span");
    kindNode.className = "kanban-progress-kind";
    const icon = createSvgNode("svg", {
      width: "13",
      height: "13",
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true",
    });
    icon.append(...iconNodes);
    kindNode.append(icon);
    addText(kindNode, "span", "", labelText);
    row.append(kindNode);

    row.append(createBar(done, total));

    const count = addText(row, "span", "kanban-progress-count", done + "/" + total);
    if (total > 0 && done === total) {
      count.dataset.complete = "true";
    }
    return row;
  }

  if (details.checklist) {
    rows.append(createRow(
      "checklist",
      "체크",
      [
        createSvgNode("rect", {
          x: "2",
          y: "2",
          width: "12",
          height: "12",
          rx: "3",
          stroke: "currentColor",
          "stroke-width": "1.4",
        }),
        createSvgNode("path", {
          d: "M5.2 8.2L7.1 10.1L11 6.1",
          stroke: "currentColor",
          "stroke-width": "1.5",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      ],
      details.checklist.done,
      details.checklist.total,
    ));
  }

  if (details.subtasks) {
    rows.append(createRow(
      "subtasks",
      "하위",
      [
        createSvgNode("circle", { cx: "4", cy: "3.5", r: "1.6", stroke: "currentColor", "stroke-width": "1.4" }),
        createSvgNode("circle", { cx: "11.5", cy: "7.5", r: "1.6", stroke: "currentColor", "stroke-width": "1.4" }),
        createSvgNode("circle", { cx: "11.5", cy: "12.5", r: "1.6", stroke: "currentColor", "stroke-width": "1.4" }),
        createSvgNode("path", {
          d: "M4 5.2V12.5H9.8M4 7.5H9.8",
          stroke: "currentColor",
          "stroke-width": "1.4",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      ],
      details.subtasks.done,
      details.subtasks.total,
    ));
  }

  const chevron = createSvgNode("svg", {
    class: "kanban-progress-chevron",
    width: "13",
    height: "13",
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": "true",
  });
  chevron.append(createSvgNode("path", {
    d: "M4 6L8 10L12 6",
    stroke: "currentColor",
    "stroke-width": "1.6",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }));

  summary.append(rows, chevron);
  box.append(summary);

  const drawer = document.createElement("div");
  drawer.className = "kanban-progress-drawer";

  if (details.checklist) {
    const group = document.createElement("div");
    group.className = "kanban-progress-group";
    group.dataset.group = "checklist";
    addText(
      group,
      "div",
      "kanban-progress-group-title",
      "체크리스트 (" + details.checklist.done + "/" + details.checklist.total + ")",
    );
    const list = document.createElement("ul");
    list.className = "kanban-progress-list";
    details.checklist.items.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.done ? "kanban-progress-item is-done" : "kanban-progress-item";
      li.dataset.done = String(item.done);
      const mark = document.createElement("span");
      mark.className = "kanban-check-mark";
      mark.setAttribute("aria-hidden", "true");
      const markSvg = createSvgNode("svg", {
        width: "13",
        height: "13",
        viewBox: "0 0 16 16",
        fill: "none",
        "aria-hidden": "true",
      });
      markSvg.append(createSvgNode("rect", {
        x: "2",
        y: "2",
        width: "12",
        height: "12",
        rx: "3",
        stroke: "currentColor",
        "stroke-width": "1.4",
      }));
      if (item.done) {
        markSvg.append(createSvgNode("path", {
          d: "M5.2 8.2L7.1 10.1L11 6.1",
          stroke: "currentColor",
          "stroke-width": "1.5",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }));
      }
      mark.append(markSvg);
      li.append(mark);
      addText(li, "span", "kanban-progress-item-text", item.text);
      list.append(li);
    });
    group.append(list);
    drawer.append(group);
  }

  if (details.subtasks) {
    const group = document.createElement("div");
    group.className = "kanban-progress-group";
    group.dataset.group = "subtasks";
    addText(
      group,
      "div",
      "kanban-progress-group-title",
      "하위 일감 (" + details.subtasks.done + "/" + details.subtasks.total + ")",
    );
    const list = document.createElement("ul");
    list.className = "kanban-progress-list";
    details.subtasks.items.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.done ? "kanban-progress-item is-done" : "kanban-progress-item";
      li.dataset.done = String(item.done);
      const dot = document.createElement("span");
      dot.className = "status-dot";
      dot.dataset.status = item.status;
      dot.setAttribute("aria-hidden", "true");
      li.append(dot);
      if (item.sourceUrl) {
        const link = document.createElement("a");
        link.className = "kanban-subtask-link";
        link.textContent = item.title;
        setSafeHref(link, item.sourceUrl);
        li.append(link);
      } else {
        addText(li, "span", "kanban-progress-item-text", item.title);
      }
      addText(li, "span", "kanban-subtask-status", item.status);
      list.append(li);
    });
    group.append(list);
    drawer.append(group);
  }

  box.append(drawer);
  return box;
}

function createKanbanCard(task, showExactStatus) {
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

  const progressBox = createTaskProgressBox(details);
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

function renderKanbanBoard(container, tasks) {
  const lanes = model.groupTasksByLane(tasks);
  container.replaceChildren(...lanes.map((lane) => {
    const col = document.createElement("section");
    col.className = "kanban-col";
    col.dataset.laneId = lane.id;

    const head = document.createElement("div");
    head.className = "kanban-col-head";
    const title = document.createElement("span");
    title.className = "kanban-col-title";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.dataset.status = lane.dot;
    dot.setAttribute("aria-hidden", "true");
    title.append(dot);
    addText(title, "span", "", lane.title);
    head.append(title);
    addText(head, "span", "kanban-col-count", String(lane.tasks.length));
    col.append(head);

    const cardsWrap = document.createElement("div");
    cardsWrap.className = "kanban-cards";
    if (lane.tasks.length === 0) {
      addText(cardsWrap, "div", "kanban-empty", "해당 일감 없음");
    } else {
      cardsWrap.append(...lane.tasks.map((task) => createKanbanCard(task, lane.showExactStatus)));
    }
    col.append(cardsWrap);
    return col;
  }));
}

function renderStatusCounts(summary) {
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

function createBillboardStep(item) {
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
}

function createTickerButton(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hq-ticker-item";
  button.title = "[" + item.owner + "] " + item.title + " (" + item.shortDate + ")";
  addText(button, "span", "hq-ticker-owner", "[" + item.owner + "]");
  addText(button, "span", "", item.title);
  addText(button, "span", "hq-ticker-date", "(" + item.shortDate + ")");
  button.addEventListener("click", () => {
    userChangedState = true;
    state.selectedEmployee = item.owner;
    render();
    model.focusEmployeeButton(Array.from(employeeNode.querySelectorAll("button")), item.owner);
    saveState();
  });
  return button;
}

function renderBillboard(filters) {
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
    upperNode.append(...view.scheduleTasks.slice(0, 4).map(createBillboardStep));
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
      track.append(createTickerButton(item));
    });
    viewport.append(track);
  }
  tickerBar.append(viewport);

  billboardNode.replaceChildren(head, upperNode, tickerBar);
}

function render() {
  const filters = { status: statusSelect.value, project: projectSelect.value };
  const summary = model.summary(filters);
  const view = model.viewForEmployee(state.selectedEmployee, filters);
  summaryNode.textContent = "현재 표시 " + summary.total + " / " + summary.snapshotTotal + "개 · 미배정 " + summary.unassigned + "개";
  renderStatusCounts(summary);
  renderBillboard(filters);
  seatingOrder = model.normalizeSeating(seatingOrder);
  employeeNode.replaceChildren(...seatingOrder.map((owner) => createWorkstation(owner, filters)));

  selectedTitle.textContent = state.selectedEmployee + "의 일감 · " + view.tasks.length + "개";
  selectedNote.textContent = view.empty ? "선택한 직원은 유지되며, 조건에 맞는 일감이 없습니다." : "대표 일감 외 " + view.otherCount + "개를 포함합니다.";
  selectedEmpty.hidden = !view.empty;
  selectedEmpty.textContent = "현재 필터에 맞는 " + state.selectedEmployee + "의 일감이 없습니다.";
  if (view.empty) {
    selectedTasksNode.replaceChildren();
  } else {
    renderKanbanBoard(selectedTasksNode, view.tasks);
  }

  const unassigned = model.unassignedTasks(filters);
  communalCount.textContent = unassigned.length + "개";
  communalEmpty.hidden = unassigned.length > 0;
  communalEmpty.textContent = "현재 조건에 맞는 미배정 일감이 없습니다.";
  renderTaskList(communalTasksNode, unassigned);
}

function setSelectOptions(select, values, selectedValue) {
  const options = [...new Set(values.concat(selectedValue ? [selectedValue] : []))];
  select.replaceChildren(...options.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  }));
  select.value = selectedValue;
}

function formatSuccessTime(value) {
  if (!value) return snapshot.snapshotDate || "스냅샷";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function setSyncStatus(message, stateName) {
  syncStatus.textContent = message;
  syncStatus.dataset.state = stateName;
}

const connectToggleButton = document.getElementById("wips-office-connect-toggle");
const logoutButton = document.getElementById("wips-office-logout");
const offlineBanner = document.getElementById("wips-office-offline-banner");
const connectionPanel = document.getElementById("wips-office-connection-panel");
const connectionForm = document.getElementById("wips-office-connection-form");
const tokenInput = document.getElementById("wips-office-token");
const dataSourceIdInput = document.getElementById("wips-office-datasource-id");
const connectSubmitButton = document.getElementById("wips-office-connect-submit");
const connectCancelButton = document.getElementById("wips-office-connect-cancel");
const connectionMessage = document.getElementById("wips-office-connection-message");
const mainView = document.getElementById("wips-office-main-view");

const IS_STATIC_MODE =
  detectRuntimeMode({ initialSnapshot: snapshot, runtimeMode: window.__WIPS_RUNTIME_MODE }) === "static";

let activeConnection = null;
let activeFetchController = null;
let pollTimerId = null;
let sessionEpoch = 0;
let isRefreshing = false;

function validateStaticConnection(input) {
  const check = validateConnectionConfig(input);
  if (check.ok) return check;
  const first = check.errors?.[0] || check.error || "";
  if (first.includes("token")) {
    return { ok: false, error: "Notion 토큰은 공백이나 제어 문자 없이 입력해야 합니다." };
  }
  return { ok: false, error: "데이터 소스 ID는 표준 UUID(8-4-4-4-12) 형식이어야 합니다." };
}

const opfsStore = createOpfsStore({
  getDirectory: typeof navigator !== "undefined" && typeof navigator?.storage?.getDirectory === "function"
    ? () => navigator.storage.getDirectory()
    : null,
});

function formatStaticNotionError(error) {
  if (error?.code === "NOTION_ABORTED") return error;
  if (error?.code === "NOTION_RATE_LIMIT") {
    return new Error("Notion 요청 한도(429)에 도달했습니다. 잠시 후 다시 시도하세요.");
  }
  if (error?.code === "NOTION_TIMEOUT") {
    return new Error("Notion 조회 요청 시간이 초과되었습니다.");
  }
  if (error?.code === "NOTION_NETWORK_ERROR") {
    return new Error("Notion API 또는 네트워크에 연결할 수 없습니다.");
  }
  if (error?.code === "NOTION_INCOMPLETE_RESPONSE") {
    return new Error("Notion 조회 결과가 불완전(incomplete)하여 기존 데이터를 유지합니다.");
  }
  if (error?.code === "NOTION_PAGE_LIMIT") {
    return new Error("Notion 페이지네이션 안전 한도(100)를 초과했습니다.");
  }
  if (error?.code === "NOTION_INVALID_RESPONSE") {
    return new Error("Notion API가 유효한 JSON 응답을 반환하지 않았습니다.");
  }
  if (error?.code === "NOTION_HTTP_ERROR") {
    const status = error.upstreamStatus;
    const msg = status === 401 || status === 403
      ? "인증 또는 권한 오류(HTTP " + status + "): Notion Integration의 Read content 권한과 단일 DB 연결, 토큰·데이터 소스 ID를 확인하세요."
      : "Notion 조회가 실패했습니다 (HTTP " + status + ").";
    const wrapped = new Error(msg);
    wrapped.upstreamStatus = status;
    return wrapped;
  }
  return error instanceof Error ? error : new Error(String(error || "Notion 조회에 실패했습니다."));
}

async function fetchNotionSnapshotStatic(connection, signal) {
  const valid = validateStaticConnection(connection);
  if (!valid.ok) throw new Error(valid.error);
  try {
    const snap = await fetchNotionSnapshot({
      token: valid.value.token,
      dataSourceId: valid.value.dataSourceId,
      strictUuid: true,
      signal,
      fetchImpl: typeof fetch === "function" ? fetch : globalThis.fetch,
    });
    return { ...snap, lastSuccessAt: new Date().toISOString() };
  } catch (error) {
    throw formatStaticNotionError(error);
  }
}

function setConnectionMessage(message, stateName) {
  if (!connectionMessage) return;
  connectionMessage.textContent = message;
  connectionMessage.dataset.state = stateName || "idle";
}

function setOfflineBanner(message) {
  if (!offlineBanner) return;
  if (message) {
    offlineBanner.textContent = message;
    offlineBanner.hidden = false;
  } else {
    offlineBanner.textContent = "";
    offlineBanner.hidden = true;
  }
}

function applySnapshot(nextSnapshot) {
  let selectedStatus = statusSelect.value;
  let selectedProject = projectSelect.value;
  snapshot = nextSnapshot;
  model = createOfficeModel(snapshot);
  if (!hasLiveModel) {
    const restored = model.restorePendingState(pendingHostState, {
      selectedEmployee: state.selectedEmployee,
      status: selectedStatus,
      project: selectedProject,
    }, userChangedState);
    state.selectedEmployee = restored.selectedEmployee;
    selectedStatus = restored.status;
    selectedProject = restored.project;
    pendingHostState = null;
    hasLiveModel = true;
  }
  dataNode.textContent = JSON.stringify(snapshot);
  setSelectOptions(statusSelect, [ALL_STATUS, ...model.statuses], selectedStatus);
  setSelectOptions(projectSelect, [ALL_PROJECTS, ...model.projects, UNSPECIFIED_PROJECT], selectedProject);
  if (snapshot.sourceUrl) {
    sourceNode.hidden = false;
    setSafeHref(sourceNode, snapshot.sourceUrl);
  } else {
    sourceNode.hidden = true;
    sourceNode.removeAttribute("href");
  }
  if (mainView) mainView.hidden = false;
  render();
}

function clearViewDom() {
  openProgressDrawers.clear();
  snapshot = createEmptySnapshot();
  model = createOfficeModel(snapshot);
  hasLiveModel = false;
  dataNode.textContent = JSON.stringify(snapshot);
  billboardNode?.replaceChildren();
  employeeNode.replaceChildren();
  selectedTasksNode.replaceChildren();
  communalTasksNode.replaceChildren();
  countsNode.replaceChildren();
  summaryNode.textContent = "";
  selectedTitle.textContent = "";
  selectedNote.textContent = "";
  selectedEmpty.hidden = true;
  selectedEmpty.textContent = "";
  communalCount.textContent = "";
  communalEmpty.hidden = true;
  communalEmpty.textContent = "";
  sourceNode.hidden = true;
  sourceNode.removeAttribute("href");
  if (mainView) mainView.hidden = true;
  setOfflineBanner("");
}

function stopStaticPolling() {
  if (pollTimerId !== null) {
    window.clearInterval(pollTimerId);
    pollTimerId = null;
  }
}

function startStaticPolling() {
  if (pollTimerId !== null) return;
  pollTimerId = window.setInterval(refreshData, 30_000);
}

async function refreshData() {
  if (isRefreshing || (IS_STATIC_MODE && !activeConnection)) return;
  isRefreshing = true;
  refreshButton.disabled = true;
  const requestEpoch = sessionEpoch;
  setSyncStatus("갱신 중…", "loading");
  let responseData = null;
  try {
    if (IS_STATIC_MODE) {
      activeFetchController?.abort();
      activeFetchController = new AbortController();
      const freshSnapshot = await fetchNotionSnapshotStatic(activeConnection, activeFetchController.signal);
      if (requestEpoch !== sessionEpoch) return;
      if (opfsStore.isSupported()) await opfsStore.saveSnapshot(freshSnapshot).catch(() => {});
      if (requestEpoch !== sessionEpoch) return;
      applySnapshot(freshSnapshot);
      setOfflineBanner("");
      setSyncStatus(formatSuccessTime(freshSnapshot.lastSuccessAt) + " 갱신", "success");
      return;
    }

    const response = await fetch("/api/tasks", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    responseData = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(responseData?.error || "Notion 데이터를 갱신하지 못했습니다.");
      error.responseData = responseData;
      throw error;
    }
    if (!responseData || !Array.isArray(responseData.results) || typeof responseData.snapshotDate !== "string") {
      throw new Error("서버가 유효한 Notion 스냅샷을 반환하지 않았습니다.");
    }

    applySnapshot(responseData);
    setSyncStatus(formatSuccessTime(snapshot.lastSuccessAt) + " 갱신", "success");
  } catch (error) {
    if (requestEpoch !== sessionEpoch || error?.code === "NOTION_ABORTED") return;
    const detail = error.responseData || responseData;
    const fallbackTime = IS_STATIC_MODE ? snapshot.lastSuccessAt : detail?.lastSuccessAt;
    const message = error.message || "서버에 연결할 수 없습니다. 연결 상태를 확인하세요.";
    if (IS_STATIC_MODE && navigator?.onLine === false && snapshot.results.length > 0) {
      setOfflineBanner("오프라인 상태입니다. 기기 OPFS에 저장된 마지막 조회 데이터를 표시합니다.");
    }
    setSyncStatus(message + (fallbackTime ? " · " + formatSuccessTime(fallbackTime) : ""), "error");
  } finally {
    isRefreshing = false;
    if (requestEpoch === sessionEpoch) {
      refreshButton.disabled = IS_STATIC_MODE && !activeConnection;
    }
  }
}

async function logoutSession() {
  sessionEpoch += 1;
  isRefreshing = false;
  activeFetchController?.abort();
  activeFetchController = null;
  stopStaticPolling();
  activeConnection = null;
  if (logoutButton) logoutButton.hidden = true;
  refreshButton.disabled = true;
  if (connectSubmitButton) connectSubmitButton.disabled = false;

  if (opfsStore.isSupported()) await opfsStore.clearAll().catch(() => {});
  if (typeof window.__wipsClearSwSession === "function") {
    await window.__wipsClearSwSession().catch(() => {});
  }
  try {
    if (typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("wips:logout"));
    }
  } catch {}
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "wips:logout" }, window.location.origin);
    }
  } catch {}

  clearViewDom();
  if (tokenInput) tokenInput.value = "";
  if (dataSourceIdInput) dataSourceIdInput.value = "";
  if (connectionPanel) connectionPanel.hidden = false;
  if (connectCancelButton) connectCancelButton.hidden = true;
  const msg = "로그아웃되었습니다. 이 기기에서 토큰·연결 정보와 업무 데이터를 삭제했습니다.";
  setConnectionMessage(msg, "info");
  setSyncStatus("로그아웃됨", "idle");
}

function saveState() {
  try {
    if (!window.openai || typeof window.openai.setWidgetState !== "function") return;
    const pending = window.openai.setWidgetState({
      modelContent: { selectedEmployee: state.selectedEmployee },
      privateContent: {
        selectedEmployee: state.selectedEmployee,
        status: statusSelect.value,
        project: projectSelect.value,
      },
    });
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {}
}

statusSelect.addEventListener("change", () => {
  userChangedState = true;
  state.status = statusSelect.value;
  render();
  saveState();
});
projectSelect.addEventListener("change", () => {
  userChangedState = true;
  state.project = projectSelect.value;
  render();
  saveState();
});
window.addEventListener?.("openai:set_globals", (event) => {
  const widgetState = event.detail && event.detail.globals && event.detail.globals.widgetState;
  if (!hasLiveModel) {
    pendingHostState = widgetState;
    if (userChangedState) return;
  }
  const incoming = model.stateFromHost(widgetState);
  if (!incoming) return;
  if (
    incoming.selectedEmployee === state.selectedEmployee &&
    incoming.status === statusSelect.value &&
    incoming.project === projectSelect.value
  ) return;
  state.selectedEmployee = incoming.selectedEmployee;
  statusSelect.value = incoming.status;
  projectSelect.value = incoming.project;
  render();
});

async function initStaticMode() {
  const startEpoch = sessionEpoch;
  clearViewDom();
  if (connectToggleButton) connectToggleButton.hidden = false;
  if (logoutButton) logoutButton.hidden = true;
  refreshButton.disabled = true;
  if (connectionPanel) connectionPanel.hidden = false;
  if (connectCancelButton) connectCancelButton.hidden = true;

  if (!opfsStore.isSupported()) {
    setConnectionMessage(
      "이 브라우저는 OPFS 격리 저장소를 지원하지 않습니다. 연결 정보는 현재 탭 세션 메모리에만 유지되며 새로고침 시 삭제됩니다.",
      "info",
    );
    setSyncStatus("연결 필요 (OPFS 미지원)", "idle");
    return;
  }

  let savedConnection = null;
  let savedSnapshot = null;
  try {
    savedConnection = await opfsStore.loadConnection();
    savedSnapshot = await opfsStore.loadSnapshot();
  } catch {
    savedConnection = null;
    savedSnapshot = null;
  }
  if (startEpoch !== sessionEpoch) return;

  if (!savedConnection) {
    if (opfsStore.isSupported()) await opfsStore.clearAll().catch(() => {});
    setSyncStatus("연결 필요", "idle");
    return;
  }

  activeConnection = savedConnection;
  if (dataSourceIdInput) dataSourceIdInput.value = savedConnection.dataSourceId;
  if (logoutButton) logoutButton.hidden = false;
  refreshButton.disabled = false;
  if (connectionPanel) connectionPanel.hidden = true;

  if (savedSnapshot && !isEmptySnapshot(savedSnapshot)) {
    applySnapshot(savedSnapshot);
    if (navigator?.onLine === false) {
      setOfflineBanner("오프라인 상태입니다. 기기 OPFS에 저장된 마지막 조회 데이터를 표시합니다.");
      setSyncStatus("오프라인 · " + formatSuccessTime(savedSnapshot.lastSuccessAt), "error");
      startStaticPolling();
      return;
    }
  }

  await refreshData();
  if (startEpoch === sessionEpoch && activeConnection) {
    startStaticPolling();
  }
}

refreshButton.addEventListener("click", refreshData);
connectToggleButton?.addEventListener("click", () => {
  if (!connectionPanel) return;
  connectionPanel.hidden = !connectionPanel.hidden;
  if (connectCancelButton) connectCancelButton.hidden = !activeConnection;
  if (!connectionPanel.hidden && activeConnection) {
    if (dataSourceIdInput) dataSourceIdInput.value = activeConnection.dataSourceId;
  }
});
connectCancelButton?.addEventListener("click", () => {
  if (connectionPanel && activeConnection) {
    connectionPanel.hidden = true;
  }
});
logoutButton?.addEventListener("click", () => {
  void logoutSession();
});
connectionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const validation = validateStaticConnection({
    token: tokenInput?.value || "",
    dataSourceId: dataSourceIdInput?.value || "",
  });
  if (!validation.ok) {
    setConnectionMessage(validation.error, "error");
    return;
  }

  const submitEpoch = sessionEpoch;
  if (connectSubmitButton) connectSubmitButton.disabled = true;
  setConnectionMessage("Notion 연결 확인 및 데이터 조회 중…", "loading");
  setSyncStatus("연결 확인 중…", "loading");
  try {
    activeFetchController?.abort();
    activeFetchController = new AbortController();
    const freshSnapshot = await fetchNotionSnapshotStatic(validation.value, activeFetchController.signal);
    if (submitEpoch !== sessionEpoch) return;

    if (opfsStore.isSupported()) {
      await opfsStore.saveConnection(validation.value);
      await opfsStore.saveSnapshot(freshSnapshot);
    }
    if (submitEpoch !== sessionEpoch) return;

    activeConnection = validation.value;
    if (tokenInput) tokenInput.value = "";
    if (connectionPanel) connectionPanel.hidden = true;
    if (logoutButton) logoutButton.hidden = false;
    refreshButton.disabled = false;
    applySnapshot(freshSnapshot);
    setOfflineBanner("");
    setConnectionMessage("연결이 저장되었습니다. OPFS에 격리 보관됩니다.", "info");
    setSyncStatus(formatSuccessTime(freshSnapshot.lastSuccessAt) + " 갱신", "success");
    startStaticPolling();
  } catch (error) {
    if (submitEpoch !== sessionEpoch || error?.code === "NOTION_ABORTED") return;
    const msg = error?.message || "Notion 연결에 실패했습니다.";
    setConnectionMessage(msg, "error");
    setSyncStatus(msg, "error");
  } finally {
    if (connectSubmitButton && submitEpoch === sessionEpoch) {
      connectSubmitButton.disabled = false;
    }
  }
});

if (IS_STATIC_MODE) {
  window.addEventListener?.("offline", () => {
    if (activeConnection && snapshot.results.length > 0) {
      setOfflineBanner("오프라인 상태입니다. 기기 OPFS에 저장된 마지막 조회 데이터를 표시합니다.");
    }
  });
  window.addEventListener?.("online", () => {
    if (activeConnection) {
      setOfflineBanner("");
      void refreshData();
    }
  });
  void initStaticMode();
} else {
  setSafeHref(sourceNode, snapshot.sourceUrl);
  render();
  setSyncStatus("동기화 중…", "loading");
  refreshData();
  window.setInterval(refreshData, 30_000);
}
