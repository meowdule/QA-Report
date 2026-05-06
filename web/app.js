/**
 * GitHub Pages 프로젝트 사이트 기준으로 jobs/ 경로를 해석합니다.
 */
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

function jobFileUrl(jobId, file) {
  const id = encodeURIComponent(String(jobId).trim());
  return new URL(`jobs/${id}/${file}`, pagesBase()).href;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function githubRepo() {
  return document.documentElement.dataset.githubRepo || "meowdule/QA-Report";
}

const qs = new URLSearchParams(window.location.search);
const initialJob = (qs.get("job") || qs.get("jobId") || "").trim();

/** @type {{ jobId: string; structure: any; scenariosDoc: any; results: any | null; dispatchMeta: any | null }} */
const state = {
  jobId: "",
  structure: null,
  scenariosDoc: null,
  results: null,
  dispatchMeta: null,
};

const el = {
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
  triggerUrl: document.getElementById("trigger-url"),
  triggerSecret: document.getElementById("trigger-secret"),
  btnPostRerun: document.getElementById("btn-post-rerun"),
  dispatchHint: document.getElementById("dispatch-hint"),
  linkActionsManual: document.getElementById("link-actions-manual"),
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
 * @param {{ signal?: AbortSignal }} [opts]
 */
async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { cache: "no-store", signal: opts.signal });
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

function wireReport(jobId) {
  const reportUrl = jobFileUrl(jobId, "report.html");
  el.reportLink.href = reportUrl;
  el.reportFrame.src = reportUrl;
}

function wireManualActionsLink() {
  const repo = githubRepo();
  el.linkActionsManual.href = `https://github.com/${repo}/actions/workflows/run-custom-scenarios.yml`;
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
 */
async function loadJob(jobId) {
  pollAbort?.abort();
  pollAbort = new AbortController();
  const signal = pollAbort.signal;

  const structureUrl = jobFileUrl(jobId, "structure.json");
  const scenariosUrl = jobFileUrl(jobId, "scenarios.draft.json");
  const resultsUrl = jobFileUrl(jobId, "results.json");

  el.btnStop.hidden = false;
  setStatus("structure.json 불러오는 중…", "load");

  const usePoll = el.pollToggle?.checked ?? true;
  let structure;
  try {
    if (usePoll) {
      structure = await pollUntilOk(structureUrl, {
        intervalMs: 3000,
        maxAttempts: 40,
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

  setStatus("연관 파일 로드 중…", "load");

  let scenarios = null;
  let results = null;
  const warnings = [];
  try {
    scenarios = await fetchJson(scenariosUrl, { signal });
  } catch {
    warnings.push("scenarios.draft.json 없음");
  }
  try {
    results = await fetchJson(resultsUrl, { signal });
  } catch {
    /* optional */
  }

  state.jobId = jobId;
  state.structure = structure;
  state.scenariosDoc = scenarios;
  state.results = results;
  state.dispatchMeta = null;

  try {
    state.dispatchMeta = await fetchJson(jobFileUrl(jobId, "dispatch-meta.json"), { signal });
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
  wireReport(jobId);
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
}

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
  const url = el.triggerUrl?.value?.trim();
  const secret = el.triggerSecret?.value?.trim();
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
    setStatus("Trigger Worker URL을 입력하세요. (또는 아래 Actions 링크)", "warn");
    return;
  }
  setStatus("Worker에 POST 중…", "load");
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
    setStatus("요청 접수됨(202). Actions에서 워크플로가 시작되면 같은 Job 폴더가 갱신됩니다.", "ok");
  } catch (e) {
    setStatus(`네트워크 오류: ${/** @type {Error} */ (e).message}`, "err");
  }
});

el.triggerUrl?.addEventListener("change", () => {
  const v = el.triggerUrl.value.trim();
  if (v) localStorage.setItem("qa_trigger_url", v);
});

wireManualActionsLink();
if (el.triggerUrl) {
  el.triggerUrl.value = localStorage.getItem("qa_trigger_url") || "";
}

if (initialJob) {
  el.input.value = initialJob;
  loadJob(initialJob);
} else {
  setStatus("Job ID를 입력한 뒤 불러오기를 누르세요.", "");
}
