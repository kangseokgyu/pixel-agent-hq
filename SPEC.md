# WIPS Office — GitHub Pages PWA 명세

작성일: 2026-11-14  
근거: PWA-MIGRATION-PLAN.md · 보안 기준: `bean-pocket` 보안 아키텍처 + 미흡 요소 보완  
상태: 구현 전 명세. 배포 대상(GitHub 저장소·Pages 주소)은 운영 설정 시 확정한다.

## Problem Statement

사용자는 PC에서 로컬 서버를 실행하지 않고도 모바일에서 WIPS 업무 현황을 확인하고 싶다. 현재 화면은 로컬 서버의 Notion 조회 API에 의존하므로 정적 호스팅에 그대로 게시하면 데이터 갱신이 동작하지 않는다. 또한 사내 업무 내용은 보안이 중요하므로 정적 배포물에 업무 데이터(`wips-data.json`), Notion 토큰, 그리고 실제 Notion 데이터 소스 ID(`DATA_SOURCE_ID`)·원본 페이지 URL(`SOURCE_URL`)이 포함되어 외부에 노출되어서는 안 된다.

기존 선행 PWA(`bean-pocket`)는 OPFS 격리 보관·외부 의존성 제로·산출물 보안 검사라는 강점을 갖췄으나, ① 기기 내 OPFS 연결·캐시 데이터를 한 번에 지우는 **로그아웃 버튼**, ② `index.html`의 **엄격한 CSP(`Content-Security-Policy`) 강제**, ③ **읽기 전용 권한 제한**이 보완점으로 남았다. 또한 현재 `WIPS-Office`의 [index.html](file:///Users/kangseokgyu/workspace/WIPS-Office/index.html) CSP에는 불필요한 외부 CDN 도메인(`cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `esm.sh`, `unpkg.com`, `persistent.oaistatic.com` 등)이 열려 있어 이를 전면 제거해야 한다.

따라서 모바일에서 앱처럼 실행하고, 본인 개인 기기의 격리 저장소(OPFS)에만 연결 정보를 안전하게 보관해 실시간으로 조회하며, 필요 시 즉시 **로그아웃**해 모든 흔적을 지울 수 있는 보안 강화 PWA를 구축한다.

## Solution

화면을 GitHub Pages에 **업무 데이터와 Notion 식별자가 전혀 포함되지 않은 정적 PWA 앱 셸(App Shell)**로 게시한다(**Zero-Data & Zero-Identifier**). `wips-data.json`, HTML 내장 스냅샷 데이터, 실제 `DATA_SOURCE_ID`·`SOURCE_URL`은 정적 배포물에 일절 포함하지 않는다. 별도의 상시 백엔드 DB/상태 서버는 운영하지 않으며, 기존 로컬 서버(`node server.mjs`) 실행 방식은 그대로 유지한다.

정적 배포 환경에서는 사용자가 본인 개인 기기(스마트폰·개인 PC)에서 입력한 **읽기 전용 Notion 토큰과 데이터 소스 ID**를 일반 `localStorage`가 아닌 브라우저 전용 비공개 파일 시스템인 **OPFS(`navigator.storage.getDirectory()`)**에 격리 저장한다. 접속 및 새로고침 시마다 `bean-pocket`과 동일하게 브라우저에서 `https://api.notion.com/v1` 조회 전용 API(`POST /v1/data_sources/{id}/query`)를 직접 호출(`credentials: 'omit'`, `redirect: 'error'`, `cache: 'no-store'`)해 최신 데이터를 표시하며, 별도의 CORS 중계 서버는 두지 않는다.

보안을 완성하기 위해 ① `index.html` 및 내부 `data-srcdoc`에 **외부 서드파티 CDN을 전면 제거한 엄격한 CSP**를 강제하고 `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval` 사용을 금지하며, ② 상단 **로그아웃 버튼** 클릭 시 OPFS 연결 파일·스냅샷 캐시(`removeEntry`), Service Worker 데이터 캐시, 진행 중 요청, 메모리/DOM 업무 현황을 즉시 모두 파기한다.

## User Stories

1. 사용자로서, PC 서버를 켜지 않고 모바일에서 업무 현황을 확인하고 싶다. 외부에서도 현황을 볼 수 있기 때문이다.
2. 사용자로서, 게시 주소에 직접 접속하고 새로고침하고 싶다. 별도 실행 절차 없이 화면을 열기 위해서다.
3. 사용자로서, 앱을 홈 화면에 추가하고 싶다. 자주 사용하는 업무 화면에 빠르게 접근하기 위해서다.
4. 사용자로서, 작은 화면에서 사무실을 이동하며 보고 싶다. 직원과 업무를 놓치지 않기 위해서다.
5. 사용자로서, 터치로 직원을 선택하고 상세 카드를 보고 싶다. 담당 업무를 확인하기 위해서다.
6. 사용자로서, 상태와 프로젝트로 필터링하고 싶다. 필요한 일감에 집중하기 위해서다.
7. 사용자로서, 모바일에서 자리 배치를 변경하고 싶다. 원하는 배치로 사무실을 보기 위해서다.
8. 사용자로서, 같은 브라우저에서 다시 열었을 때 자리 배치가 복원되기를 원한다. 반복 설정을 피하기 위해서다.
9. 사용자로서, 개인 기기 브라우저의 격리 저장소(OPFS)에 읽기 전용 Notion 토큰과 데이터 소스 ID를 등록해 바로 Notion 데이터를 조회하고 싶다. 정적 배포물에 업무 데이터나 DB 식별자를 올리지 않고도 최신 현황을 보기 위해서다.
10. 사용자로서, 같은 기기에서 앱을 다시 열었을 때 OPFS에 저장된 연결 정보로 자동 복원·조회되기를 원한다. 매번 토큰과 ID를 다시 입력하지 않기 위해서다.
11. 사용자로서, **로그아웃 버튼**을 눌러 기기에 저장된 OPFS 연결 파일(토큰·데이터 소스 ID), OPFS/Service Worker 스냅샷 캐시, 현재 화면 메모리와 DOM의 업무 데이터를 즉시 모두 삭제하고 싶다. 기기 변경이나 보안 필요 시 업무 정보와 접근 권한을 남기지 않기 위해서다.
12. 사용자로서, 마지막 데이터 조회 성공 시각을 보고 싶다. 정보가 얼마나 최신인지 판단하기 위해서다.
13. 사용자로서, 새로고침 버튼으로 Notion 최신 데이터를 다시 조회하고 싶다. 현재 시점의 최신 업무 현황을 즉시 반영하기 위해서다.
14. 사용자로서, 연결이 끊겨도(로그인 상태인 경우) 마지막으로 정상 로드한 데이터를 보고 싶다. 이동 중에도 현황을 확인하기 위해서다.
15. 사용자로서, 오프라인 상태와 캐시된 데이터의 기준 시각을 알고 싶다. 오래된 정보를 최신 정보로 오인하지 않기 위해서다.
16. 사용자로서, 데이터 조회 실패 시 현재 화면의 데이터가 유지되기를 원한다. 일시적 오류 때문에 현황을 잃지 않기 위해서다.
17. 사용자로서, 새 버전 배포 후 변경된 화면을 사용할 수 있기를 원한다. 오래된 캐시 때문에 수정 사항을 놓치지 않기 위해서다.
18. 로컬 사용자로서, 기존 로컬 서버(`node server.mjs`)의 Notion 연동을 계속 사용하고 싶다. 정적 배포 도입 이후에도 기존 작업 방식을 유지하기 위해서다.
19. 데이터 관리자로서, 배포물(`index.html` 및 `data-srcdoc` 포함)에 `wips-data.json`, 실제 업무 데이터, Notion 토큰, 실제 `DATA_SOURCE_ID`·`SOURCE_URL`이 전혀 포함되지 않기를 원한다. 게시 URL이 외부에 알려져도 업무 내용과 대상 DB 식별자가 노출되지 않게 하기 위해서다.
20. 보안 담당자로서, 브라우저 코드에 외부 서드파티 CDN 스크립트가 없고, 엄격한 CSP와 DOM XSS 방어(`createElement` + `textContent`)가 강제되며, 클라이언트가 조회 전용(`query`)만 호출하기를 원한다.
21. 운영자로서, 읽기 전용 토큰 발급(단일 DB 연결), 공용 PC 사용 금지 안내, 모바일 설치, 로그아웃 및 장애 확인 절차를 문서로 확인하고 싶다. 배포를 안전하고 지속적으로 관리하기 위해서다.

## Implementation Decisions

- **정적 배포물 무데이터 & 무식별자(Zero-Data & Zero-Identifier) 원칙**:
  - 정적 배포물(`dist/`)에는 `wips-data.json`을 포함하지 않으며, `index.html` 및 `wips-office.html`의 초기 내장 데이터도 빈 스냅샷(`results: []`, `sourceUrl: ""`)으로 빌드한다.
  - `server.mjs`에 기본값으로 정의된 실제 `DATA_SOURCE_ID`와 `SOURCE_URL`을 정적 배포 코드에 포함하지 않는다.
  - 연결 설정이 없는 상태로 접속하면 업무 데이터나 DB 식별자 없이 연결 입력 UI만 표시한다.
- **환경별 데이터 공급 방식 구분**:
  - 로컬 서버 환경(`node server.mjs`): 기존처럼 서버의 `.env` 설정, 기본 `DATA_SOURCE_ID`, `/api/tasks` 엔드포인트를 유지한다.
  - 정적 PWA 환경(GitHub Pages): 기기 OPFS에 저장된 사용자 Notion 토큰과 데이터 소스 ID를 사용해 조회 전용으로 Notion 데이터를 실시간 조회한다.
- **OPFS 격리 보관 (자격증명 및 스냅샷 캐시)**:
  - Notion 토큰, 데이터 소스 ID(`connection.json`), 마지막 성공 스냅샷 캐시(`snapshot-cache.json`)는 일반 `localStorage`·`sessionStorage`·`indexedDB`가 아닌 **OPFS(`navigator.storage.getDirectory()` 하위 전용 디렉터리 `wips-office-private-v1`)**에 보관한다. (미지원 환경에서는 영속 저장하지 않고 명시적 안내 또는 세션 메모리 전용 모드로 처리한다.)
  - 토큰·데이터 소스 ID 입력 시 제어 문자, 빈 값, UUID 형식을 엄격히 검증한다.
  - 읽기 전용 권한 제한을 안내하기 위해 연결 UI에 **"Read content(콘텐츠 읽기) 권한만 체크 + WIPS 단일 DB만 연결 + 공용 PC 사용 금지"** 체크리스트를 명시한다.
- **읽기 전용 Notion API 직접 조회 (중계 서버 없음)**:
  - 브라우저용 Notion 클라이언트(`lib/notion-client.mjs`)는 `bean-pocket`과 동일하게 별도의 프록시/중계 서버 없이 `https://api.notion.com/v1`으로 직접 `fetch` 요청(`credentials: 'omit'`, `redirect: 'error'`, `cache: 'no-store'`)을 전송한다.
  - 호출 범위는 **오직 데이터 소스 조회(`POST /v1/data_sources/{id}/query`)만 허용**하도록 제한하고 페이지 생성·수정·삭제(쓰기) 메서드는 원천 배제한다.
  - 기존 `server.mjs`의 페이지네이션·속성 매핑·타임아웃·`429 Retry-After`·불완전 응답 검증 로직을 공용 모듈로 재사용한다.
- **엄격한 CSP(`Content-Security-Policy`) 및 DOM XSS 원천 차단**:
  - 정적 배포물의 `index.html` 및 내부 `data-srcdoc`에서 불필요한 외부 CDN(`cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `esm.sh`, `unpkg.com`, `persistent.oaistatic.com`, Google/Bunny 폰트 등)을 **CSP에서 전면 제거**한다.
  - `default-src 'none'`, `script-src 'self'`(또는 내장 실행 구조에 필요한 최소 제한, 외부 도메인 0개), `style-src 'self' 'unsafe-inline'`(내장 스타일 한정), `img-src 'self' data:`, `connect-src 'self' https://api.notion.com`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`으로 최소 권한 CSP를 강제한다(부모 `index.html`과 `allow-same-origin` iframe `data-srcdoc` 양쪽 모두 동일하게 적용).
  - 런타임 외부 패키지를 사용하지 않으며, UI 렌더링 시 `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function`을 금지하고 `document.createElement`와 `textContent`만 사용한다.
- **로그아웃(토큰·OPFS·캐시·화면 즉시 파기)**:
  - 화면 상단 컨트롤 영역에 **로그아웃** 버튼을 제공한다(연결 설정 또는 캐시 데이터가 있을 때 표시·활성화).
  - 로그아웃 실행 시 다음을 원자적 순서로 즉시 수행한다:
    1. 진행 중인 `fetch` 요청 중단(`AbortController`) 및 자동 갱신 타이머 해제
    2. OPFS `wips-office-private-v1` 내 `connection.json` 및 `snapshot-cache.json`을 `removeEntry`로 즉시 삭제
    3. Service Worker에 등록된 데이터 캐시(존재 시) 정리 요청
    4. 메모리 내 `snapshot`·`model`을 빈 초기 상태로 교체하고 DOM의 직원 말풍선·상세 카드·미배정 일감 목록을 즉시 비움
    5. 초기 연결 설정 화면으로 전환하고 삭제 완료 안내 표시
  - 로그아웃 직후 새로고침하거나 네트워크를 끊고 오프라인으로 재실행하더라도 이전 업무 데이터나 토큰이 복원되지 않아야 한다.
- **하위 경로 호환성 및 UI 동기화**:
  - 화면·아이콘·manifest·서비스 워커는 GitHub Pages 저장소 하위 경로(`/저장소명/`)에서 상대 경로(`./`)로 동작해야 하며, `start_url`·`scope`도 `./`로 맞춘다.
  - `wips-office.html`과 iframe 실행본(`index.html`)이 결정적 동기화 스크립트로 일관되게 생성되도록 유지한다.
- **PWA 및 오프라인 캐시 정책**:
  - `sw.js`는 순수 정적 앱 셸 리소스만 캐시하며, **Notion API 요청/응답(`Authorization` 헤더 포함)은 Service Worker 캐시에 저장하지 않는다.**
  - 오프라인 복원용 마지막 스냅샷은 **로그인(OPFS 연결 보유) 상태에서만** OPFS(`snapshot-cache.json`)에 보관하고, 로그아웃 시 즉시 삭제한다.
  - 새 버전 배포 시 앱 셸 캐시 교체와 오래된 캐시 정리를 지원한다. 오류 응답이나 유효하지 않은 데이터로 마지막 성공 스냅샷을 덮어쓰지 않는다.
- **산출물 보안 감사(`verify-dist.mjs`)**:
  - 빌드 시 allowlist 기반 파일 검증, 심볼릭 링크 차단, 루트 절대 경로 차단, `wips-data.json`/`.env`/`server.mjs` 차단, 실제 일감 제목·실제 `DATA_SOURCE_ID`·`SOURCE_URL`·토큰 패턴(`ntn_`, `secret_`) 차단, `innerHTML`/`eval`/`localStorage`(토큰 저장 용도) 차단, `https://api.notion.com/v1`(및 허용된 안전한 Notion 페이지 링크 검증 로직) 외의 모든 외부 URL 및 외부 CDN 도메인 차단, CSP 메타 태그 존재 검증을 통과한 경우에만 배포를 허용한다.
- **자리 배치 및 문서화**:
  - 자리 배치는 해당 브라우저에 저장(단, 로그아웃 시 업무 데이터와 분리해 유지할지 초기화할지는 `T02` 계약에 따름)하며 모바일 터치와 선택 메뉴 조작을 검증한다.
  - README에 로컬·정적 실행, 읽기 전용 Notion 토큰 발급(Read content 전용 + 단일 DB 연결), 공용 PC 사용 금지 안내, 로그아웃 동작, 모바일 설치, 실패 확인 절차를 기록한다.

## Testing Decisions

테스트는 사용자가 관찰하는 결과와 배포 산출물의 보안 계약을 검증한다. 내부 함수 호출 횟수나 코드 문자열만으로 PWA 동작을 입증하지 않는다. 동작 변경은 의도한 기능의 부재로 실패하는 테스트를 먼저 확인한 뒤 구현한다.

주된 검증 경계는 **실제 정적 배포물을 저장소 하위 경로로 제공하는 브라우저 실행**이다. 이 경계에서 초기 무데이터·무식별자 상태, OPFS 연결 등록 후 조회, 로그아웃 시 OPFS/캐시/DOM 완전 파기, CSP 차단 동작, 모바일 조작, 오프라인 및 업데이트를 함께 검증한다.

| 대상 | 수용 기준 및 검증 |
| --- | --- |
| 기존 기능 | `node --test`가 통과하고 로컬 서버(`/api/tasks`) Notion 연동, 필터, 직원 선택, 자리 배치가 유지된다. |
| 배포물 보안 감사 | `verify-dist.mjs`가 `wips-data.json`, `.env`, `server.mjs`, Notion 토큰, 실제 업무 데이터, 실제 `DATA_SOURCE_ID`/`SOURCE_URL`, `https://api.notion.com/v1` 외의 외부 URL 및 외부 CDN, `innerHTML`/`eval` 부재 및 엄격한 CSP(`connect-src 'self' https://api.notion.com`) 메타 태그 존재를 검증한다. |
| 미연결 초기 상태 | OPFS 연결이 없는 브라우저로 정적 배포물에 접속하면 어떠한 업무 데이터나 DB 식별자도 노출되지 않고 연결 설정 안내만 표시된다. |
| 정적 실시간 조회 | 읽기 전용 토큰·데이터 소스 ID 등록 후 `https://api.notion.com/v1` 조회 전용(`query`) 직접 호출이 페이지네이션·매핑·429·타임아웃 규칙에 따라 동작하고 새로고침 시 최신 데이터를 다시 조회한다. |
| **로그아웃** | 로그아웃 버튼 클릭 시 OPFS 연결 파일·스냅샷 캐시(`removeEntry`), SW 캐시, 현재 화면 메모리·DOM의 업무 데이터가 즉시 삭제되고, 이후 새로고침이나 오프라인 재실행 시에도 데이터가 나타나지 않는다. |
| CSP 및 XSS 방어 | 엄격한 CSP 메타 태그가 외부 CDN 스크립트·비인가 연결을 차단하며, `createElement` + `textContent` 렌더링이 적용된다. |
| 하위 경로 | 저장소 하위 경로(`/저장소명/`)에서 직접 접속·새로고침 및 모든 PWA 리소스 로드가 성공한다. |
| UI 동기화 | 원본 UI와 iframe 실행본의 기능·보안(빈 초기 스냅샷·강화된 CSP)이 일치한다. |
| 실패 처리 | 조회 실패·불완전한 데이터·검증 실패 시 현재 화면의 마지막 정상 데이터가 유지되고 오류 상태가 표시된다. |
| 오프라인 | 로그인 및 정상 조회 후 연결을 끊고 재실행하면 OPFS의 마지막 스냅샷과 기준 시각이 표시된다. 최초 방문 또는 로그아웃 후 오프라인 방문 시에는 데이터가 표시되지 않는다. |
| 업데이트 | 이전 버전을 캐시한 브라우저에서 새 배포 후 변경 화면을 확인하고 오래된 캐시 정리를 검증한다. |
| 모바일 | Android·iPhone에서 연결 등록/로그아웃, 직원 선택, 상세 카드, 필터, 자리 배치, 저장 복원 및 홈 화면 실행을 확인한다. |
| 실제 게시 | HTTPS 접속과 앱 셸 배포 결과가 실제 게시 화면에 반영된다. |

검증 기록에는 명령, 종료 코드, 결과, 증거 경로를 남긴다. 실제 기기 검증과 에뮬레이션을 구분하고, 실행이 막힌 항목은 이유와 미검증 범위를 명시한다. 문서 작성 단계에서 이 테스트들이 실행되거나 통과한 것으로 간주하지 않는다.

## Out of Scope

- 정적 배포물에 `wips-data.json`, 실제 업무 스냅샷, 또는 실제 `DATA_SOURCE_ID`·`SOURCE_URL`을 포함하여 배포하는 것
- 공용 PC 지원 또는 다중 사용자 계정/서버 세션 관리
- 제3자 프록시/중계 서버를 경유한 Notion 토큰 전송 및 외부 CDN 스크립트 로드
- 모바일 네이티브 앱 및 앱스토어 배포
- Notion 데이터 생성·수정·삭제(쓰기) 기능
- 자리 배치의 기기 간 동기화
- 토큰 등록 및 최초 정상 조회 이전 기기 또는 로그아웃 이후 기기의 오프라인 업무 데이터 표시

## Further Notes

### 운영 설정 확정 사항

| 항목 | 필요한 결정 | 결정 전 처리 |
| --- | --- | --- |
| 배포 대상 | GitHub 저장소와 Pages 주소 | 하위 경로(`/저장소명/`) 대응 구현 및 로컬 검증 |
| Notion 토큰 권한 | 읽기 전용(Read content) + 단일 WIPS DB 연결 | 연결 UI 체크리스트 및 README에 명시 |

merge가 필요하면 변경 내용과 검증 결과를 제시하여 사용자 승인을 받는다.

### 최종 완료 조건

PC 서버 없이 모바일 접속·홈 화면 실행이 가능하고, 배포물에는 업무 데이터·토큰·실제 DB 식별자·외부 CDN CSP가 전혀 포함되지 않으며, 개인 기기 OPFS에 연결 정보를 안전하게 보관해 조회 전용 실시간 Notion 조회와 오프라인 마지막 데이터 확인이 동작하고, **로그아웃 버튼**으로 OPFS 연결·캐시 파일과 화면 업무 데이터를 즉시 완전 삭제할 수 있어야 한다. 기존 로컬 서버 기능 유지가 검증되어야 하며, 실제 배포·모바일 검증 결과 및 미검증 범위를 기록해야 한다.
