import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BANNED_CDN_HOSTS,
  OUTER_CSP,
  SRCDOC_CSP,
  buildSyncedIndexHtml,
  unescapeHtmlAttr,
} from "../scripts/sync-office.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const indexHtml = readFileSync(`${rootDir}index.html`, "utf8");
const officeHtml = readFileSync(`${rootDir}wips-office.html`, "utf8");
const emptySnapshot = JSON.parse(readFileSync(`${rootDir}fixtures/empty-snapshot.json`, "utf8"));
const sourceData = JSON.parse(readFileSync(`${rootDir}wips-data.json`, "utf8"));

test("produces byte-identical index.html output for identical inputs", () => {
  const first = buildSyncedIndexHtml({ indexHtml, officeHtml, emptySnapshot, empty: false });
  const second = buildSyncedIndexHtml({ indexHtml, officeHtml, emptySnapshot, empty: false });
  assert.equal(first, second);
});

test("removes all banned external CDN domains and innerHTML from both outer and srcdoc HTML", () => {
  const built = buildSyncedIndexHtml({ indexHtml, officeHtml, emptySnapshot, empty: true });
  const rawSrcdoc = built.match(/\bdata-srcdoc="([\s\S]*?)"/)?.[1];
  assert.ok(rawSrcdoc, "built index.html includes data-srcdoc");
  const srcdoc = unescapeHtmlAttr(rawSrcdoc);

  const outerCsp = built.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)?.[1];
  const innerCsp = srcdoc.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)?.[1];
  assert.equal(outerCsp, OUTER_CSP);
  assert.equal(innerCsp, SRCDOC_CSP);

  for (const host of BANNED_CDN_HOSTS) {
    assert.equal(built.includes(host), false, `outer html must not contain ${host}`);
    assert.equal(srcdoc.includes(host), false, `srcdoc must not contain ${host}`);
  }
  assert.equal(/\binnerHTML\b/.test(built), false);
  assert.equal(/\binnerHTML\b/.test(srcdoc), false);
});

test("strips all task titles, real DATA_SOURCE_ID, and SOURCE_URL in empty static mode", () => {
  const built = buildSyncedIndexHtml({ indexHtml, officeHtml, emptySnapshot, empty: true });
  const rawSrcdoc = built.match(/\bdata-srcdoc="([\s\S]*?)"/)?.[1];
  const srcdoc = unescapeHtmlAttr(rawSrcdoc);
  const embedded = JSON.parse(srcdoc.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/)?.[1]);

  assert.deepEqual(embedded, emptySnapshot);
  assert.equal(built.includes("00000000-0000-4000-8000-000000000000"), false);
  assert.equal(srcdoc.includes("00000000-0000-4000-8000-000000000000"), false);
  assert.equal(built.includes("00000000000000000000000000000000"), false);
  assert.equal(srcdoc.includes("00000000000000000000000000000000"), false);

  for (const task of sourceData.results) {
    assert.equal(srcdoc.includes(task.title), false, `srcdoc must not contain task title ${task.title}`);
    assert.equal(built.includes(task.title), false, `built html must not contain task title ${task.title}`);
  }
});
