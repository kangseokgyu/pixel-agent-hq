# T08 Verification — Service Worker App Shell, Update Cleanup & Logout Purge

## TDD Cycle
1. **Red**: Created `tests/pwa-offline-update.test.mjs`; initial run failed 4/4 (`sw.js` missing).
2. **Green**:
   - Implemented `sw.js` with scope-qualified cache keys (`wips-office-shell:<scope>:<version>`), `{ cache: "reload" }` precaching of allowlisted static shell assets (`./`, `./index.html`, `./manifest.webmanifest`, `./pwa-register.js`, `./icons/icon-192.png`, `./icons/icon-512.png`), `skipWaiting()` + `clients.claim()`, stale same-scope cleanup on `activate`, fetch bypass for non-`GET`, `Authorization`, cross-origin, `sw.js`, `/api/*`, Notion endpoints, and `wips-data.json`, and `WIPS_CLEAR_SESSION` cleanup handler.
   - Aligned offline OPFS mock seed in `tests/pwa-offline-update.test.mjs` with `fixtures/sample-snapshot.json` and cross-realm property assertion.

## Verification Results
- `node --test tests/pwa-offline-update.test.mjs`: 4/4 pass
- `node --test` (full suite): 61/61 pass
