#!/usr/bin/env bash
set -euo pipefail

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

mkdir -p "jobs/${JOB_ID}"
cp -r "${STASH}/." "jobs/${JOB_ID}/"

git add "jobs/${JOB_ID}"

if git diff --staged --quiet; then
  echo "Nothing to commit under jobs/${JOB_ID}"
else
  git commit -m "Job ${JOB_ID}: crawl, scenarios, and test report"
fi

git push origin gh-pages

rm -rf "$STASH"
echo "Published to gh-pages jobs/${JOB_ID}/"
