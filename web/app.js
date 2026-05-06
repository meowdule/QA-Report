/**
 * GitHub Pages 프로젝트 사이트 기준으로 jobs/ 경로를 해석합니다.
 */

/**
 * Cloudflare Worker 루트 URL (끝 슬래시 없음). `workers/trigger` 배포 후 주소를 여기 한 번만 넣고 푸시하면 됩니다.
 * 분석 대상 사이트(URL)를 바꿔 가며 쓸 때는 **이 값을 다시 바꿀 필요 없음** — 같은 Worker가 모든 요청을 처리합니다.
 * 비우면 `index.html`의 `data-worker-base-url`만 사용합니다.
 */
const DEFAULT_WORKER_BASE_URL = "https://seo-qa-report.meowdule73.workers.dev";

/** Worker에 WEBHOOK_SECRET 을 쓰는 경우에만 동일 값. 비우면 헤더 미전송. */
const DEFAULT_QA_WEBHOOK_SECRET = "";

function pagesBase() {
  const { origin, pathname } = window.location;
  let p = pathname;
  if (/\/index\.html$/i.test(p)) p = p.replace(/\/?index\.html$/i, "");
  else if (!p.endsWith("/")) {
    const last = p.split("/").pop() || "";
    if (last.includes(".")) p = p.replace(/\/[^/]+$/, "");
  }
  if (!p.endsWith("/")) p += "/";
  return origin + (p.startsWith("/") ? p : `/${p}`);
}

/**
 * @param {string} jobRel `run_id` 또는 `YYYY-MM-DD/HHmmss_runid` (jobs/ 이하 상대 경로)
 * @param {string} file
 */
function jobFileUrl(jobRel, file) {
  const u = new URL(pagesBase());
  const prefix = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  const rest = ["jobs", ...String(jobRel).split("/").filter(Boolean), String(file)]
    .map((s) => encodeURIComponent(s))
    .join("/");
  u.pathname = `${prefix}${rest}`;
  return u.href;
}

/** @type {Map<string, string>} */
const jobPathCache = new Map();

/**
 * `jobs/_byRunId/<run_id>.json` → 실제 저장 경로. 없으면 구 flat `jobs/<id>/` 가정.
 * @param {string} jobId
 */
async function resolveJobStoragePath(jobId) {
  const id = String(jobId).trim();
  if (!id) throw new Error("작업 번호가 비어 있습니다.");
  const cached = jobPathCache.get(id);
  if (cached) return cached;
  const metaUrl = new URL(`jobs/_byRunId/${encodeURIComponent(id)}.json`, pagesBase());
  try {
    const r = await fetch(metaUrl, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (j && typeof j.path === "string") {
        const p = j.path.replace(/^\/+|\/+$/g, "");
        if (p) {
          jobPathCache.set(id, p);
          return p;
        }
      }
    }
  } catch {
    /* legacy */
  }
  jobPathCache.set(id, id);
  return id;
}

/**
 * 신규 배포: `_byRunId` 메타가 먼저 생기거나, 구 저장소는 flat `jobs/<id>/structure.json` 만 있음.
 * @param {string} jobId
 * @param {AbortSignal} signal
 * @param {{ intervalMs: number; maxAttempts: number }} pollCfg
 */
async function waitForJobStorageReady(jobId, signal, pollCfg) {
  const id = String(jobId).trim();
  const metaUrl = new URL(`jobs/_byRunId/${encodeURIComponent(id)}.json`, pagesBase());
  const flatStructureUrl = jobFileUrl(id, "structure.json");

  for (let i = 0; i < pollCfg.maxAttempts; i++) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (i > 0) await sleep(pollCfg.intervalMs);

    try {
      const rm = await fetch(metaUrl, { cache: "no-store", signal });
      if (rm.ok) {
        jobPathCache.delete(id);
        return;
      }
    } catch {
      /* */
    }

    try {
      const rs = await fetch(flatStructureUrl, { cache: "no-store", signal });
      if (rs.ok) return;
    } catch {
      /* */
    }

    setStatus(`결과 업로드 대기 중… (${i + 1}/${pollCfg.maxAttempts})`, "wait");
  }
  throw new Error("작업 결과가 제한 시간 안에 나타나지 않았습니다.");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function githubRepo() {
  return document.documentElement.dataset.githubRepo || "meowdule/QA-Report";
}

/** Cloudflare Worker 루트 (슬래시 없음). HTML data → 없으면 DEFAULT_WORKER_BASE_URL */
function workerBaseUrl() {
  const fromHtml = document.documentElement.dataset.workerBaseUrl?.trim();
  if (fromHtml) return fromHtml.replace(/\/+$/, "");
  const fallback = DEFAULT_WORKER_BASE_URL.trim();
  if (fallback) return fallback.replace(/\/+$/, "");
  return "";
}

function analyzeWorkerEndpoint() {
  const b = workerBaseUrl();
  return b ? `${b}/analyze` : "";
}

/** Worker `POST /` 재실행 엔드포인트 */
function workerRerunEndpoint() {
  const b = workerBaseUrl();
  return b ? `${b}/` : "";
}

/** HTML data → 없으면 DEFAULT_QA_WEBHOOK_SECRET */
function qaWebhookSecret() {
  const fromHtml = document.documentElement.dataset.qaWebhookSecret?.trim();
  if (fromHtml) return fromHtml;
  return DEFAULT_QA_WEBHOOK_SECRET.trim();
}

const qs = new URLSearchParams(window.location.search);
const initialJob = (qs.get("job") || qs.get("jobId") || "").trim();

if (window.location.protocol === "file:") {
  document.getElementById("file-protocol-banner")?.classList.remove("hidden");
}

/** @type {{ jobId: string; jobStoragePath: string; structure: any; scenariosDoc: any; results: any | null; dispatchMeta: any | null }} */
const state = {
  jobId: "",
  jobStoragePath: "",
  structure: null,
  scenariosDoc: null,
  results: null,
  dispatchMeta: null,
};

const el = {
  analyzeForm: document.getElementById("analyze-form"),
  analyzeTargetUrl: document.getElementById("analyze-target-url"),
  analyzeMaxPages: document.getElementById("analyze-max-pages"),
  analyzeMaxDepth: document.getElementById("analyze-max-depth"),
  analyzeTraceMode: document.getElementById("analyze-trace-mode"),
  analyzeStatus: document.getElementById("analyze-status"),
  form: document.getElementById("job-form"),
  input: document.getElementById("job-input"),
  pollToggle: document.getElementById("poll-toggle"),
  btnStop: document.getElementById("btn-stop"),
  status: document.getElementById("job-status"),
  summarySection: document.getElementById("summary-section"),
  summaryBody: document.getElementById("summary-body"),
  scenariosSection: document.getElementById("scenarios-section"),
  scenariosBody: document.getElementById("scenarios-body"),
  scenariosRaw: document.getElementById("scenarios-raw"),
  editSection: document.getElementById("edit-section"),
  scenariosJson: document.getElementById("scenarios-json"),
  scenarioFormRows: document.getElementById("scenario-form-rows"),
  jsonHint: document.getElementById("json-hint"),
  btnJsonToForm: document.getElementById("btn-json-to-form"),
  btnFormToJson: document.getElementById("btn-form-to-json"),
  btnValidateJson: document.getElementById("btn-validate-json"),
  btnPostRerun: document.getElementById("btn-post-rerun"),
  dispatchHint: document.getElementById("dispatch-hint"),
  structureSection: document.getElementById("structure-section"),
  structureBody: document.getElementById("structure-body"),
  structureRaw: document.getElementById("structure-raw"),
  resultsSection: document.getElementById("results-section"),
  resultsBody: document.getElementById("results-body"),
  resultsRaw: document.getElementById("results-raw"),
  reportSection: document.getElementById("report-section"),
  reportLink: document.getElementById("report-link"),
  reportFrame: document.getElementById("report-frame"),
};

/** @type {AbortController | null} */
let pollAbort = null;

function setStatus(text, kind = "") {
  if (!el.status) return;
  el.status.textContent = text;
  el.status.dataset.kind = kind;
}

function setAnalyzeStatus(text, kind = "") {
  if (!el.analyzeStatus) return;
  el.analyzeStatus.textContent = text;
  el.analyzeStatus.dataset.kind = kind;
}

/** @param {boolean} on */
function setAnalyzeBusy(on) {
  const panel = document.getElementById("analyze-panel");
  const form = el.analyzeForm;
  if (!form) return;
  for (const node of form.querySelectorAll("input, select, button")) {
    if (node instanceof HTMLButtonElement && node.type === "submit") {
      if (!node.dataset.idleLabel) node.dataset.idleLabel = node.textContent || "분석 시작";
      node.disabled = on;
      node.textContent = on ? "처리 중…" : node.dataset.idleLabel;
      continue;
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLButtonElement) {
      node.disabled = on;
    }
  }
  panel?.classList.toggle("is-loading", on);
}

/**
 * 이전 실행과 구분: `prevFinishedAt`이 있으면 다른 값일 때만, 없으면 `sinceIso` 이후 완료된 것만 신규로 봅니다.
 * @param {string} finishedAt
 * @param {string | null | undefined} prevFinishedAt
 * @param {string | undefined} sinceIso
 */
function isFreshResultsFinishedAt(finishedAt, prevFinishedAt, sinceIso) {
  if (!finishedAt) return false;
  if (prevFinishedAt != null) return finishedAt !== prevFinishedAt;
  if (sinceIso) return finishedAt > sinceIso;
  return true;
}

/**
 * @param {string} jobRel resolveJobStoragePath 결과
 * @param {string} file
 * @param {string | null | undefined} prevFinishedAt
 * @param {string} sinceIso
 * @param {AbortSignal} signal
 */
async function pollResultsUntilFresh(jobRel, file, prevFinishedAt, sinceIso, signal) {
  const maxAttempts = 72;
  const intervalMs = 5000;
  for (let i = 0; i < maxAttempts; i++) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (i > 0) await sleep(intervalMs);
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const results = await fetchJson(jobFileUrl(jobRel, file), { signal, cacheBust: true });
      const t = results?.finishedAt;
      if (isFreshResultsFinishedAt(t, prevFinishedAt, sinceIso)) return results;
    } catch {
      /* still deploying */
    }
    setStatus(`테스트 결과 대기 중… (${i + 1}/${maxAttempts})`, "wait");
  }
  throw new Error("results.json 갱신 대기 시간 초과");
}

/**
 * @param {string} url
 * @param {AbortSignal} signal
 * @param {(n: number) => void} [onWait]
 */
async function fetchJsonWithRetries(url, signal, onWait, attempts = 30, intervalMs = 2000) {
  let lastErr = /** @type {Error | null} */ (null);
  for (let i = 0; i < attempts; i++) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    try {
      return await fetchJson(url, { signal });
    } catch (e) {
      lastErr = /** @type {Error} */ (e);
    }
    if (i < attempts - 1) {
      onWait?.(i + 1);
      await sleep(intervalMs);
    }
  }
  throw lastErr || new Error("fetch failed");
}

function scrollToWorkbench() {
  requestAnimationFrame(() => {
    document.getElementById("edit-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function show(elm, on) {
  if (!elm) return;
  elm.classList.toggle("hidden", !on);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} url
 * @param {{ signal?: AbortSignal; cacheBust?: boolean }} [opts]
 */
async function fetchJson(url, opts = {}) {
  let u = url;
  if (opts.cacheBust) {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set("_", String(Date.now()));
    u = parsed.href;
  }
  const r = await fetch(u, { cache: "no-store", signal: opts.signal });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

/**
 * @param {string} url
 * @param {{ intervalMs: number; maxAttempts: number; signal?: AbortSignal }} cfg
 */
async function pollUntilOk(url, cfg) {
  let lastErr = /** @type {Error | null} */ (null);
  for (let i = 0; i < cfg.maxAttempts; i++) {
    if (cfg.signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      return await fetchJson(url, { signal: cfg.signal });
    } catch (e) {
      lastErr = /** @type {Error} */ (e);
      if (cfg.signal?.aborted) throw lastErr;
      setStatus(`대기 중… (${i + 1}/${cfg.maxAttempts}) ${lastErr.message}`, "wait");
      await sleep(cfg.intervalMs);
    }
  }
  throw lastErr || new Error("poll failed");
}

function renderSummary(structure, scenarios, results) {
  const pages = structure?.pages?.length ?? 0;
  const scenariosCount = scenarios?.scenarios?.length ?? 0;
  const origin = structure?.origin ?? "—";
  const target = structure?.targetUrl ?? "—";
  let resultsLine = "results.json 없음 또는 아직 미배포";
  if (results?.scenarios) {
    const ok = results.scenarios.filter((s) => s.passed).length;
    const tot = results.scenarios.length;
    resultsLine = `시나리오 통과 ${ok} / ${tot}`;
  }
  el.summaryBody.innerHTML = `
    <dl class="dl-grid">
      <dt>대상 URL</dt><dd><code>${esc(target)}</code></dd>
      <dt>Origin</dt><dd><code>${esc(origin)}</code></dd>
      <dt>크롤 페이지</dt><dd>${esc(pages)}</dd>
      <dt>시나리오 수</dt><dd>${esc(scenariosCount)}</dd>
      <dt>실행 요약</dt><dd>${esc(resultsLine)}</dd>
    </dl>
  `;
}

/**
 * @param {any} structure
 */
function renderStructure(structure) {
  const pages = structure?.pages || [];
  const rows = pages
    .slice(0, 50)
    .map(
      (p) =>
        `<tr><td>${esc(p.title || "—")}</td><td><code class="break">${esc(p.url)}</code></td><td>${esc(
          p.httpStatus ?? p.error ?? "—",
        )}</td></tr>`,
    )
    .join("");
  const more = pages.length > 50 ? `<p class="hint">처음 50개만 표시합니다.</p>` : "";
  el.structureBody.innerHTML = `
    <p class="hint">페이지 수: <strong>${pages.length}</strong></p>
    <div class="table-scroll"><table class="data"><thead><tr><th>제목</th><th>URL</th><th>상태</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=3>페이지 없음</td></tr>"}</tbody></table></div>${more}
  `;
  el.structureRaw.textContent = JSON.stringify(structure, null, 2);
}

/**
 * @param {any} doc
 */
function renderScenarios(doc) {
  const list = doc?.scenarios || [];
  const rows = list
    .map(
      (s) =>
        `<tr><td><code>${esc(s.id)}</code></td><td>${esc(s.name)}</td><td>${esc(
          (s.criteria || []).join(", "),
        )}</td><td>${esc(s.steps?.length ?? 0)}</td></tr>`,
    )
    .join("");
  el.scenariosBody.innerHTML = `
    <p class="hint">시나리오 스키마 버전: <strong>${esc(doc?.version ?? "?")}</strong></p>
    <div class="table-scroll"><table class="data"><thead><tr><th>ID</th><th>이름</th><th>기준</th><th>스텝 수</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=4>없음</td></tr>"}</tbody></table></div>
  `;
  el.scenariosRaw.textContent = JSON.stringify(doc, null, 2);
}

/**
 * @param {any} results
 */
function renderResults(results) {
  const summary = results?.criteriaSummary;
  let table = "";
  if (summary && Object.keys(summary).length) {
    const rows = Object.entries(summary)
      .filter(([, row]) => (row.pass || 0) + (row.fail || 0) > 0)
      .map(
        ([id, row]) =>
          `<tr><td><code>${esc(id)}</code></td><td>${esc(row.labelKo || id)}</td><td>${esc(
            row.pass,
          )}</td><td>${esc(row.fail)}</td></tr>`,
      )
      .join("");
    table = `<h3 class="subh">기준별</h3><div class="table-scroll"><table class="data"><thead><tr><th>ID</th><th>라벨</th><th>통과</th><th>실패</th></tr></thead><tbody>${
      rows || "<tr><td colspan=4>집계 없음</td></tr>"
    }</tbody></table></div>`;
  }
  const scen = (results?.scenarios || [])
    .map(
      (s) =>
        `<li class="${s.passed ? "ok" : "bad"}"><strong>${esc(s.name)}</strong> — ${
          s.passed ? "통과" : "실패"
        } (${esc(s.durationMs)} ms)</li>`,
    )
    .join("");
  el.resultsBody.innerHTML = `
    ${table}
    <h3 class="subh">시나리오</h3><ul class="result-list">${scen || "<li>없음</li>"}</ul>
  `;
  el.resultsRaw.textContent = JSON.stringify(results, null, 2);
}

/**
 * @param {any} doc
 */
function renderScenarioForms(doc) {
  if (!el.scenarioFormRows) return;
  el.scenarioFormRows.replaceChildren();
  const list = doc?.scenarios || [];
  list.forEach((s, i) => {
    const det = document.createElement("details");
    det.className = "scenario-block";
    det.dataset.index = String(i);
    if (i === 0) det.open = true;

    const sum = document.createElement("summary");
    sum.textContent = s.id || `scenario-${i}`;
    det.appendChild(sum);

    const wrap = document.createElement("div");
    wrap.className = "scenario-fields";

    const nameL = document.createElement("label");
    nameL.className = "field";
    nameL.innerHTML = "<span>이름</span>";
    const nameI = document.createElement("input");
    nameI.type = "text";
    nameI.className = "sc-name";
    nameI.value = s.name || "";
    nameL.appendChild(nameI);
    wrap.appendChild(nameL);

    const critL = document.createElement("label");
    critL.className = "field";
    critL.innerHTML = "<span>기준 (쉼표 구분)</span>";
    const critI = document.createElement("input");
    critI.type = "text";
    critI.className = "sc-crit";
    critI.value = (s.criteria || []).join(", ");
    critL.appendChild(critI);
    wrap.appendChild(critL);

    const stepL = document.createElement("label");
    stepL.className = "field";
    stepL.innerHTML = "<span>스텝 (JSON 배열)</span>";
    const ta = document.createElement("textarea");
    ta.className = "sc-steps code-area";
    ta.rows = 8;
    ta.spellcheck = false;
    ta.value = JSON.stringify(s.steps || [], null, 2);
    stepL.appendChild(ta);
    wrap.appendChild(stepL);

    det.appendChild(wrap);
    el.scenarioFormRows.appendChild(det);
  });
}

/**
 * @param {any} baseDoc
 */
function readScenarioFormsIntoDoc(baseDoc) {
  const doc = JSON.parse(JSON.stringify(baseDoc));
  const blocks = /** @type {HTMLElement[]} */ ([...document.querySelectorAll(".scenario-block")]);
  blocks.forEach((det, i) => {
    if (!doc.scenarios[i]) return;
    const name = det.querySelector(".sc-name")?.value ?? doc.scenarios[i].name;
    const crit = det.querySelector(".sc-crit")?.value ?? "";
    const stepsRaw = det.querySelector(".sc-steps")?.value ?? "[]";
    doc.scenarios[i].name = name;
    doc.scenarios[i].criteria = crit
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    doc.scenarios[i].steps = JSON.parse(stepsRaw);
  });
  return doc;
}

function syncJsonFromState() {
  if (!el.scenariosJson || !state.scenariosDoc) return;
  el.scenariosJson.value = JSON.stringify(state.scenariosDoc, null, 2);
}

function parseJsonEditor() {
  const raw = el.scenariosJson?.value?.trim();
  if (!raw) throw new Error("JSON 이 비어 있습니다.");
  return JSON.parse(raw);
}

function wireReport(jobRel) {
  const reportUrl = jobFileUrl(jobRel, "report.html");
  el.reportLink.href = reportUrl;
  el.reportFrame.src = reportUrl;
}

function hideAllPanels() {
  show(el.summarySection, false);
  show(el.scenariosSection, false);
  show(el.editSection, false);
  show(el.structureSection, false);
  show(el.resultsSection, false);
  show(el.reportSection, false);
  el.reportFrame.removeAttribute("src");
}

/**
 * @param {string} jobId
 * @param {{ longPoll?: boolean; scrollToWorkbench?: boolean }} [opts]
 */
async function loadJob(jobId, opts = {}) {
  pollAbort?.abort();
  pollAbort = new AbortController();
  const signal = pollAbort.signal;

  el.btnStop.hidden = false;

  const usePoll = el.pollToggle?.checked ?? true;
  const longPoll = opts.longPoll === true;
  const pollCfg = longPoll
    ? { intervalMs: 4000, maxAttempts: 100 }
    : { intervalMs: 3000, maxAttempts: 40 };

  try {
    if (longPoll) {
      setStatus("배포된 작업 정보를 기다리는 중…", "load");
      await waitForJobStorageReady(jobId, signal, pollCfg);
    }
  } catch (e) {
    el.btnStop.hidden = true;
    const err = /** @type {Error & { name?: string }} */ (e);
    if (err.name === "AbortError") {
      setStatus("요청이 중지되었습니다.", "warn");
      return;
    }
    setStatus(err.message || "대기 실패", "err");
    hideAllPanels();
    return;
  }

  setStatus("작업 저장 위치 확인 중…", "load");
  let jobRel;
  try {
    jobRel = await resolveJobStoragePath(jobId);
  } catch (e) {
    el.btnStop.hidden = true;
    setStatus(/** @type {Error} */ (e).message, "err");
    hideAllPanels();
    return;
  }

  const structureUrl = jobFileUrl(jobRel, "structure.json");
  const scenariosUrl = jobFileUrl(jobRel, "scenarios.draft.json");
  const resultsUrl = jobFileUrl(jobRel, "results.json");

  setStatus("structure.json 불러오는 중…", "load");

  let structure;
  try {
    if (usePoll) {
      structure = await pollUntilOk(structureUrl, {
        intervalMs: pollCfg.intervalMs,
        maxAttempts: pollCfg.maxAttempts,
        signal,
      });
    } else {
      structure = await fetchJson(structureUrl, { signal });
    }
  } catch (e) {
    el.btnStop.hidden = true;
    const err = /** @type {Error & { name?: string }} */ (e);
    if (err.name === "AbortError") {
      setStatus("요청이 중지되었습니다.", "warn");
      return;
    }
    setStatus(`불러오기 실패: ${err.message}`, "err");
    hideAllPanels();
    return;
  }

  setStatus("시나리오·결과 파일 로드 중…", "load");

  const scenRetries = longPoll ? 60 : 30;
  const scenInterval = longPoll ? 3000 : 2000;
  const resultRetries = longPoll ? 60 : 30;
  const resultInterval = longPoll ? 3000 : 2000;

  let scenarios = null;
  let results = null;
  const warnings = [];
  try {
    scenarios = await fetchJson(scenariosUrl, { signal });
  } catch {
    try {
      scenarios = await fetchJsonWithRetries(
        scenariosUrl,
        signal,
        (n) => setStatus(`시나리오 초안 대기 중… (${n}/${scenRetries})`, "wait"),
        scenRetries,
        scenInterval,
      );
    } catch {
      warnings.push("scenarios.draft.json 없음");
    }
  }
  try {
    results = await fetchJson(resultsUrl, { signal });
  } catch {
    try {
      results = await fetchJsonWithRetries(
        resultsUrl,
        signal,
        (n) => setStatus(`테스트 결과(results.json) 대기 중… (${n}/${resultRetries})`, "wait"),
        resultRetries,
        resultInterval,
      );
    } catch {
      /* optional */
    }
  }

  state.jobId = jobId;
  state.jobStoragePath = jobRel;
  state.structure = structure;
  state.scenariosDoc = scenarios;
  state.results = results;
  state.dispatchMeta = null;

  try {
    state.dispatchMeta = await fetchJson(jobFileUrl(jobRel, "dispatch-meta.json"), { signal });
  } catch {
    state.dispatchMeta = null;
  }
  if (el.dispatchHint) {
    if (state.dispatchMeta?.sig) {
      el.dispatchHint.textContent =
        "dispatch-meta.json 로드됨 — Worker에 DISPATCH_HMAC_SECRET이 설정되어 있으면 POST에 서명이 포함됩니다.";
    } else {
      el.dispatchHint.textContent =
        "dispatch-meta.json 없음 — 저장소 Actions에 DISPATCH_HMAC_SECRET을 설정한 뒤 파이프라인을 다시 실행하면 생성됩니다.";
    }
  }

  renderSummary(structure, scenarios, results);
  renderStructure(structure);
  if (scenarios) {
    renderScenarios(scenarios);
    show(el.scenariosSection, true);
    syncJsonFromState();
    renderScenarioForms(scenarios);
    show(el.editSection, true);
    el.jsonHint.textContent = "";
  } else {
    show(el.scenariosSection, false);
    show(el.editSection, false);
  }
  if (results) {
    renderResults(results);
    show(el.resultsSection, true);
  } else {
    show(el.resultsSection, false);
  }

  show(el.summarySection, true);
  show(el.structureSection, true);
  wireReport(jobRel);
  show(el.reportSection, true);

  const u = new URL(window.location.href);
  u.searchParams.set("job", jobId);
  window.history.replaceState({}, "", u);

  el.btnStop.hidden = true;
  const tail = new Date().toLocaleString();
  if (warnings.length) {
    setStatus(`완료 · ${tail} — ${warnings.join(" · ")}`, "warn");
  } else {
    setStatus(`완료 · ${tail}`, "ok");
  }

  if (opts.scrollToWorkbench && scenarios) {
    scrollToWorkbench();
  }
}

el.analyzeForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const workerUrl = analyzeWorkerEndpoint();
  const targetUrl = el.analyzeTargetUrl?.value?.trim();
  if (!workerUrl) {
    setAnalyzeStatus(
      "분석 트리거 URL이 없습니다. Cloudflare Worker를 배포한 뒤 web/app.js의 DEFAULT_WORKER_BASE_URL(또는 index.html의 data-worker-base-url)에 Worker 루트 주소를 넣고 다시 배포하세요. Worker 없이 쓰려면 GitHub → Actions →「Analyze site and run tests」로 실행한 뒤, 여기서 작업 번호로 불러오기만 하면 됩니다.",
      "err",
    );
    return;
  }
  if (!targetUrl) {
    setAnalyzeStatus("분석할 URL을 입력하세요.", "err");
    return;
  }
  const secret = qaWebhookSecret();
  const payload = {
    target_url: targetUrl,
    max_pages: String(el.analyzeMaxPages?.value ?? "20"),
    max_depth: String(el.analyzeMaxDepth?.value ?? "2"),
    trace_mode: el.analyzeTraceMode?.value || "failure",
  };

  setAnalyzeBusy(true);
  setAnalyzeStatus("워크플로에 분석을 요청하는 중…", "load");
  try {
    const r = await fetch(workerUrl, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-QA-Secret": secret } : {}),
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* ignore */
    }
    if (!r.ok) {
      setAnalyzeStatus(`오류 ${r.status}: ${text.slice(0, 500)}`, "err");
      return;
    }
    if (data?.run_id != null) {
      const rid = String(data.run_id);
      if (window.location.protocol !== "file:") {
        const u = new URL(window.location.href);
        u.searchParams.set("job", rid);
        window.history.replaceState({}, "", u);
      }
      el.input.value = rid;
      setAnalyzeStatus(`작업 ${rid} — 분석이 끝나 결과가 올라올 때까지 기다립니다…`, "load");
      await loadJob(rid, { longPoll: true, scrollToWorkbench: true });
      setAnalyzeStatus(
        "불러오기가 끝났습니다. 요약·시나리오를 확인하고, 필요하면 수정한 뒤 「테스트 수행」을 누르세요.",
        "ok",
      );
      return;
    }
    if (data?.queued) {
      setAnalyzeStatus(
        data.message ||
          "분석은 시작됐지만 작업 번호를 아직 받지 못했습니다. 잠시 뒤 아래에서 작업 번호로 불러오기를 시도해 보세요.",
        "warn",
      );
      return;
    }
    setAnalyzeStatus(`응답: ${text.slice(0, 400)}`, "warn");
  } catch (e) {
    setAnalyzeStatus(`네트워크 오류: ${/** @type {Error} */ (e).message}`, "err");
  } finally {
    setAnalyzeBusy(false);
  }
});

el.form?.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const jobId = el.input.value.trim();
  if (!jobId) return;
  loadJob(jobId);
});

el.btnStop?.addEventListener("click", () => {
  pollAbort?.abort();
  el.btnStop.hidden = true;
  setStatus("사용자가 중지했습니다.", "warn");
});

el.btnJsonToForm?.addEventListener("click", () => {
  try {
    const doc = parseJsonEditor();
    if (!Array.isArray(doc.scenarios)) throw new Error("scenarios 배열이 필요합니다.");
    state.scenariosDoc = doc;
    renderScenarioForms(doc);
    el.jsonHint.textContent = "폼을 시나리오 JSON에 맞게 갱신했습니다.";
    el.jsonHint.dataset.kind = "ok";
  } catch (e) {
    el.jsonHint.textContent = /** @type {Error} */ (e).message;
    el.jsonHint.dataset.kind = "err";
  }
});

el.btnFormToJson?.addEventListener("click", () => {
  if (!state.scenariosDoc) return;
  try {
    const merged = readScenarioFormsIntoDoc(state.scenariosDoc);
    state.scenariosDoc = merged;
    syncJsonFromState();
    el.jsonHint.textContent = "JSON을 폼 내용으로 갱신했습니다.";
    el.jsonHint.dataset.kind = "ok";
  } catch (e) {
    el.jsonHint.textContent = /** @type {Error} */ (e).message;
    el.jsonHint.dataset.kind = "err";
  }
});

el.btnValidateJson?.addEventListener("click", () => {
  try {
    const doc = parseJsonEditor();
    if (!Array.isArray(doc.scenarios)) throw new Error("최상위에 scenarios 배열이 있어야 합니다.");
    state.scenariosDoc = doc;
    el.jsonHint.textContent = `유효한 JSON입니다. 시나리오 ${doc.scenarios.length}개.`;
    el.jsonHint.dataset.kind = "ok";
  } catch (e) {
    el.jsonHint.textContent = /** @type {Error} */ (e).message;
    el.jsonHint.dataset.kind = "err";
  }
});

el.btnPostRerun?.addEventListener("click", async () => {
  const url = workerRerunEndpoint();
  const secret = qaWebhookSecret();
  if (!state.jobId) {
    setStatus("Job ID가 없습니다. 먼저 불러오기를 실행하세요.", "err");
    return;
  }
  let scenarios;
  try {
    scenarios = parseJsonEditor();
  } catch (e) {
    el.jsonHint.textContent = /** @type {Error} */ (e).message;
    el.jsonHint.dataset.kind = "err";
    return;
  }
  if (!url) {
    setStatus("지금은 테스트를 실행할 수 없습니다. 잠시 후 다시 시도해 주세요.", "warn");
    return;
  }

  const prevFinished = state.results?.finishedAt ?? null;
  const postStartedAt = new Date().toISOString();

  setStatus("테스트 수행을 요청하는 중…", "load");
  const payload = { job_id: state.jobId, scenarios };
  if (state.dispatchMeta?.sig != null && state.dispatchMeta?.exp != null) {
    payload.dispatch_sig = state.dispatchMeta.sig;
    payload.dispatch_exp = state.dispatchMeta.exp;
  }

  try {
    const r = await fetch(url, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-QA-Secret": secret } : {}),
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) {
      setStatus(`Worker 오류 ${r.status}: ${text.slice(0, 400)}`, "err");
      return;
    }

    setStatus("워크플로가 돌고 있습니다. 새 results.json이 올라올 때까지 기다립니다…", "load");
    pollAbort?.abort();
    pollAbort = new AbortController();
    const signal = pollAbort.signal;
    el.btnStop.hidden = false;
    try {
      await pollResultsUntilFresh(state.jobStoragePath, "results.json", prevFinished, postStartedAt, signal);
      await loadJob(state.jobId);
      setStatus(`테스트 반영 완료 · ${new Date().toLocaleString()}`, "ok");
    } catch (e) {
      const err = /** @type {Error & { name?: string }} */ (e);
      if (err.name === "AbortError") {
        setStatus("대기를 중지했습니다.", "warn");
        return;
      }
      setStatus(
        err.message ||
          "결과를 기다리지 못했습니다. 잠시 후 「불러오기」로 다시 시도하거나 Actions 로그를 확인하세요.",
        "err",
      );
    } finally {
      el.btnStop.hidden = true;
    }
  } catch (e) {
    setStatus(`네트워크 오류: ${/** @type {Error} */ (e).message}`, "err");
  }
});

if (initialJob) {
  document.getElementById("job-id-panel")?.setAttribute("open", "");
  el.input.value = initialJob;
  loadJob(initialJob);
} else {
  setStatus("위에서 사이트 주소를 넣고 분석을 시작하세요.", "");
}
