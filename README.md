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
├── packages/core/            # 크롤·시나리오 생성·실행·리포트 (Playwright)
├── scripts/                  # gh-pages에 jobs/ 게시 스크립트
├── web/                      # Pages용 정적 앱
└── docs/trigger/             # (선택) 트리거 예제 — 미추가
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
node src/pipeline.mjs
```

결과는 `packages/core/output/` 에 생성됩니다(`gitignore` 됨).

### Phase 2 — 시나리오 스키마·리포트 품질

- [ ] 스텝 타입 정의: `navigate`, `click`, `fill`, `assertVisible`, `assertNoConsoleError`, `waitForResponse` 등
- [ ] 5가지 기준과 스텝·메트릭 매핑 표준화
- [ ] 대시보드: 기준별 통과/실패, 스크린샷·trace 링크, 콘솔 에러 목록

**완료 기준:** 실패 시 원인을 HTML만으로 대부분 추적 가능.

### Phase 3 — Pages SPA (읽기 전용 먼저)

- [ ] `jobId` 쿼리 또는 경로로 `structure.json` / `scenarios.draft.json` fetch·표시
- [ ] 분석 완료까지 폴링(또는 수동 새로고침 안내)
- [ ] `report.html` 임베드 또는 새 탭 링크

**완료 기준:** 사용자가 GitHub UI 없이 결과·초안을 도메인에서 볼 수 있다.

### Phase 4 — 도메인에서 시나리오 편집 + 실행

- [ ] 테이블/폼 기반 에디터 ↔ JSON 동기화
- [ ] “실행” 클릭 시 **편집본 전체**를 트리거 API로 POST → second workflow(`test`) 디스패치
- [ ] `test` 잡이 최종 시나리오를 받아 실행 후 동일 `jobId`(또는 `jobId` 파생)로 리포트 갱신

**완료 기준:** 사 specification대로 “수정 → 실행 → 대시보드”가 도메인에서 닫힌 루프.

### Phase 5 — 트리거 레이어 하드닝

- [ ] Rate limit, 페이로드 크기 제한
- [ ] job별 서명 토큰 검증
- [ ] (선택) 간단 API 키 또는 Cloudflare Access와 연동

**완료 기준:** 무차별 디스패치·토큰 유출 위험이 설계 수준에서 통제됨.

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
