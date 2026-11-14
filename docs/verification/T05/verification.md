# T05 검증 보고서 — OPFS 연결 설정·실시간 Notion 조회·로그아웃 버튼

- 실행 일시: 2026-11-14
- 산출물:
  - [wips-office.html](file:///Users/kangseokgyu/workspace/WIPS-Office/wips-office.html)
  - [index.html](file:///Users/kangseokgyu/workspace/WIPS-Office/index.html) (`node scripts/sync-office.mjs` 동기화)
  - [auth-and-live-query.test.mjs](file:///Users/kangseokgyu/workspace/WIPS-Office/tests/auth-and-live-query.test.mjs)

## 검증 결과

1. **TDD 실패 확인**:
   - 명령: `node --test tests/auth-and-live-query.test.mjs`
   - 종료 코드: `1` (정적 모드 미연결 화면 및 OPFS 연결/로그아웃 테스트 2건 실패, 로컬 서버 회귀 1건 통과)
2. **동기화 및 T05 테스트**:
   - 명령: `node scripts/sync-office.mjs && node --test tests/auth-and-live-query.test.mjs`
   - 종료 코드: `0` (3/3 통과 — 미연결 시 업무·DB ID 미노출 + 보안 체크리스트 표시, OPFS 연결 저장 및 실시간 조회·실패 시 데이터 유지·재접속 복원·로그아웃 시 진행 중 fetch 중단 + `removeEntry` + SW 정리 훅 + DOM 즉시 초기화 + 재로드 미노출 확인, 로컬 `/api/tasks` 모드 유지)
3. **전체 회귀 테스트**:
   - 명령: `node --test`
   - 종료 코드: `0` (51/51 통과)
