import assert from "node:assert/strict";
import test from "node:test";

import * as notionClient from "../lib/notion-client.mjs";

function makeNotionPage({
  id = "aaaa1111bbbb2222cccc3333dddd4444",
  title = "조회 테스트 일감",
  status = "진행",
  subTaskIds = [],
} = {}) {
  return {
    id,
    url: `https://app.notion.com/${id}`,
    properties: {
      일감: { title: [{ plain_text: title }] },
      "하위 일감": { relation: subTaskIds.map((childId) => ({ id: childId })) },
      담당자: { select: { name: "sb" } },
      상태: { status: { name: status } },
      프로젝트: { select: { name: "2.3" } },
      우선순위: { select: { name: "P1" } },
      구분: { select: { name: "품질" } },
      "다음 조치": { rich_text: [{ plain_text: "확인" }] },
      "완료 조건": { rich_text: [{ plain_text: "완료" }] },
      목표일: { date: { start: "2026-11-14", end: null } },
      "다음 확인일": { date: null },
    },
  };
}

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("queries paginated Notion data sources read-only with strict fetch guards", async () => {
  const requests = [];
  const dataSourceId = "11111111-2222-4333-8444-555555555555";
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) {
      return jsonResponse(200, {
        results: [makeNotionPage({ title: "첫 페이지 일감" })],
        has_more: true,
        next_cursor: "next-2",
      });
    }
    return jsonResponse(200, {
      results: [makeNotionPage({ id: "eeee5555ffff6666aaaa7777bbbb8888", title: "둘째 페이지 일감" })],
      has_more: false,
    });
  };

  const snapshot = await notionClient.fetchNotionSnapshot({
    token: "demo_readonly_token",
    dataSourceId,
    strictUuid: true,
    includeChecklists: false,
    fetchImpl,
    sleep: async () => {},
  });

  assert.equal(snapshot.results.length, 2);
  assert.equal(snapshot.sourceUrl, "");
  assert.deepEqual(snapshot.data_source_ids, [dataSourceId]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, `https://api.notion.com/v1/data_sources/${dataSourceId}/query`);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(JSON.parse(requests[1].options.body).start_cursor, "next-2");
});

test("rejects control characters, invalid UUIDs, and exposes no Notion write helpers", async () => {
  const exportedKeys = Object.keys(notionClient);
  assert.equal(exportedKeys.some((key) => /create|update|patch|delete|write/i.test(key)), false);

  await assert.rejects(
    notionClient.fetchNotionSnapshot({
      token: "bad\ntoken",
      dataSourceId: "11111111-2222-4333-8444-555555555555",
      strictUuid: true,
    }),
    (error) => error.code === "NOTION_INVALID_TOKEN",
  );

  await assert.rejects(
    notionClient.fetchNotionSnapshot({
      token: "demo_token",
      dataSourceId: "../pages",
    }),
    (error) => error.code === "NOTION_INVALID_DATASOURCE",
  );

  await assert.rejects(
    notionClient.fetchNotionSnapshot({
      token: "demo_token",
      dataSourceId: "not-a-uuid",
      strictUuid: true,
    }),
    (error) => error.code === "NOTION_INVALID_DATASOURCE",
  );
});

test("handles 429 Retry-After, timeouts, and incomplete responses", async () => {
  let calls = 0;
  const sleeps = [];
  const ok = await notionClient.fetchNotionSnapshot({
    token: "demo_token",
    dataSourceId: "11111111-2222-4333-8444-555555555555",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, {}, { "retry-after": "1" });
      return jsonResponse(200, { results: [], has_more: false });
    },
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.equal(ok.results.length, 0);
  assert.deepEqual(sleeps, [1000]);

  await assert.rejects(
    notionClient.fetchNotionSnapshot({
      token: "demo_token",
      dataSourceId: "11111111-2222-4333-8444-555555555555",
      fetchImpl: async () => jsonResponse(200, {
        results: [makeNotionPage()],
        has_more: false,
        request_status: { type: "incomplete" },
      }),
    }),
    (error) => error.code === "NOTION_INCOMPLETE_RESPONSE",
  );

  await assert.rejects(
    notionClient.fetchNotionSnapshot({
      token: "demo_token",
      dataSourceId: "11111111-2222-4333-8444-555555555555",
      timeoutMs: 10,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    }),
    (error) => error.code === "NOTION_TIMEOUT",
  );
});

test("extracts paginated and nested to_do blocks while skipping child pages and databases", async () => {
  const requests = [];
  const blockPages = new Map([
    [
      "https://api.notion.com/v1/blocks/root-page-1/children?page_size=100",
      {
        results: [
          { id: "todo-1", type: "to_do", has_children: false, to_do: { rich_text: [{ plain_text: "설계 확인" }], checked: true } },
          { id: "toggle-1", type: "toggle", has_children: true, toggle: { rich_text: [{ plain_text: "세부 항목" }] } },
          { id: "subpage-1", type: "child_page", has_children: true, child_page: { title: "하위 페이지" } },
          { id: "subdb-1", type: "child_database", has_children: true, child_database: { title: "하위 DB" } },
        ],
        has_more: true,
        next_cursor: "blk-cursor-2",
      },
    ],
    [
      "https://api.notion.com/v1/blocks/root-page-1/children?page_size=100&start_cursor=blk-cursor-2",
      {
        results: [
          { id: "col-list-1", type: "column_list", has_children: true },
          { id: "todo-empty", type: "to_do", has_children: false, to_do: { rich_text: [], checked: false } },
        ],
        has_more: false,
      },
    ],
    [
      "https://api.notion.com/v1/blocks/toggle-1/children?page_size=100",
      {
        results: [
          { id: "todo-2", type: "to_do", has_children: false, to_do: { rich_text: [{ plain_text: "토글 안 체크" }], checked: false } },
        ],
        has_more: false,
      },
    ],
    [
      "https://api.notion.com/v1/blocks/col-list-1/children?page_size=100",
      {
        results: [
          { id: "col-1", type: "column", has_children: true },
        ],
        has_more: false,
      },
    ],
    [
      "https://api.notion.com/v1/blocks/col-1/children?page_size=100",
      {
        results: [
          { id: "todo-3", type: "to_do", has_children: false, to_do: { rich_text: [{ plain_text: "컬럼 안 체크" }], checked: true } },
        ],
        has_more: false,
      },
    ],
  ]);

  const checklist = await notionClient.fetchPageChecklist({
    token: "demo_readonly_token",
    blockId: "root-page-1",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const body = blockPages.get(String(url));
      assert.ok(body, `unexpected block fetch: ${url}`);
      return jsonResponse(200, body);
    },
    sleep: async () => {},
  });

  assert.deepEqual(checklist, [
    { text: "설계 확인", done: true },
    { text: "토글 안 체크", done: false },
    { text: "컬럼 안 체크", done: true },
    { text: "항목 없음", done: false },
  ]);

  assert.equal(requests.some((req) => req.url.includes("subpage-1") || req.url.includes("subdb-1")), false);
  for (const req of requests) {
    assert.equal(req.options.method, "GET");
    assert.equal(req.options.redirect, "error");
    assert.equal(req.options.credentials, "omit");
    assert.equal(req.options.cache, "no-store");
    assert.equal(req.options.headers.Authorization, "Bearer demo_readonly_token");
    assert.equal(req.options.headers["Notion-Version"], notionClient.NOTION_VERSION);
  }
});

test("rejects invalid block IDs and retries 429 on block children queries", async () => {
  await assert.rejects(
    notionClient.fetchPageChecklist({
      token: "demo_token",
      blockId: "../pages",
    }),
    (error) => error.code === "NOTION_INVALID_BLOCK",
  );

  let attempts = 0;
  const sleeps = [];
  const items = await notionClient.fetchPageChecklist({
    token: "demo_token",
    blockId: "11111111-2222-4333-8444-555555555555",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return jsonResponse(429, {}, { "retry-after": "1" });
      return jsonResponse(200, {
        results: [
          { id: "todo-1", type: "to_do", has_children: false, to_do: { rich_text: [{ plain_text: "재시도 성공" }], checked: true } },
        ],
        has_more: false,
      });
    },
    sleep: async (ms) => sleeps.push(ms),
  });

  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.deepEqual(items, [{ text: "재시도 성공", done: true }]);
});

test("skips completed tasks, bounds concurrency, and degrades gracefully on block errors", async () => {
  const dataSourceId = "11111111-2222-4333-8444-555555555555";
  const fetchedBlockIds = [];
  let inFlightBlocks = 0;
  let maxInFlightBlocks = 0;

  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes("/data_sources/")) {
      return jsonResponse(200, {
        results: [
          makeNotionPage({ id: "task-ok-1", title: "진행 일감 1", status: "진행", subTaskIds: ["sub-1"] }),
          makeNotionPage({ id: "task-403", title: "권한 없음 일감", status: "대기" }),
          makeNotionPage({ id: "task-404", title: "삭제됨 일감", status: "진행" }),
          makeNotionPage({ id: "task-ok-2", title: "진행 일감 2", status: "검토" }),
          makeNotionPage({ id: "task-done", title: "완료 일감", status: "완료" }),
        ],
        has_more: false,
      });
    }

    const match = href.match(/\/blocks\/([^/]+)\/children/);
    assert.ok(match);
    const blockId = decodeURIComponent(match[1]);
    fetchedBlockIds.push(blockId);
    inFlightBlocks += 1;
    maxInFlightBlocks = Math.max(maxInFlightBlocks, inFlightBlocks);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlightBlocks -= 1;

    if (blockId === "task-403") return jsonResponse(403, { message: "forbidden" });
    if (blockId === "task-404") return jsonResponse(404, { message: "not found" });
    return jsonResponse(200, {
      results: [
        { id: `${blockId}-item`, type: "to_do", has_children: false, to_do: { rich_text: [{ plain_text: `${blockId} 항목` }], checked: false } },
      ],
      has_more: false,
    });
  };

  const snapshot = await notionClient.fetchNotionSnapshot({
    token: "demo_readonly_token",
    dataSourceId,
    strictUuid: true,
    includeChecklists: true,
    checklistConcurrency: 2,
    fetchImpl,
    sleep: async () => {},
  });

  assert.equal(fetchedBlockIds.includes("task-done"), false);
  assert.equal(maxInFlightBlocks <= 2, true);

  const byId = new Map(snapshot.results.map((task) => [task.id, task]));
  assert.deepEqual(byId.get("task-ok-1").subTaskIds, ["sub-1"]);
  assert.deepEqual(byId.get("task-ok-1").checklist, [{ text: "task-ok-1 항목", done: false }]);
  assert.deepEqual(byId.get("task-403").checklist, []);
  assert.deepEqual(byId.get("task-404").checklist, []);
  assert.deepEqual(byId.get("task-ok-2").checklist, [{ text: "task-ok-2 항목", done: false }]);
  assert.deepEqual(byId.get("task-done").checklist, []);
});

test("rethrows abort errors during checklist enrichment instead of swallowing them", async () => {
  const controller = new AbortController();
  const dataSourceId = "11111111-2222-4333-8444-555555555555";

  await assert.rejects(
    notionClient.fetchNotionSnapshot({
      token: "demo_readonly_token",
      dataSourceId,
      strictUuid: true,
      includeChecklists: true,
      signal: controller.signal,
      fetchImpl: async (url) => {
        if (String(url).includes("/data_sources/")) {
          controller.abort();
          return jsonResponse(200, {
            results: [makeNotionPage({ id: "task-abort", status: "진행" })],
            has_more: false,
          });
        }
        assert.fail("block request must not start after abort");
      },
    }),
    (error) => error.code === "NOTION_ABORTED",
  );
});
