# T13 Pre-Release Verification Report

## Repository & Hygiene Status
- Branch: `main`
- Remote configured: none (`git remote -v` returned empty; no push/publish performed)
- Ignored paths (`git status --ignored`): `.env`, `dist/`
- Commits completed prior to T13 report:
  - `208a38c` T00: initialize git repository and baseline files
  - `c049fd5` T00: record baseline verification report
  - `01b7a27` T01: document PWA release, CORS relay, and strict CSP decisions
  - `35f8b29` T02: define empty snapshot, OPFS store, and logout destruction contracts
  - `7f06bc9` T03: add deterministic sync script with empty snapshot and strict CSP hardening
  - `86482a4` T04: extract read-only Notion client module and add stateless CORS relay worker
  - `5e79df7` T05: implement OPFS connection UI, read-only live Notion query, and instant logout destruction
  - `2399435` T06: refine mobile responsive layout, touch targets, and seating tests
  - `19bf5ea` T07: add PWA manifest, PNG icons, pwa-register.js, and server asset MIME support
  - `52b842a` T08: implement scope-isolated Service Worker app shell, offline cache, and logout purge
  - `9c2fe0d` T09: add zero-data GitHub Pages packager and verify-dist security audit
  - `2512129` T10: add minimal-privilege GitHub Pages deployment workflow
  - `ab2ff72` T11: add subpath /WIPS-Office/ integration tests and acceptance report
  - `c1110b4` T12: document GitHub Pages PWA mode, OPFS security, CORS proxy, and troubleshooting

## Pre-Release Verification Results
- `node scripts/build-pages.mjs && node scripts/verify-dist.mjs`:
  - Output: `dist/` contains 6 allowlisted files (`index.html`, `manifest.webmanifest`, `pwa-register.js`, `sw.js`, `icons/icon-192.png`, `icons/icon-512.png`), `swVersion=wips-4e599f13d59c`
  - Audit result: `verify-dist: OK (zero data, zero secrets, strict CSP, allowlist verified)`
- `node --test` (full suite, `BypassSandbox: true`):
  - Result: 66/66 passed, 0 failed, 0 skipped

## Security Invariants Summary
- Zero real Notion tasks, `.env` secrets, tokens, real `DATA_SOURCE_ID`, or real `SOURCE_URL` exist in built `dist/` (`fixtures/empty-snapshot.json` embedded).
- Static PWA credentials (`connection.json`) and cached snapshot (`snapshot-cache.json`) are stored solely in OPFS (`wips-office-private-v1`) and cleared cleanly on `로그아웃`.
- Strict CSP (`default-src 'none'`, no `'unsafe-eval'`, no external CDNs, no `innerHTML`/`outerHTML`/`eval`/`new Function`) enforced on outer shell and `data-srcdoc`.
- GitHub Actions `.github/workflows/deploy-pages.yml` uses minimal permissions (`contents: read` at root, `pages: write` / `id-token: write` on `deploy`), `persist-credentials: false`, and zero `NOTION_TOKEN` secrets.

## Pending Manual Steps Before Public Launch
1. Add GitHub remote (`origin`) and push `main` after explicit user confirmation.
2. Enable GitHub Repository Settings → Pages → Source: `GitHub Actions`.
3. Deploy stateless CORS proxy (`scripts/cors-proxy-worker.mjs`) to Cloudflare Workers (or equivalent HTTPS origin) with `ALLOWED_ORIGINS=https://<owner>.github.io`.
4. Verify live HTTPS GitHub Pages URL on desktop Chromium DevTools and physical iOS Safari / Android Chrome devices.
