# T11 Acceptance Report — Subpath (`/WIPS-Office/`) PWA Verification

## Verified Locally
1. **Subpath Static Bundle HTTP Serving (`/WIPS-Office/`)**:
   - Served built `dist/` mounted at `/WIPS-Office/` via local `node:http` (`tests/subpath-acceptance.test.mjs`).
   - Verified HTTP 200 and proper MIME types for `/WIPS-Office/`, `/WIPS-Office/index.html`, `/WIPS-Office/manifest.webmanifest`, `/WIPS-Office/pwa-register.js`, `/WIPS-Office/sw.js`, `/WIPS-Office/icons/icon-192.png`, and `/WIPS-Office/icons/icon-512.png`.
   - Verified HTTP 404 for `/WIPS-Office/wips-data.json`, `/WIPS-Office/api/tasks`, `/WIPS-Office/.env`, and `/wips-data.json`.
   - Verified `dist/index.html` contains zero task records, zero real `DATA_SOURCE_ID`, and zero real `SOURCE_URL` page IDs.
2. **Built `dist/index.html` Static Lifecycle (VM & Mock OPFS)**:
   - Unconnected boot renders `wips-office-main-view` hidden, security checklist visible, and zero employees/tasks.
   - Connection form persists validated config and snapshot to OPFS (`wips-office-private-v1`) and sends read-only `POST .../v1/data_sources/{uuid}/query`.
   - Transient 502 error retains cached office view and OPFS snapshot.
   - `로그아웃` deletes OPFS `connection.json` and `snapshot-cache.json`, triggers SW session cache clear hook + `wips:logout` event, clears rendered employees/tasks immediately, and keeps offline reload empty.
3. **Mobile Responsive & Strict CSP**:
   - Built `dist/index.html` includes outer + `srcdoc` strict CSP, viewport meta (`width=device-width, initial-scale=1`), `@media (max-width: 480px)` rules, `touch-action: manipulation`, `min-height: 44px`, `font-size: 16px`, and `overflow-x: clip`.
   - Service Worker subpath cache lifecycle and bypass rules verified in `tests/pwa-offline-update.test.mjs`.

## Pending Live / Physical Verification (Requires Deployment)
- Live HTTPS GitHub Pages subpath deployment (`https://<owner>.github.io/<repo>/`) and real browser Service Worker / OPFS / CacheStorage inspection in Chromium DevTools Application tab.
- Deployed stateless Cloudflare Workers CORS proxy (`scripts/cors-proxy-worker.mjs`) against live Notion API.
- Physical iOS Safari ("Add to Home Screen") and Android Chrome PWA installation, touch dragging, and airplane-mode launch tests.

## Command Results
- `node --test tests/subpath-acceptance.test.mjs`: 2/2 pass (`BypassSandbox: true`)
- `node --test`: 66/66 pass (`BypassSandbox: true`)
