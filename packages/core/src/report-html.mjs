import { CRITERIA } from "./schema.mjs";
import { externalHttpUrlsSorted, internalOkPageUrls } from "./site-lists.mjs";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 반원 게이지 호(대략 πr, r=120) */
const PASS_GAUGE_ARC = 377;

/**
 * @param {number} passPct
 * @param {number} passed
 * @param {number} total
 */
function buildPassGaugeSvg(passPct, passed, total) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(passPct) || 0)));
  const dash = Math.round((pct / 100) * PASS_GAUGE_ARC);
  const sub = total ? `${passed} / ${total} 시나리오` : "실행 결과 없음";
  return `<svg class="pass-gauge-svg" viewBox="0 0 320 148" role="img" aria-label="통과율 ${esc(pct)}퍼센트">
    <defs>
      <linearGradient id="passGaugeGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#fb7185"/>
        <stop offset="40%" stop-color="#fbbf24"/>
        <stop offset="100%" stop-color="#34d399"/>
      </linearGradient>
    </defs>
    <path class="pass-gauge-track" d="M40 124 A120 120 0 0 1 280 124" fill="none" stroke-width="18" stroke-linecap="round"/>
    <path class="pass-gauge-fill" d="M40 124 A120 120 0 0 1 280 124" fill="none" stroke="url(#passGaugeGrad)" stroke-width="18" stroke-linecap="round" stroke-dasharray="${dash} ${PASS_GAUGE_ARC}"/>
    <text x="160" y="88" text-anchor="middle" class="pass-gauge-pct">${esc(pct)}%</text>
    <text x="160" y="108" text-anchor="middle" class="pass-gauge-sub">${esc(sub)}</text>
  </svg>`;
}

/**
 * @param {number} pages
 * @param {number} total
 * @param {number} passed
 * @param {number} passPct
 */
function buildSummaryDashboardHtml(pages, total, passed, passPct) {
  const fail = Math.max(0, total - passed);
  const gauge = buildPassGaugeSvg(passPct, passed, total);
  return `<div class="summary-dashboard" id="summary">
    <div class="sd-gauge-card">
      <div class="sd-card-head">
        <h3 class="sd-card-title">테스트 통과</h3>
        <p class="sd-card-desc">시나리오 실행 결과 한눈에 보기</p>
      </div>
      ${gauge}
    </div>
    <div class="sd-metrics">
      <div class="sd-metric sd-metric--pages">
        <span class="sd-metric-label">크롤 페이지</span>
        <span class="sd-metric-value">${esc(pages)}</span>
      </div>
      <div class="sd-metric sd-metric--run">
        <span class="sd-metric-label">실행 시나리오</span>
        <span class="sd-metric-value">${esc(total)}</span>
      </div>
      <div class="sd-metric sd-metric--ok">
        <span class="sd-metric-label">통과</span>
        <span class="sd-metric-value">${esc(passed)}</span>
      </div>
      <div class="sd-metric sd-metric--fail">
        <span class="sd-metric-label">실패</span>
        <span class="sd-metric-value">${esc(fail)}</span>
      </div>
    </div>
  </div>`;
}

/** 스텝 타입 → 비개발자용 짧은 설명 */
const STEP_LABEL_KO = /** @type {Record<string, string>} */ ({
  navigate: "페이지로 이동",
  click: "요소 클릭",
  fill: "텍스트 입력",
  selectOption: "목록에서 선택",
  check: "선택(체크/라디오)",
  assertVisible: "화면에 보이는지 확인",
  assertNoConsoleError: "오류 메시지 없음 확인",
  waitForResponse: "서버 응답 대기",
  waitForSelector: "특정 영역이 나타날 때까지 대기",
});

/** @param {string} kind */
function stepIconSvg(kind) {
  const common = 'class="step-ico-svg" viewBox="0 0 24 24" aria-hidden="true"';
  const p = {
    navigate:
      '<path fill="currentColor" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z"/>',
    click: '<path fill="currentColor" d="M13 1.07V9h7L10 23 9 14H2l11-12.93z"/>',
    fill: '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
    assertVisible:
      '<path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>',
  };
  const path = p[/** @type {keyof typeof p} */ (kind)] || p.assertVisible;
  return `<svg ${common}>${path}</svg>`;
}

/**
 * @param {{ structure: any; scenariosDoc: any; runResults: any; jobId: string; reportGeneratedAt?: string; lighthouseSummary?: any }} p
 */
export function buildReportHtml(p) {
  const { structure, scenariosDoc, runResults, jobId } = p;
  const lighthouseSummary = p.lighthouseSummary;
  const reportGeneratedAt = p.reportGeneratedAt ?? runResults.finishedAt ?? new Date().toISOString();
  const passed = runResults.scenarios.filter((s) => s.passed).length;
  const total = runResults.scenarios.length;
  const pages = structure.pages?.length ?? 0;
  const traceMode = runResults.traceMode ?? "failure";

  const criteriaRows = buildCriteriaTable(runResults.criteriaSummary);
  const failedConsoleBlock = buildFailedConsoleSection(runResults.scenarios);
  const scenarioRows = runResults.scenarios.map((s) => buildScenarioTableRow(s)).join("");
  const crawlInsightHtml = buildCrawlInsightSection(structure);
  const siteListsHtml = buildSiteListsSection(structure, lighthouseSummary);
  const lighthouseSectionHtml = buildLighthouseSection(lighthouseSummary);

  const passPct = total ? Math.round((passed / total) * 100) : 0;
  const targetUrl = structure.targetUrl || "—";
  const summaryDashboardHtml = buildSummaryDashboardHtml(pages, total, passed, passPct);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>테스트 결과 · ${esc(jobId)}</title>
  <link rel="icon" href="./Icon.svg" type="image/svg+xml"/>
  <link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"/>
  <style>
    :root {
      --font: "Pretendard", -apple-system, system-ui, sans-serif;
      --bg: #f4f6fb;
      --surface: #ffffff;
      --text: #1c1d27;
      --muted: #8c92a4;
      --line: #eceef5;
      --accent: #0d9488;
      --accent-hover: #0f766e;
      --accent-2: #6366f1;
      --ok: #059669;
      --ok-bg: #ecfdf5;
      --bad: #dc2626;
      --bad-bg: #fef2f2;
      --radius: 18px;
      --shadow: 0 16px 40px rgba(31, 37, 89, 0.08);
      --shadow-sm: 0 4px 16px rgba(15, 23, 42, 0.06);
      --gauge-track: #edf0f7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      line-height: 1.55;
      color: var(--text);
      background: linear-gradient(180deg, #fafbff 0%, #f0f2f8 100%);
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 960px; margin: 0 auto; padding: 1.5rem 1.25rem 2.5rem; }
    .top-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }
    .brand-wrap { display: flex; align-items: flex-start; gap: 0.85rem; }
    .brand-badge {
      width: 2.35rem; height: 2.35rem; border-radius: 12px; flex-shrink: 0;
      background: linear-gradient(145deg, #8b5cf6, #0d9488);
      box-shadow: 0 10px 22px rgba(99, 102, 241, 0.25);
    }
    .brand { margin: 0; font-size: 1.35rem; font-weight: 800; letter-spacing: -0.03em; }
    .sub { margin: 0.35rem 0 0; font-size: 0.9rem; color: var(--muted); max-width: 36rem; }
    .job-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.75rem;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .job-pill span { color: var(--muted); font-weight: 500; }
    .actions-top { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.55rem 1rem;
      font-family: inherit;
      font-size: 0.88rem;
      font-weight: 600;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      background: linear-gradient(135deg, #0d9488, #0f766e);
      color: #fff;
      box-shadow: 0 8px 20px rgba(13, 148, 136, 0.22);
    }
    .btn:hover { background: linear-gradient(135deg, #0f766e, #0d9488); }
    .target-card {
      background: var(--surface);
      border: 1px solid rgba(229, 232, 242, 0.95);
      border-radius: var(--radius);
      padding: 1.1rem 1.2rem;
      margin-bottom: 1.1rem;
      box-shadow: var(--shadow);
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.55rem 1rem;
      align-items: center;
    }
    @media (max-width: 760px) {
      .target-card { grid-template-columns: 1fr; }
    }
    .target-card .lbl { font-size: 0.75rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.15rem; grid-column: 1 / -1; }
    .target-card a { color: var(--accent); font-weight: 600; word-break: break-all; text-decoration: none; }
    .target-card a:hover { text-decoration: underline; }
    .meta-chips { display: flex; flex-wrap: wrap; gap: 0.45rem; margin: 0; font-size: 0.8rem; color: var(--muted); justify-content: flex-end; }
    @media (max-width: 760px) { .meta-chips { justify-content: flex-start; } }
    .meta-chips span { padding: 0.22rem 0.55rem; background: #f4f6fb; border-radius: 999px; font-weight: 600; color: var(--muted); }
    .summary-dashboard {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1rem;
      margin-bottom: 1.35rem;
    }
    @media (min-width: 800px) {
      .summary-dashboard { grid-template-columns: 1.15fr 0.85fr; align-items: stretch; }
    }
    .sd-gauge-card {
      background: var(--surface);
      border: 1px solid rgba(229, 232, 242, 0.95);
      border-radius: var(--radius);
      padding: 1.15rem 1.2rem 0.5rem;
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }
    .sd-gauge-card::before {
      content: "";
      position: absolute;
      top: 0; right: 0;
      width: 55%;
      height: 100%;
      background: radial-gradient(circle at 100% 0%, rgba(139, 92, 246, 0.07), transparent 55%);
      pointer-events: none;
    }
    .sd-card-head { margin-bottom: 0.35rem; position: relative; }
    .sd-card-title { margin: 0; font-size: 1.05rem; font-weight: 800; letter-spacing: -0.02em; }
    .sd-card-desc { margin: 0.25rem 0 0; font-size: 0.8rem; color: var(--muted); }
    .pass-gauge-svg { width: 100%; max-width: 340px; margin: 0 auto; display: block; }
    .pass-gauge-track { stroke: var(--gauge-track); }
    .pass-gauge-pct { font-size: 42px; font-weight: 800; fill: var(--text); letter-spacing: -0.04em; }
    .pass-gauge-sub { font-size: 13px; fill: var(--muted); }
    .sd-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.75rem;
    }
    .sd-metric {
      background: var(--surface);
      border: 1px solid rgba(229, 232, 242, 0.95);
      border-radius: 16px;
      padding: 0.85rem 1rem;
      box-shadow: var(--shadow-sm);
      position: relative;
      overflow: hidden;
    }
    .sd-metric::before {
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 4px;
      border-radius: 4px 0 0 4px;
    }
    .sd-metric--pages::before { background: linear-gradient(180deg, #6366f1, #8b5cf6); }
    .sd-metric--run::before { background: linear-gradient(180deg, #5c8dff, #6366f1); }
    .sd-metric--ok::before { background: linear-gradient(180deg, #34d399, #0d9488); }
    .sd-metric--fail::before { background: linear-gradient(180deg, #fb7185, #f97316); }
    .sd-metric-label { display: block; font-size: 0.72rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; }
    .sd-metric-value { font-size: 1.65rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
    .sd-metric--ok .sd-metric-value { color: var(--ok); }
    .sd-metric--fail .sd-metric-value { color: var(--bad); }
    .two-col-urls {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1rem 1.25rem;
    }
    @media (max-width: 720px) { .two-col-urls { grid-template-columns: 1fr; } }
    .two-col-urls h3 { margin: 0 0 0.45rem; font-size: 0.92rem; font-weight: 800; }
    .url-list { margin: 0; padding-left: 1.1rem; font-size: 0.84rem; word-break: break-all; }
    .url-list li { margin: 0.28rem 0; }
    .url-list .empty { list-style: none; margin-left: -1.1rem; color: var(--muted); }
    .step-ico-svg { width: 1.1rem; height: 1.1rem; vertical-align: -0.2rem; margin-right: 0.35rem; color: var(--muted); }
    .jump {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }
    .jump a {
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--muted);
      text-decoration: none;
      padding: 0.4rem 0.85rem;
      border-radius: 999px;
      background: var(--surface);
      border: 1px solid rgba(229, 232, 242, 0.95);
      box-shadow: var(--shadow-sm);
      transition: color 0.15s, border-color 0.15s, box-shadow 0.15s;
    }
    .jump a:hover {
      color: var(--accent-2);
      border-color: rgba(99, 102, 241, 0.35);
      box-shadow: 0 6px 18px rgba(99, 102, 241, 0.12);
    }
    .section {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 1.15rem 1.25rem;
      margin-bottom: 1rem;
      box-shadow: var(--shadow);
    }
    .section h2 {
      margin: 0 0 0.65rem;
      font-size: 1.05rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .section > p.lead { margin: 0 0 0.85rem; font-size: 0.9rem; color: var(--muted); }
    .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table.data { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    table.data th, table.data td { border-bottom: 1px solid var(--line); padding: 0.65rem 0.5rem; text-align: left; vertical-align: top; }
    table.data th { font-size: 0.72rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    table.data tr:last-child td { border-bottom: none; }
    .crit-ok { color: var(--ok); font-weight: 700; }
    .crit-bad { color: var(--bad); font-weight: 700; }
    .pill {
      display: inline-block;
      margin: 0.12rem 0.25rem 0 0;
      padding: 0.12rem 0.45rem;
      border-radius: 999px;
      background: #f4f6fb;
      font-size: 0.72rem;
      color: var(--muted);
    }
    .crit-bar-track {
      height: 10px;
      border-radius: 999px;
      background: var(--gauge-track);
      overflow: hidden;
      min-width: 72px;
      max-width: 140px;
    }
    .crit-bar-fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #34d399, #0d9488);
      box-shadow: inset 0 0 8px rgba(255,255,255,0.2);
    }
    .crit-bar-cell { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; }
    .crit-bar-pct { font-size: 0.78rem; font-weight: 800; color: var(--text); min-width: 2.5rem; }
    .crawl-one { font-size: 0.9rem; color: var(--muted); margin: 0 0 0.85rem; line-height: 1.5; }
    .stat-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .stat-chip {
      padding: 0.45rem 0.65rem;
      background: #f8f9fe;
      border: 1px solid var(--line);
      border-radius: 14px;
      font-size: 0.82rem;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .stat-chip strong { color: var(--text); font-weight: 700; }
    .stat-ico { font-size: 0.95rem; }
    .scenario-table td { font-size: 0.86rem; }
    .scenario-steps { margin: 0; padding-left: 1rem; }
    .scenario-steps li { margin: 0.18rem 0; }
    .status-chip { display: inline-block; padding: 0.15rem 0.45rem; border-radius: 999px; font-size: 0.74rem; font-weight: 700; }
    .status-chip.pass { color: var(--ok); background: var(--ok-bg); }
    .status-chip.fail { color: var(--bad); background: var(--bad-bg); }
    .artifacts { margin-top: 0.65rem; font-size: 0.85rem; }
    .artifacts a { color: var(--accent); font-weight: 600; text-decoration: none; }
    .artifacts a:hover { text-decoration: underline; }
    .err-list { margin: 0.5rem 0 0; padding-left: 1.1rem; font-size: 0.84rem; color: var(--bad); }
    .footer {
      margin-top: 2rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--line);
      font-size: 0.78rem;
      color: var(--muted);
      line-height: 1.6;
    }
    .footer strong { color: var(--text); }
    .time-foot { margin-top: 0.75rem; font-size: 0.75rem; color: #94a3b8; }
    @media print {
      .no-print { display: none !important; }
      body { background: #fff; }
      .wrap { max-width: none; padding: 0; }
      .section, .target-card, .summary-dashboard, .sd-gauge-card, .sd-metric { break-inside: avoid; box-shadow: none; }
    }
  </style>
</head>
<body>
<div class="wrap">
  <div class="top-bar">
    <div class="brand-wrap">
      <div class="brand-badge" aria-hidden="true"></div>
      <div>
        <h1 class="brand">테스트 결과</h1>
        <p class="sub">자동으로 실행한 점검 요약입니다. 아래에서 통과 여부와 각 항목 설명을 확인하세요.</p>
      </div>
    </div>
    <div class="actions-top no-print">
      <span class="job-pill"><span>작업 ID</span> ${esc(jobId)}</span>
      <button type="button" class="btn" onclick="window.print()">PDF로 저장 · 인쇄</button>
    </div>
  </div>

  <div class="target-card">
    <div class="lbl">분석한 사이트</div>
    <a href="${esc(targetUrl)}" target="_blank" rel="noopener noreferrer">${esc(targetUrl)}</a>
    <div class="meta-chips">
      <span>페이지 ${esc(pages)}개 수집</span>
      <span>시나리오 버전 ${esc(scenariosDoc.version ?? "—")}</span>
      <span>기록 모드: ${esc(traceMode === "failure" ? "실패 시만" : traceMode === "all" ? "전체" : "끔")}</span>
    </div>
  </div>

  ${summaryDashboardHtml}

  <nav class="jump no-print" aria-label="섹션 이동">
    <a href="#sites">내부·외부 URL</a>
    <a href="#lighthouse">Lighthouse</a>
    <a href="#criteria">점검 기준 요약</a>
    <a href="#scenarios">시나리오별 결과</a>
    <a href="#errors">오류 메시지</a>
    <a href="#crawl">수집 범위</a>
  </nav>

  ${siteListsHtml}

  ${lighthouseSectionHtml}

  <section class="section" id="criteria">
    <h2>점검 기준별 요약</h2>
    <p class="lead">각 항목이 몇 번 통과·실패했는지 보여 줍니다. 한 시나리오에 여러 기준이 붙을 수 있습니다.</p>
    <div class="scroll-x">
      <table class="data">
        <thead>
          <tr>
            <th>기준</th>
            <th>설명</th>
            <th>통과 비율</th>
            <th>통과</th>
            <th>실패</th>
            <th>관련 시나리오</th>
          </tr>
        </thead>
        <tbody>${criteriaRows}</tbody>
      </table>
    </div>
  </section>

  <section class="section" id="errors">
    <h2>브라우저 오류 (실패한 항목만)</h2>
    ${failedConsoleBlock}
  </section>

  <section class="section" id="scenarios">
    <h2>시나리오별 상세</h2>
    <p class="lead">이전 형태처럼 표로 각 시나리오의 상태, 소요 시간, 실행 단계를 확인할 수 있습니다.</p>
    <div class="scroll-x">
      <table class="data scenario-table">
        <thead><tr><th>상태</th><th>시나리오</th><th>소요</th><th>점검 기준</th><th>실행 단계</th></tr></thead>
        <tbody>${scenarioRows}</tbody>
      </table>
    </div>
  </section>

  ${crawlInsightHtml}

  <footer class="footer">
    <strong>저작권·이용 안내</strong><br/>
    본 리포트는 QA 자동화 도구로 생성되었습니다. 대상 웹사이트의 이용약관·저작권은 각 사이트 정책을 따릅니다.
    이 문서의 재배포·상업적 이용 시 관련 법령 및 사이트 정책을 확인하세요.
    <div class="time-foot">작업 ID ${esc(jobId)} · 테스트 완료 ${esc(runResults.finishedAt)} · 리포트 생성 ${esc(reportGeneratedAt)}</div>
  </footer>
</div>
</body>
</html>`;
}

/**
 * @param {any} structure
 */
function buildCrawlInsightSection(structure) {
  const list = structure?.pages || [];
  const ok = list.filter((p) => !p.error && p.httpStatus >= 200 && p.httpStatus < 400);
  let sumLinks = 0;
  let sumInteract = 0;
  let pagesWithClickable = 0;
  let sumSelectSingle = 0;
  let sumSelectMulti = 0;
  let sumRadioGroups = 0;
  let sumCheckbox = 0;
  let sumSwitch = 0;
  let sumAriaToggle = 0;
  let sumOutboundExt = 0;
  let sumOutboundMail = 0;
  let sumOutboundTel = 0;
  let sumBlankTargets = 0;
  for (const p of ok) {
    sumLinks += (p.links || []).length;
    const intr = p.interactables || [];
    sumInteract += intr.length;
    if (
      intr.some((x) =>
        ["button", "roleButton", "inputButton", "clickableDiv", "anchor", "roleLink"].includes(x.kind),
      )
    ) {
      pagesWithClickable++;
    }
    for (const fc of p.formControls || []) {
      if (fc.kind === "select") {
        if (fc.multiple) sumSelectMulti++;
        else sumSelectSingle++;
      } else if (fc.kind === "radioGroup") sumRadioGroups++;
      else if (fc.kind === "checkbox") sumCheckbox++;
      else if (fc.kind === "switch") sumSwitch++;
      else if (fc.kind === "ariaToggle") sumAriaToggle++;
    }
    const ob = p.outboundNav || [];
    for (const x of ob) {
      if (x.category === "external_http") sumOutboundExt++;
      else if (x.category === "mailto") sumOutboundMail++;
      else if (x.category === "tel") sumOutboundTel++;
    }
    const lcm = p.linkClickMeta;
    if (lcm && typeof lcm === "object") {
      for (const v of Object.values(lcm)) {
        if (v && typeof v === "object" && v.opensNewTab) sumBlankTargets++;
      }
    }
  }
  const errCount = list.length - ok.length;
  const sumFormControls =
    sumSelectSingle + sumSelectMulti + sumRadioGroups + sumCheckbox + sumSwitch + sumAriaToggle;

  /** @type {{ label: string; value: number }[]} */
  const chips = [
    { label: "정상 응답 페이지", value: ok.length },
    { label: "건너뛰거나 오류 페이지", value: errCount },
    { label: "같은 사이트 안 링크(합계)", value: sumLinks },
    { label: "클릭·버튼 후보(합계)", value: sumInteract },
    { label: "클릭 후보가 있는 페이지", value: pagesWithClickable },
  ];
  if (sumFormControls > 0) chips.push({ label: "입력·목록·토글 등 폼 요소", value: sumFormControls });
  if (sumSelectSingle > 0) chips.push({ label: "한 개만 고르는 목록", value: sumSelectSingle });
  if (sumSelectMulti > 0) chips.push({ label: "여러 개 고르는 목록", value: sumSelectMulti });
  if (sumRadioGroups > 0) chips.push({ label: "라디오 묶음", value: sumRadioGroups });
  if (sumCheckbox > 0) chips.push({ label: "체크박스", value: sumCheckbox });
  if (sumSwitch + sumAriaToggle > 0) chips.push({ label: "스위치·토글", value: sumSwitch + sumAriaToggle });
  if (sumBlankTargets > 0) chips.push({ label: "새 탭으로 열리는 링크", value: sumBlankTargets });
  if (sumOutboundExt > 0) chips.push({ label: "외부 사이트 링크(참고)", value: sumOutboundExt });
  if (sumOutboundMail > 0) chips.push({ label: "메일 링크", value: sumOutboundMail });
  if (sumOutboundTel > 0) chips.push({ label: "전화 링크", value: sumOutboundTel });

  const iconMap = /** @type {Record<string, string>} */ ({
    "정상 응답 페이지": "✅",
    "건너뛰거나 오류 페이지": "⚠️",
    "같은 사이트 안 링크(합계)": "🔗",
    "클릭·버튼 후보(합계)": "🖱️",
    "클릭 후보가 있는 페이지": "📄",
    "입력·목록·토글 등 폼 요소": "🧾",
    "한 개만 고르는 목록": "🔽",
    "여러 개 고르는 목록": "☑️",
    "라디오 묶음": "🎯",
    "체크박스": "✅",
    "스위치·토글": "🎛️",
    "새 탭으로 열리는 링크": "🪟",
    "외부 사이트 링크(참고)": "🌐",
    "메일 링크": "✉️",
    "전화 링크": "📞",
  });
  const chipHtml = chips
    .map((c) => `<div class="stat-chip"><span class="stat-ico">${iconMap[c.label] || "✨"}</span><strong>${esc(c.value)}</strong> ${esc(c.label)}</div>`)
    .join("");

  return `<section class="section" id="crawl">
    <h2>자동 수집 범위</h2>
    <p class="crawl-one">페이지를 돌며 링크·버튼·입력 요소를 찾아 자동 점검 초안을 만들 때 참고한 규모입니다. 팝업·일부 앱 화면은 포함되지 않을 수 있습니다.</p>
    <div class="stat-grid">${chipHtml}</div>
  </section>`;
}

/**
 * @param {Record<string, any> | undefined} summary
 */
function buildCriteriaTable(summary) {
  if (!summary || Object.keys(summary).length === 0) {
    return `<tr><td colspan="6" style="color:var(--muted)">표시할 요약이 없습니다.</td></tr>`;
  }

  const entries = Object.entries(summary).filter(([, row]) => (row.pass || 0) + (row.fail || 0) > 0);
  if (!entries.length) {
    return `<tr><td colspan="6" style="color:var(--muted)">이번 실행에 태깅된 기준이 없습니다.</td></tr>`;
  }

  return entries
    .map(([id, row]) => {
      const def = CRITERIA[/** @type {keyof typeof CRITERIA} */ (id)];
      const label = def?.labelKo ?? id;
      const desc = def?.description ?? "";
      const total = row.pass + row.fail;
      const rate = total ? Math.round((row.pass / total) * 100) : 0;
      const scenList = (row.scenarioIds || [])
        .map(
          /** @param {{ id: string; passed: boolean }} s */ (s) =>
            `<span class="${s.passed ? "crit-ok" : "crit-bad"}">${esc(s.id)}</span>`,
        )
        .join(" ");
      const bar = `<div class="crit-bar-cell"><div class="crit-bar-track" title="${esc(rate)}%"><span class="crit-bar-fill" style="width:${esc(rate)}%"></span></div><span class="crit-bar-pct">${esc(rate)}%</span></div>`;
      return `<tr>
        <td><strong>${esc(label)}</strong></td>
        <td style="color:var(--muted);font-size:0.88rem">${esc(desc)}</td>
        <td>${bar}</td>
        <td class="crit-ok">${esc(row.pass)}</td>
        <td class="crit-bad">${esc(row.fail)}</td>
        <td style="word-break:break-word;font-size:0.85rem">${scenList || "—"}</td>
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
    return `<p style="color:var(--muted);margin:0">실패한 시나리오에서 잡힌 브라우저 오류가 없거나, 모든 항목이 통과했습니다.</p>`;
  }

  return failed
    .map((s) => {
      const lines = (s.consoleErrors || []).slice(0, 12).map((e) => {
        const text =
          typeof e === "object" && e != null && "text" in e
            ? String(e.text)
            : typeof e === "string"
              ? e
              : JSON.stringify(e);
        return `<li>${esc(text.slice(0, 500))}</li>`;
      });
      return `<div style="margin-bottom:1rem">
        <strong>${esc(s.name)}</strong>
        <ul class="err-list">${lines.join("")}</ul>
      </div>`;
    })
    .join("");
}

/**
 * @param {any} s
 */
function buildScenarioTableRow(s) {
  const badgeText = s.passed ? "통과" : "실패";
  const badgeCls = s.passed ? "pass" : "fail";
  const crit = (s.criteria || []).map((c) => `<span class="pill">${esc(criterionLabelKo(c))}</span>`).join(" ");
  const sec = Math.round((s.durationMs || 0) / 100) / 10;
  const steps = (s.steps || [])
    .map((st) => {
      const label = STEP_LABEL_KO[st.type] || st.type;
      return `<li>${stepIconSvg(st.type)}<strong>${esc(label)}</strong>${formatStepDetailHuman(st)}</li>`;
    })
    .join("");
  return `<tr>
    <td><span class="status-chip ${badgeCls}">${esc(badgeText)}</span></td>
    <td><strong>${esc(s.name)}</strong></td>
    <td>${esc(sec)}초</td>
    <td>${crit || "—"}</td>
    <td><ol class="scenario-steps">${steps || "<li>스텝 없음</li>"}</ol></td>
  </tr>`;
}

function criterionLabelKo(id) {
  const def = CRITERIA[/** @type {keyof typeof CRITERIA} */ (id)];
  return def?.labelKo ?? id;
}

/**
 * @param {any} st
 */
function formatStepDetailHuman(st) {
  const parts = [];
  if (st.url) parts.push(`주소 ${esc(shortUrl(st.url))}`);
  if (st.finalUrl && st.finalUrl !== st.url) parts.push(`이동 후 ${esc(shortUrl(st.finalUrl))}`);
  if (st.status != null) parts.push(`응답 ${esc(st.status)}`);
  if (st.navigationMode && st.navigationMode !== "same_tab_or_spa") {
    const navKo =
      st.navigationMode === "new_tab_or_popup"
        ? "새 창/탭"
        : st.navigationMode === "full_navigation_same_tab"
          ? "같은 탭에서 다른 사이트로 이동"
          : st.navigationMode === "same_origin_navigation"
            ? "같은 사이트 안에서 이동"
            : st.navigationMode;
    parts.push(esc(navKo));
  }
  if (st.popupUrl) parts.push(`팝업 ${esc(shortUrl(st.popupUrl))}`);
  if (st.dialogs?.length) parts.push(`알림 창 ${st.dialogs.length}회`);
  if (st.selector) parts.push(`대상 요소`);
  if (st.href) parts.push(`링크 ${esc(shortUrl(st.href))}`);
  if (st.accessibleName) parts.push(`이름 「${esc(String(st.accessibleName).slice(0, 40))}」`);
  if (st.values) parts.push(`선택 값 ${esc(JSON.stringify(st.values))}`);
  if (st.value != null && String(st.value) !== "") parts.push(`값 ${esc(String(st.value).slice(0, 40))}`);
  if (st.label != null && String(st.label) !== "") parts.push(`항목 「${esc(String(st.label).slice(0, 40))}」`);
  if (st.error) parts.push(`<span class="step-detail">원인: ${esc(String(st.error).slice(0, 200))}</span>`);
  if (!parts.length) return "";
  return ` — <span class="step-detail">${parts.join(" · ")}</span>`;
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    return (x.hostname + x.pathname).slice(0, 56) + (u.length > 56 ? "…" : "");
  } catch {
    return String(u).slice(0, 56);
  }
}

/**
 * @param {any} structure
 * @param {any} lighthouseSummary
 */
function mergeSiteLists(structure, lighthouseSummary) {
  const internal =
    Array.isArray(lighthouseSummary?.internalUrls) && lighthouseSummary.internalUrls.length
      ? lighthouseSummary.internalUrls
      : internalOkPageUrls(structure);
  const external =
    Array.isArray(lighthouseSummary?.externalUrls) && lighthouseSummary.externalUrls.length
      ? lighthouseSummary.externalUrls
      : externalHttpUrlsSorted(structure);
  return { internal, external };
}

/**
 * @param {any} structure
 * @param {any} lighthouseSummary
 */
function buildSiteListsSection(structure, lighthouseSummary) {
  const { internal, external } = mergeSiteLists(structure, lighthouseSummary);
  const liIn = internal
    .map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`)
    .join("");
  const liEx = external
    .map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`)
    .join("");
  return `<section class="section" id="sites">
    <h2>내부·외부 URL</h2>
    <p class="lead">크롤로 <strong>실제로 방문·수집한 내부 페이지</strong>와, 페이지에서 찾은 <strong>외부 https 링크</strong>입니다.</p>
    <div class="two-col-urls">
      <div id="sites-internal">
        <h3>내부 (방문)</h3>
        <ul class="url-list">${liIn || '<li class="empty">내부 페이지가 없습니다.</li>'}</ul>
      </div>
      <div id="sites-external">
        <h3>외부 (링크 수집)</h3>
        <ul class="url-list">${liEx || '<li class="empty">수집된 외부 https 링크가 없습니다.</li>'}</ul>
      </div>
    </div>
  </section>`;
}

/** @param {number | null | undefined} v */
function scoreCell(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return esc(String(v));
}

/** @param {any} lighthouseSummary */
function buildLighthouseSection(lighthouseSummary) {
  const items = Array.isArray(lighthouseSummary?.items) ? lighthouseSummary.items : [];
  const skipped = lighthouseSummary?.skipped === true;
  const rows = items
    .map((row) => {
      const { url, kind, scores, reportHtml, error } = row;
      const link =
        typeof reportHtml === "string"
          ? `<a href="${esc(reportHtml)}" target="_blank" rel="noopener noreferrer">HTML 리포트</a>`
          : "—";
      const err = error ? ` <span class="crit-bad">${esc(String(error).slice(0, 160))}</span>` : "";
      const kindKo = kind === "external" ? "외부" : "내부";
      return `<tr>
        <td><span class="pill">${esc(kindKo)}</span></td>
        <td style="word-break:break-all"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>${err}</td>
        <td>${scoreCell(scores?.performance)}</td>
        <td>${scoreCell(scores?.accessibility)}</td>
        <td>${scoreCell(scores?.["best-practices"])}</td>
        <td>${scoreCell(scores?.seo)}</td>
        <td>${link}</td>
      </tr>`;
    })
    .join("");

  let note;
  if (skipped) {
    note = `<p class="lead">이번 작업에서는 Lighthouse를 실행하지 않았습니다(<code>SKIP_LIGHTHOUSE=1</code> 등). URL 목록은 위와 같습니다.</p>`;
  } else if (items.length === 0) {
    note = `<p class="lead">Lighthouse 감사 결과가 없습니다. 내부 정상 응답 페이지가 없거나, 실행 중 오류만 있었을 수 있습니다.</p>`;
  } else {
    note = `<p class="lead">점수는 0–100(또는 실패 시 —)입니다. HTML 리포트에서 세부 감사 항목을 확인할 수 있습니다.</p>`;
  }

  return `<section class="section" id="lighthouse">
    <h2>Lighthouse 요약</h2>
    ${note}
    <div class="scroll-x">
      <table class="data">
        <thead><tr><th>구분</th><th>URL</th><th>성능</th><th>접근성</th><th>권장</th><th>SEO</th><th>리포트</th></tr></thead>
        <tbody>${
          rows ||
          '<tr><td colspan="7" style="color:var(--muted)">표시할 Lighthouse 실행 결과가 없습니다.</td></tr>'
        }</tbody>
      </table>
    </div>
  </section>`;
}
