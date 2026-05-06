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

`POST /repos/{owner}/{repo}/dispatches` 는 저장소에 대한 쓰기 권한이 필요합니다. 권한이 부족하면 **204** 가 아닌 **403/404** 가 납니다.

- **Classic PAT:** `repo` 권한(공개 저장소만일 때도 `repository_dispatch` 가 거절되면 `repo` 로 재발급).
- **Fine-grained:** 해당 저장소에 대한 권한 중 **Metadata** 및 워크플로/콘텐츠 관련 정책이 허용되는 조합을 시도하고, 안 되면 classic `repo` PAT 사용을 권장합니다.

## SPA에서 호출

- URL: 배포한 Worker URL (예: `https://qa-trigger.xxx.workers.dev/`)
- `POST`, `Content-Type: application/json`
- Body: `{ "job_id": "<run_id>", "scenarios": { ...문서 전체... } }`
- (선택) 헤더 `X-QA-Secret: <WEBHOOK_SECRET과 동일>`

## Phase 5 하드닝 (이 Worker)

- **Rate limit:** IP(`CF-Connecting-IP`)당 분당 요청 수(`RATE_LIMIT_PER_MIN`, 기본 30).
- **본문 크기:** `MAX_BODY_BYTES`(기본 256KiB), `scenarios` JSON 문자열 `MAX_SCENARIO_BYTES`(기본 62KiB, GitHub 한도 여유).
- **HMAC job 서명:** `DISPATCH_HMAC_SECRET` 을 설정하면 POST에 `dispatch_sig`·`dispatch_exp` 필수(페이지가 `jobs/<id>/dispatch-meta.json` 에서 읽음). GitHub Actions와 **동일 비밀**을 저장소 `DISPATCH_HMAC_SECRET` 시크릿에도 두면 `repository_dispatch` 수신 시 `scripts/verify-dispatch-event.mjs` 로 이중 검증됩니다.
- **Origin 허용 목록:** `ALLOWED_ORIGINS`(쉼표 구분). 비우면 모든 Origin 허용(개발 편의). 운영에서는 Pages 출처만 나열하세요.
- **API 키:** `WEBHOOK_SECRET` + 헤더 `X-QA-Secret` (운영에서 설정 권장).

## 제한

- GitHub `client_payload` 전체 크기 약 **65KB**. 초과 시 시나리오를 줄이거나 Actions에서 `workflow_dispatch`로 JSON을 붙여 넣으세요.
