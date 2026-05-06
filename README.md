# Site Analyzer & Scenario Tester

GitHub Pages에서 URL을 입력하고, 크롤·구조 분석 결과와 자동 생성 시나리오를 **같은 도메인의 UI에서 검토·수정**한 뒤, GitHub Actions로 테스트를 실행하고 HTML 대시보드로 결과를 확인하는 프로젝트입니다.

## 목표

1. 사이트 구조 분석(주요 페이지, 이동 경로 후보)
2. 허용 범위 내 페이지 크롤
3. 5가지 관점의 테스트 시나리오 초안 생성  
   (렌더링, 핵심 액션, 입력·저장, 콘솔 에러, 주요 흐름)
4. 사용자가 시나리오·입력값을 UI에서 수정 후 실행
5. 결과를 HTML 대시보드로 표시

## 아키텍처 요약

| 구성 요소 | 역할 |
|-----------|------|
| **GitHub Pages** | SPA(`index.html` + 정적 자산). URL 입력, 시나리오 편집, 진행 표시, 대시보드 라우팅. |
| **트리거 레이어 (선택이 아니라 실사용 시 권장)** | `workflow_dispatch` 호출, 남용 방지(Rate limit 등). PAT/앱 토큰은 **여기만** 보관. |
| **GitHub Actions** | 크롤·분석·시나리오 생성·Playwright 실행·리포트 HTML 생성. |
| **결과물 저장** | `gh-pages` 브랜치의 `jobs/{jobId}/` 아래 JSON·HTML 커밋 → SPA와 **same-origin**으로 `fetch` 가능. |

> GitHub Pages는 정적 호스팅만 제공합니다. 임의 도메인 크롤과 헤드리스 브라우저 테스트는 반드시 Actions(또는 별도 서버)에서 수행합니다.

## 디렉터리 규약 (계획)

```
/
├── README.md                 # 본 문서
├── .github/workflows/        # Pages 배포, Analyze & Test
├── packages/core/            # 크롤·시나리오 생성·실행·리포트 (Playwright, schema.mjs)
├── scripts/                  # gh-pages에 jobs/ 게시 스크립트
├── web/                      # Pages용 정적 앱 (Job 조회·시나리오 편집·POST 재실행)
├── workers/trigger/          # Cloudflare Worker 예제 (repository_dispatch)
└── docs/trigger/             # (선택) 미사용
```

`gh-pages` 배포 후 공개 경로 예시:

- `/jobs/{jobId}/structure.json` — 구조·크롤 요약
- `/jobs/{jobId}/scenarios.draft.json` — 초안 시나리오
- `/jobs/{jobId}/report.html` — 최종 대시보드

## 시크릿·보안

- **PAT / LLM API 키는 GitHub Actions Secrets 및 트리거 환경 변수에만** 둡니다. SPA에 포함하지 않습니다.
- `jobId`는 UUID 등 추측 어려운 값을 사용하고, 가능하면 **일회용 서명 토큰**으로 “실행” 요청을 검증합니다.
- `robots.txt`·`noindex`는 검색 노출 완화용이며, 접근 통제는 별도(예: Cloudflare Access, 조직 정책)가 필요할 수 있습니다.

## GitHub Pages 설정

1. 이 저장소를 GitHub에 푸시합니다(`main` 브랜치).
2. 저장소 **Settings → Pages** 로 이동합니다.
3. **Build and deployment** 에서 **Source** 를 **Deploy from a branch** 로 두고, **Branch** 는 **`gh-pages` / `(root)`** 를 선택합니다.  
   - 최초에는 `gh-pages` 브랜치가 없을 수 있습니다. `main` 에 `web/` 변경을 푸시하면 **Deploy GitHub Pages** 워크플로가 브랜치를 생성합니다.
4. 워크플로가 성공한 뒤 몇 분 내 사이트 URL이 표시됩니다.  
   - **프로젝트 페이지:** `https://<owner>.github.io/<repo>/`  
   - **사용자/조직 페이지(`username.github.io` 저장소):** 루트 URL 규칙이 다를 수 있습니다.

### `jobs/` 디렉터리

- 분석·테스트 결과물은 Phase 1부터 **`gh-pages` 브랜치**의 `jobs/<jobId>/` 에 커밋됩니다.
- **Deploy GitHub Pages** 워크플로는 `clean: false` 로 설정되어 있어, `web/` 재배포 시 기존 `jobs/` 가 삭제되지 않습니다.(`web/` 에서 제거한 파일은 `gh-pages` 에 남을 수 있어, 필요 시 수동 정리)

## 선행 조건

- GitHub 저장소 + 위 [GitHub Pages 설정](#github-pages-설정)
- (권장) 트리거용 서버리스 계정 및 저장소에 대한 Fine-grained PAT 또는 GitHub App
- 테스트 대상 사이트에 대한 **합법적 크롤·자동화 허용** 확인(robots, 이용약관, 본인 소유 범위 권장)

---

## 구현 단계 (우선순위)

아래 순서로 진행하면 리스크가 가장 낮고, 각 단계마다 **검증 가능한 결과물**이 생깁니다.

### Phase 0 — 저장소·Pages 뼈대 ✅

- [x] 리포지토리 생성, 기본 라이선스·브랜치 전략(`main` + Actions로 `gh-pages` 배포)
- [x] 정적 앱(`web/`)을 `gh-pages`에 올리고, 접속 확인(아래 [GitHub Pages 설정](#github-pages-설정))
- [x] `jobs/` 경로는 웹 배포 워크플로에서 삭제하지 않음(`clean: false`) — Phase 1 Actions만 해당 경로에 커밋

**완료 기준:** 공개 URL에서 정적 페이지가 열린다.

### Phase 1 — Actions만으로 “한 줄 파이프라인” (MVP 코어) ✅

> SPA 없이 GitHub Actions에서 **수동 `workflow_dispatch`** 로 실행합니다.

- [x] 입력: `target_url`, `max_pages`, `max_depth`(워크플로 입력)
- [x] Playwright로 시작 URL 로드, 동일 출처 링크 수집, BFS 크롤(깊이·페이지 수 제한)
- [x] 산출물: `structure.json`, 링크 그래프 `graph`
- [x] 휴리스틱 시나리오 초안 → `scenarios.draft.json`(스텝: `navigate`, `assertVisible`, `click`, `fill`, `assertNoConsoleError`)
- [x] 초안 기준 Playwright 스모크 실행 → `results.json`
- [x] `report.html` 및 JSON을 **`gh-pages`의 `jobs/{jobId}/`** 에 커밋 푸시 (`jobId` = GitHub `run_id`)

**완료 기준:** Actions 한 번으로 해당 job 폴더에 JSON + HTML이 생기고, Pages URL에서 열어볼 수 있다.

#### Phase 1 실행 방법

1. GitHub 저장소 **Actions** 탭 → **Analyze site and run tests** 워크플로 선택 → **Run workflow**.
2. `target_url` 에 분석할 URL 입력 후 실행합니다.
3. 성공 후 **기존에 `gh-pages` 가 없으면** 스크립트가 `web/` 내용으로 브랜치를 한 번 생성합니다. Pages 설정이 되어 있으면 다음 주소 형태로 리포트를 열 수 있습니다.  
   `https://<owner>.github.io/<repo>/jobs/<run_id>/report.html`  
   (`run_id` 는 해당 워크플로 실행 상세 페이지 상단의 숫자 ID 와 동일합니다.)
4. 일부 시나리오가 실패하면 워크플로는 **경고(노란색)** 로 끝날 수 있으나, 산출물은 `continue-on-error` 및 `if: always()` 로 **`jobs/` 에 게시**됩니다.

#### 로컬에서 파이프라인만 실행

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

결과는 `packages/core/output/` 에 생성됩니다(`gitignore` 됨). Trace·스크린샷은 `output/traces/`, `output/screenshots/` 에 있습니다.

**크롤 없이 시나리오만 재실행(로컬):** `input/structure.json`, `input/scenarios.final.json` 을 둔 뒤 `npm run run-tests-only` (선택으로 `input/scenarios.draft.json` 원본 유지).

### Phase 2 — 시나리오 스키마·리포트 품질 ✅

- [x] 스텝 타입: `navigate`, `click`, `fill`, `assertVisible`, `assertNoConsoleError`, `waitForResponse` (`packages/core/src/schema.mjs` · `schema.json` 산출)
- [x] 5가지 기준(`page_rendering`, `core_action`, `input_data`, `console_errors`, `primary_flow`)과 주요 스텝·메트릭 매핑 표준화
- [x] 대시보드: 기준별 통과/실패 표, 실패 시 **스크린샷**(`screenshots/`)·**Trace**(`traces/*.zip`, 기본은 실패 시만 저장), 실패 시나리오 **콘솔·페이지 오류** 블록
- [x] `TRACE_MODE` 환경 변수 / Actions 입력 `trace_mode`: `failure` | `all` | `off`

**완료 기준:** 실패 시 HTML에서 스텝 상세·스크린샷·trace·콘솔 로그로 원인 추적이 가능합니다.

#### Trace 보기

로컬에서 job 폴더를 받은 뒤:

```bash
npx playwright show-trace traces/<시나리오-id>.zip
```

### Phase 3 — Pages SPA (읽기 전용 먼저) ✅

- [x] `jobId` 쿼리 `?job=` / `?jobId=` 또는 폼 입력으로 `structure.json`, `scenarios.draft.json`, `results.json` fetch·표시
- [x] `structure.json` 이 아직 없을 때 3초 간격 폴링(최대 약 2분, 체크로 끄기 가능) 및 중지 버튼
- [x] `report.html` 을 동일 출처 iframe + 새 탭 링크로 표시

**완료 기준:** 사용자가 GitHub UI 없이 Pages 도메인에서 Job 결과·초안·대시보드를 볼 수 있다.

#### Phase 3 사용법

1. **권장:** 배포 시 `web/index.html` 의 `<html>` 에 **`data-worker-base-url`**(Worker 루트, 슬래시 없음)과 필요 시 **`data-qa-webhook-secret`** 을 넣습니다. Pages에서 대상 URL만 입력하고 **분석 시작**을 누르면 Worker가 `analyze-and-test.yml` 을 dispatch하고 `run_id` 를 받으면 같은 화면에서 Job을 폴링합니다.
2. Worker를 쓰지 않을 때: Actions에서 **Analyze site and run tests** 실행 후 **Job ID**(워크플로 `run_id`)를 확인합니다.
3. Pages에서 `https://<owner>.github.io/<repo>/?job=<run_id>` 로 열거나, Job ID를 입력해 **불러오기**를 누릅니다.
4. 배포 직후 `jobs/<id>/` 가 아직 없으면 **폴링**이 켜져 있으면 자동으로 재시도합니다.

Worker의 `/analyze`·토큰 권한·환경 변수는 **`workers/trigger/README.md`** 를 참고합니다.

### Phase 4 — 도메인에서 시나리오 편집 + 실행 ✅

- [x] `web/` 에서 시나리오 문서 **JSON 텍스트** + **시나리오별 폼**(이름, 기준, 스텝 JSON) ↔ **폼 → JSON / JSON → 폼** 동기화
- [x] **POST** 로 Trigger Worker URL에 `{ job_id, scenarios }` 전달 → Worker가 GitHub **`repository_dispatch`** (`run-custom-scenarios`) 호출
- [x] **`.github/workflows/run-custom-scenarios.yml`**: 기존 `jobs/<jobId>/structure.json`(및 초안)을 `gh-pages`에서 가져와 `scenarios.final.json`으로 테스트만 재실행(`run-tests-only.mjs`) 후 **동일 `jobs/<jobId>/`** 에 `report.html`·`results.json` 등 갱신
- [x] Worker 미사용 시: Actions **Run custom scenarios (re-test)** 워크플로에서 동일 JSON 수동 입력

**완료 기준:** Pages에서 수정 →(Worker POST 또는 Actions 수동)→ 같은 Job 폴더의 대시보드가 갱신된다.

#### Phase 4 설정 요약

1. **저장소** `Settings → Secrets and variables` 에서 Worker용 PAT는 **Worker 시크릿에만** 저장합니다.
2. **`workers/trigger/README.md`** 를 참고해 Cloudflare Worker를 배포하고, `web/index.html` 의 **`data-worker-base-url`** / **`data-qa-webhook-secret`** 을 동일 Worker에 맞게 설정합니다.
3. `web/index.html` 의 `data-github-repo` 를 본인 `owner/repo` 로 바꾸면 수동 실행 링크가 맞춰집니다.

### Phase 5 — 트리거 레이어 하드닝 ✅

- [x] **Worker:** IP별 분당 요청 제한, 본문·`scenarios` JSON 크기 상한, 선택 **`ALLOWED_ORIGINS`**
- [x] **Job 서명:** `DISPATCH_HMAC_SECRET` + `jobs/<jobId>/dispatch-meta.json` (`HMAC-SHA256(jobId:exp)`). SPA가 POST 시 포함, Worker가 검증 후 `repository_dispatch`에 동일 필드 전달
- [x] **Actions 이중 검증:** `DISPATCH_HMAC_SECRET` 이 있으면 `run-custom-scenarios` 가 `repository_dispatch` 수신 시 `scripts/verify-dispatch-event.mjs` 실행(없으면 스킵)
- [x] **API 키:** Worker `WEBHOOK_SECRET` ↔ 헤더 `X-QA-Secret` (Phase 4 유지, 운영 권장)
- [x] **Cloudflare Access:** Worker 앞단에 Access를 두는 방식은 [Cloudflare 문서](https://developers.cloudflare.com/cloudflare-one/policies/access/)를 참고(코드 변경 없음)

**완료 기준:** 남용·임의 Job 덮어쓰기 완화(서명+Rate limit+Origin), PAT는 Worker/Actions 시크릿에만 존재.

#### Phase 5 설정 체크리스트

1. GitHub 저장소 **Settings → Secrets and variables → Actions** 에 `DISPATCH_HMAC_SECRET` 추가(임의 긴 랜덤 문자열).
2. Cloudflare Worker **Secrets** 에 동일 값 `DISPATCH_HMAC_SECRET` 저장.
3. `WEBHOOK_SECRET` 을 양쪽에 맞추고, Worker `ALLOWED_ORIGINS` 에 GitHub Pages URL을 지정.
4. **Analyze** / **Run custom scenarios** 를 한 번씩 실행해 `dispatch-meta.json` 이 `jobs/<id>/` 에 생기는지 확인.

### Phase 6 — LLM 연동(선택)

- [ ] 크롤 요약 + DOM 스냅샷(민감 정보 마스킹)을 입력으로 시나리오 보강
- [ ] 실패 케이스 피드백 루프는 후순위

**완료 기준:** 초안 품질 개선, 비용·토큰 한도 문서화.

---

## 로컬 개발

Phase 0의 `web/` 은 빌드 도구 없이 정적 파일입니다. 로컬에서 미리보려면 저장소 루트 또는 `web/` 에서 정적 서버를 띄우면 됩니다.

```powershell
# PowerShell 예시
Set-Location web
python -m http.server 8080
```

```bash
# Bash 예시
cd web && python -m http.server 8080
```

이후 `http://localhost:8080` 접속.

Phase 2+ 에서 공용 스크립트(`npm run build:web` 등)를 루트에 두지 않고도 `packages/core` 단위로 확장할 수 있습니다.

## 라이선스

MIT — [LICENSE](./LICENSE)

## 기여

이 저장소는 초기 기획 단계입니다. Phase 1 완료 후 기여 가이드를 보강합니다.
