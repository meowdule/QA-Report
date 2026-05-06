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

const qs = new URLSearchParams(window.location.search);
const initialJob = (qs.get("job") || qs.get("jobId") || "").trim();

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

function wireReport(jobId) {
  const reportUrl = jobFileUrl(jobId, "report.html");
  el.reportLink.href = reportUrl;
  el.reportFrame.src = reportUrl;
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
    /* 선택 파일 */
  }

  renderSummary(structure, scenarios, results);
  renderStructure(structure);
  if (scenarios) {
    renderScenarios(scenarios);
    show(el.scenariosSection, true);
  } else {
    show(el.scenariosSection, false);
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

function hideAllPanels() {
  show(el.summarySection, false);
  show(el.scenariosSection, false);
  show(el.structureSection, false);
  show(el.resultsSection, false);
  show(el.reportSection, false);
  el.reportFrame.removeAttribute("src");
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

if (initialJob) {
  el.input.value = initialJob;
  loadJob(initialJob);
} else {
  setStatus("Job ID를 입력한 뒤 불러오기를 누르세요.", "");
}
