/**
 * Cloudflare Workers: POST JSON { job_id, scenarios } → GitHub repository_dispatch
 *
 * Secrets (wrangler secret):
 *   GITHUB_TOKEN — classic PAT: repo scope, 또는 fine-grained: Contents+Metadata+Actions(dispatches)
 *   WEBHOOK_SECRET — (선택) 브라우저가 보내는 X-QA-Secret 과 동일하게 설정
 *
 * Vars:
 *   GITHUB_REPO — "owner/name"
 */
export default {
  /** @param {Request} request */
  /** @param {{ GITHUB_TOKEN: string; GITHUB_REPO: string; WEBHOOK_SECRET?: string }} env */
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-QA-Secret",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405, cors);
    }

    if (env.WEBHOOK_SECRET) {
      const got = request.headers.get("X-QA-Secret");
      if (got !== env.WEBHOOK_SECRET) {
        return json({ error: "Forbidden" }, 403, cors);
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const jobId = body?.job_id != null ? String(body.job_id).trim() : "";
    const scenarios = body?.scenarios;
    if (!jobId || !scenarios || typeof scenarios !== "object") {
      return json({ error: "job_id and scenarios object required" }, 400, cors);
    }

    const repo = env.GITHUB_REPO;
    const token = env.GITHUB_TOKEN;
    if (!repo || !token) {
      return json({ error: "Worker env GITHUB_REPO / GITHUB_TOKEN missing" }, 500, cors);
    }

    const payload = JSON.stringify({
      event_type: "run-custom-scenarios",
      client_payload: { job_id: jobId, scenarios },
    });

    if (payload.length > 65_000) {
      return json({ error: "Payload exceeds GitHub client_payload limit (~65KB)" }, 413, cors);
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
      body: payload,
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
