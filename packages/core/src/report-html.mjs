import { CRITERIA } from "./schema.mjs";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ structure: any; scenariosDoc: any; runResults: any; jobId: string }} p
 */
export function buildReportHtml(p) {
  const { structure, scenariosDoc, runResults, jobId } = p;
  const passed = runResults.scenarios.filter((s) => s.passed).length;
  const total = runResults.scenarios.length;
  const pages = structure.pages?.length ?? 0;
  const traceMode = runResults.traceMode ?? "failure";

  const criteriaRows = buildCriteriaTable(runResults.criteriaSummary);
  const failedConsoleBlock = buildFailedConsoleSection(runResults.scenarios);
  const scenarioRows = runResults.scenarios.map((s) => buildScenarioRow(s)).join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>QA 리포트 · Job ${esc(jobId)}</title>
  <style>
    :root { font-family: system-ui, sans-serif; line-height: 1.45; color: #0f1419; background: #f6f8fb; }
    main { max-width: 1000px; margin: 0 auto; padding: 1.5rem; }
    h1 { font-size: 1.35rem; margin: 0 0 0.5rem; }
    h2 { font-size: 1.05rem; margin: 0 0 0.5rem; }
    .card { background: #fff; border: 1px solid #d8dee6; border-radius: 10px; padding: 1rem 1.1rem; margin: 1rem 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
    .stat { padding: 0.75rem; background: #f0f4fa; border-radius: 8px; }
    .stat strong { display: block; font-size: 1.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { border-bottom: 1px solid #e3e8ef; padding: 0.5rem 0.35rem; vertical-align: top; }
    th { text-align: left; font-size: 0.78rem; color: #5c6570; }
    .badge { display: inline-block; padding: 0.15rem 0.45rem; border-radius: 6px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; }
    .badge.pass { background: #def7e6; color: #0b6b32; }
    .badge.fail { background: #fde8e8; color: #9b1c1c; }
    .pill { display: inline-block; margin: 0.15rem 0.25rem 0 0; padding: 0.1rem 0.35rem; border-radius: 999px; background: #eef2f7; font-size: 0.72rem; }
    .muted { color: #5c6570; font-size: 0.82rem; }
    .steps { margin: 0.25rem 0 0 1rem; padding: 0; }
    .steps li.ok { color: #0b6b32; }
    .steps li.bad { color: #9b1c1c; }
    .steps li.skip { color: #6e7781; }
    pre.sub { font-size: 0.72rem; background: #0f1419; color: #e7ecf3; padding: 0.5rem; border-radius: 6px; overflow: auto; max-height: 220px; }
    code { font-family: ui-monospace, monospace; font-size: 0.85em; }
    a { color: #0969da; }
    .crit-ok { color: #0b6b32; font-weight: 600; }
    .crit-bad { color: #9b1c1c; font-weight: 600; }
    .artifact { font-size: 0.82rem; margin: 0.2rem 0; }
  </style>
</head>
<body>
<main>
  <h1>테스트 대시보드 (Phase 2)</h1>
  <p class="muted">Job <code>${esc(jobId)}</code> · ${esc(runResults.finishedAt)} · scenarios v${esc(
    scenariosDoc.version,
  )} · trace: <code>${esc(traceMode)}</code></p>
  <div class="card">
    <div class="grid">
      <div class="stat"><strong>${esc(pages)}</strong> 크롤 페이지</div>
      <div class="stat"><strong>${esc(total ? Math.round((passed / total) * 100) : 0)}%</strong> 시나리오 통과</div>
      <div class="stat"><strong>${esc(passed)}/${esc(total)}</strong> 시나리오</div>
      <div class="stat"><strong>대상</strong> <span style="word-break:break-all">${esc(structure.targetUrl)}</span></div>
    </div>
  </div>

  <div class="card">
    <h2>5가지 기준별 통과 요약</h2>
    <p class="muted">각 기준 태그가 붙은 시나리오 건수 기준입니다. 한 시나리오가 여러 기준을 포함할 수 있습니다.</p>
    <div style="overflow:auto;">
      <table>
        <thead>
          <tr>
            <th>기준</th>
            <th>설명</th>
            <th>주요 스텝</th>
            <th>통과</th>
            <th>실패</th>
            <th>시나리오</th>
          </tr>
        </thead>
        <tbody>${criteriaRows}</tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <h2>콘솔·페이지 오류 (실패한 시나리오)</h2>
    ${failedConsoleBlock}
  </div>

  <div class="card" style="overflow:auto;">
    <h2>시나리오 상세</h2>
    <p class="muted">Trace: 실패 시(또는 trace 모드 <code>all</code>) <code>traces/*.zip</code> · 로컬에서
      <code>npx playwright show-trace traces/&lt;파일&gt;.zip</code></p>
    <table>
      <thead>
        <tr>
          <th>결과</th>
          <th>시나리오 / 기준</th>
          <th>시간</th>
          <th>아티팩트</th>
          <th>스텝 / 콘솔</th>
        </tr>
      </thead>
      <tbody>${scenarioRows}</tbody>
    </table>
  </div>

  <p class="muted">원본: <a href="./structure.json">structure.json</a> ·
    <a href="./scenarios.draft.json">scenarios.draft.json</a> ·
    <a href="./results.json">results.json</a> ·
    <a href="./schema.json">schema.json</a></p>
</main>
</body>
</html>`;
}

/**
 * @param {Record<string, any> | undefined} summary
 */
function buildCriteriaTable(summary) {
  if (!summary || Object.keys(summary).length === 0) {
    return `<tr><td colspan="6" class="muted">기준 요약 없음</td></tr>`;
  }

  const entries = Object.entries(summary).filter(([, row]) => (row.pass || 0) + (row.fail || 0) > 0);
  if (!entries.length) {
    return `<tr><td colspan="6" class="muted">이번 실행에 태깅된 기준이 없습니다.</td></tr>`;
  }

  return entries
    .map(([id, row]) => {
      const def = CRITERIA[/** @type {keyof typeof CRITERIA} */ (id)];
      const label = def?.labelKo ?? id;
      const desc = def?.description ?? "";
      const steps = def?.primarySteps?.join(", ") ?? "";
      const total = row.pass + row.fail;
      const rate = total ? Math.round((row.pass / total) * 100) : 0;
      const scenList = (row.scenarioIds || [])
        .map(
          /** @param {{ id: string; passed: boolean }} s */ (s) =>
            `<span class="${s.passed ? "crit-ok" : "crit-bad"}">${esc(s.id)}</span>`,
        )
        .join(", ");
      return `<tr>
        <td><strong>${esc(label)}</strong><div class="muted"><code>${esc(id)}</code></div></td>
        <td class="muted">${esc(desc)}</td>
        <td><code>${esc(steps)}</code></td>
        <td class="crit-ok">${esc(row.pass)} <span class="muted">(${esc(rate)}%)</span></td>
        <td class="crit-bad">${esc(row.fail)}</td>
        <td style="word-break:break-word;">${scenList || "—"}</td>
      </tr>`;
    })
    .join("");
}

/**
 * @param {any[]} scenarios
 */
function buildFailedConsoleSection(scenarios) {
  const failed = scenarios.filter((s) => !s.passed && s.consoleErrors?.length);
  if (!failed.length) {
    return `<p class="muted">실패 시나리오에서 수집된 콘솔·페이지 오류가 없거나, 통과만 있습니다.</p>`;
  }

  return failed
    .map((s) => {
      const body = esc(JSON.stringify(s.consoleErrors, null, 2));
      return `<div style="margin-bottom:1rem;">
        <strong>${esc(s.name)}</strong> <code class="muted">${esc(s.id)}</code>
        <pre class="sub">${body}</pre>
      </div>`;
    })
    .join("");
}

/**
 * @param {any} s
 */
function buildScenarioRow(s) {
  const badge = s.passed ? "pass" : "fail";
  const crit = (s.criteria || []).map((c) => `<span class="pill">${esc(c)}</span>`).join(" ");

  const arts = [];
  if (s.artifacts?.trace) {
    arts.push(`<div class="artifact">Trace: <a href="./${esc(s.artifacts.trace)}">${esc(s.artifacts.trace)}</a></div>`);
  }
  if (s.artifacts?.screenshot) {
    arts.push(
      `<div class="artifact">Screenshot: <a href="./${esc(s.artifacts.screenshot)}">${esc(
        s.artifacts.screenshot,
      )}</a></div>`,
    );
  }
  if (!arts.length) {
    arts.push(`<span class="muted">—</span>`);
  }

  const errPreview =
    s.passed === false && s.consoleErrors?.length
      ? `<pre class="sub">${esc(JSON.stringify(s.consoleErrors.slice(0, 4), null, 2))}</pre>`
      : "";

  const steps = (s.steps || [])
    .map((st) => {
      const cls = st.skipped ? "skip" : st.ok ? "ok" : "bad";
      const extra = formatStepDetail(st);
      const note = st.note ? ` <span class="muted">(${esc(st.note)})</span>` : "";
      return `<li class="${cls}"><code>${esc(st.type)}</code>${note}${extra}</li>`;
    })
    .join("");

  return `<tr>
    <td><span class="badge ${badge}">${badge}</span></td>
    <td><strong>${esc(s.name)}</strong><div class="muted">${esc(s.id)}</div>${crit}</td>
    <td>${esc(s.durationMs)} ms</td>
    <td>${arts.join("")}</td>
    <td><ol class="steps">${steps}</ol>${errPreview}</td>
  </tr>`;
}

/**
 * @param {any} st
 */
function formatStepDetail(st) {
  const parts = [];
  if (st.url) parts.push(`url ${esc(st.url)}`);
  if (st.finalUrl) parts.push(`→ ${esc(st.finalUrl)}`);
  if (st.status != null) parts.push(`HTTP ${esc(st.status)}`);
  if (st.selector) parts.push(`sel ${esc(st.selector)}`);
  if (st.href) parts.push(`href ${esc(st.href)}`);
  if (st.requestMethod) parts.push(`req ${esc(st.requestMethod)}`);
  if (st.error) parts.push(`err ${esc(st.error)}`);
  if (!parts.length) return "";
  return ` — <span class="muted">${parts.join(" · ")}</span>`;
}
