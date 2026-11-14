# T07 Verification — PWA Metadata, Icons & Registration Entrypoint

## TDD Cycle
1. **Red**: Created `tests/pwa-manifest.test.mjs`; `node --test tests/pwa-manifest.test.mjs` failed 4/4 before implementation (`manifest.webmanifest` missing, `icons/icon-192.png` missing, `pwa-register.js` missing, `index.html` missing manifest/icon/script links).
2. **Green**:
   - Created subpath-relative `manifest.webmanifest` (`start_url: "./"`, `scope: "./"`, `display: "standalone"`, relative PNG icons).
   - Generated valid PNG icons `icons/icon-192.png` (192x192) and `icons/icon-512.png` (512x512).
   - Created `pwa-register.js` registering `./sw.js` with `{ scope: "./", updateViaCache: "none" }`, graceful fallback when Service Worker is unavailable or rejected, and `wips:logout` / same-origin `postMessage` forwarding to `{ type: "WIPS_CLEAR_SESSION" }`.
   - Updated outer `<head>` and `<body>` of `index.html` and added static allowlist/MIME handling in `server.mjs`.
   - Re-ran `node scripts/sync-office.mjs` to confirm outer tags are preserved.

## Verification Results
- `node scripts/sync-office.mjs && node --test tests/pwa-manifest.test.mjs`: 4/4 pass
- `node --test` (full suite): 57/57 pass
