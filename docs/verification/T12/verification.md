# T12 Verification — Documentation & Zero-Secret Audit (`README.md`)

## Changes
- Updated `README.md` to cover both Local Server Mode (`node server.mjs`) and GitHub Pages Zero-Data Static PWA Mode (`scripts/build-pages.mjs`, `scripts/verify-dist.mjs`).
- Replaced hardcoded Notion database ID and Notion page link in `README.md` with placeholder documentation (`<YOUR_DATA_SOURCE_UUID>`).
- Documented Notion Integration minimal permissions (`Read content` only, single DB connection, no shared/public PCs), stateless CORS proxy (`scripts/cors-proxy-worker.mjs` with `/v1` suffix and `ALLOWED_ORIGINS`), OPFS isolation (`wips-office-private-v1`) + `로그아웃` destruction, mobile home-screen installation, and troubleshooting.

## Verification Results
- Grep secret check on `README.md` (`! grep -E "45edae11|f71627a|ntn_|secret_" README.md`): exit code 0 (zero matches)
- `node scripts/build-pages.mjs && node scripts/verify-dist.mjs`: exit code 0 (`verify-dist: OK`, `swVersion=wips-4e599f13d59c`, `files=6`)
- `node --test` (full suite, `BypassSandbox: true`): 66/66 pass
