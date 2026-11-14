import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as notionClient from "../lib/notion-client.mjs";
import { handleCorsProxyRequest } from "../scripts/cors-proxy-worker.mjs";

function makeNotionPage({ id = "aaaa1111bbbb2222cccc3333dddd4444", title = "조회 테스트 일감" } = {}) {
  return {
    id,
    url: `https://app.notion.com/${id}`,
    properties: {
      일감: { title: [{ plain_text: title }] },
      담당자: { select: { name: "sb" } },
      상태: { status: { name: "진행" } },
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
    apiRoot: "https://relay.example.com/v1",
    strictUuid: true,
    fetchImpl,
    sleep: async () => {},
  });

  assert.equal(snapshot.results.length, 2);
  assert.equal(snapshot.sourceUrl, "");
  assert.deepEqual(snapshot.data_source_ids, [dataSourceId]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, `https://relay.example.com/v1/data_sources/${dataSourceId}/query`);
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

test("stateless CORS proxy forwards only POST /v1/data_sources/{uuid}/query for allowed origins without logging", async () => {
  const workerSource = readFileSync(new URL("../scripts/cors-proxy-worker.mjs", import.meta.url), "utf8");
  assert.equal(/console\.(log|info|debug|warn|error)/.test(workerSource), false);

  const dataSourceId = "11111111-2222-4333-8444-555555555555";
  const allowedOrigin = "https://owner.github.io";

  const preflight = await handleCorsProxyRequest(
    new Request(`https://relay.example.com/v1/data_sources/${dataSourceId}/query`, {
      method: "OPTIONS",
      headers: { Origin: allowedOrigin },
    }),
    { allowedOrigins: [allowedOrigin] },
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
  assert.equal(preflight.headers.get("Cache-Control"), "no-store");

  const blockedOrigin = await handleCorsProxyRequest(
    new Request(`https://relay.example.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: { Origin: "https://evil.example.com", Authorization: "Bearer demo_token" },
      body: JSON.stringify({ page_size: 100 }),
    }),
    { allowedOrigins: [allowedOrigin] },
  );
  assert.equal(blockedOrigin.status, 403);

  const blockedWritePath = await handleCorsProxyRequest(
    new Request("https://relay.example.com/v1/pages", {
      method: "POST",
      headers: { Origin: allowedOrigin, Authorization: "Bearer demo_token" },
      body: JSON.stringify({}),
    }),
    { allowedOrigins: [allowedOrigin] },
  );
  assert.equal(blockedWritePath.status, 403);

  const blockedMethod = await handleCorsProxyRequest(
    new Request(`https://relay.example.com/v1/data_sources/${dataSourceId}/query`, {
      method: "PATCH",
      headers: { Origin: allowedOrigin, Authorization: "Bearer demo_token" },
    }),
    { allowedOrigins: [allowedOrigin] },
  );
  assert.equal(blockedMethod.status, 405);

  const forwardedCalls = [];
  const okResponse = await handleCorsProxyRequest(
    new Request(`https://relay.example.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: {
        Origin: allowedOrigin,
        Authorization: "Bearer demo_token",
        "Content-Type": "application/json",
        "Notion-Version": "2026-03-11",
      },
      body: JSON.stringify({ page_size: 100 }),
    }),
    {
      allowedOrigins: [allowedOrigin],
      fetchImpl: async (url, init) => {
        forwardedCalls.push({ url: String(url), init });
        return jsonResponse(200, { results: [makeNotionPage()], has_more: false }, { "retry-after": "5" });
      },
    },
  );

  assert.equal(okResponse.status, 200);
  assert.equal(okResponse.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
  assert.equal(okResponse.headers.get("Cache-Control"), "no-store");
  assert.equal(forwardedCalls.length, 1);
  assert.equal(forwardedCalls[0].url, `https://api.notion.com/v1/data_sources/${dataSourceId}/query`);
  assert.equal(forwardedCalls[0].init.method, "POST");
  assert.equal(forwardedCalls[0].init.redirect, "error");
});

test("stateless CORS proxy rejects oversized (>4KB), malformed JSON, and disallowed-key bodies", async () => {
  const dataSourceId = "11111111-2222-4333-8444-555555555555";
  const allowedOrigin = "https://owner.github.io";
  const url = `https://relay.example.com/v1/data_sources/${dataSourceId}/query`;
  const headers = {
    Origin: allowedOrigin,
    Authorization: "Bearer demo_token",
    "Content-Type": "application/json",
  };
  let upstreamCalled = false;
  const fetchImpl = async () => {
    upstreamCalled = true;
    return jsonResponse(200, { results: [], has_more: false });
  };

  const oversized = await handleCorsProxyRequest(
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ page_size: 100, start_cursor: "a".repeat(5000) }),
    }),
    { allowedOrigins: [allowedOrigin], fetchImpl },
  );
  assert.equal(oversized.status, 413);

  const malformed = await handleCorsProxyRequest(
    new Request(url, {
      method: "POST",
      headers,
      body: "{bad json",
    }),
    { allowedOrigins: [allowedOrigin], fetchImpl },
  );
  assert.equal(malformed.status, 400);

  const nonObject = await handleCorsProxyRequest(
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(["unexpected"]),
    }),
    { allowedOrigins: [allowedOrigin], fetchImpl },
  );
  assert.equal(nonObject.status, 400);

  const invalidKey = await handleCorsProxyRequest(
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ page_size: 100, properties: { evil: true } }),
    }),
    { allowedOrigins: [allowedOrigin], fetchImpl },
  );
  assert.equal(invalidKey.status, 400);
  assert.equal(upstreamCalled, false);
});
