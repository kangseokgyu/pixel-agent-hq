import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

test("deploy-pages workflow builds, tests, audits zero-data dist/, and deploys with minimal permissions", () => {
  const workflowPath = resolve(ROOT, ".github/workflows/deploy-pages.yml");
  assert.ok(existsSync(workflowPath), ".github/workflows/deploy-pages.yml must exist");

  const yml = readFileSync(workflowPath, "utf8");

  assert.match(yml, /\bpush:\s*\n\s*branches:\s*\[["']?main["']?\]|\bpush:\s*\n\s*branches:\s*\n\s*-\s*["']?main["']?/);
  assert.match(yml, /\bworkflow_dispatch:/);
  assert.match(yml, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(yml, /\bpages:\s*write/);
  assert.match(yml, /\bid-token:\s*write/);
  assert.match(yml, /\bconcurrency:/);

  assert.match(yml, /uses:\s*actions\/checkout@v4[\s\S]*?persist-credentials:\s*false/);
  assert.match(yml, /uses:\s*actions\/setup-node@v4[\s\S]*?node-version:\s*["']?22["']?/);
  assert.match(yml, /\bnode --test\b/);
  assert.match(yml, /\bnode scripts\/build-pages\.mjs\b/);
  assert.match(yml, /\bnode scripts\/verify-dist\.mjs\b/);
  assert.match(yml, /uses:\s*actions\/upload-pages-artifact@v3[\s\S]*?path:\s*dist\b/);
  assert.match(yml, /uses:\s*actions\/deploy-pages@v4/);

  assert.doesNotMatch(yml, /NOTION_TOKEN/);
  assert.doesNotMatch(yml, /secrets\.NOTION/i);
  assert.doesNotMatch(yml, /00000000-0000-4000-8000-000000000000/);
  assert.doesNotMatch(yml, /00000000000000000000000000000000/);
});
