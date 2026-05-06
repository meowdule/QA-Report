import { CRITERIA } from "./schema.mjs";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ structure: any; scenariosDoc: any; runResults: any; jobId: string; reportGeneratedAt?: string }} p
 */
export function buildReportHtml(p) {
  const { structure, scenariosDoc, runResults, jobId } = p;
  const reportGeneratedAt = p.reportGeneratedAt ?? runResults.finishedAt ?? new Date().toISOString();
  const passed = runResults.scenarios.filter((s) => s.passed).length;
  const total = runResults.scenarios.length;
  const pages = structure.pages?.length ?? 0;
  const traceMode = runResults.traceMode ?? "failure";

  const criteriaRows = buildCriteriaTable(runResults.criteriaSummary);
  const failedConsoleBlock = buildFailedConsoleSection(runResults.scenarios);
  const scenarioRows = runResults.scenarios.map((s) => buildScenarioRow(s)).join("");

  const passPct = total ? Math.round((passed / total) * 100) : 0;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>QA 리포트 · Job ${esc(jobId)}</title>
  <link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"/>
  <style>
    :root {
      --font: "Pretendard", -apple-system, system-ui, sans-serif;
      --bg: #e8ecf4;
      --bg2: #f4f6fb;
      --card: #fff;
      --text: #1a1d24;
      --muted: #5c6473;
      --accent: #00c471;
      --accent2: #00a85f;
      --accent-soft: rgba(0, 196, 113, 0.12);
      --border: rgba(15, 23, 42, 0.08);
      --shadow: 0 4px 24px rgba(15, 23, 42, 0.07);
      --radius: 16px;
      --radius-sm: 12px;
      --bad: #e11d48;
      --ok: #00a85f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      line-height: 1.55;
      color: var(--text);
      background: linear-gradient(165deg, var(--bg) 0%, var(--bg2) 50%, var(--bg) 100%);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 1040px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    .hero {
      text-align: center;
      margin-bottom: 1.75rem;
    }
    .eyebrow {
      display: inline-block;
      margin: 0 0 0.65rem;
      padding: 0.25rem 0.7rem;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: var(--accent2);
      background: var(--accent-soft);
      border-radius: 999px;
    }
    h1 {
      margin: 0 0 0.6rem;
      font-size: clamp(1.5rem, 3.5vw, 1.85rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.25;
    }
    .meta {
      margin: 0 auto;
      max-width: 42rem;
      font-size: 0.88rem;
      color: var(--muted);
      line-height: 1.6;
    }
    .meta code { font-size: 0.9em; }
    .meta-grid {
      display: grid;
      gap: 0.35rem;
      margin-top: 0.75rem;
      padding: 0.85rem 1rem;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      text-align: left;
    }
    .meta-grid div { display: flex; flex-wrap: wrap; gap: 0.35rem 0.75rem; align-items: baseline; }
    .meta-grid strong { min-width: 5.5rem; color: var(--text); font-size: 0.8rem; }
    .callout {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      font-size: 0.82rem;
      color: var(--muted);
      background: rgba(0, 196, 113, 0.08);
      border-radius: var(--radius-sm);
      border: 1px solid var(--accent-soft);
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem 1.35rem;
      margin: 1rem 0;
      box-shadow: var(--shadow);
    }
    .card h2 {
      margin: 0 0 0.5rem;
      font-size: 1.05rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .card > p.muted { margin-top: 0; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.85rem;
    }
    .stat {
      padding: 1rem;
      background: var(--bg2);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    .stat strong {
      display: block;
      font-size: 1.35rem;
      font-weight: 800;
      color: var(--text);
      letter-spacing: -0.02em;
    }
    .stat span.lbl {
      display: block;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--muted);
      margin-top: 0.25rem;
    }
    .stat.pass strong { color: var(--ok); }
    table.data {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    table.data th, table.data td {
      border-bottom: 1px solid var(--border);
      padding: 0.55rem 0.45rem;
      vertical-align: top;
      text-align: left;
    }
    table.data th {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    table.data tr:last-child td { border-bottom: none; }
    .scroll { overflow: auto; -webkit-overflow-scrolling: touch; }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 8px;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .badge.pass { background: #d1fae5; color: #047857; }
    .badge.fail { background: #ffe4e6; color: #be123c; }
    .pill {
      display: inline-block;
      margin: 0.15rem 0.35rem 0 0;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      background: var(--bg2);
      border: 1px solid var(--border);
      font-size: 0.72rem;
      color: var(--muted);
    }
    .muted { color: var(--muted); font-size: 0.86rem; }
    .steps { margin: 0.35rem 0 0 1rem; padding: 0; }
    .steps li { margin: 0.15rem 0; }
    .steps li.ok { color: #047857; }
    .steps li.bad { color: var(--bad); }
    .steps li.skip { color: var(--muted); }
    pre.sub {
      font-size: 0.72rem;
      background: #12151c;
      color: #e8ecf4;
      padding: 0.65rem;
      border-radius: var(--radius-sm);
      overflow: auto;
      max-height: 220px;
      margin: 0.35rem 0 0;
    }
    code { font-family: ui-monospace, monospace; font-size: 0.88em; }
    a { color: var(--accent2); font-weight: 600; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .crit-ok { color: #047857; font-weight: 700; }
    .crit-bad { color: var(--bad); font-weight: 700; }
    .artifact { font-size: 0.82rem; margin: 0.25rem 0; }
    .links {
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--border);
      font-size: 0.85rem;
      color: var(--muted);
      text-align: center;
    }
  </style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <p class="eyebrow">실행 리포트</p>
    <h1>테스트 결과 대시보드</h1>
    <p class="meta">
      GitHub Actions <strong>run_id</strong>마다 <code>jobs/&lt;Job ID&gt;/</code> 폴더가 따로 생깁니다.
      사용자·실행 시각이 다르면 Job ID가 달라지므로 리포트도 각각 보관됩니다.
    </p>
    <div class="meta-grid">
      <div><strong>Job ID</strong> <code>${esc(jobId)}</code></div>
      <div><strong>테스트 완료</strong> <span>${esc(runResults.finishedAt)}</span></div>
      <div><strong>리포트 생성</strong> <span>${esc(reportGeneratedAt)}</span></div>
      <div><strong>시나리오 스키마</strong> <span>v${esc(scenariosDoc.version)}</span> · trace <code>${esc(traceMode)}</code></div>
      <div><strong>대상 URL</strong> <code style="word-break:break-all">${esc(structure.targetUrl)}</code></div>
    </div>
    <p class="callout">이 페이지는 배포된 정적 HTML입니다. 같은 Job에서 시나리오를 수정해 다시 테스트하면 이 파일이 갱신됩니다.</p>
  </header>

  <div class="card">
    <div class="grid">
      <div class="stat"><strong>${esc(pages)}</strong><span class="lbl">크롤 페이지</span></div>
      <div class="stat pass"><strong>${esc(passPct)}%</strong><span class="lbl">시나리오 통과율</span></div>
      <div class="stat"><strong>${esc(passed)} / ${esc(total)}</strong><span class="lbl">통과 / 전체</span></div>
      <div class="stat"><strong>${esc(total)}</strong><span class="lbl">실행 시나리오 수</span></div>
    </div>
  </div>

  <div class="card">
    <h2>기준별 통과 요약</h2>
    <p class="muted">기준 태그가 붙은 시나리오 건수 기준입니다. 한 시나리오가 여러 기준을 가질 수 있습니다.</p>
    <div class="scroll">
      <table class="data">
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
    <h2>콘솔·페이지 오류 (실패 시나리오)</h2>
    ${failedConsoleBlock}
  </div>

  <div class="card">
    <h2>시나리오 상세</h2>
    <p class="muted">Trace는 실패 시 또는 모드가 <code>all</code>일 때 <code>traces/*.zip</code> ·
      <code>npx playwright show-trace traces/&lt;파일&gt;.zip</code></p>
    <div class="scroll">
      <table class="data">
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
  </div>

  <p class="links">
    원본 JSON ·
    <a href="./structure.json">structure.json</a> ·
    <a href="./scenarios.draft.json">scenarios.draft.json</a> ·
    <a href="./results.json">results.json</a> ·
    <a href="./schema.json">schema.json</a>
  </p>
</div>
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
