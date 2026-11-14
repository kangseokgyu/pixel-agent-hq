# T10 Verification — GitHub Actions Pages Deployment Workflow

## TDD Cycle
1. **Red**: Created `tests/deploy-workflow.test.mjs`; initial run failed 1/1 (`.github/workflows/deploy-pages.yml` missing).
2. **Green**: Created `.github/workflows/deploy-pages.yml` with `push` (`main`) + `workflow_dispatch` triggers, minimal permissions (`contents: read` at root; `pages: write` / `id-token: write` scoped to `deploy`), `concurrency`, `actions/checkout@v4` (`persist-credentials: false`), `actions/setup-node@v4` (Node 22), `node --test`, `node scripts/build-pages.mjs`, `node scripts/verify-dist.mjs`, `actions/upload-pages-artifact@v3` (`path: dist`), `actions/deploy-pages@v4`, and zero `NOTION_TOKEN` / real ID references.

## Verification Results
- `node --test tests/deploy-workflow.test.mjs`: 1/1 pass
- `node --test` (full suite): 64/64 pass
