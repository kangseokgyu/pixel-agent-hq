import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BANNED_CDN_HOSTS,
  OUTER_CSP,
  SRCDOC_CSP,
  buildSyncedIndexHtml,
  syncOfficeHtml,
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

test("syncOfficeHtml check reports drift when wips-office.html differs from source bundle", async () => {
  const { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tempRoot = mkdtempSync(join(tmpdir(), "wips-sync-check-"));
  try {
    for (const rel of ["index.html", "wips-office.html"]) {
      cpSync(join(rootDir, rel), join(tempRoot, rel));
    }
    cpSync(join(rootDir, "fixtures"), join(tempRoot, "fixtures"), { recursive: true });
    cpSync(join(rootDir, "lib"), join(tempRoot, "lib"), { recursive: true });
    cpSync(join(rootDir, "src"), join(tempRoot, "src"), { recursive: true });

    assert.equal(syncOfficeHtml({ rootDir: tempRoot, check: true }).ok, true);
    const stale = readFileSync(join(tempRoot, "wips-office.html"), "utf8").replace("window.__wipsOfficeModel", "window.__stale");
    writeFileSync(join(tempRoot, "wips-office.html"), stale);
    const drifted = syncOfficeHtml({ rootDir: tempRoot, check: true });
    assert.equal(drifted.ok, false);
    assert.ok(drifted.drifted.includes("wips-office.html"));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
