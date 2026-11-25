export const STATUS_ORDER = ["진행", "검증", "장시간 테스트 중", "대기", "예정", "완료"];
const STATUS_RANK = new Map(STATUS_ORDER.map((status, index) => [status, index]));
export const KANBAN_LANES = [
  { id: "planned", title: "예정 · 대기", dot: "대기", statuses: ["대기", "예정"] },
  { id: "progress", title: "진행", dot: "진행", statuses: ["진행"] },
  { id: "review", title: "검증 · 테스트", dot: "검증", statuses: ["검증", "장시간 테스트 중"] },
];
export const EMPLOYEES = ["sb", "이요원", "여이전트", "석규", "UI"];
export const SHARED_OWNER = "공통";
export const ACTIVE_TICKER_STATUSES = new Set(["진행", "검증", "장시간 테스트 중"]);
export const ALL_STATUS = "전체 상태";
export const ALL_PROJECTS = "전체 프로젝트";
export const UNSPECIFIED_PROJECT = "프로젝트 미지정";

export function isSharedOwner(owner) {
  return owner === null || owner === undefined || owner === "" || owner === SHARED_OWNER;
}

export function todayKstIso() {
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
  const statusOk = filters.status === ALL_STATUS || task.status === filters.status;
  const projectOk = filters.project === ALL_PROJECTS || projectLabel(task) === filters.project;
  return statusOk && projectOk;
}

export function safeNotionUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value);
    const allowedHost = parsed.hostname === "app.notion.com" || parsed.hostname === "notion.so" || parsed.hostname.endsWith(".notion.so");
    const hasNoCredentials = parsed.username === "" && parsed.password === "";
    const usesDefaultHttpsPort = parsed.port === "";
    return parsed.protocol === "https:" && allowedHost && hasNoCredentials && usesDefaultHttpsPort ? parsed.href : "";
  } catch {
    return "";
  }
}

export function toNotionAppUrl(value) {
  const safe = safeNotionUrl(value);
  return safe ? safe.replace(/^https:/, "notion:") : "";
}

function formatGoalDate(task) {
  if (task.startDate && task.endDate) return task.startDate + " — " + task.endDate;
  if (task.startDate) return task.startDate;
  if (task.endDate) return "~ " + task.endDate;
  return "미지정";
}

export function computeScheduleGauge(task, referenceDateIso) {
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

export function normalizeTaskId(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/-/g, "");
}

export function extractTaskId(task) {
  const direct = normalizeTaskId(task?.id);
  if (direct) return direct;
  if (typeof task?.url !== "string" || !task.url) return "";
  const pathOnly = task.url.split(/[?#]/)[0].replace(/\/+$/, "");
  const match = pathOnly.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? normalizeTaskId(match[1]) : "";
}

export function createOfficeModel(snapshot) {
  const tasks = Array.isArray(snapshot.results) ? snapshot.results.slice() : [];
  const statuses = STATUS_ORDER.concat([...new Set(tasks.map((task) => task.status).filter(Boolean))]
    .filter((status) => !STATUS_ORDER.includes(status)));
  const employees = EMPLOYEES.concat([...new Set(tasks.map((task) => task.owner).filter((owner) => owner && !isSharedOwner(owner)))]
    .filter((owner) => !EMPLOYEES.includes(owner)));
  const projects = ["2.3", "2.2.1", "기타"].concat([...new Set(tasks.map((task) => task.project).filter(Boolean))]
    .filter((project) => !["2.3", "2.2.1", "기타"].includes(project)));

  const allTasksById = new Map();
  for (const task of tasks) {
    const id = extractTaskId(task);
    if (id && !allTasksById.has(id)) {
      allTasksById.set(id, task);
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
      const childTask = allTasksById.get(normalizeTaskId(rawChildId));
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
