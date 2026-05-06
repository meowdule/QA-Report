/**
 * Phase 6: 크롤·초안 요약을 LLM에 보내 추가 스모크 시나리오를 제안·병합합니다.
 * OpenAI 호환 Chat Completions API (`LLM_BASE_URL` 로 Azure 등 교체 가능).
 */

import { STEP_TYPES, validateScenarioSteps } from "./schema.mjs";

const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * @param {any} structure
 * @param {any} draftDoc
 */
export function buildMaskedPack(structure, draftDoc) {
  const pages = (structure.pages || [])
    .filter((p) => !p.error && p.httpStatus >= 200 && p.httpStatus < 400)
    .slice(0, 15)
    .map((p) => ({
      url: p.url,
      title: maskPII(p.title || ""),
      linkCount: (p.links || []).length,
      outboundSummary: summarizeOutbound(p.outboundNav),
      interactableKinds: countKinds(p.interactables),
      formKinds: (p.formControls || []).map((f) => f.kind),
      linkTabHints: summarizeTabHints(p.linkClickMeta),
    }));

  return {
    targetUrl: structure.targetUrl,
    origin: structure.origin,
    pages,
    existingScenarios: (draftDoc.scenarios || []).map((s) => ({
      id: s.id,
      name: s.name,
      criteria: s.criteria,
      stepTypes: (s.steps || []).map((x) => x.type),
    })),
    allowedStepTypes: [...STEP_TYPES],
    uiAfterClickHint:
      "토스트/스낵바는 보통 짧게 보였다 사라짐 → waitForSelector(role=alert|status 또는 알려진 클래스) + optional. " +
      "window.alert 는 러너가 기록 후 dismiss. target=_blank 는 새 탭으로 열리며 러너가 URL 기록 후 탭을 닫음. " +
      "동일 탭 외부 이동은 finalUrl 로 구분. mailto/tel 은 시나리오에서 navigate 하지 말 것.",
  };
}

function maskPII(s) {
  return String(s)
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b\+?\d[\d\s\-]{7,}\b/g, "[tel]")
    .slice(0, 200);
}

/**
 * @param {any} meta
 */
function summarizeTabHints(meta) {
  if (!meta || typeof meta !== "object") return null;
  let blank = 0;
  let self = 0;
  for (const v of Object.values(meta)) {
    if (v && typeof v === "object" && v.opensNewTab) blank++;
    else self++;
  }
  return { opensNewTabLinkTargets: blank, sameTabOrUnspecified: self };
}

/**
 * @param {any[]} nav
 */
function summarizeOutbound(nav) {
  const out = { external_http: 0, mailto: 0, tel: 0, javascript: 0 };
  if (!Array.isArray(nav)) return out;
  for (const x of nav) {
    const c = x?.category;
    if (c && Object.prototype.hasOwnProperty.call(out, c)) out[c]++;
  }
  return out;
}

/**
 * @param {any[] | undefined} list
 */
function countKinds(list) {
  /** @type {Record<string, number>} */
  const m = {};
  if (!Array.isArray(list)) return m;
  for (const x of list) {
    const k = x.kind || "?";
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

/**
 * @param {string} text
 */
function parseJsonFromLlm(text) {
  const t = String(text).trim();
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let p = tryParse(t);
  if (p) return p;
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    p = tryParse(m[0]);
    if (p) return p;
  }
  return null;
}

/**
 * @param {any} structure
 * @param {any} draftDoc
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ doc: any; log: any }>}
 */
export async function enrichScenariosWithLLM(structure, draftDoc, env = process.env) {
  const apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY;
  /** @type {any} */
  const log = { enabled: !!apiKey, merged: 0, skippedDuplicates: 0, errors: [] };

  if (!apiKey) {
    log.reason = "no_api_key";
    return { doc: draftDoc, log };
  }

  const base = (env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.LLM_MODEL || DEFAULT_MODEL;
  const pack = buildMaskedPack(structure, draftDoc);

  const system = `You are a senior QA automation engineer. Given a JSON pack describing crawled pages, suggest 2 to 6 ADDITIONAL smoke test scenarios as JSON ONLY.

Output format: {"scenarios": [ { "id": "llm-something", "name": "...", "criteria": ["core_action","console_errors"], "steps": [ ... ] } ]}

Rules:
- Each step must use ONLY these types: ${STEP_TYPES.join(", ")}.
- Do not repeat existing scenario ids listed in existingScenarios.
- Prefer waitForSelector for toasts/live regions after clicks when plausible (e.g. [role=alert], [role=status]); use optional:true when unsure.
- For outbound external_http / mailto / tel links: do NOT add navigate steps to those URLs.
- Keep scenarios short (at most 12 steps each).
- criteria must be from: page_rendering, core_action, input_data, console_errors, primary_flow
- Respond with a single valid JSON object only, no markdown fences.`;

  const user = JSON.stringify(pack);

  let text = "";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const errBody = (await res.text()).slice(0, 800);
      log.errors.push(`HTTP ${res.status} ${errBody}`);
      return { doc: draftDoc, log };
    }
    const data = await res.json();
    text = data?.choices?.[0]?.message?.content || "";
  } catch (e) {
    log.errors.push(String(e?.message || e));
    return { doc: draftDoc, log };
  }

  const parsed = parseJsonFromLlm(text);
  if (!parsed?.scenarios || !Array.isArray(parsed.scenarios)) {
    log.errors.push("invalid_llm_json");
    log.rawPreview = text.slice(0, 800);
    return { doc: draftDoc, log };
  }

  const existingIds = new Set((draftDoc.scenarios || []).map((s) => s.id));
  /** @type {any} */
  const merged = { ...draftDoc, scenarios: [...(draftDoc.scenarios || [])] };

  for (const sc of parsed.scenarios) {
    if (!sc?.id || existingIds.has(sc.id)) {
      log.skippedDuplicates++;
      continue;
    }
    const probe = { scenarios: [sc], targetUrl: draftDoc.targetUrl };
    const issues = validateScenarioSteps(probe);
    if (issues.length) {
      log.errors.push({ id: sc.id, issues });
      continue;
    }
    merged.scenarios.push(sc);
    existingIds.add(sc.id);
    log.merged++;
  }

  return { doc: merged, log };
}
