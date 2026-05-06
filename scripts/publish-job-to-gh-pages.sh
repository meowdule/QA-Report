#!/usr/bin/env bash
set -euo pipefail

# gh-pages 에 작업 산출물을 올립니다.
# - 신규(분석): JOB_REL 미지정 시 한국 시간(Asia/Seoul) 기준
#   jobs/YYYYMMDD/HHmmss_<JOB_ID>/  (예: jobs/20260105/143052_12345678901/)
# - 재실행: 환경변수 JOB_REL 에 기존 상대 경로를 넣으면 그 폴더를 덮어씀
# - jobs/_byRunId/<JOB_ID>.json 에 { "path": "..." } 저장 → Pages SPA 가 run_id 로 실제 경로 조회

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT="${REPO_ROOT:-$DEFAULT_ROOT}"
cd "$ROOT"

JOB_ID="${JOB_ID:?JOB_ID is required}"
OUT="${ROOT}/packages/core/output"

if [[ ! -d "$OUT" ]]; then
  echo "Missing output dir: $OUT"
  exit 1
fi

STASH="/tmp/qa-job-${JOB_ID}"
rm -rf "$STASH"
cp -r "$OUT" "$STASH"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if git ls-remote --heads origin gh-pages | grep -q refs/heads/gh-pages; then
  git fetch origin gh-pages
  git checkout -B gh-pages origin/gh-pages
else
  echo "No gh-pages on remote; bootstrapping from web/"
  git checkout --orphan gh-pages-bootstrap
  git rm -rf . >/dev/null 2>&1 || true
  git clean -fdx
  cp -r "${DEFAULT_ROOT}/web/." .
  git add -A
  git commit -m "Initialize gh-pages from web (bootstrap for Phase 1)"
  git branch -M gh-pages
  git push -u origin gh-pages
fi

if [[ -n "${JOB_REL:-}" ]]; then
  TARGET_REL="$JOB_REL"
else
  # 한국 시간(Asia/Seoul) · jobs/년-월-일/시분초_runid/
  DATE_PART="$(TZ=Asia/Seoul date +%Y-%m-%d)"
  TIME_PART="$(TZ=Asia/Seoul date +%H%M%S)"
  TARGET_REL="${DATE_PART}/${TIME_PART}_${JOB_ID}"
fi

TARGET_DIR="jobs/${TARGET_REL}"
mkdir -p "$TARGET_DIR"
cp -r "${STASH}/." "$TARGET_DIR/"

mkdir -p "jobs/_byRunId"
META_FILE="jobs/_byRunId/${JOB_ID}.json"
export TARGET_REL
export META_FILE
python3 -c "import json, os; p=os.environ['META_FILE']; open(p,'w',encoding='utf-8').write(json.dumps({'path':os.environ['TARGET_REL']},ensure_ascii=False))"

git add "$TARGET_DIR"
git add "$META_FILE"

if git diff --staged --quiet; then
  echo "Nothing to commit under ${TARGET_DIR}"
else
  git commit -m "Job ${JOB_ID}: ${TARGET_REL}"
fi

git push origin gh-pages

rm -rf "$STASH"
echo "Published to gh-pages ${TARGET_DIR}/"
