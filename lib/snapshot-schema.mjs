export const EMPTY_SNAPSHOT = Object.freeze({
  snapshotDate: "",
  timezone: "Asia/Seoul",
  sourceUrl: "",
  results: Object.freeze([]),
  has_more: false,
  data_source_ids: Object.freeze([]),
});

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_OR_WHITESPACE_PATTERN = /[\s\u0000-\u001F\u007F]/;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createEmptySnapshot() {
  return {
    snapshotDate: "",
    timezone: "Asia/Seoul",
    sourceUrl: "",
    results: [],
    has_more: false,
    data_source_ids: [],
  };
}

function isValidChecklistItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return typeof item.text === "string" && typeof item.done === "boolean";
}

function isValidTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return false;
  if (typeof task.title !== "string" || !task.title.trim()) return false;
  if (task.id !== undefined && typeof task.id !== "string") return false;
  if (task.owner !== undefined && task.owner !== null && typeof task.owner !== "string") return false;
  if (task.status !== undefined && task.status !== null && typeof task.status !== "string") return false;
  if (task.project !== undefined && task.project !== null && typeof task.project !== "string") return false;
  if (task.parentTaskIds !== undefined && !Array.isArray(task.parentTaskIds)) return false;
  if (task.subTaskIds !== undefined && (!Array.isArray(task.subTaskIds) || task.subTaskIds.some((id) => typeof id !== "string"))) {
    return false;
  }
  if (task.checklist !== undefined && (!Array.isArray(task.checklist) || !task.checklist.every(isValidChecklistItem))) {
    return false;
  }
  return true;
}

export function validateSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ok: false, error: "Snapshot must be a JSON object.", errors: ["Snapshot must be a JSON object."] };
  }
  if (typeof snapshot.snapshotDate !== "string" || (snapshot.snapshotDate !== "" && !DATE_PATTERN.test(snapshot.snapshotDate))) {
    errors.push("snapshotDate must be empty or YYYY-MM-DD.");
  }
  if (typeof snapshot.timezone !== "string" || !snapshot.timezone.trim()) {
    errors.push("timezone must be a non-empty string.");
  }
  if (snapshot.sourceUrl !== undefined && typeof snapshot.sourceUrl !== "string") {
    errors.push("sourceUrl must be a string.");
  }
  if (!Array.isArray(snapshot.results) || !snapshot.results.every(isValidTask)) {
    errors.push("results must be an array of valid task objects.");
  }
  if (snapshot.has_more !== undefined && typeof snapshot.has_more !== "boolean") {
    errors.push("has_more must be a boolean.");
  }
  if (snapshot.data_source_ids !== undefined && (!Array.isArray(snapshot.data_source_ids) || snapshot.data_source_ids.some((id) => typeof id !== "string"))) {
    errors.push("data_source_ids must be an array of strings.");
  }
  if (snapshot.lastSuccessAt !== undefined && snapshot.lastSuccessAt !== null && typeof snapshot.lastSuccessAt !== "string") {
    errors.push("lastSuccessAt must be an ISO string or null.");
  }

  if (errors.length > 0) {
    return { ok: false, error: errors[0], errors };
  }
  return { ok: true, value: snapshot };
}

export function isEmptySnapshot(snapshot) {
  const check = validateSnapshot(snapshot);
  if (!check.ok) return false;
  return (
    snapshot.results.length === 0 &&
    snapshot.snapshotDate === "" &&
    (snapshot.sourceUrl || "") === "" &&
    (!Array.isArray(snapshot.data_source_ids) || snapshot.data_source_ids.length === 0)
  );
}

export function detectRuntimeMode({ initialSnapshot, runtimeMode } = {}) {
  if (runtimeMode === "static") return "static";
  if (runtimeMode === "local") return "local";
  return isEmptySnapshot(initialSnapshot) ? "static" : "local";
}

export function validateConnectionConfig(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Connection configuration must be an object.", errors: ["Connection configuration must be an object."] };
  }

  const rawToken = typeof input.token === "string" ? input.token : "";
  if (!rawToken || CONTROL_OR_WHITESPACE_PATTERN.test(rawToken)) {
    errors.push("Notion token must not be empty or contain whitespace/control characters.");
  }

  const rawDataSourceId = typeof input.dataSourceId === "string" ? input.dataSourceId.trim() : "";
  if (!rawDataSourceId || CONTROL_PATTERN.test(rawDataSourceId) || !UUID_PATTERN.test(rawDataSourceId)) {
    errors.push("Data source ID must be a valid UUID (8-4-4-4-12).");
  }

  if (errors.length > 0) {
    return { ok: false, error: errors[0], errors };
  }

  return {
    ok: true,
    value: {
      token: rawToken,
      dataSourceId: rawDataSourceId.toLowerCase(),
    },
  };
}
