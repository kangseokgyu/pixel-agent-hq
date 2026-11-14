# T01 검증 보고서 — 배포 대상·CORS 중계·CSP 보안 정책 결정

- 실행 일시: 2026-11-14
- 산출물: [pwa-release-decisions.md](file:///Users/kangseokgyu/workspace/WIPS-Office/docs/pwa-release-decisions.md)

## 검증 항목 확인

1. **GitHub Pages 하위 경로 호환성**: `./` 상대 경로 기준과 루트 절대 경로 금지 원칙 명시 완료.
2. **무상태 CORS 중계 규격**: `OPTIONS` 및 `POST /v1/data_sources/{uuid}/query`만 허용하고 Origin 검증 및 무저장·무로깅 규격 명시 완료 (제3자 공개 프록시 배제).
3. **최소 권한 CSP 정책**: 외부 `index.html` 및 내부 `data-srcdoc`의 CSP 지시어를 확정하고 기존 외부 CDN 도메인 및 `'unsafe-eval'` 제거 대상 명시 완료.
4. **비밀정보·식별자 미포함 확인**: 문서 내 실제 Notion 토큰, `DATA_SOURCE_ID`, `SOURCE_URL` 미포함 확인.
