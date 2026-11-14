# Pixel Agent HQ

Notion의 일감 데이터베이스를 읽어 픽셀 탑뷰 가상 오피스(Pixel Agent HQ) 화면에 반영합니다. 직원 선택, 업무 말풍선, 상세 카드, 상태·프로젝트 필터를 제공합니다.

## 실행 (모드 선택)

### A. 로컬 서버 모드 (`node server.mjs`)

Node.js 20 이상을 사용합니다(CI/권장 Node 22). 외부 패키지 설치는 필요 없습니다.

1. `.env.example`을 복사해 `.env`를 만듭니다.
2. `.env`의 `NOTION_TOKEN`, `NOTION_DATA_SOURCE_ID`(필요 시 `NOTION_SOURCE_URL`)를 입력합니다.
3. 프로젝트 폴더에서 서버를 실행합니다.

```bash
cp .env.example .env
# .env를 열어 NOTION_TOKEN 등을 설정
node server.mjs
```

브라우저에서 <http://127.0.0.1:8000/>을 엽니다. 서버가 시작되면 화면이 Notion을 조회하고, 이후 30초마다 자동 갱신합니다. `지금 갱신` 버튼으로 즉시 조회할 수도 있습니다.

서버는 로컬 `127.0.0.1`에서만 요청을 받습니다. 브라우저에 Notion 토큰을 보내지 않으며, `.env`와 서버 코드는 정적 파일로 제공되지 않습니다. 토큰을 환경변수 `NOTION_TOKEN`으로 전달할 수도 있습니다. `PORT`는 선택 사항이며 기본값은 `8000`입니다.

### B. GitHub Pages 정적 PWA 모드 (Zero-Data)

GitHub Pages에 배포되는 `dist/` 번들은 **실제 일감 데이터(`wips-data.json`), `.env`, 토큰, 실제 Data Source ID 및 페이지 URL을 전혀 포함하지 않습니다.** 연결 전 첫 화면은 빈 스냅샷(`results: []`) 상태로 열립니다.

```bash
node scripts/build-pages.mjs   # dist/ 정적 PWA 번들 생성 (빈 스냅샷 내장)
node scripts/verify-dist.mjs   # Zero-Data / Zero-Secret / CSP / allowlist 보안 검증
```

배포 워크플로우는 `.github/workflows/deploy-pages.yml`에 정의되어 있으며 `main` 푸시 또는 수동 실행(`workflow_dispatch`) 시 `node --test` → `build-pages.mjs` → `verify-dist.mjs` 검증을 통과한 경우에만 GitHub Pages에 배포합니다.

## Notion 연결 및 보안 규칙

### 1. Notion Integration 설정 (최소 권한)

- Notion Integrations에서 새 Integration을 만들 때 **Capabilities는 `Read content`만 허용**하세요. (`Update content`, `Insert content`, 사용자 정보 권한 비활성 권장)
- **대상 Notion 데이터베이스 페이지 단 하나에만** 해당 Integration을 연결하세요.
- Data Source UUID 형식(`<YOUR_DATA_SOURCE_UUID>`, 예: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)을 확인해 로컬 `.env` 또는 정적 PWA 연결 폼에 입력합니다.
- **공용·타인 PC/공용 브라우저에서는 절대 토큰을 입력하거나 연결하지 마세요.**

### 2. 개인 OPFS 저장소 및 `로그아웃` 즉시 파기

- 정적 PWA 모드에서 입력한 Notion 토큰, `dataSourceId`(`connection.json`)와 마지막 조회 스냅샷(`snapshot-cache.json`)은 **현재 개인 브라우저의 비공개 OPFS(`wips-office-private-v1`)에만 저장**되며, `https://api.notion.com/v1` 조회 전용 엔드포인트로 직접 요청합니다(중계 서버 없음).
- `localStorage`에는 UI 레이아웃·자리 배치 키(`wips-office-seating-v1`, `codex:visualization-widget-*`)만 저장되며, 토큰이나 일감 스냅샷은 절대 저장되지 않습니다.
- Service Worker(`sw.js`)는 정적 앱 셸(`./`, `./index.html`, `./manifest.webmanifest`, `./pwa-register.js`, `./icons/*`)만 캐시하며 `POST`, `Authorization` 헤더 요청, `/v1/data_sources/`, `/api/`, `wips-data.json`은 절대 캐시하지 않습니다.
- **`로그아웃` 버튼**을 누르면 진행 중인 fetch 요청과 폴링 타이머를 즉시 중단하고, OPFS의 `connection.json` / `snapshot-cache.json`을 `removeEntry`로 파기하며, Service Worker 세션 캐시 정리 후 메모리와 화면 DOM을 빈 상태로 초기화합니다.

## 모바일 홈 화면 설치 (PWA)

- **Android (Chrome)**: GitHub Pages 주소(`https://<owner>.github.io/<repo>/`) 접속 → 브라우저 메뉴 → **앱 설치** 또는 **홈 화면에 추가** 선택.
- **iOS (Safari)**: GitHub Pages 주소 접속 → 하단 **공유** 아이콘 → **홈 화면에 추가** 선택.
- 설치 후 오프라인에서도 앱 셸이 열리며, 로그인 상태였다면 OPFS에 보관된 마지막 캐시 스냅샷을 읽기 전용으로 표시하고, 로그아웃 상태에서는 0건 화면만 표시합니다.

## Notion 속성 및 매핑

Notion Personal Access Token(PAT) 또는 내부 integration token을 사용할 수 있습니다. 내부 integration을 쓰는 경우 해당 integration에 읽기 권한(`Read content`)을 주고, 대상 데이터베이스를 integration과 공유해야 합니다.

조회 속성은 `일감`(title), `담당자`(select), `상태`(status), `프로젝트`(select), `우선순위`(select), `구분`(select), `다음 조치`(rich text), `완료 조건`(rich text), `목표일`(date), `다음 확인일`(date)입니다. 캐릭터의 건수와 대표 말풍선은 `상위 일감` 연결이 없는 최상위 일감만 집계합니다. 상세 목록에는 하위 일감도 표시합니다. 상태·프로젝트 필터는 집계에도 적용됩니다.

새로운 담당자·상태·프로젝트 옵션도 화면 필터와 직원 목록에 반영됩니다.

공식 참고 문서:

- [Query a data source](https://developers.notion.com/reference/query-a-data-source) — `start_cursor`와 `page_size`를 이용해 모든 페이지를 조회합니다.
- [Request limits](https://developers.notion.com/reference/request-limits) — `429` 응답의 `Retry-After`를 준수합니다. 대기가 설정 한도를 넘으면 해당 조회를 포기하고 다음 폴링까지 대기합니다.
- [Notion API quick start](https://developers.notion.com/guides/notion-api/quick-start) — PAT 및 API 버전 안내.

## 실패 처리

Notion 조회가 실패하면 현재 화면의 데이터를 유지하고 오류와 마지막 성공 시각을 표시합니다. 최초 조회에 실패해도 내장된 `wips-data.json` 스냅샷으로 화면을 계속 볼 수 있습니다. 서버의 `.env`에 토큰을 설정한 뒤 재시도하거나 서버를 다시 시작하세요.

## 문제 해결 (Troubleshooting)

- **네트워크 / CSP 연결 실패**: 정적 PWA는 브라우저에서 `https://api.notion.com/v1`로 직접 요청합니다. 사내 네트워크·프록시·브라우저 확장 프로그램이 `api.notion.com` 통신을 차단하지 않는지 확인하세요.
- **Notion `401` / `403` / `404`**: Notion Integration의 `Read content` 권한과 대상 데이터베이스 페이지 공유 연결 상태, 그리고 Data Source UUID 형식을 확인하세요.
- **OPFS를 사용할 수 없음**: HTTPS 또는 `localhost`/`127.0.0.1`의 일반 브라우저 창에서 접속해야 OPFS가 동작합니다. 일부 인앱 브라우저나 프라이빗 브라우징 모드에서는 OPFS 저장이 제한될 수 있습니다.

## 파일

- `server.mjs`: 로컬 정적 서버, Notion API 조회·매핑·페이지네이션·제한 시간 처리
- `index.html`, `wips-office.html`: 사무실 UI 및 iframe 실행본
- `manifest.webmanifest`, `pwa-register.js`, `sw.js`, `icons/`: 서브패스 상대 경로 PWA 메타데이터, Service Worker 앱 셸 캐시, 아이콘
- `lib/`: `notion-client.mjs` (읽기 전용 조회), `opfs-store.mjs` (OPFS 저장/파기), `snapshot-schema.mjs` (빈 스냅샷 및 입력 검증)
- `scripts/`: `sync-office.mjs` (CSP/DOM 동기화), `build-pages.mjs` (`dist/` 패키징), `verify-dist.mjs` (보안·Zero-Data 검증)
- `.github/workflows/deploy-pages.yml`: GitHub Pages 빌드·보안 감사·배포 워크플로우
- `fixtures/`: `empty-snapshot.json`, `sample-snapshot.json`
- `wips-data.json`: 로컬 서버 실행 시 사용하는 캐시 스냅샷 (`dist/`에는 포함되지 않음)
- `.env.example`: 로컬 설정 예시

## 검증

```bash
node --test
node scripts/build-pages.mjs && node scripts/verify-dist.mjs
```

테스트는 Notion 응답 mock, 가상 OPFS/Service Worker/브라우저 환경, 그리고 로컬 HTTP 서버를 사용합니다. 실제 Notion API 및 원격 GitHub Pages 연결 확인에는 사용자 토큰과 배포 환경이 필요합니다.

## 자리 배치

`자리 배치`를 누른 뒤 요원을 다른 자리로 드래그하거나 요원 아래 선택 메뉴에서 목적지를 고르면 두 요원의 자리를 교환합니다. `배치 완료`로 편집을 종료하고, `기본 배치로`로 초기화할 수 있습니다. 배치는 현재 브라우저에 자동 저장되며 새로고침과 데이터 갱신 후에도 유지됩니다. 다른 브라우저와 공유되지 않으며 저장이 차단된 경우 안내 메시지를 표시합니다.
