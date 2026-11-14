# T09 Verification — Zero-Data Static Bundle & Security Audit (`dist/`)

## TDD Cycle
1. **Red**: Created `tests/build-pages.test.mjs`; initial run failed 2/2 (`scripts/build-pages.mjs` missing).
2. **Green**:
   - Implemented `scripts/build-pages.mjs` (`buildPages`, `DIST_ALLOWLIST`) generating only `index.html`, `manifest.webmanifest`, `pwa-register.js`, `sw.js`, `icons/icon-192.png`, and `icons/icon-512.png`, embedding empty snapshot JSON (`results: []`) and stamping content-hashed `SW_VERSION` (`wips-<hash12>`).
   - Implemented `scripts/verify-dist.mjs` (`verifyDist`) enforcing file allowlist, zero symlinks, zero `.env` / `wips-data.json` / real `DATA_SOURCE_ID` / `SOURCE_URL` / token leaks, zero banned external CDNs, zero HTML/eval sinks, restricted UI-only `localStorage` usage, relative subpath URLs, and strict outer + `srcdoc` CSP headers.
   - Confirmed clean `dist/` passes and 11 negative mutation test cases fail `verifyDist`.

## Verification Results
- `node --test tests/build-pages.test.mjs`: 2/2 pass
- `node scripts/build-pages.mjs && node scripts/verify-dist.mjs`: exit code 0 (`verify-dist: OK`, `swVersion=wips-4e599f13d59c`, `files=6`)
- `node --test` (full suite): 63/63 pass
