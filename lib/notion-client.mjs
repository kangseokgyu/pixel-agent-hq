export const NOTION_VERSION = "2026-03-11";
export const NOTION_API_ROOT = "https://api.notion.com/v1";
export const MAX_RETRY_AFTER_MS = 10_000;
export const MAX_RETRIES = 2;
export const MAX_PAGES = 100;
export const REQUEST_TIMEOUT_MS = 10_000;

const TOKEN_INVALID_PATTERN = /[\s\u0000-\u001F\u007F]/;
const DATASOURCE_SAFE_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NotionApiError extends Error {
  constructor(message, { status = 502, code = "NOTION_API_ERROR", cooldownMs = 0, upstreamStatus = null } = {}) {
    super(message);
    this.name = "NotionApiError";
    this.status = status;
    this.code = code;
    this.cooldownMs = cooldownMs;
    this.upstreamStatus = upstreamStatus;
  }
}

function plainText(items) {
  if (!Array.isArray(items)) return null;
  const text = items.map((item) => {
    if (typeof item?.plain_text === "string") return item.plain_text;
    if (typeof item?.text?.content === "string") return item.text.content;
    return "";
  }).join("");
  return text || null;
}

function selectName(value) {
  return typeof value?.name === "string" && value.name.trim() ? value.name : null;
}

export function mapNotionPage(page) {
  const properties = page?.properties || {};
  const taskDate = properties["목표일"]?.date;
  return {
    url: typeof page?.url === "string" ? page.url : "",
    title: plainText(properties["일감"]?.title) || "제목 없음",
    parentTaskIds: (properties["상위 일감"]?.relation || []).map((parent) => parent.id),
    owner: selectName(properties["담당자"]?.select),
    status: selectName(properties["상태"]?.status) || "미지정",
    project: selectName(properties["프로젝트"]?.select),
    priority: selectName(properties["우선순위"]?.select),
    category: selectName(properties["구분"]?.select),
    nextAction: plainText(properties["다음 조치"]?.rich_text),
    doneCondition: plainText(properties["완료 조건"]?.rich_text),
    startDate: typeof taskDate?.start === "string" ? taskDate.start : null,
    endDate: typeof taskDate?.end === "string" ? taskDate.end : null,
    checkDate: typeof properties["다음 확인일"]?.date?.start === "string"
      ? properties["다음 확인일"].date.start
      : null,
  };
}

function todayInKorea(now) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now())).filter((part) => part.type !== "literal").map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, externalSignal, onResponse) {
  if (externalSignal?.aborted) {
    throw new NotionApiError("Notion API request was cancelled.", { code: "NOTION_ABORTED", status: 499 });
  }

  const controller = new AbortController();
  let timedOut = false;
  let cancelledExternally = false;
  const onExternalAbort = () => {
    cancelledExternally = true;
    controller.abort();
  };
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    onResponse?.(response);
    if (response.status === 429 || !response.ok) {
      try {
        await response.body?.cancel();
      } catch (error) {
        if (controller.signal.aborted) throw error;
      }
      return { response, payload: null };
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw error;
      throw new NotionApiError("Notion API returned an invalid JSON response.", { code: "NOTION_INVALID_RESPONSE" });
    }
    return { response, payload };
  } catch (error) {
    if (error instanceof NotionApiError) throw error;
    if (cancelledExternally || externalSignal?.aborted) {
      throw new NotionApiError("Notion API request was cancelled.", { code: "NOTION_ABORTED", status: 499 });
    }
    if (timedOut || controller.signal.aborted || error?.name === "AbortError") {
      throw new NotionApiError("Notion API request timed out.", { code: "NOTION_TIMEOUT", status: 504 });
    }
    throw new NotionApiError("Could not reach the Notion API.", { code: "NOTION_NETWORK_ERROR", status: 502 });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

async function queryNotionPage({
  token,
  dataSourceId,
  cursor,
  fetchImpl,
  timeoutMs,
  sleep,
  now,
  apiRoot,
  signal,
  onRateLimit,
}) {
  const url = `${apiRoot.replace(/\/$/, "")}/data_sources/${encodeURIComponent(dataSourceId)}/query`;
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  let retryCount = 0;

  while (true) {
    let receivedRetryDelay = null;
    const { response, payload } = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify(body),
    }, timeoutMs, signal, (receivedResponse) => {
      if (receivedResponse.status !== 429) return;
      const retryAfter = parseRetryAfter(receivedResponse.headers.get("retry-after"), now());
      receivedRetryDelay = retryAfter ?? Math.min(1000 * (2 ** retryCount), MAX_RETRY_AFTER_MS);
      onRateLimit?.(receivedRetryDelay);
    });
    if (response.status !== 429) return { response, payload };

    const retryDelay = receivedRetryDelay ?? Math.min(1000 * (2 ** retryCount), MAX_RETRY_AFTER_MS);
    if (retryDelay > MAX_RETRY_AFTER_MS || retryCount >= MAX_RETRIES) {
      throw new NotionApiError("Notion API rate limit reached.", {
        status: 429,
        code: "NOTION_RATE_LIMIT",
        cooldownMs: retryDelay,
        upstreamStatus: 429,
      });
    }
    await sleep(retryDelay);
    retryCount += 1;
  }
}

function validateToken(token) {
  if (!token) {
    throw new NotionApiError("NOTION_TOKEN is missing.", {
      code: "NOTION_TOKEN_MISSING",
      status: 503,
    });
  }
  if (typeof token !== "string" || TOKEN_INVALID_PATTERN.test(token)) {
    throw new NotionApiError("Notion token contains invalid whitespace or control characters.", {
      code: "NOTION_INVALID_TOKEN",
      status: 400,
    });
  }
}

function validateDataSourceId(dataSourceId, strictUuid) {
  if (typeof dataSourceId !== "string" || !dataSourceId.trim()) {
    throw new NotionApiError("Data source ID is required.", {
      code: "NOTION_INVALID_DATASOURCE",
      status: 400,
    });
  }
  const normalized = dataSourceId.trim();
  const valid = strictUuid
    ? UUID_PATTERN.test(normalized)
    : DATASOURCE_SAFE_PATTERN.test(normalized);
  if (!valid) {
    throw new NotionApiError("Data source ID format is invalid.", {
      code: "NOTION_INVALID_DATASOURCE",
      status: 400,
    });
  }
  return normalized;
}

export async function fetchNotionSnapshot({
  token,
  dataSourceId,
  sourceUrl = "",
  apiRoot = NOTION_API_ROOT,
  strictUuid = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  sleep = wait,
  now = Date.now,
  maxPages = MAX_PAGES,
  signal,
  onRateLimit,
} = {}) {
  validateToken(token);
  const safeDataSourceId = validateDataSourceId(dataSourceId, strictUuid);

  const results = [];
  let cursor;
  let pageCount = 0;
  while (true) {
    if (pageCount >= maxPages) {
      throw new NotionApiError(`Notion pagination exceeded the ${maxPages}-page safety limit.`, {
        code: "NOTION_PAGE_LIMIT",
        status: 502,
      });
    }
    const queryResult = await queryNotionPage({
      token,
      dataSourceId: safeDataSourceId,
      cursor,
      fetchImpl,
      timeoutMs,
      sleep,
      now,
      apiRoot,
      signal,
      onRateLimit,
    });
    const { response, payload } = queryResult;
    if (!response.ok) {
      throw new NotionApiError(`Notion API returned HTTP ${response.status}.`, {
        status: response.status === 429 ? 429 : 502,
        code: response.status === 429 ? "NOTION_RATE_LIMIT" : "NOTION_HTTP_ERROR",
        upstreamStatus: response.status,
      });
    }

    if (payload?.request_status?.type === "incomplete") {
      throw new NotionApiError("Notion query returned an incomplete result.", {
        code: "NOTION_INCOMPLETE_RESPONSE",
      });
    }
    if (!Array.isArray(payload.results)) {
      throw new NotionApiError("Notion API response did not contain a results list.", { code: "NOTION_INVALID_RESPONSE" });
    }
    results.push(...payload.results.map(mapNotionPage));
    pageCount += 1;
    if (!payload.has_more) break;
    if (typeof payload.next_cursor !== "string" || !payload.next_cursor) {
      throw new NotionApiError("Notion pagination response is missing next_cursor.", { code: "NOTION_INVALID_RESPONSE" });
    }
    cursor = payload.next_cursor;
  }

  return {
    snapshotDate: todayInKorea(now),
    timezone: "Asia/Seoul",
    sourceUrl,
    results,
    has_more: false,
    data_source_ids: [safeDataSourceId],
  };
}
