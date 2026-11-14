# T00 검증 보고서 — 기준점과 실행 환경 확정

- 실행 일시: 2026-11-14
- 초기 기준 커밋 해시 (`main`): `208a38c7ef50c57df43ef3d5383cb67fca8e5162`
- Node.js 버전: `v22.17.0`
- Git 버전: `git version 2.54.0 (Apple Git-157)`

## 1. Git 저장소 및 무시 규칙 확인

- `git init -b main` 수행 후 초기 기준 커밋(`208a38c7ef50c57df43ef3d5383cb67fca8e5162`) 생성.
- `.gitignore`에 `.env`, `.env.*`, `!.env.example`, `dist/`, `node_modules/`, `*.log` 포함 확인.
- `git status --ignored` 결과 `.env`가 `Ignored files`로 분류되어 추적 대상에서 제외됨을 확인.
- `git worktree list` 출력:
  `/Users/kangseokgyu/workspace/WIPS-Office 208a38c [main]`

## 2. 루트 추적 파일 목록 (주요 프로젝트 파일)

- `.env.example`, `.gitignore`, `PLAN.md`, `PWA-MIGRATION-PLAN.md`, `README.md`, `SPEC.md`
- `index.html`, `wips-office.html`, `wips-data.json`, `drag-verification.png`
- `server.mjs`, `server.test.mjs`, `wips-office.test.mjs`
- `.agents/` 하위 스킬/에이전트 정의 파일 일체

## 3. 테스트 기준선 (`node --test`)

1. **표준 샌드박스 내 실행 (`BypassSandbox: false`)**:
   - 명령: `node --test`
   - 종료 코드: `1`
   - 결과: 총 34개 중 29개 통과, 5개 실패 (`server.test.mjs` 내 로컬 `127.0.0.1` HTTP 소켓 접속 시 샌드박스 `connect EPERM` 제약)
2. **로컬 루프백 허용 실행 (`BypassSandbox: true`)**:
   - 명령: `node --test`
   - 종료 코드: `0`
   - 결과: 총 34개 중 34개 통과, 0개 실패 (`duration_ms: 499.984375`)

## 4. 브라우저 검증 도구 가용 여부

- `/Applications/Google Chrome.app` 설치 확인
- `npx` (`/Users/kangseokgyu/.nvm/versions/node/v22.17.0/bin/npx`) 가용 확인
