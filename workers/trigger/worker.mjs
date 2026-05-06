/**
 * Cloudflare Worker
 * - POST / (또는 루트) — 시나리오 재실행 → repository_dispatch
 * - POST /analyze — Analyze 워크플로 dispatch + run_id 폴링
 *
 * Secrets: GITHUB_TOKEN, (선택) WEBHOOK_SECRET, (권장) DISPATCH_HMAC_SECRET
 * Vars: GITHUB_REPO, DEFAULT_REF(기본 main), ANALYZE_WORKFLOW(기본 analyze-and-test.yml)
 *       ALLOWED_ORIGINS, RATE_LIMIT_PER_MIN, MAX_BODY_BYTES, MAX_SCENARIO_BYTES
 */

/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

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

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyDispatch(jobId, exp, sig, secret) {
  if (!secret || !jobId || sig == null || exp == null) return false;
  const expN = typeof exp === "string" ? parseInt(exp, 10) : Number(exp);
  if (!Number.isFinite(expN)) return false;
  if (expN < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacSha256Hex(secret, `${String(jobId).trim()}:${expN}`);
  return timingSafeEqualHex(String(sig), expected);
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "qa-report-trigger-worker",
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} repo
 * @param {string} token
 * @param {string} workflowFile
 * @param {number} sinceMs
 */
async function pollLatestRunId(repo, token, workflowFile, sinceMs) {
  const headers = ghHeaders(token);
  const wfEnc = encodeURIComponent(workflowFile);
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${wfEnc}/runs?per_page=10`;
  const wfPath = `.github/workflows/${workflowFile}`;

  for (let attempt = 0; attempt < 24; attempt++) {
    if (attempt > 0) await sleep(1500);
    else await sleep(2000);

    const r = await fetch(url, { headers });
    if (!r.ok) continue;
    const data = await r.json();
    const runs = data.workflow_runs || [];
    for (const run of runs) {
      if (run.path !== wfPath) continue;
      const created = new Date(run.created_at).getTime();
      if (created >= sinceMs - 25_000) {
        return { id: run.id, html_url: run.html_url };
      }
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} body
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, string>} cors
 */
async function handleAnalyze(body, env, cors) {
  const targetUrl = typeof body.target_url === "string" ? body.target_url.trim() : "";
  if (!targetUrl || !/^https:\/\//i.test(targetUrl)) {
    return json({ error: "target_url required (https://...)" }, 400, cors);
  }

  let maxPages = String(body.max_pages ?? "20");
  let maxDepth = String(body.max_depth ?? "2");
  let traceMode = String(body.trace_mode ?? "failure");
  const mp = parseInt(maxPages, 10);
  const md = parseInt(maxDepth, 10);
  if (!Number.isFinite(mp) || mp < 1 || mp > 100) maxPages = "20";
  if (!Number.isFinite(md) || md < 0 || md > 10) maxDepth = "2";
  if (!["failure", "all", "off"].includes(traceMode)) traceMode = "failure";

  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_TOKEN;
  if (!repo || !token) {
    return json({ error: "Worker env GITHUB_REPO / GITHUB_TOKEN missing" }, 500, cors);
  }

  const workflowFile = env.ANALYZE_WORKFLOW || "analyze-and-test.yml";
  const ref = env.DEFAULT_REF || "main";
  const sinceMs = Date.now();

  const dispatchUrl = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;
  const disp = await fetch(dispatchUrl, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      ref,
      inputs: {
        target_url: targetUrl,
        max_pages: maxPages,
        max_depth: maxDepth,
        trace_mode: traceMode,
      },
    }),
  });

  if (!disp.ok) {
    const t = await disp.text();
    return json(
      { error: "workflow_dispatch failed", status: disp.status, body: t.slice(0, 2000) },
      502,
      cors,
    );
  }

  const found = await pollLatestRunId(repo, token, workflowFile, sinceMs);
  if (!found) {
    return json(
      {
        ok: true,
        queued: true,
        message:
          "워크플로는 시작됐지만 run_id 를 확정하지 못했습니다. GitHub Actions에서 최신 실행의 run_id 를 확인하세요.",
      },
      202,
      cors,
    );
  }

  return json(
    { ok: true, run_id: found.id, html_url: found.html_url, job_id: String(found.id) },
    202,
    cors,
  );
}

/**
 * @param {Record<string, unknown>} body
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, string>} cors
 */
async function handleRerun(body, env, cors) {
  const jobId = body?.job_id != null ? String(body.job_id).trim() : "";
  const scenarios = body?.scenarios;
  if (!jobId || !scenarios || typeof scenarios !== "object") {
    return json({ error: "job_id and scenarios object required" }, 400, cors);
  }

  const scenariosStr = JSON.stringify(scenarios);
  const maxScenario = Math.min(62_000, parseInt(env.MAX_SCENARIO_BYTES || "62000", 10));
  if (scenariosStr.length > maxScenario) {
    return json(
      { error: `scenarios JSON too large (${scenariosStr.length} > ${maxScenario})` },
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
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: ghBody,
  });

  if (!gh.ok) {
    const t = await gh.text();
    return json({ error: "GitHub API error", status: gh.status, body: t.slice(0, 2000) }, 502, cors);
  }

  return json({ ok: true, job_id: jobId }, 202, cors);
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

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const isAnalyze = path === "/analyze" || path.endsWith("/analyze");

    if (request.method === "OPTIONS") {
      if (!originAllowed(request, env) && (env.ALLOWED_ORIGINS || "").trim()) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return json({ error: "POST only", hint: isAnalyze ? "POST /analyze" : "POST /" }, 405, cors);
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

    if (isAnalyze) {
      return handleAnalyze(body, env, cors);
    }
    return handleRerun(body, env, cors);
  },
};

function json(o, status, cors) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
