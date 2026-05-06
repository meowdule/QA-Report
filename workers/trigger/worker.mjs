/**
 * Cloudflare Worker — Phase 5: rate limit, body 크기, HMAC job 서명, 선택 Origin 허용
 *
 * Secrets: GITHUB_TOKEN, (선택) WEBHOOK_SECRET, (권장) DISPATCH_HMAC_SECRET
 * Vars: GITHUB_REPO, (선택) ALLOWED_ORIGINS — 쉼표 구분, 예: https://user.github.io,https://user.github.io/repo
 *       MAX_BODY_BYTES 기본 262144, RATE_LIMIT_PER_MIN 기본 30
 */

/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

/**
 * @param {string} ip
 * @param {number} maxPerMin
 */
function rateLimitOk(ip, maxPerMin) {
  const now = Date.now();
  const windowMs = 60_000;
  let arr = rateBuckets.get(ip);
  if (!arr) {
    arr = [];
    rateBuckets.set(ip, arr);
  }
  const cutoff = now - windowMs;
  while (arr.length && arr[0] < cutoff) arr.shift();
  if (arr.length >= maxPerMin) return false;
  arr.push(now);
  if (rateBuckets.size > 10_000) rateBuckets.clear();
  return true;
}

/**
 * @param {Request} request
 * @param {{ ALLOWED_ORIGINS?: string }} env
 */
function originAllowed(request, env) {
  const raw = env.ALLOWED_ORIGINS || "";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return true;
  const o = request.headers.get("Origin");
  if (!o) return false;
  return list.some((allowed) => o === allowed || o.startsWith(allowed));
}

/**
 * @param {string} secret
 * @param {string} message
 */
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} a hex
 * @param {string} b hex
 */
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * @param {string} jobId
 * @param {unknown} exp
 * @param {unknown} sig
 * @param {string} secret
 */
async function verifyDispatch(jobId, exp, sig, secret) {
  if (!secret || !jobId || sig == null || exp == null) return false;
  const expN = typeof exp === "string" ? parseInt(exp, 10) : Number(exp);
  if (!Number.isFinite(expN)) return false;
  if (expN < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacSha256Hex(secret, `${String(jobId).trim()}:${expN}`);
  return timingSafeEqualHex(String(sig), expected);
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string | undefined>} env
   */
  async fetch(request, env) {
    const allowOrigin = request.headers.get("Origin") || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-QA-Secret",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      if (!originAllowed(request, env) && (env.ALLOWED_ORIGINS || "").trim()) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405, cors);
    }

    if (!originAllowed(request, env) && (env.ALLOWED_ORIGINS || "").trim()) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const maxPerMin = Math.min(200, Math.max(5, parseInt(env.RATE_LIMIT_PER_MIN || "30", 10)));
    if (!rateLimitOk(ip, maxPerMin)) {
      return json({ error: "Rate limit exceeded" }, 429, cors);
    }

    if (env.WEBHOOK_SECRET) {
      const got = request.headers.get("X-QA-Secret");
      if (got !== env.WEBHOOK_SECRET) {
        return json({ error: "Forbidden" }, 403, cors);
      }
    }

    const maxBody = Math.min(1024 * 1024, Math.max(4096, parseInt(env.MAX_BODY_BYTES || "262144", 10)));
    const buf = await request.arrayBuffer();
    if (buf.byteLength > maxBody) {
      return json({ error: `Body too large (max ${maxBody} bytes)` }, 413, cors);
    }

    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const jobId = body?.job_id != null ? String(body.job_id).trim() : "";
    const scenarios = body?.scenarios;
    if (!jobId || !scenarios || typeof scenarios !== "object") {
      return json({ error: "job_id and scenarios object required" }, 400, cors);
    }

    const scenariosStr = JSON.stringify(scenarios);
    const maxScenario = Math.min(62_000, parseInt(env.MAX_SCENARIO_BYTES || "62000", 10));
    if (scenariosStr.length > maxScenario) {
      return json(
        { error: `scenarios JSON too large (${scenariosStr.length} > ${maxScenario}). 줄이거나 Actions에서 수동 실행하세요.` },
        413,
        cors,
      );
    }

    const hmacSecret = env.DISPATCH_HMAC_SECRET || "";
    if (hmacSecret) {
      const ok = await verifyDispatch(jobId, body.dispatch_exp, body.dispatch_sig, hmacSecret);
      if (!ok) {
        return json(
          { error: "Invalid or expired dispatch signature (dispatch-meta.json 을 같은 Job에서 불러오세요)" },
          403,
          cors,
        );
      }
    }

    const repo = env.GITHUB_REPO;
    const token = env.GITHUB_TOKEN;
    if (!repo || !token) {
      return json({ error: "Worker env GITHUB_REPO / GITHUB_TOKEN missing" }, 500, cors);
    }

    const clientPayload = {
      job_id: jobId,
      scenarios,
      dispatch_sig: body.dispatch_sig,
      dispatch_exp: body.dispatch_exp,
    };

    const ghBody = JSON.stringify({
      event_type: "run-custom-scenarios",
      client_payload: clientPayload,
    });

    if (ghBody.length > 65_000) {
      return json({ error: "GitHub client_payload exceeds ~65KB" }, 413, cors);
    }

    const gh = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "qa-report-trigger-worker",
      },
      body: ghBody,
    });

    if (!gh.ok) {
      const t = await gh.text();
      return json({ error: "GitHub API error", status: gh.status, body: t.slice(0, 2000) }, 502, cors);
    }

    return json({ ok: true, job_id: jobId }, 202, cors);
  },
};

/**
 * @param {Record<string, unknown>} o
 * @param {number} status
 * @param {Record<string, string>} cors
 */
function json(o, status, cors) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
