import crypto from "crypto";

/**
 * @param {string} jobId
 * @param {number} exp unix seconds
 * @param {string} secret
 */
export function signDispatch(jobId, exp, secret) {
  const id = String(jobId).trim();
  const payload = `${id}:${exp}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * @param {string} jobId
 * @param {string} secret
 * @param {number} [ttlSec] 기본 48h
 */
export function createDispatchMeta(jobId, secret, ttlSec = 172800) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = signDispatch(jobId, exp, secret);
  return {
    version: 1,
    jobId: String(jobId).trim(),
    exp,
    sig,
    alg: "HMAC-SHA256",
  };
}

/**
 * @param {string} jobId
 * @param {number} exp
 * @param {string} sig hex
 * @param {string} secret
 */
export function verifyDispatchMeta(jobId, exp, sig, secret) {
  if (!secret || !jobId || !sig) return false;
  const expN = typeof exp === "string" ? parseInt(exp, 10) : Number(exp);
  if (!Number.isFinite(expN)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (expN < now) return false;
  const expected = signDispatch(jobId, expN, secret);
  return timingSafeEqualHex(sig, expected);
}

/**
 * @param {string} a
 * @param {string} b
 */
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
