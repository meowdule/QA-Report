# QA Report — GitHub `repository_dispatch` 트리거 (Cloudflare Workers)

GitHub Pages SPA에서 **POST** 한 번으로 `run-custom-scenarios` 워크플로를 시작합니다.  
PAT는 Worker 시크릿에만 두고, 브라우저에는 두지 않습니다.

## 배포

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)에서 Worker 생성 또는 Wrangler 사용.
2. Wrangler 사용 시 이 디렉터리에서:

```bash
npm create cloudflare@latest -- .   # 또는 기존 wrangler 프로젝트에 worker.mjs 연결
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WEBHOOK_SECRET   # 선택, SPA에서 동일 값을 헤더로 전송
```

3. Variables (plain): `GITHUB_REPO` — `owner/repo` 형식.

4. `worker.mjs` 를 엔트리로 지정합니다.

## GitHub 토큰 권한

### `repository_dispatch` (POST 루트 — 시나리오 재실행)

`POST /repos/{owner}/{repo}/dispatches` 는 저장소에 대한 쓰기 권한이 필요합니다. 권한이 부족하면 **204** 가 아닌 **403/404** 가 납니다.

- **Classic PAT:** `repo` 권한(공개 저장소만일 때도 `repository_dispatch` 가 거절되면 `repo` 로 재발급).
- **Fine-grained:** 해당 저장소에 대한 권한 중 **Metadata** 및 워크플로/콘텐츠 관련 정책이 허용되는 조합을 시도하고, 안 되면 classic `repo` PAT 사용을 권장합니다.

### `workflow_dispatch` + 실행 목록 조회 (`POST /analyze`)

`POST /analyze` 는 **Analyze site and run tests** 워크플로를 `workflow_dispatch` 로 시작하고, 같은 토큰으로 **해당 워크플로의 최근 실행 목록**을 읽어 `run_id` 를 돌려줍니다.

- **Classic PAT:** 보통 **`repo`** + **`workflow`**(또는 Actions 관련 범위가 포함된 조합). `workflow_dispatch` 가 **403** 이면 토큰에 워크플로 트리거 권한이 없는 경우가 많습니다.
- **Fine-grained:** 저장소에 **Actions: Read and write**(또는 동등) + **Contents** 등이 필요할 수 있습니다. 실패 시 classic `repo` 범위 PAT 로 시도하는 것을 권장합니다.

**Plain 변수(선택):**

- `ANALYZE_WORKFLOW` — 워크플로 파일명(기본 `analyze-and-test.yml`).
- `DEFAULT_REF` — dispatch에 쓸 브랜치/태그(기본 `main`).

코드 변경 후 Worker는 **다시 배포**해야 합니다.

## SPA에서 호출

### 시나리오 재실행 (POST 루트)

- URL: 배포한 Worker URL (예: `https://qa-trigger.xxx.workers.dev/`)
- `POST`, `Content-Type: application/json`
- Body: `{ "job_id": "<run_id>", "scenarios": { ...문서 전체... } }`
- (선택) 헤더 `X-QA-Secret: <WEBHOOK_SECRET과 동일>`

### 새 사이트 분석 (`POST …/analyze`)

- URL: Worker에 **`/analyze`** 경로를 붙인 주소 (예: `https://qa-trigger.xxx.workers.dev/analyze`). 라우팅이 경로 접미사로만 구분되면 동일 Worker에 커스텀 도메인 경로로 매핑해도 됩니다.
- `POST`, `Content-Type: application/json`
- Body 예:

```json
{
  "target_url": "https://example.com/",
  "max_pages": "20",
  "max_depth": "2",
  "trace_mode": "failure"
}
```

- 응답: 성공 시 **`run_id`**(GitHub Actions `run_id`, Pages의 Job ID와 동일)와 `html_url` 등. 직후 `run_id` 를 못 잡으면 **`queued: true`** 만 돌아올 수 있으므로 Actions에서 `run_id` 를 확인합니다.
- (선택) 헤더 `X-QA-Secret` — 루트 POST와 동일하게 Worker에 `WEBHOOK_SECRET` 이 있으면 검증에 사용됩니다.

## Phase 5 하드닝 (이 Worker)

- **Rate limit:** IP(`CF-Connecting-IP`)당 분당 요청 수(`RATE_LIMIT_PER_MIN`, 기본 30).
- **본문 크기:** `MAX_BODY_BYTES`(기본 256KiB), `scenarios` JSON 문자열 `MAX_SCENARIO_BYTES`(기본 62KiB, GitHub 한도 여유).
- **HMAC job 서명:** `DISPATCH_HMAC_SECRET` 을 설정하면 POST에 `dispatch_sig`·`dispatch_exp` 필수(페이지가 `jobs/<id>/dispatch-meta.json` 에서 읽음). GitHub Actions와 **동일 비밀**을 저장소 `DISPATCH_HMAC_SECRET` 시크릿에도 두면 `repository_dispatch` 수신 시 `scripts/verify-dispatch-event.mjs` 로 이중 검증됩니다.
- **Origin 허용 목록:** `ALLOWED_ORIGINS`(쉼표 구분). 비우면 모든 Origin 허용(개발 편의). 운영에서는 Pages 출처만 나열하세요.
- **API 키:** `WEBHOOK_SECRET` + 헤더 `X-QA-Secret` (운영에서 설정 권장).

## 제한

- GitHub `client_payload` 전체 크기 약 **65KB**. 초과 시 시나리오를 줄이거나 Actions에서 `workflow_dispatch`로 JSON을 붙여 넣으세요.
