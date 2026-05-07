# QA Report · Site Analyzer & Scenario Tester

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![GitHub Pages](https://img.shields.io/badge/docs-live-24292f?logo=github)](https://meowdule.github.io/QA-Report/)

**GitHub Pages**에서 URL을 넣고 크롤·구조 분석과 자동 생성 시나리오를 같은 화면에서 검토·수정한 뒤, **GitHub Actions**로 테스트를 돌리고 **HTML 대시보드**로 결과를 보는 도구입니다.  
헤드리스 브라우저 실행과 저장소 쓰기는 Actions(또는 별도 서버)에서만 수행하고, Pages는 정적 UI·결과 조회용입니다.

---

## 목차

- [목표](#목표)
- [시스템 구성](#시스템-구성)
- [저장소 구조](#저장소-구조)
- [보안·시크릿](#보안시크릿)
- [GitHub Pages 설정](#github-pages-설정)
- [`jobs/` 경로](#jobs-디렉터리)
- [선행 조건](#선행-조건)
- [구현 단계 (Phase 0–6)](#구현-단계-우선순위)
- [로컬 개발](#로컬-개발)
- [라이선스·기여](#라이선스)

---

## 목표

| # | 내용 |
|---|------|
| 1 | 사이트 구조 분석(주요 페이지, 이동 경로 후보) |
| 2 | 허용 범위 내 페이지 크롤 |
| 3 | 5가지 관점 시나리오 초안 — 렌더링, 핵심 액션, 입력·저장, 콘솔, 주요 흐름 |
| 4 | UI에서 시나리오·입력값 수정 후 실행 |
| 5 | 결과를 HTML 대시보드로 표시 |

---

## 시스템 구성

| 구성 요소 | 역할 |
|-----------|------|
| **GitHub Pages** | 정적 SPA(`web/`). URL 입력, 시나리오 편집, 진행 표시, `?job=` 조회. |
| **트리거 레이어** (권장) | `workflow_dispatch` / `repository_dispatch` 호출, Rate limit 등. PAT는 **Worker·Actions 시크릿**에만. |
| **GitHub Actions** | 크롤·분석·시나리오 생성·Playwright·리포트 HTML 생성·`gh-pages` 푸시. |
| **결과물** | `gh-pages`의 `jobs/<날짜>/<시간>_<run_id>/` 및 `jobs/_byRunId/<run_id>.json` 메타 → SPA는 작업 번호만으로 경로 조회. |

> **참고:** GitHub Pages는 정적 호스팅만 제공합니다. 임의 도메인 크롤과 헤드리스 테스트는 반드시 Actions(또는 별도 백엔드)에서 실행합니다.

---

## 저장소 구조

```
/
├── README.md                 # 본 문서
├── .github/workflows/        # Pages 배포, Analyze & Test, 재실행
├── packages/core/            # 크롤, 시나리오, 실행, 리포트 (Playwright, schema)
├── scripts/                  # gh-pages jobs/ 게시·검증 스크립트
├── web/                      # Pages 정적 앱 (Job 조회, 편집, POST 재실행)
└── workers/trigger/          # Cloudflare Worker 예시 → README.md
```

**배포 후 공개 URL 예시** (`gh-pages` 기준):

| 경로 | 설명 |
|------|------|
| `/jobs/{jobId}/structure.json` | 구조·크롤 요약 (`formControls`, `selectionMode` 등) |
| `/jobs/{jobId}/scenarios.draft.json` | 초안 시나리오 |
| `/jobs/{jobId}/report.html` | HTML 대시보드 |

---

## 보안·시크릿

- **PAT·LLM API 키** → GitHub Actions Secrets, Worker 환경 변수 **만**. SPA 번들에 넣지 않습니다.
- **`jobId`**는 추측 어려운 값을 쓰고, 실행 POST는 가능하면 **서명 토큰**(`dispatch-meta.json`, HMAC)으로 검증합니다.
- `robots.txt`·`noindex`는 검색 완화용이며, 실제 접근 통제는 별도(Cloudflare Access, 조직 정책 등)가 필요할 수 있습니다.

---

## GitHub Pages 설정

1. 저장소를 GitHub에 푸시합니다 (`main`).
2. **Settings → Pages** 로 이동합니다.
3. **Source:** **Deploy from a branch** → **Branch:** `gh-pages` / **(root)**.
   - 처음에는 `gh-pages`가 없을 수 있습니다. `main`에 `web/` 변경을 푸시하면 **Deploy GitHub Pages** 워크플로가 브랜치를 만듭니다.
4. 워크플로 성공 후 몇 분 안에 사이트 URL이 표시됩니다.
   - **프로젝트 페이지:** `https://<owner>.github.io/<repo>/`
   - **`username.github.io` 저장소**는 루트 URL 규칙이 다를 수 있습니다.

---

## `jobs/` 디렉터리

- 결과물은 **`gh-pages`**에 `jobs/<YYYY-MM-DD>/<HHMMSS>_<run_id>/` 형태로 올라갑니다 (Asia/Seoul). 재실행 시 **같은 폴더**를 덮어씁니다.
- `jobs/_byRunId/<run_id>.json`에 `{ "path": "날짜/시간_runid" }`가 있어 SPA가 `?job=<run_id>`만으로 실제 경로를 찾습니다. 예전 flat `jobs/<run_id>/`도 동작합니다.
- **Deploy GitHub Pages**는 `clean: false`라 `web/` 재배포 시 기존 `jobs/`가 지워지지 않습니다. (`web/`에서 지운 파일은 `gh-pages`에 남을 수 있어 필요 시 수동 정리)

---

## 선행 조건

- GitHub 저장소 + 위 [GitHub Pages 설정](#github-pages-설정)
- (권장) 트리거용 PAT 또는 GitHub App
- 대상 사이트에 대한 **합법적 크롤·자동화** 확인 (robots, 이용약관, 본인·허용 범위)

---

## 구현 단계 (우선순위)

단계 순으로 진행하면 리스크가 낮고, 각 단계마다 검증 가능한 산출물이 생깁니다.

### Phase 0 — 저장소·Pages 뼈대

- [x] 리포지토리, `main` + Actions로 `gh-pages` 배포
- [x] 정적 앱(`web/`) 배포 및 접속 확인
- [x] `jobs/` 경로는 웹 배포 워크플로에서 삭제하지 않음 (`clean: false`)

**완료 기준:** 공개 URL에서 정적 페이지가 열린다.

---

### Phase 1 — Actions만 MVP 파이프라인

> SPA 없이 Actions **Run workflow**로 실행합니다.

- [x] 입력: `target_url`, `max_pages`, `max_depth`
- [x] Playwright BFS 크롤 (깊이·페이지 수 제한)
- [x] `structure.json` — `links`, `interactables`, **`formControls`**, `graph`
- [x] 휴리스틱 시나리오 초안 → `scenarios.draft.json`
- [x] Playwright 스모크 → `results.json`
- [x] `report.html`·JSON을 날짜/시간 폴더에 푸시 + `run_id` 메타

**완료 기준:** Actions 한 번으로 job 폴더에 JSON + HTML이 생기고 Pages에서 열 수 있다.

#### Phase 1 — 실행 방법

1. **Actions** → **Analyze site and run tests** → **Run workflow**
2. `target_url` 입력 후 실행
3. 성공 후 리포트:  
   `https://<owner>.github.io/<repo>/jobs/<날짜>/<시간>_<run_id>/report.html`  
   (`run_id` = 해당 실행 상단 숫자 ID)
4. 일부 시나리오 실패 시 워크플로는 경고로 끝날 수 있으나, `continue-on-error` / `if: always()`로 **`jobs/` 게시**는 유지됩니다.

#### 단위 테스트 (`packages/core`)

```powershell
Set-Location packages/core
npm ci
npm test
```

크롤·시나리오·스키마·리포트 HTML 등 순수 로직 검증 (브라우저 E2E 없음). CI에서도 동일하게 실행됩니다.

> 예전 `report.html`만 있고 같은 폴더에 `Icon.svg`가 없으면 파비콘이 비어 보일 수 있습니다. Job을 재실행하면 함께 올라갑니다.

#### 로컬 파이프라인

```powershell
Set-Location packages/core
npm ci
npx playwright install chromium
$env:TARGET_URL="https://example.com"
$env:MAX_PAGES="10"
$env:MAX_DEPTH="2"
$env:JOB_ID="local"
$env:TRACE_MODE="failure"   # failure | all | off
node src/pipeline.mjs
```

결과: `packages/core/output/` (`gitignore`). Trace·스크린샷: `output/traces/`, `output/screenshots/`.

**크롤 없이 시나리오만 재실행:** `input/structure.json`, `input/scenarios.final.json` 준비 후 `npm run run-tests-only`.

---

### Phase 2 — 스키마·리포트 품질

- [x] 스텝 타입 표준화 (`schema.mjs` / `schema.json`)
- [x] 클릭 스텝: 다이얼로그, `target=_blank` / 새 탭, 동일 탭 네비 (`runner.mjs`)
- [x] 5가지 기준(`page_rendering`, `core_action`, …)과 스텝·메트릭 매핑
- [x] 대시보드: 기준별 표, 실패 시 스크린샷·Trace·콘솔 블록
- [x] `TRACE_MODE` / `trace_mode`: `failure` \| `all` \| `off`

**완료 기준:** 실패 시 HTML에서 스텝·스크린샷·trace·콘솔로 원인 추적 가능.

#### Trace 보기 (로컬)

```bash
npx playwright show-trace traces/<시나리오-id>.zip
```

---

### Phase 3 — Pages SPA (읽기)

- [x] `?job=` / 폼으로 JSON fetch·표시
- [x] 구조 없을 때 폴링(간격·중지 가능)
- [x] `report.html` iframe + 새 탭

**완료 기준:** GitHub UI 없이 Pages에서 Job·초안·대시보드 확인.

#### Phase 3 — 사용 요약

1. **Worker 사용:** `workers/trigger` 배포 후 **`web/app.js`**의 **`DEFAULT_WORKER_BASE_URL`**에 Worker 루트(URL, 끝 슬래시 없음). 여러 사이트 분석에도 동일 URL 유지. (선택) `WEBHOOK_SECRET` ↔ **`DEFAULT_QA_WEBHOOK_SECRET`**.
2. **Worker 없음:** Actions 실행 후 **Job ID**(`run_id`) 확인.
3. `https://<owner>.github.io/<repo>/?job=<run_id>` 또는 폼에서 **불러오기**.
4. 배포 직후 폴더가 없으면 폴링으로 재시도.

상세: **`workers/trigger/README.md`**

---

### Phase 4 — 시나리오 편집 + 실행

- [x] `web/` 폼 ↔ JSON 동기화
- [x] Worker **POST** `{ job_id, scenarios }` → `repository_dispatch` (`run-custom-scenarios`)
- [x] 워크플로: `gh-pages`에서 구조·시나리오 가져와 재실행 후 **같은 `jobs/<jobId>/`** 갱신
- [x] Worker 없을 때: Actions **Run custom scenarios** 수동 입력

**완료 기준:** Pages에서 수정 → Worker 또는 Actions → 같은 Job 폴더 대시보드 갱신.

#### Phase 4 — 설정 요약

1. Worker용 PAT는 **Worker 시크릿**에만 (`Settings`는 저장소 기준, Worker는 CF 대시보드).
2. **`workers/trigger/README.md`**로 Worker 배포, **`DEFAULT_WORKER_BASE_URL`** 맞춤.
3. `web/index.html`의 `data-github-repo`를 `owner/repo`로 맞추면 관련 링크가 정확해집니다.

---

### Phase 5 — 트리거 하드닝

- [x] Worker: IP Rate limit, JSON 크기 상한, 선택 **`ALLOWED_ORIGINS`**
- [x] Job 서명: `DISPATCH_HMAC_SECRET` + `dispatch-meta.json`
- [x] Actions: `verify-dispatch-event.mjs` (시크릿 있을 때)
- [x] `WEBHOOK_SECRET` ↔ `X-QA-Secret`
- [x] Cloudflare Access는 [공식 문서](https://developers.cloudflare.com/cloudflare-one/policies/access/) 참고

**완료 기준:** 남용·임의 덮어쓰기 완화, PAT는 Worker/Actions에만.

#### Phase 5 — 체크리스트

1. **Actions** Secrets: `DISPATCH_HMAC_SECRET`
2. Worker Secrets: 동일 `DISPATCH_HMAC_SECRET`
3. `WEBHOOK_SECRET` 정합, `ALLOWED_ORIGINS`에 Pages URL
4. Analyze / Run custom scenarios 실행 후 `jobs/<id>/dispatch-meta.json` 확인

---

### Phase 6 — LLM 연동 (선택)

- [x] `llm-enrich.mjs` — 크롤 요약·시나리오 메타 병합 (OpenAI 호환 API)
- [x] `LLM_SCENARIOS=1` 또는 `ENABLE_LLM_SCENARIOS=1`일 때만 호출 → `llm-enrich-log.json`
- [x] Actions: 입력 `llm_scenarios=true` + `OPENAI_API_KEY` 또는 `LLM_API_KEY`
- [ ] 실패 피드백 루프·DOM 풀 스냅샷은 후순위

| 변수 | 설명 |
|------|------|
| `LLM_SCENARIOS` / `ENABLE_LLM_SCENARIOS` | `1` 또는 `true`면 보강 실행 |
| `OPENAI_API_KEY` / `LLM_API_KEY` | API 키 |
| `LLM_BASE_URL` | 기본 `https://api.openai.com/v1` |
| `LLM_MODEL` | 기본 `gpt-4o-mini` |
| `STRICT_SCENARIO_VALIDATE` | `1`이면 스키마 실패 시 즉시 종료 |

**클릭 스텝 (수동 JSON):** `opensNewTab` / `target: "_blank"`, `keepPopupOpen`, `detectPopupMs` 등. 토스트는 `waitForSelector` + `optional: true` 보완.

**완료 기준:** 키가 있으면 검증 통과 `llm-*` 시나리오가 추가되고 로그로 건수 확인. 비용은 모델·토큰에 따름.

---

## 로컬 개발

`web/`은 빌드 없이 정적 파일입니다. 미리보기:

```powershell
Set-Location web
python -m http.server 8080
```

```bash
cd web && python -m http.server 8080
```

→ `http://localhost:8080`  
(`file://`로 열면 Worker·Job fetch가 막힐 수 있습니다 — README의 Pages 링크처럼 호스트를 쓰세요.)

---

## 라이선스

**MIT** — [LICENSE](./LICENSE)

## 기여

초기 기획·구현이 정리된 상태입니다. 이슈·PR 환영합니다. Worker·트리거 상세는 **`workers/trigger/README.md`**를 우선 참고하세요.
