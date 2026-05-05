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

  const scenarioRows = runResults.scenarios
    .map((s) => {
      const badge = s.passed ? "pass" : "fail";
      const crit = (s.criteria || []).map((c) => `<span class="pill">${esc(c)}</span>`).join(" ");
      const errPreview =
        s.consoleErrors?.length > 0
          ? `<pre class="sub">${esc(JSON.stringify(s.consoleErrors.slice(0, 3), null, 2))}</pre>`
          : "";
      const steps = (s.steps || [])
        .map(
          (st) =>
            `<li class="${st.ok ? "ok" : "bad"}"><code>${esc(st.type)}</code> ${
              st.error ? `— ${esc(st.error)}` : ""
            }</li>`,
        )
        .join("");
      return `<tr>
        <td><span class="badge ${badge}">${badge}</span></td>
        <td><strong>${esc(s.name)}</strong><div class="muted">${esc(s.id)}</div>${crit}</td>
        <td>${s.durationMs} ms</td>
        <td><ol class="steps">${steps}</ol>${errPreview}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>QA 리포트 · Job ${esc(jobId)}</title>
  <style>
    :root { font-family: system-ui, sans-serif; line-height: 1.45; color: #0f1419; background: #f6f8fb; }
    main { max-width: 960px; margin: 0 auto; padding: 1.5rem; }
    h1 { font-size: 1.35rem; margin: 0 0 0.5rem; }
    .card { background: #fff; border: 1px solid #d8dee6; border-radius: 10px; padding: 1rem 1.1rem; margin: 1rem 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
    .stat { padding: 0.75rem; background: #f0f4fa; border-radius: 8px; }
    .stat strong { display: block; font-size: 1.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th, td { border-bottom: 1px solid #e3e8ef; padding: 0.55rem 0.35rem; vertical-align: top; }
    th { text-align: left; font-size: 0.8rem; color: #5c6570; }
    .badge { display: inline-block; padding: 0.15rem 0.45rem; border-radius: 6px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }
    .badge.pass { background: #def7e6; color: #0b6b32; }
    .badge.fail { background: #fde8e8; color: #9b1c1c; }
    .pill { display: inline-block; margin: 0.15rem 0.25rem 0 0; padding: 0.1rem 0.35rem; border-radius: 999px; background: #eef2f7; font-size: 0.72rem; }
    .muted { color: #5c6570; font-size: 0.82rem; }
    .steps { margin: 0.25rem 0 0 1rem; padding: 0; }
    .steps li.ok { color: #0b6b32; }
    .steps li.bad { color: #9b1c1c; }
    pre.sub { font-size: 0.72rem; background: #0f1419; color: #e7ecf3; padding: 0.5rem; border-radius: 6px; overflow: auto; max-height: 160px; }
    code { font-family: ui-monospace, monospace; font-size: 0.85em; }
    a { color: #0969da; }
  </style>
</head>
<body>
<main>
  <h1>테스트 대시보드</h1>
  <p class="muted">Job <code>${esc(jobId)}</code> · ${esc(runResults.finishedAt)}</p>
  <div class="card">
    <div class="grid">
      <div class="stat"><strong>${esc(pages)}</strong> 크롤 페이지</div>
      <div class="stat"><strong>${esc(total ? Math.round((passed / total) * 100) : 0)}%</strong> 시나리오 통과</div>
      <div class="stat"><strong>${esc(passed)}/${esc(total)}</strong> 시나리오</div>
      <div class="stat"><strong>대상</strong> <span style="word-break:break-all">${esc(structure.targetUrl)}</span></div>
    </div>
  </div>
  <div class="card">
    <h2 style="margin-top:0;font-size:1.05rem;">기준별 요약</h2>
    <ul class="muted">
      <li><strong>page_rendering</strong> — <code>assertVisible(body)</code> 기반</li>
      <li><strong>core_action</strong> — 첫 동일 출처 링크 클릭 시나리오</li>
      <li><strong>input_data</strong> — 첫 폼 필드에 더미 입력 (실제 저장 검증은 포함하지 않을 수 있음)</li>
      <li><strong>console_errors</strong> — 시나리오 단계 <code>assertNoConsoleError</code></li>
      <li><strong>primary_flow</strong> — 상위 페이지 순차 방문</li>
    </ul>
  </div>
  <div class="card" style="overflow:auto;">
    <h2 style="margin-top:0;font-size:1.05rem;">시나리오 결과</h2>
    <table>
      <thead><tr><th>결과</th><th>시나리오</th><th>시간</th><th>스텝 / 콘솔</th></tr></thead>
      <tbody>${scenarioRows}</tbody>
    </table>
  </div>
  <p class="muted">원본 JSON: <a href="./structure.json">structure.json</a> · <a href="./scenarios.draft.json">scenarios.draft.json</a> · <a href="./results.json">results.json</a></p>
</main>
</body>
</html>`;
}
