import { createSeatingStore } from "./seating-store.mjs";
import {
  ALL_PROJECTS,
  ALL_STATUS,
  UNSPECIFIED_PROJECT,
  createOfficeModel,
} from "./office-model.mjs";
import {
  renderOfficeView,
  setSafeHref,
} from "./office-renderer.mjs";
import { createSessionController } from "./session-controller.mjs";

window.__wipsOfficeModel = createOfficeModel;

const byId = (id) => document.getElementById("wips-office-" + id);
const root = byId("root");
if (!root) return;

const dataNode = byId("data");
let snapshot = JSON.parse(dataNode.textContent);
let model = createOfficeModel(snapshot);
const statusSelect = byId("status");
const projectSelect = byId("project");
const refreshButton = byId("refresh");
const syncStatus = byId("sync-status");
const summaryNode = byId("summary");
const countsNode = byId("status-counts");
const employeeNode = byId("employees");
const seatingEdit = byId("edit-seating");
const seatingReset = byId("reset-seating");
const seatingMessage = byId("seating-message");
const selectedTitle = byId("selected-title");
const selectedNote = byId("selected-note");
const selectedEmpty = byId("selected-empty");
const selectedTasksNode = byId("selected-tasks");
const communalCount = byId("communal-count");
const communalEmpty = byId("communal-empty");
const communalTasksNode = byId("communal-tasks");
const communalTitleNode = byId("communal-title");
const billboardNode = byId("billboard");
const sourceNode = byId("source");
const connectToggleButton = byId("connect-toggle");
const logoutButton = byId("logout");
const offlineBanner = byId("offline-banner");
const connectionPanel = byId("connection-panel");
const connectionForm = byId("connection-form");
const tokenInput = byId("token");
const dataSourceIdInput = byId("datasource-id");
const connectSubmitButton = byId("connect-submit");
const connectCancelButton = byId("connect-cancel");
const connectionMessage = byId("connection-message");
const mainView = byId("main-view");

const seatingStore = createSeatingStore({
  normalizeSeating: (saved) => model.normalizeSeating(saved),
  swapSeats: (order, owner, target) => model.swapSeats(order, owner, target),
  onMessage: (text) => {
    seatingMessage.textContent = text;
  },
});

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

function selectEmployee(owner) {
  userChangedState = true;
  state.selectedEmployee = owner;
  render();
  model.focusEmployeeButton(Array.from(employeeNode.querySelectorAll("button")), owner);
  saveState();
}

function render() {
  renderOfficeView({
    model,
    filters: { status: statusSelect.value, project: projectSelect.value },
    selectedEmployee: state.selectedEmployee,
    seatingStore,
    openProgressDrawers,
    nodes: {
      summaryNode,
      countsNode,
      billboardNode,
      employeeNode,
      selectedTitle,
      selectedNote,
      selectedEmpty,
      selectedTasksNode,
      communalTitleNode,
      communalCount,
      communalEmpty,
      communalTasksNode,
    },
    onSelectEmployee: selectEmployee,
    onRender: render,
  });
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

function setSyncStatus(message, stateName) {
  syncStatus.textContent = message;
  syncStatus.dataset.state = stateName;
}

function formatSuccessTime(value, fallbackDate) {
  if (!value) return fallbackDate || "스냅샷";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

function clearViewDom(emptySnapshot) {
  openProgressDrawers.clear();
  snapshot = emptySnapshot;
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

const sessionController = createSessionController({
  initialSnapshot: snapshot,
  explicitMode: window.__WIPS_RUNTIME_MODE,
  windowObj: window,
  navigatorObj: navigator,
  hooks: {
    formatTime: (value) => formatSuccessTime(value, snapshot.snapshotDate),
    getLastSuccessAt: () => snapshot.lastSuccessAt,
    setRefreshDisabled: (disabled) => {
      refreshButton.disabled = disabled;
    },
    setConnectSubmitDisabled: (disabled) => {
      if (connectSubmitButton) connectSubmitButton.disabled = disabled;
    },
    setSyncStatus,
    setConnectionMessage,
    setOfflineBanner,
    onSnapshot: applySnapshot,
    onResetEmpty: clearViewDom,
    setStaticUnconnectedControls: () => {
      if (connectToggleButton) connectToggleButton.hidden = false;
      if (logoutButton) logoutButton.hidden = true;
      refreshButton.disabled = true;
      if (connectionPanel) connectionPanel.hidden = false;
      if (connectCancelButton) connectCancelButton.hidden = true;
    },
    onRestoredConnection: (savedConnection) => {
      if (dataSourceIdInput) dataSourceIdInput.value = savedConnection.dataSourceId;
      if (logoutButton) logoutButton.hidden = false;
      refreshButton.disabled = false;
      if (connectionPanel) connectionPanel.hidden = true;
    },
    onConnected: (_connection, freshSnapshot) => {
      if (tokenInput) tokenInput.value = "";
      if (connectionPanel) connectionPanel.hidden = true;
      if (logoutButton) logoutButton.hidden = false;
      refreshButton.disabled = false;
      applySnapshot(freshSnapshot);
    },
    onBeforeLogoutClear: () => {
      if (logoutButton) logoutButton.hidden = true;
      refreshButton.disabled = true;
      if (connectSubmitButton) connectSubmitButton.disabled = false;
    },
    onLoggedOut: (emptySnapshot) => {
      clearViewDom(emptySnapshot);
      if (tokenInput) tokenInput.value = "";
      if (dataSourceIdInput) dataSourceIdInput.value = "";
      if (connectionPanel) connectionPanel.hidden = false;
      if (connectCancelButton) connectCancelButton.hidden = true;
    },
  },
});

seatingEdit.addEventListener("click", () => {
  const editing = seatingStore.toggleEdit();
  seatingEdit.setAttribute("aria-pressed", String(editing));
  seatingEdit.textContent = editing ? "배치 완료" : "자리 배치";
  seatingReset.hidden = !editing;
  seatingMessage.textContent = editing
    ? "요원을 다른 자리로 끌거나 아래 선택 메뉴에서 고르면 두 요원의 자리를 서로 바꿉니다. 변경 즉시 저장됩니다."
    : "자리 배치는 이 브라우저에 저장됩니다.";
  render();
});
seatingReset.addEventListener("click", () => {
  seatingStore.reset();
  render();
});

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

refreshButton.addEventListener("click", () => {
  void sessionController.refresh();
});
connectToggleButton?.addEventListener("click", () => {
  if (!connectionPanel) return;
  connectionPanel.hidden = !connectionPanel.hidden;
  const activeConnection = sessionController.getActiveConnection();
  if (connectCancelButton) connectCancelButton.hidden = !activeConnection;
  if (!connectionPanel.hidden && activeConnection && dataSourceIdInput) {
    dataSourceIdInput.value = activeConnection.dataSourceId;
  }
});
connectCancelButton?.addEventListener("click", () => {
  if (connectionPanel && sessionController.getActiveConnection()) {
    connectionPanel.hidden = true;
  }
});
logoutButton?.addEventListener("click", () => {
  void sessionController.logout();
});
connectionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sessionController.connect({
    token: tokenInput?.value || "",
    dataSourceId: dataSourceIdInput?.value || "",
  });
});

if (sessionController.isStaticMode()) {
  window.addEventListener?.("offline", () => sessionController.handleOffline());
  window.addEventListener?.("online", () => sessionController.handleOnline());
  void sessionController.initStatic();
} else {
  setSafeHref(sourceNode, snapshot.sourceUrl);
  render();
  setSyncStatus("동기화 중…", "loading");
  void sessionController.refresh();
  window.setInterval(() => {
    void sessionController.refresh();
  }, 30_000);
}
