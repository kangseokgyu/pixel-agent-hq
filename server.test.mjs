import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

import {
  DATA_SOURCE_ID,
  MAX_RETRY_AFTER_MS,
  NOTION_VERSION,
  SOURCE_URL,
  createWipsServer,
  fetchNotionSnapshot,
  mapNotionPage,
} from "./server.mjs";

const projectDir = fileURLToPath(new URL(".", import.meta.url));
const snapshot = JSON.parse(readFileSync(new URL("./wips-data.json", import.meta.url), "utf8"));

function property(name, value) {
  return { [name]: value };
}

function makePage({
  id = "0123456789abcdef0123456789abcdef",
  title = "테스트 일감",
  owner = "새 담당자",
  status = "새 상태",
  project = "새 프로젝트",
} = {}) {
  return {
    id,
    url: `https://app.notion.com/${id}`,
    properties: {
      일감: property("title", [{ plain_text: title }]),
      담당자: property("select", owner ? { name: owner } : null),
      상태: property("status", status ? { name: status } : null),
      프로젝트: property("select", project ? { name: project } : null),
      우선순위: property("select", { name: "P1" }),
      구분: property("select", { name: "신규 구분" }),
      ["다음 조치"]: property("rich_text", [
        { plain_text: "첫 단계 " },
        { plain_text: "다음 단계" },
      ]),
      ["완료 조건"]: property("rich_text", [{ plain_text: "완료 확인" }]),
      목표일: property("date", { start: "2026-12-01", end: "2026-12-03" }),
      ["다음 확인일"]: property("date", { start: "2026-11-30", end: null }),
    },
  };
}

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("uses the configured WIPS source and current Notion API version", () => {
  assert.equal(DATA_SOURCE_ID, "00000000-0000-4000-8000-000000000000");
  assert.equal(SOURCE_URL, "https://app.notion.com/p/00000000000000000000000000000000");
  assert.equal(NOTION_VERSION, "2026-03-11");
});

test("maps every WIPS property and retains new select values", () => {
  const task = mapNotionPage(makePage());

  assert.deepEqual(task, {
    url: "https://app.notion.com/0123456789abcdef0123456789abcdef",
    title: "테스트 일감",
    parentTaskIds: [],
    owner: "새 담당자",
    status: "새 상태",
    project: "새 프로젝트",
    priority: "P1",
    category: "신규 구분",
    nextAction: "첫 단계 다음 단계",
    doneCondition: "완료 확인",
    startDate: "2026-12-01",
    endDate: "2026-12-03",
    checkDate: "2026-11-30",
  });

  const unassigned = mapNotionPage(makePage({ owner: null, project: null, status: null }));
  assert.equal(unassigned.owner, null);
  assert.equal(unassigned.project, null);
  assert.equal(unassigned.status, "미지정");
});

test("queries all datasource pages with the required headers and cursor", async () => {
  const calls = [];
  const resultPages = [
    { results: [makePage({ title: "첫 페이지" })], has_more: true, next_cursor: "cursor-2" },
    { results: [makePage({ id: "fedcba9876543210fedcba9876543210", title: "둘째 페이지" })], has_more: false },
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return jsonResponse(200, resultPages[calls.length - 1]);
  };

  const result = await fetchNotionSnapshot({
    token: "test-token",
    fetchImpl,
    sleep: async () => {},
  });

  assert.equal(result.results.length, 2);
  assert.match(result.snapshotDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].options.headers["Notion-Version"], NOTION_VERSION);
  assert.equal(calls[0].body.page_size, 100);
  assert.equal("start_cursor" in calls[0].body, false);
  assert.equal(calls[1].body.start_cursor, "cursor-2");
});

test("sends a datasource query through actual local HTTP", async (t) => {
  let requestCount = 0;
  const mockNotion = createHttpServer((request, response) => {
    requestCount += 1;
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/data_sources/mock-source/query");
    assert.equal(request.headers.authorization, "Bearer test-token");
    assert.equal(request.headers["notion-version"], NOTION_VERSION);
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ results: [makePage()], has_more: false }));
    });
    request.resume();
  });
  const port = await listen(mockNotion);
  t.after(() => close(mockNotion));

  const result = await fetchNotionSnapshot({
    token: "test-token",
    dataSourceId: "mock-source",
    apiRoot: `http://127.0.0.1:${port}/v1`,
    fetchImpl: fetch,
  });
  assert.equal(result.results[0].title, "테스트 일감");
  assert.equal(requestCount, 1);
});

test("keeps the timeout active after headers until the response body is parsed", async (t) => {
  const slowNotion = createHttpServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.flushHeaders();
  });
  const port = await listen(slowNotion);
  t.after(async () => {
    slowNotion.closeAllConnections();
    await close(slowNotion);
  });

  const request = fetchNotionSnapshot({
    token: "test-token",
    dataSourceId: "slow-source",
    apiRoot: `http://127.0.0.1:${port}/v1`,
    timeoutMs: 40,
    fetchImpl: fetch,
  }).then(
    () => ({ kind: "success" }),
    (error) => ({ kind: "error", error }),
  );
  const watchdog = new Promise((resolve) => setTimeout(() => resolve({ kind: "watchdog" }), 350));
  const outcome = await Promise.race([request, watchdog]);
  assert.equal(outcome.kind, "error", "stalled body must not outlive the request timeout");
  assert.match(outcome.error.message, /timed out/i);
});

test("coalesces concurrent polls during Retry-After and applies cooldown immediately", async (t) => {
  let upstreamRequests = 0;
  let retryDelaySeen = 0;
  let notifyRetryDelay;
  const retryDelayStarted = new Promise((resolve) => { notifyRetryDelay = resolve; });
  let releaseSleep;
  const sleepBarrier = new Promise((resolve) => { releaseSleep = resolve; });
  const server = createWipsServer({
    staticDir: projectDir,
    initialSnapshot: snapshot,
    fetchSnapshot: ({ onRateLimit } = {}) => fetchNotionSnapshot({
      token: "test-token",
      dataSourceId: "mock-source",
      apiRoot: "https://mock.invalid/v1",
      fetchImpl: async () => {
        upstreamRequests += 1;
        return upstreamRequests === 1
          ? jsonResponse(429, {}, { "retry-after": "2" })
          : jsonResponse(200, { results: [makePage({ title: `refresh-${upstreamRequests}` })], has_more: false });
      },
      onRateLimit: (milliseconds) => {
        retryDelaySeen = milliseconds;
        onRateLimit?.(milliseconds);
      },
      sleep: async () => {
        notifyRetryDelay();
        await sleepBarrier;
      },
    }),
  });
  const port = await listen(server);
  t.after(() => close(server));
  const url = `http://127.0.0.1:${port}/api/tasks`;

  const first = fetch(url);
  await retryDelayStarted;
  const second = fetch(url);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const requestsDuringRetryDelay = upstreamRequests;
  releaseSleep();
  const [firstResponse, secondResponse] = await Promise.all([first, second]);

  assert.equal(retryDelaySeen, 2000);
  assert.equal(requestsDuringRetryDelay, 1, "a concurrent poll must share the in-flight Notion query");
  assert.equal(upstreamRequests, 2, "one retry follows the single 429 response");
  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
});

test("retries a short Retry-After and abandons a delay beyond the configured bound", async () => {
  let attempts = 0;
  const sleeps = [];
  const retried = await fetchNotionSnapshot({
    token: "test-token",
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse(429, { message: "rate limited" }, { "retry-after": "2" })
        : jsonResponse(200, { results: [], has_more: false });
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  });
  assert.equal(retried.results.length, 0);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [2000]);

  let longDelayAttempts = 0;
  await assert.rejects(
    fetchNotionSnapshot({
      token: "test-token",
      fetchImpl: async () => {
        longDelayAttempts += 1;
        return jsonResponse(429, {}, { "retry-after": String(MAX_RETRY_AFTER_MS / 1000 + 30) });
      },
      sleep: async () => assert.fail("must not sleep beyond the retry bound"),
    }),
    (error) => error.status === 429 && error.cooldownMs > MAX_RETRY_AFTER_MS,
  );
  assert.equal(longDelayAttempts, 1);
});

test("rejects an incomplete Notion result even when has_more is false", async () => {
  await assert.rejects(
    fetchNotionSnapshot({
      token: "test-token",
      fetchImpl: async () => jsonResponse(200, {
        results: [makePage()],
        has_more: false,
        request_status: { type: "incomplete" },
      }),
    }),
    (error) => error.code === "NOTION_INCOMPLETE_RESPONSE",
  );
});

test("aborts a Notion request at the configured timeout", async () => {
  await assert.rejects(
    fetchNotionSnapshot({
      token: "test-token",
      timeoutMs: 10,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    }),
    /timed out/i,
  );
});

test("serves only allowlisted files and exposes refresh failures without replacing cached data", async (t) => {
  const freshSnapshot = { ...snapshot, snapshotDate: "2026-11-12", results: [makePage()].map(mapNotionPage) };
  let calls = 0;
  const server = createWipsServer({
    staticDir: projectDir,
    initialSnapshot: snapshot,
    fetchSnapshot: async () => {
      calls += 1;
      if (calls === 1) return freshSnapshot;
      throw new Error("simulated Notion outage");
    },
  });
  const port = await listen(server);
  t.after(() => close(server));
  const baseUrl = `http://127.0.0.1:${port}`;

  const indexResponse = await fetch(`${baseUrl}/`);
  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.headers.get("content-type"), /text\/html/);
  assert.equal((await fetch(`${baseUrl}/.env`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/server.mjs`)).status, 404);

  const firstRefresh = await fetch(`${baseUrl}/api/tasks`);
  assert.equal(firstRefresh.status, 200);
  assert.equal((await firstRefresh.json()).results[0].owner, "새 담당자");

  const failedRefresh = await fetch(`${baseUrl}/api/tasks`);
  assert.equal(failedRefresh.status, 502);
  const failureBody = await failedRefresh.json();
  assert.match(failureBody.error, /Notion/i);
  assert.equal(failureBody.snapshotDate, "2026-11-12");
  assert.equal(calls, 2);
});

test("applies a long 429 cooldown to later polls without another Notion request", async (t) => {
  let calls = 0;
  const server = createWipsServer({
    staticDir: projectDir,
    initialSnapshot: snapshot,
    fetchSnapshot: async () => {
      calls += 1;
      const error = new Error("Notion rate limit");
      error.status = 429;
      error.cooldownMs = 60_000;
      throw error;
    },
  });
  const port = await listen(server);
  t.after(() => close(server));
  const baseUrl = `http://127.0.0.1:${port}`;

  const first = await fetch(`${baseUrl}/api/tasks`);
  assert.equal(first.status, 429);
  assert.ok(Number(first.headers.get("retry-after")) >= 1);
  const second = await fetch(`${baseUrl}/api/tasks`);
  assert.equal(second.status, 429);
  assert.equal(calls, 1);
});

test("builds employee, status, and project choices from live task values", () => {
  const fragment = readFileSync(new URL("./wips-office.html", import.meta.url), "utf8");
  const modelScript = fragment.match(/<script id="office-model">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(modelScript);
  const context = { window: {}, document: { getElementById: () => null }, URL };
  vm.runInNewContext(modelScript, context, { filename: "wips-office.html" });
  const model = context.window.__wipsOfficeModel({ results: [{
    title: "새 값 테스트",
    owner: "새 담당자",
    status: "새 상태",
    project: "새 프로젝트",
  }] });

  assert.ok(model.employees.includes("새 담당자"));
  assert.ok(model.statuses.includes("새 상태"));
  assert.ok(model.projects.includes("새 프로젝트"));
  assert.equal(model.summary({ status: "새 상태", project: "새 프로젝트" }).total, 1);
});

test("keeps the iframe document synchronized with the workspace source and snapshot", () => {
  const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const fragment = readFileSync(new URL("./wips-office.html", import.meta.url), "utf8");
  const parentCsp = index.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)?.[1];
  assert.match(parentCsp || "", /connect-src 'self'/);
  const frameAttrs = index.match(/<iframe\b([^>]*)>/)?.[1];
  assert.ok(frameAttrs, "index keeps its iframe document wrapper");
  const sandbox = frameAttrs.match(/\bsandbox="([^"]+)"/)?.[1];
  assert.match(sandbox || "", /(?:^|\s)allow-scripts(?:\s|$)/);
  assert.match(sandbox || "", /(?:^|\s)allow-same-origin(?:\s|$)/);
  const rawSrcdoc = frameAttrs.match(/\bdata-srcdoc="([\s\S]*?)"/)?.[1];
  assert.ok(rawSrcdoc, "index embeds the office document as escaped srcdoc");
  const srcdoc = rawSrcdoc.replace(/&(?:quot|#x27|#39|lt|gt|amp);/g, (entity) => ({
    "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&",
  })[entity]);

  const snapshotFrom = (html) => JSON.parse(html.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/)?.[1]);
  const embeddedSnapshot = snapshotFrom(srcdoc);
  const sourceSnapshot = JSON.parse(readFileSync(new URL("./wips-data.json", import.meta.url), "utf8"));
  assert.equal(embeddedSnapshot.snapshotDate, sourceSnapshot.snapshotDate);
  assert.equal(embeddedSnapshot.timezone, sourceSnapshot.timezone);
  assert.equal(embeddedSnapshot.sourceUrl, sourceSnapshot.sourceUrl);
  assert.deepEqual(embeddedSnapshot.results, sourceSnapshot.results);
  assert.match(srcdoc, /connect-src 'self'/);
  assert.equal(
    srcdoc.match(/<script id="office-model">([\s\S]*?)<\/script>/)?.[1],
    fragment.match(/<script id="office-model">([\s\S]*?)<\/script>/)?.[1],
  );
});

test("maps parent task relations independently of other relations", () => {
  const page = makePage();
  page.properties["상위 일감"] = property("relation", [{ id: "root-task" }]);
  page.properties["선행 작업"] = property("relation", [{ id: "dependency" }]);
  assert.deepEqual(mapNotionPage(page).parentTaskIds, ["root-task"]);
  page.properties["상위 일감"].relation = [];
  assert.deepEqual(mapNotionPage(page).parentTaskIds, []);
});
