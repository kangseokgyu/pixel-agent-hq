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
