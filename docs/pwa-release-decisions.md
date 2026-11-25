# WIPS Office — GitHub Pages PWA 배포·보안 정책 결정 (`T01`)

작성일: 2026-11-14  
기준 명세: [SPEC.md](file:///Users/kangseokgyu/workspace/WIPS-Office/SPEC.md) · 실행 계획: [PLAN.md](file:///Users/kangseokgyu/workspace/WIPS-Office/PLAN.md)

---

## 1. GitHub Pages 배포 대상 및 하위 경로 호환 규칙

- **배포 방식**: GitHub Actions(`actions/deploy-pages`) 기반 무데이터 정적 앱 셸 배포 (`dist/`).
- **예상 게시 경로**: `https://<github-owner>.github.io/<repo-name>/` (예: `/WIPS-Office/`). 원격 저장소 확정 전까지 특정 저장소명이나 루트 경로(`/`)를 하드코딩하지 않는다.
- **상대 경로 원칙**:
  - `index.html`, `manifest.webmanifest`, `pwa-register.js`, `sw.js`, `icons/`의 모든 자산 참조와 `start_url`, `scope`는 `./` 기준 상대 경로를 사용한다.
  - 루트 절대 경로(`/manifest.webmanifest`, `/sw.js`, `/icons/...`)는 사용을 금지한다.
- **무데이터 & 무식별자 원칙**:
  - 정적 배포물(`dist/`)에는 `wips-data.json`, `.env`, `server.mjs`, 실제 업무 제목·URL, 실제 Notion `DATA_SOURCE_ID`·`SOURCE_URL`·토큰을 일절 포함하지 않는다.

---

## 2. 읽기 전용 Notion API 직접 호출 규격 (중계 서버 없음)

`bean-pocket`과 동일하게 별도의 프록시/중계 서버 없이 브라우저에서 `https://api.notion.com/v1`으로 직접 요청을 전송한다.

- **허용 메서드 및 경로 (Read-Only)**:
  - `POST https://api.notion.com/v1/data_sources/{uuid}/query` (`{uuid}`는 표준 UUID 형식만 허용)
  - `GET https://api.notion.com/v1/blocks/{id}/children` (할 일 체크리스트 읽기 전용 조회)
  - 페이지 생성·수정·삭제(쓰기) API는 클라이언트에 포함하지 않는다.
- **네트워크 격리 옵션 및 금지 사항**:
  - 모든 `fetch` 호출에 `credentials: 'omit'`, `redirect: 'error'`, `cache: 'no-store'`를 적용한다.
  - 제3자 프록시나 별도의 CORS 중계 서버를 경유해 토큰을 전송하지 않는다.

---

## 3. 최소 권한 CSP(`Content-Security-Policy`) 정책

기존 `index.html`에 남아 있던 외부 서드파티 CDN 도메인(`cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `esm.sh`, `unpkg.com`, `fonts.bunny.net`, `fonts.googleapis.com`, `fonts.gstatic.com`, `persistent.oaistatic.com`)과 `'unsafe-eval'`/`'wasm-unsafe-eval'`을 전면 제거한다.

### 3.1 외부 셸 `index.html` CSP
```text
default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.notion.com; worker-src 'self'; manifest-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
```

### 3.2 내부 `data-srcdoc` 문서 CSP
```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.notion.com; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

- **DOM XSS 방어 규칙**: 모든 UI 및 동적 DOM 갱신은 `document.createElement`, `textContent`, `replaceChildren`만 사용하며 `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function`을 금지한다.

---

## 4. Notion Integration 및 기기 보안 지침

1. **Read content 전용 권한**: Notion Integration 설정의 Capabilities에서 **`Read content`(콘텐츠 읽기)만 활성화**하고 Update/Insert/User 정보 읽기 권한은 모두 해제한다.
2. **단일 DB 연결**: 워크스페이스 전체가 아닌 **WIPS 업무 데이터베이스 페이지 1개에만** Integration 연결(`Connect to`)을 부여한다.
3. **개인 기기 격리 저장 및 공용 PC 금지**:
   - 연결 설정(`connection.json`)과 마지막 스냅샷 캐시(`snapshot-cache.json`)는 개인 기기 브라우저의 OPFS(`wips-office-private-v1`)에만 저장하며, `localStorage`·`sessionStorage`·`indexedDB`에 토큰이나 업무 데이터를 저장하지 않는다.
   - 공용 PC 또는 타인과 공유하는 브라우저에서는 입력하지 않으며, 사용 종료 시 상단 `로그아웃` 버튼으로 OPFS·SW 캐시·화면 데이터를 즉시 파기한다.
