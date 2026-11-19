import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EMPTY_SNAPSHOT,
  detectRuntimeMode,
  isEmptySnapshot,
  validateConnectionConfig,
  validateSnapshot,
} from "../lib/snapshot-schema.mjs";

const emptyFixture = JSON.parse(readFileSync(new URL("../fixtures/empty-snapshot.json", import.meta.url), "utf8"));
const sampleFixture = JSON.parse(readFileSync(new URL("../fixtures/sample-snapshot.json", import.meta.url), "utf8"));

test("validates empty and sample snapshots and distinguishes empty state", () => {
  const emptyCheck = validateSnapshot(emptyFixture);
  assert.equal(emptyCheck.ok, true);
  assert.equal(isEmptySnapshot(emptyFixture), true);
  assert.equal(isEmptySnapshot(EMPTY_SNAPSHOT), true);

  const sampleCheck = validateSnapshot(sampleFixture);
  assert.equal(sampleCheck.ok, true);
  assert.equal(isEmptySnapshot(sampleFixture), false);
});

test("rejects malformed snapshots and unexpected field types", () => {
  assert.equal(validateSnapshot(null).ok, false);
  assert.equal(validateSnapshot({ ...sampleFixture, results: "bad" }).ok, false);
  assert.equal(validateSnapshot({ ...sampleFixture, timezone: "" }).ok, false);
  assert.equal(validateSnapshot({ ...sampleFixture, results: [{ owner: "sb" }] }).ok, false);
  assert.equal(validateSnapshot({ ...sampleFixture, snapshotDate: "11-14-2026" }).ok, false);
});

test("validates optional task id, subTaskIds, and checklist fields while staying backwards-compatible", () => {
  const withChecklist = {
    ...sampleFixture,
    results: [
      {
        id: "task-1",
        title: "체크리스트 포함 일감",
        subTaskIds: ["sub-1", "sub-2"],
        checklist: [
          { text: "첫 번째 확인", done: true },
          { text: "두 번째 확인", done: false },
        ],
      },
      {
        title: "필드 생략 레거시 일감",
      },
    ],
  };
  assert.equal(validateSnapshot(withChecklist).ok, true);

  for (const badTask of [
    { title: "잘못된 id", id: 123 },
    { title: "잘못된 subTaskIds 타입", subTaskIds: "sub-1" },
    { title: "비문자 subTaskIds 원소", subTaskIds: ["sub-1", 42] },
    { title: "잘못된 checklist 타입", checklist: "not-array" },
    { title: "null checklist 항목", checklist: [null] },
    { title: "done 누락 checklist 항목", checklist: [{ text: "항목" }] },
    { title: "text 비문자 checklist 항목", checklist: [{ text: 99, done: false }] },
    { title: "done 비불리언 checklist 항목", checklist: [{ text: "항목", done: "true" }] },
  ]) {
    assert.equal(
      validateSnapshot({ ...sampleFixture, results: [badTask] }).ok,
      false,
      `expected rejection for: ${badTask.title}`,
    );
  }
});

test("detects local server mode vs static PWA mode from initial snapshot or explicit override", () => {
  assert.equal(detectRuntimeMode({ initialSnapshot: emptyFixture }), "static");
  assert.equal(detectRuntimeMode({ initialSnapshot: sampleFixture }), "local");
  assert.equal(detectRuntimeMode({ initialSnapshot: sampleFixture, runtimeMode: "static" }), "static");
});

test("validates connection config strictly and blocks control chars and bad UUIDs", () => {
  const valid = validateConnectionConfig({
    token: "demo_token_abc123",
    dataSourceId: "11111111-2222-4333-8444-555555555555",
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.token, "demo_token_abc123");
  assert.equal(valid.value.dataSourceId, "11111111-2222-4333-8444-555555555555");

  for (const invalid of [
    { token: "", dataSourceId: "11111111-2222-4333-8444-555555555555" },
    { token: "bad\ntoken", dataSourceId: "11111111-2222-4333-8444-555555555555" },
    { token: "bad token", dataSourceId: "11111111-2222-4333-8444-555555555555" },
    { token: "demo_token", dataSourceId: "../pages" },
    { token: "demo_token", dataSourceId: "not-a-uuid" },
  ]) {
    assert.equal(validateConnectionConfig(invalid).ok, false);
  }
});
