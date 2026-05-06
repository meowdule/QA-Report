/**
 * GitHub Actions: repository_dispatch 이벤트의 job 서명 검증
 * 환경 변수: GITHUB_EVENT_PATH, DISPATCH_HMAC_SECRET(선택 — 없으면 스킵)
 */
import fs from "fs";
import { verifyDispatchMeta } from "../packages/core/src/dispatch-sign.mjs";

const path = process.env.GITHUB_EVENT_PATH;
const secret = process.env.DISPATCH_HMAC_SECRET || "";

if (!path) {
  console.error("GITHUB_EVENT_PATH missing");
  process.exit(1);
}

const event = JSON.parse(fs.readFileSync(path, "utf8"));

if (event.action !== "run-custom-scenarios") {
  console.log("Skip verify: action is", event.action);
  process.exit(0);
}

if (!secret) {
  console.log("DISPATCH_HMAC_SECRET not set — dispatch 서명 검증 생략(Worker에서만 검증 권장).");
  process.exit(0);
}

const cp = event.client_payload;
if (!cp || !cp.job_id) {
  console.error("client_payload.job_id missing");
  process.exit(1);
}

const jobId = String(cp.job_id).trim();
const exp = cp.dispatch_exp;
const sig = cp.dispatch_sig;

if (!sig || exp == null) {
  console.error("repository_dispatch 에 dispatch_sig / dispatch_exp 가 없습니다. Worker 또는 클라이언트를 Phase 5에 맞게 갱신하세요.");
  process.exit(1);
}

if (!verifyDispatchMeta(jobId, exp, String(sig), secret)) {
  console.error("dispatch 서명 검증 실패");
  process.exit(1);
}

console.log("dispatch 서명 검증 OK jobId=", jobId);
