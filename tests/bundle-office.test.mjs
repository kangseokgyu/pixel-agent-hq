import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { bundleModules, injectBundledOfficeScript } from "../scripts/bundle-office.mjs";
import { syncOfficeHtml } from "../scripts/sync-office.mjs";

const ROOT = resolve(import.meta.dirname, "..");

test("bundleModules emits deterministic scoped closures without top-level collisions", () => {
  const first = bundleModules("src/office-app.mjs", { rootDir: ROOT });
  const second = bundleModules("src/office-app.mjs", { rootDir: ROOT });
  assert.equal(first, second);
  assert.equal(/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|\beval\s*\(|\bnew\s+Function\b/.test(first), false);
  assert.match(first, /const __wips_mod_0 = \(\(\) => \{/);

  const tempRoot = mkdtempSync(join(tmpdir(), "wips-bundle-unit-"));
  try {
    mkdirSync(join(tempRoot, "sub"), { recursive: true });
    writeFileSync(join(tempRoot, "sub/a.mjs"), 'const SECRET = 10;\nexport const value = SECRET;\n');
    writeFileSync(join(tempRoot, "sub/b.mjs"), 'const SECRET = 20;\nexport function getVal() { return SECRET; }\n');
    writeFileSync(
      join(tempRoot, "entry.mjs"),
      'import { value } from "./sub/a.mjs";\nimport { getVal } from "./sub/b.mjs";\nglobalThis.result = value + getVal();\n',
    );
    const bundled = bundleModules("entry.mjs", { rootDir: tempRoot });
    const sandbox = {};
    vm.runInNewContext(bundled, sandbox);
    assert.equal(sandbox.result, 30);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("injectBundledOfficeScript replaces office-model script and syncOfficeHtml check catches drift", () => {
  const sampleHtml = '<div id="wips-office-root"></div>\n<script id="office-model">old</script>';
  const updated = injectBundledOfficeScript(sampleHtml, "(() => {})();");
  assert.equal(updated, '<div id="wips-office-root"></div>\n<script id="office-model">\n(() => {})();\n</script>');

  const checkResult = syncOfficeHtml({ rootDir: ROOT, check: true });
  assert.equal(checkResult.ok, true, `Expected sync check clean, got drifted: ${checkResult.drifted.join(", ")}`);
});
