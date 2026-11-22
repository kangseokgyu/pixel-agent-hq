# Pixel Agent HQ 아이콘 가이드

이 문서는 **Pixel Agent HQ (`WIPS-Office`)** 프로젝트에서 사용하는 모든 아이콘의 시각 기준, 구현 규칙, 접근성, 배포 검증 절차를 정의합니다.

---

## 1. 적용 범위

| 분류 | 위치 | 형태 | 용도 |
| :--- | :--- | :--- | :--- |
| **UI 아이콘** | `wips-office.html` (`index.html` 동기화) | 인라인 SVG DOM (`createSvgNode`) | 칸반 카드 진행률, 체크리스트, 펼침 화살표, 외부 링크(Notion) |
| **상태 인디케이터** | `wips-office.html` (`.status-dot`) | CSS 원형 도트 | 업무 상태(진행·검증·대기 등) 시각 구분 |
| **PWA 앱 아이콘** | `icons/icon-192.png`, `icons/icon-512.png` | PNG (RGBA) | 브라우저 파비콘, iOS/Android 홈 화면 설치, 앱 셸 캐시 |

> **제외 범위**: 가상 오피스 배경 이미지(`--hq-room-bg`)와 픽셀 캐릭터 스프라이트는 별도 그래픽 에셋으로 관리하며 이 가이드에 포함하지 않습니다. 또한 플랫폼별 렌더링 편차가 큰 **이모지(Emoji)는 UI 아이콘으로 사용하지 않습니다.**

---

## 2. 핵심 원칙

1. **Zero-CDN & CSP 준수**
   - `index.html`과 `data-srcdoc`의 CSP(`default-src 'none'; img-src 'self' data:; font-src 'self'`) 및 `scripts/verify-dist.mjs`의 보안 감사에 따라 외부 아이콘 폰트·CDN(Lucide CDN, Material Symbols, Font Awesome 등)을 불러올 수 없습니다.
   - 모든 UI 아이콘은 `http://www.w3.org/2000/svg` 네임스페이스를 사용하는 **인라인 SVG DOM**으로 직접 생성합니다.
2. **`currentColor` 기반 테마 대응**
   - SVG 내부에 고정 색상(`#000`, `#fff` 등)을 하드코딩하지 않고 `stroke="currentColor"` 또는 `fill="currentColor"`를 사용합니다.
   - 색상은 부모 요소의 CSS `color` 속성(CSS 변수 또는 `light-dark()`)으로 제어해 라이트/다크 모드에 자동 대응합니다.
3. **일관된 선형(Outline) 스타일**
   - UI 아이콘은 `16×16` 좌표계 기반의 간결한 선형 스타일을 기본으로 하며, 둥근 끝점과 꺾임(`stroke-linecap="round"`, `stroke-linejoin="round"`)을 유지합니다.
   - 외부 서비스 브랜드 심볼(예: Notion)만 예외적으로 `24×24` 좌표계와 부분 면 채우기(`fill-opacity`)를 허용합니다.
4. **접근성 및 모션 최소화**
   - 텍스트 옆 장식용 아이콘은 `aria-hidden="true"`를 반드시 부여합니다.
   - 텍스트 없이 아이콘만 있는 인터랙션 요소(`<a>`, `<button>`)는 부모 요소에 `aria-label`과 `title`을 제공하고, SVG 자체에는 `aria-hidden="true"`를 지정합니다.
   - 회전 등 트랜지션이 있는 아이콘은 `@media (prefers-reduced-motion: reduce)`에서 `transition: none`을 적용합니다.

---

## 3. 인라인 SVG UI 아이콘 규격

### 3.1 그리드 및 크기

| 역할 | `viewBox` | 렌더링 크기 | 컨테이너/여백 규칙 |
| :--- | :--- | :--- | :--- |
| **일반 UI 아이콘** (체크, 하위 일감, 화살표, 체크 마크) | `0 0 16 16` | `13px × 13px` | `flex: none; display: block;`, 텍스트와 `gap: 4px`~`6px` |
| **상단 유틸리티 고스트 아이콘 버튼** (갱신, 연결, 로그아웃) | `0 0 16 16` | `16px × 16px` (모바일 `15px × 15px`) | 버튼 `40px × 40px` (모바일 `36px × 44px`), 고스트(`background/border: transparent`), `aria-label` + `title` 필수 |
| **브랜드/아이콘 버튼** (Notion 바로가기 등) | `0 0 24 24` | `14px × 14px` | 버튼 컨테이너 `22px × 22px`, `border-radius: 5px` |
| **위젯 공통 기준** (`index.html` 호스트) | — | `--icon-size: 16px` | 호스트 컨트롤 기본 아이콘 크기 변수 |

### 3.2 스트로크 및 도형 규칙 (`16×16` 기준)

- **배경 채우기**: `fill="none"`
- **내부 안전 여백**: 사방 `2px` 권장 (예: 외곽 사각형 `x="2" y="2" width="12" height="12"`)
- **모서리 반경**: 외곽 사각형 `rx="3"`
- **선 두께 (`stroke-width`)**:
  - 기본 외곽/연결선: `1.4`
  - 강조 기호(체크마크): `1.5`
  - 방향 지시(화살표/chevron): `1.6`
- **선 끝·이음새**: `stroke-linecap="round"`, `stroke-linejoin="round"`

### 3.3 색상 토큰

| 상태 / 용도 | CSS 값 | 적용 예 |
| :--- | :--- | :--- |
| 기본 / 보조 아이콘 | `var(--muted-foreground)` | `.kanban-progress-kind`, `.kanban-progress-chevron`, 미완료 `.kanban-check-mark`, `.task-source`, `.sync-button--icon` (고스트 기본) |
| 완료 / 긍정 상태 | `light-dark(#15803d, #4ade80)` | 완료된 `.kanban-check-mark` |
| 호버 / 포커스 강조 (브랜드 버튼) | `color: var(--foreground)`<br>`border-color: var(--primary)`<br>`background: color-mix(in oklab, var(--primary) 12%, var(--card))` | `.kanban-card .task-source:hover`, `:focus-visible` |
| 호버 / 포커스 강조 (고스트 아이콘) | `color: var(--foreground)`<br>`border-color: var(--border)`<br>`background: var(--secondary)` | `.sync-button--icon:hover`, `:focus-visible` |
| 위험 / 파괴적 고스트 아이콘 | 기본 `var(--destructive)`<br>호버 `border: 35%`, `bg: 10%` (`--destructive`) | `.sync-button--icon.sync-button--danger` (`::before` `1px` `var(--border)` 구분선 포함) |

### 3.4 구현 규칙 (`createSvgNode`)

- `innerHTML`로 SVG 문자열을 삽입하지 않습니다. XSS 방지 및 `wips-office.test.mjs`의 가상 DOM 테스트 환경 호환을 위해 반드시 `wips-office.html`의 `createSvgNode(tag, attrs)` 헬퍼를 사용합니다.

```js
const icon = createSvgNode("svg", {
  width: "13",
  height: "13",
  viewBox: "0 0 16 16",
  fill: "none",
  "aria-hidden": "true",
});

icon.append(
  createSvgNode("path", {
    d: "M4 6L8 10L12 6",
    stroke: "currentColor",
    "stroke-width": "1.6",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }),
);
```

---

## 4. 현재 아이콘 인벤토리

### 4.1 인라인 SVG UI 아이콘 (`wips-office.html`)

| 이름 | 클래스 / 위치 | `viewBox` | 크기 | 특징 |
| :--- | :--- | :--- | :--- | :--- |
| **지금 갱신** | `#wips-office-refresh` (`.sync-button--icon svg`) | `0 0 16 16` | `16×16` (모바일 `15×15`) | 시계방향 순환 호 + 화살표(`sw=1.5`), 고스트 단독 아이콘 버튼(`aria-label`/`title="지금 갱신"`) |
| **연결 설정** | `#wips-office-connect-toggle` (`.sync-button--icon svg`) | `0 0 16 16` | `16×16` (모바일 `15×15`) | 수평 링크 2개 + 중앙 연결선(`sw=1.5`), 고스트 단독 아이콘 버튼(`aria-label`/`title="연결 설정"`) |
| **로그아웃** | `#wips-office-logout` (`.sync-button--icon.sync-button--danger svg`) | `0 0 16 16` | `16×16` (모바일 `15×15`) | 좌측 도어 프레임 + 우측 이탈 화살표(`sw=1.5`), 고스트 파괴적 액션(`aria-label`/`title="로그아웃"`), `::before` `1px` 구분선 |
| **체크리스트** | `.kanban-progress-kind svg` (`checklist`) | `0 0 16 16` | `13×13` | 둥근 사각형(`rx=3`, `sw=1.4`) + 체크 경로(`sw=1.5`) |
| **하위 일감** | `.kanban-progress-kind svg` (`subtasks`) | `0 0 16 16` | `13×13` | 노드 원 3개(`r=1.6`) + 분기 트리 연결선(`sw=1.4`) |
| **펼침 화살표** | `.kanban-progress-chevron` | `0 0 16 16` | `13×13` | 하향 V자(`sw=1.6`), `[open]` 시 `rotate(180deg)` (`140ms ease`) |
| **체크박스 마크** | `.kanban-check-mark svg` | `0 0 16 16` | `13×13` | 미완료: 빈 사각형 / 완료: 사각형+체크(녹색) |
| **Notion 로고** | `.kanban-card .task-source svg` | `0 0 24 24` | `14×14` | 3D 큐브(`fill-opacity: 0.16 / 0.28`, `sw=1.5`) + N 글리프, 부모 `<a>`에 `aria-label="Notion에서 보기"` |

### 4.2 상태 인디케이터 (`.status-dot`)

아이콘 대신 `0.62em × 0.62em` 원형 도트(`aria-hidden="true"`)로 업무 상태를 표시합니다.

| 상태 (`data-status`) | 색상 코드 |
| :--- | :--- |
| `진행` | `#2383e2` |
| `검증` | `#9d68d3` |
| `장시간 테스트 중` | `#dfab01` |
| `대기` | `#d9730d` |
| `예정` | `#91918e` |
| `완료` | `#448361` |
| 기타 / 미지정 | `var(--muted-foreground)` |

---

## 5. PWA 앱 아이콘 규격 (`icons/`)

### 5.1 파일 및 매니페스트 규격

| 파일 경로 | 해상도 | 포맷 | `manifest.webmanifest` `purpose` | 참조 위치 |
| :--- | :--- | :--- | :--- | :--- |
| `icons/icon-192.png` | `192 × 192` | 8-bit RGBA PNG | `any` | `manifest.webmanifest`, `index.html` (`icon`, `apple-touch-icon`), `sw.js`, `scripts/build-pages.mjs` |
| `icons/icon-512.png` | `512 × 512` | 8-bit RGBA PNG | `any maskable` | `manifest.webmanifest`, `sw.js`, `scripts/build-pages.mjs` |

### 5.2 시각 정체성 및 Maskable 규칙

- **브랜드 팔레트**:
  - 배경(`background_color`): `#f4ece0` (따뜻한 크림)
  - 테마 포인트(`theme_color`): `#c96442` (테라코타 오렌지)
  - 프레임/보조 카드: 다크 슬레이트 프레임 + 크림/세이지 그린 보드 블록
- **Maskable 안전 영역**: `icon-512.png`는 `any maskable`로 등록되어 있으므로 Android 적응형 아이콘(원형·스퀘어클 등) 마스킹 시 잘리지 않도록 핵심 심볼을 **중앙 80% 안전 영역(safe zone)** 안에 배치합니다.
- **상대 경로 필수**: GitHub Pages 서브패스 배포 호환을 위해 `manifest.webmanifest`, `index.html`, `sw.js`에서 아이콘 경로는 반드시 `./icons/...` 상대 경로를 사용합니다(`/`로 시작하는 절대 경로 금지).

---

## 6. 아이콘 추가·수정 워크플로우

### 6.1 UI 아이콘 추가 시

1. `wips-office.html`에 `createSvgNode`를 사용하여 SVG를 작성하고, 스타일과 `prefers-reduced-motion` 규칙을 추가합니다.
2. `index.html`의 `data-srcdoc`와 동기화합니다.
   ```bash
   node scripts/sync-office.mjs
   ```
3. 필요 시 `wips-office.test.mjs`에 DOM 구조 및 `aria-label`/`aria-hidden` 테스트를 추가합니다.

### 6.2 PWA 앱 아이콘 변경/추가 시

1. `icons/` 디렉터리에 PNG 파일을 배치합니다.
2. `manifest.webmanifest`, `index.html`, `sw.js`, `scripts/build-pages.mjs`의 파일 목록과 상대 경로(`./icons/...`)가 모두 일치하는지 확인합니다.

### 6.3 배포 전 검증 (필수)

```bash
node --test
node scripts/build-pages.mjs && node scripts/verify-dist.mjs
```

---

## 7. Do / Don't 요약

| Do (권장) | Don't (금지) |
| :--- | :--- |
| `createSvgNode()`로 인라인 SVG DOM 생성 | `innerHTML`로 SVG 문자열 삽입 |
| `stroke="currentColor"` / `fill="currentColor"` 사용 | SVG 내부에 `#000000` 등 색상 하드코딩 |
| 외부 링크·아이콘 전용 버튼에 `aria-label` + `title` 지정 | 접근성 레이블 없는 아이콘 전용 버튼 배치 |
| `16×16` 그리드, `stroke-width: 1.4~1.6`, 둥근 끝점 유지 | 서로 다른 스타일(채움/얇은 선/이모지) 혼용 |
| PWA 아이콘에 `./icons/...` 상대 경로 사용 | `/icons/...` 루트 절대 경로 또는 외부 CDN 아이콘 사용 |
