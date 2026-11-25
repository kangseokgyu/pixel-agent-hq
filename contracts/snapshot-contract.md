# WIPS Office — 스냅샷·OPFS·로그아웃 계약 (`T02`)

## 1. 스냅샷 스키마

모든 스냅샷 객체는 다음 필드를 갖는다:

- `snapshotDate` (`string`): `""` (빈 초기 스냅샷) 또는 `"YYYY-MM-DD"` (한국 시간 기준 날짜)
- `timezone` (`string`): 비어 있지 않은 문자열 (기본 `"Asia/Seoul"`)
- `sourceUrl` (`string`): 정적 빈 초기 스냅샷 및 테스트 샘플에서는 `""`, 서버/실사용 스냅샷에서는 허용된 HTTPS URL 또는 `""`
- `results` (`Array<TaskItem>`): 정규화된 일감 배열 (초기 배포 스냅샷은 반드시 `[]`). 각 항목은 `title` 외에 선택 필드 `id` (`string`), `parentTaskIds` (`Array<string>`), `subTaskIds` (`Array<string>`), `checklist` (`Array<{ text: string, done: boolean }>`)를 포함할 수 있다.
- `has_more` (`boolean`): `false`
- `data_source_ids` (`Array<string>`): 데이터 소스 ID 목록 (초기 배포 스냅샷은 반드시 `[]`)
- `lastSuccessAt` (`string | null | undefined`, 선택): ISO 8601 마지막 성공 시각

### 빈 초기 스냅샷 판별 (`isEmptySnapshot`)
- `results.length === 0`, `snapshotDate === ""`, `sourceUrl === ""`, `data_source_ids.length === 0`을 모두 만족하면 빈 초기 스냅샷으로 판별한다.

### 런타임 모드 판별 (`detectRuntimeMode`)
- `runtimeMode === "static"`이거나 초기 내장 스냅샷이 빈 초기 스냅샷(`isEmptySnapshot`)이면 **정적 PWA 모드(`"static"`)**로 동작한다.
- 그렇지 않으면 **로컬 서버 모드(`"local"`)**로 동작하며 기존 `/api/tasks` 엔드포인트를 사용한다.

---

## 2. OPFS 격리 저장소 계약 (`lib/opfs-store.mjs`)

- 전용 비공개 디렉터리 이름: `wips-office-private-v1`
- 저장 파일:
  1. `connection.json`: `{ token, dataSourceId }`
     - `token`: 공백 및 제어 문자(`[\u0000-\u001F\u007F]`)가 없는 비어 있지 않은 문자열
     - `dataSourceId`: 표준 UUID(`8-4-4-4-12`) 형식
  2. `snapshot-cache.json`: 마지막 성공 스냅샷(`validateSnapshot` 통과 객체)
- **저장소 금지 사항**: Notion 토큰, `dataSourceId`, 업무 스냅샷은 `localStorage`, `sessionStorage`, `indexedDB`에 절대 저장하지 않는다.
- **읽기백(Readback) 검증**: `saveConnection` 및 `saveSnapshot`은 쓰기 완료 후 `getFile().text()`로 다시 읽어 저장 내용 일치 여부를 검증한다.

---

## 3. 로그아웃 파기 계약 (`clearAll`)

- `opfsStore.clearAll()` 호출 시 `wips-office-private-v1` 디렉터리 내 `connection.json`과 `snapshot-cache.json`을 모두 `removeEntry`로 즉시 삭제한다.
- 삭제 이후 `loadConnection()` 및 `loadSnapshot()`은 반드시 `null`을 반환한다.
- 자리 배치(`wips-office-seating-v1`)는 업무 데이터나 토큰을 포함하지 않는 순수 브라우저 화면 배치 설정으로 분리 유지한다.
