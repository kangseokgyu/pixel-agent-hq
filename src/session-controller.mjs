import {
  createEmptySnapshot,
  detectRuntimeMode,
  isEmptySnapshot,
  validateConnectionConfig,
} from "../lib/snapshot-schema.mjs";
import { createOpfsStore } from "../lib/opfs-store.mjs";
import { fetchNotionSnapshot } from "../lib/notion-client.mjs";

export function validateStaticConnection(input) {
  const check = validateConnectionConfig(input);
  if (check.ok) return check;
  const first = check.errors?.[0] || check.error || "";
  if (first.includes("token")) {
    return { ok: false, error: "Notion 토큰은 공백이나 제어 문자 없이 입력해야 합니다." };
  }
  return { ok: false, error: "데이터 소스 ID는 표준 UUID(8-4-4-4-12) 형식이어야 합니다." };
}

export function formatStaticNotionError(error) {
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

export function resolveLogoutTargetOrigin(windowObj) {
  const locOrigin = windowObj?.location?.origin;
  if (typeof locOrigin === "string" && locOrigin && locOrigin !== "null") {
    return locOrigin;
  }
  const winOrigin = windowObj?.origin;
  if (typeof winOrigin === "string" && winOrigin && winOrigin !== "null") {
    return winOrigin;
  }
  return null;
}

export function createSessionController({
  initialSnapshot,
  explicitMode,
  windowObj = globalThis.window,
  navigatorObj = globalThis.navigator,
  fetchImpl,
  opfsStore,
  hooks,
}) {
  const staticMode = detectRuntimeMode({ initialSnapshot, runtimeMode: explicitMode }) === "static";
  const store = opfsStore || createOpfsStore({
    getDirectory: typeof navigatorObj !== "undefined" && typeof navigatorObj?.storage?.getDirectory === "function"
      ? () => navigatorObj.storage.getDirectory()
      : null,
  });

  let modeState = staticMode ? "unconnected" : "local";
  let activeConnection = null;
  let activeFetchController = null;
  let pollTimerId = null;
  let sessionEpoch = 0;
  let isRefreshing = false;
  let hasCachedData = !staticMode && Array.isArray(initialSnapshot?.results) && initialSnapshot.results.length > 0;

  function resolveFetch() {
    if (typeof fetchImpl === "function") return fetchImpl;
    if (typeof fetch === "function") return fetch;
    return globalThis.fetch;
  }

  async function queryStaticNotion(connection, signal) {
    const valid = validateStaticConnection(connection);
    if (!valid.ok) throw new Error(valid.error);
    try {
      const snap = await fetchNotionSnapshot({
        token: valid.value.token,
        dataSourceId: valid.value.dataSourceId,
        strictUuid: true,
        signal,
        fetchImpl: resolveFetch(),
      });
      return { ...snap, lastSuccessAt: new Date().toISOString() };
    } catch (error) {
      throw formatStaticNotionError(error);
    }
  }

  function stopPolling() {
    if (pollTimerId !== null) {
      windowObj?.clearInterval?.(pollTimerId);
      pollTimerId = null;
    }
  }

  function startPolling() {
    if (pollTimerId !== null) return;
    pollTimerId = windowObj?.setInterval?.(refresh, 30_000) ?? null;
  }

  async function refresh() {
    if (isRefreshing || (staticMode && !activeConnection)) return;
    isRefreshing = true;
    hooks.setRefreshDisabled(true);
    const requestEpoch = sessionEpoch;
    hooks.setSyncStatus("갱신 중…", "loading");
    let responseData = null;

    try {
      if (staticMode) {
        activeFetchController?.abort();
        activeFetchController = new AbortController();
        const freshSnapshot = await queryStaticNotion(activeConnection, activeFetchController.signal);
        if (requestEpoch !== sessionEpoch) return;
        if (store.isSupported()) await store.saveSnapshot(freshSnapshot).catch(() => {});
        if (requestEpoch !== sessionEpoch) return;
        hasCachedData = freshSnapshot.results.length > 0;
        modeState = "connected";
        hooks.onSnapshot(freshSnapshot);
        hooks.setOfflineBanner("");
        hooks.setSyncStatus(hooks.formatTime(freshSnapshot.lastSuccessAt) + " 갱신", "success");
        return;
      }

      const response = await resolveFetch()("/api/tasks", {
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

      hasCachedData = responseData.results.length > 0;
      hooks.onSnapshot(responseData);
      hooks.setSyncStatus(hooks.formatTime(responseData.lastSuccessAt) + " 갱신", "success");
    } catch (error) {
      if (requestEpoch !== sessionEpoch || error?.code === "NOTION_ABORTED") return;
      const detail = error.responseData || responseData;
      const fallbackTime = staticMode ? hooks.getLastSuccessAt() : detail?.lastSuccessAt;
      const message = error.message || "서버에 연결할 수 없습니다. 연결 상태를 확인하세요.";
      if (staticMode && navigatorObj?.onLine === false && hasCachedData) {
        modeState = "offline-cached";
        hooks.setOfflineBanner("오프라인 상태입니다. 기기 OPFS에 저장된 마지막 조회 데이터를 표시합니다.");
      }
      hooks.setSyncStatus(message + (fallbackTime ? " · " + hooks.formatTime(fallbackTime) : ""), "error");
    } finally {
      isRefreshing = false;
      if (requestEpoch === sessionEpoch) {
        hooks.setRefreshDisabled(staticMode && !activeConnection);
      }
    }
  }

  async function connect(credentials) {
    const validation = validateStaticConnection(credentials);
    if (!validation.ok) {
      hooks.setConnectionMessage(validation.error, "error");
      return { ok: false, error: validation.error };
    }

    const submitEpoch = sessionEpoch;
    modeState = "connecting";
    hooks.setConnectSubmitDisabled(true);
    hooks.setConnectionMessage("Notion 연결 확인 및 데이터 조회 중…", "loading");
    hooks.setSyncStatus("연결 확인 중…", "loading");

    try {
      activeFetchController?.abort();
      activeFetchController = new AbortController();
      const freshSnapshot = await queryStaticNotion(validation.value, activeFetchController.signal);
      if (submitEpoch !== sessionEpoch) return { ok: false, aborted: true };

      if (store.isSupported()) {
        await store.saveConnection(validation.value);
        await store.saveSnapshot(freshSnapshot);
      }
      if (submitEpoch !== sessionEpoch) return { ok: false, aborted: true };

      activeConnection = validation.value;
      hasCachedData = freshSnapshot.results.length > 0;
      modeState = "connected";
      hooks.onConnected(validation.value, freshSnapshot);
      hooks.setOfflineBanner("");
      hooks.setConnectionMessage("연결이 저장되었습니다. OPFS에 격리 보관됩니다.", "info");
      hooks.setSyncStatus(hooks.formatTime(freshSnapshot.lastSuccessAt) + " 갱신", "success");
      startPolling();
      return { ok: true, snapshot: freshSnapshot };
    } catch (error) {
      if (submitEpoch !== sessionEpoch || error?.code === "NOTION_ABORTED") {
        return { ok: false, aborted: true };
      }
      modeState = activeConnection ? "connected" : "unconnected";
      const msg = error?.message || "Notion 연결에 실패했습니다.";
      hooks.setConnectionMessage(msg, "error");
      hooks.setSyncStatus(msg, "error");
      return { ok: false, error: msg };
    } finally {
      if (submitEpoch === sessionEpoch) {
        hooks.setConnectSubmitDisabled(false);
      }
    }
  }

  async function logout() {
    sessionEpoch += 1;
    isRefreshing = false;
    activeFetchController?.abort();
    activeFetchController = null;
    stopPolling();
    activeConnection = null;
    hasCachedData = false;
    modeState = "unconnected";

    hooks.onBeforeLogoutClear();

    if (store.isSupported()) await store.clearAll().catch(() => {});
    if (typeof windowObj?.__wipsClearSwSession === "function") {
      await windowObj.__wipsClearSwSession().catch(() => {});
    }
    try {
      if (typeof CustomEvent === "function") {
        windowObj?.dispatchEvent?.(new CustomEvent("wips:logout"));
      }
    } catch {}
    try {
      if (windowObj?.parent && windowObj.parent !== windowObj) {
        const targetOrigin = resolveLogoutTargetOrigin(windowObj);
        if (targetOrigin) {
          windowObj.parent.postMessage({ type: "wips:logout" }, targetOrigin);
        }
        if (typeof windowObj.parent.__wipsClearSwSession === "function") {
          await windowObj.parent.__wipsClearSwSession().catch(() => {});
        }
      }
    } catch {}

    hooks.onLoggedOut(createEmptySnapshot());
    hooks.setConnectionMessage("로그아웃되었습니다. 이 기기에서 토큰·연결 정보와 업무 데이터를 삭제했습니다.", "info");
    hooks.setSyncStatus("로그아웃됨", "idle");
  }

  async function initStatic() {
    const startEpoch = sessionEpoch;
    hooks.onResetEmpty(createEmptySnapshot());
    hooks.setStaticUnconnectedControls();

    if (!store.isSupported()) {
      hooks.setConnectionMessage(
        "이 브라우저는 OPFS 격리 저장소를 지원하지 않습니다. 연결 정보는 현재 탭 세션 메모리에만 유지되며 새로고침 시 삭제됩니다.",
        "info",
      );
      hooks.setSyncStatus("연결 필요 (OPFS 미지원)", "idle");
      return;
    }

    let savedConnection = null;
    try {
      savedConnection = await store.loadConnection();
    } catch {
      savedConnection = null;
    }
    let savedSnapshot = null;
    try {
      savedSnapshot = await store.loadSnapshot();
    } catch {
      savedSnapshot = null;
    }
    if (startEpoch !== sessionEpoch) return;

    if (!savedConnection) {
      if (store.isSupported()) await store.clearAll().catch(() => {});
      modeState = "unconnected";
      hooks.setSyncStatus("연결 필요", "idle");
      return;
    }

    activeConnection = savedConnection;
    hooks.onRestoredConnection(savedConnection);

    if (savedSnapshot && !isEmptySnapshot(savedSnapshot)) {
      hasCachedData = savedSnapshot.results.length > 0;
      hooks.onSnapshot(savedSnapshot);
      if (navigatorObj?.onLine === false) {
        modeState = "offline-cached";
        hooks.setOfflineBanner("오프라인 상태입니다. 기기 OPFS에 저장된 마지막 조회 데이터를 표시합니다.");
        hooks.setSyncStatus("오프라인 · " + hooks.formatTime(savedSnapshot.lastSuccessAt), "error");
        startPolling();
        return;
      }
    }

    modeState = "connected";
    await refresh();
    if (startEpoch === sessionEpoch && activeConnection) {
      startPolling();
    }
  }

  function handleOffline() {
    if (staticMode && activeConnection && hasCachedData) {
      modeState = "offline-cached";
      hooks.setOfflineBanner("오프라인 상태입니다. 기기 OPFS에 저장된 마지막 조회 데이터를 표시합니다.");
    }
  }

  function handleOnline() {
    if (staticMode && activeConnection) {
      hooks.setOfflineBanner("");
      void refresh();
    }
  }

  return {
    isStaticMode: () => staticMode,
    getModeState: () => modeState,
    getActiveConnection: () => activeConnection,
    initStatic,
    connect,
    refresh,
    logout,
    handleOffline,
    handleOnline,
    startPolling,
    stopPolling,
  };
}
