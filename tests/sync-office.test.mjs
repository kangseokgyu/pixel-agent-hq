import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildOfficeHtml } from "../scripts/bundle-office.mjs";
import {
  BANNED_CDN_HOSTS,
  OUTER_CSP,
  SRCDOC_CSP,
  buildShellIndexHtml,
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

test("syncOfficeHtml check reports drift when generated HTML or source CSS differs", async () => {
  const { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tempRoot = mkdtempSync(join(tmpdir(), "wips-sync-check-"));
  try {
    for (const rel of ["index.html", "wips-office.html", "wips-data.json"]) {
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

    syncOfficeHtml({ rootDir: tempRoot });
    assert.equal(syncOfficeHtml({ rootDir: tempRoot, check: true }).ok, true);

    const codexCssPath = join(tempRoot, "src/shell/codex-host.css");
    writeFileSync(codexCssPath, `${readFileSync(codexCssPath, "utf8")}\n/* drift */\n`);
    const cssDrifted = syncOfficeHtml({ rootDir: tempRoot, check: true });
    assert.equal(cssDrifted.ok, false);
    assert.ok(cssDrifted.drifted.includes("index.html"));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("dist zero-data bundle stays within REF-5 byte budget after shell CSS pruning", () => {
  const built = syncOfficeHtml({ rootDir, outPath: "dist/index.html", empty: true, check: true });
  assert.ok(built.bytes <= 380_246, `Expected dist/index.html <= 380246 bytes, got ${built.bytes}`);
});

test("srcdoc places inner host bridge after body opening tag so ResizeObserver observes document.body", () => {
  const currentIndex = readFileSync(`${rootDir}index.html`, "utf8");
  const rawSrcdoc = currentIndex.match(/\bdata-srcdoc="([\s\S]*?)"/)?.[1];
  const srcdoc = unescapeHtmlAttr(rawSrcdoc);
  const bodyIdx = srcdoc.indexOf("<body>");
  const observerIdx = srcdoc.indexOf("ResizeObserver");
  assert.ok(bodyIdx !== -1 && observerIdx !== -1 && bodyIdx < observerIdx);
});

test("buildShellIndexHtml escapes '<' inside #wips-office-data for both populated and empty snapshots", () => {
  const maliciousTitle = "</script><script>window.__xss=1</script>";
  const officeWithPayload = buildOfficeHtml({
    rootDir,
    snapshot: {
      snapshotDate: "2026-11-27",
      sourceUrl: "",
      results: [{ id: "t1", title: maliciousTitle, owner: "sb", status: "진행" }],
    },
  });

  const populatedShell = buildShellIndexHtml({
    rootDir,
    officeHtml: officeWithPayload,
    emptySnapshot,
    empty: false,
  });
  const populatedSrcdoc = unescapeHtmlAttr(populatedShell.match(/\bdata-srcdoc="([\s\S]*?)"/)?.[1]);
  assert.equal(populatedSrcdoc.includes(maliciousTitle), false);
  const populatedData = JSON.parse(
    populatedSrcdoc.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/)?.[1],
  );
  assert.equal(populatedData.results[0].title, maliciousTitle);

  const emptyPayload = {
    ...emptySnapshot,
    results: [{ id: "t2", title: maliciousTitle }],
  };
  const emptyShell = buildShellIndexHtml({
    rootDir,
    officeHtml: officeWithPayload,
    emptySnapshot: emptyPayload,
    empty: true,
  });
  const emptySrcdoc = unescapeHtmlAttr(emptyShell.match(/\bdata-srcdoc="([\s\S]*?)"/)?.[1]);
  assert.equal(emptySrcdoc.includes(maliciousTitle), false);
  const parsedEmptyData = JSON.parse(
    emptySrcdoc.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/)?.[1],
  );
  assert.equal(parsedEmptyData.results[0].title, maliciousTitle);
});
