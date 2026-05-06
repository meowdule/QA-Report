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

- **Classic PAT:** `repo` (또는 공개 저장소만이면 `public_repo` + dispatch 가능 여부 확인).
- **Fine-grained:** 저장소 접근 + **Contents** 읽기, **Metadata** 읽기, 워크플로 디스패치에 필요한 권한(정책에 따라 `Actions` 읽기만으로는 부족할 수 있음 — 실패 시 classic `repo` 권장).

## SPA에서 호출

- URL: 배포한 Worker URL (예: `https://qa-trigger.xxx.workers.dev/`)
- `POST`, `Content-Type: application/json`
- Body: `{ "job_id": "<run_id>", "scenarios": { ...문서 전체... } }`
- (선택) 헤더 `X-QA-Secret: <WEBHOOK_SECRET과 동일>`

## 제한

- GitHub `client_payload` 전체 크기 약 **65KB**. 초과 시 시나리오를 줄이거나 Actions에서 `workflow_dispatch`로 JSON을 붙여 넣으세요.
