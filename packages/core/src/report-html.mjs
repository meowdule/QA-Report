import { CRITERIA } from "./schema.mjs";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
 * @param {number} pass
 * @param {number} fail
 */
function buildDonutHtml(pass, fail) {
  const p = Math.max(0, pass);
  const f = Math.max(0, fail);
  const t = p + f || 1;
  const pct = Math.round((p / t) * 100);
  const c = 2 * Math.PI * 18;
  const dash = (p / t) * c;
  return `<div class="donut-row" role="img" aria-label="통과 ${p}, 실패 ${f}">
    <svg class="donut-chart" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="18" fill="none" stroke="#e2e8f0" stroke-width="7"/>
      <circle cx="22" cy="22" r="18" fill="none" stroke="#0d9488" stroke-width="7" stroke-linecap="round"
        stroke-dasharray="${dash} ${c}" transform="rotate(-90 22 22)"/>
    </svg>
    <div><strong>${esc(String(pct))}%</strong> 통과 · <span style="color:var(--muted)">${esc(p)}/${esc(p + f)} 시나리오</span></div>
  </div>`;
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
  const scenarioCards = runResults.scenarios.map((s) => buildScenarioCard(s)).join("");
  const crawlInsightHtml = buildCrawlInsightSection(structure);
  const donutHtml = total > 0 ? buildDonutHtml(passed, total - passed) : "";

  const passPct = total ? Math.round((passed / total) * 100) : 0;
  const targetUrl = structure.targetUrl || "—";
  let targetHost = "—";
  try {
    targetHost = new URL(targetUrl).hostname;
  } catch {
    /* */
  }

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
      --bg: #f5f7fb;
      --surface: #ffffff;
      --text: #1e293b;
      --muted: #64748b;
      --line: #e2e8f0;
      --accent: #0d9488;
      --accent-hover: #0f766e;
      --ok: #059669;
      --ok-bg: #ecfdf5;
      --bad: #dc2626;
      --bad-bg: #fef2f2;
      --radius: 14px;
      --shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      line-height: 1.55;
      color: var(--text);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 920px; margin: 0 auto; padding: 1.5rem 1.25rem 2rem; }
    .top-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.25rem;
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
      border-radius: 10px;
      border: none;
      cursor: pointer;
      background: var(--accent);
      color: #fff;
    }
    .btn:hover { background: var(--accent-hover); }
    .target-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 1rem 1.15rem;
      margin-bottom: 1rem;
      box-shadow: var(--shadow);
    }
    .target-card .lbl { font-size: 0.75rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.35rem; }
    .target-card a { color: var(--accent); font-weight: 600; word-break: break-all; text-decoration: none; }
    .target-card a:hover { text-decoration: underline; }
    .meta-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem; font-size: 0.8rem; color: var(--muted); }
    .meta-chips span { padding: 0.2rem 0.5rem; background: #f1f5f9; border-radius: 6px; }
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .kpi {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
      box-shadow: var(--shadow);
    }
    .kpi .num { font-size: 1.65rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; }
    .kpi .num.ok { color: var(--ok); }
    .kpi .lbl { font-size: 0.8rem; color: var(--muted); margin-top: 0.25rem; font-weight: 500; }
    .donut-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.85rem 1rem;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      margin-bottom: 1.25rem;
      box-shadow: var(--shadow);
      font-size: 0.92rem;
    }
    .donut-chart { width: 3.75rem; height: 3.75rem; flex-shrink: 0; }
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
      padding: 0.35rem 0.65rem;
      border-radius: 8px;
      background: var(--surface);
      border: 1px solid var(--line);
    }
    .jump a:hover { color: var(--accent); border-color: var(--accent); }
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
      background: #f1f5f9;
      font-size: 0.72rem;
      color: var(--muted);
    }
    .crawl-one { font-size: 0.9rem; color: var(--muted); margin: 0 0 0.85rem; line-height: 1.5; }
    .stat-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .stat-chip {
      padding: 0.45rem 0.65rem;
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 10px;
      font-size: 0.82rem;
    }
    .stat-chip strong { color: var(--text); font-weight: 700; }
    .sc-card {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
      margin-bottom: 0.85rem;
      background: #fafbfc;
    }
    .sc-card:last-child { margin-bottom: 0; }
    .sc-card.pass { border-left: 4px solid var(--ok); }
    .sc-card.fail { border-left: 4px solid var(--bad); background: #fffafb; }
    .sc-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 0.75rem; margin-bottom: 0.5rem; }
    .sc-badge {
      font-size: 0.72rem;
      font-weight: 800;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .sc-badge.pass { background: var(--ok-bg); color: var(--ok); }
    .sc-badge.fail { background: var(--bad-bg); color: var(--bad); }
    .sc-title { margin: 0; font-size: 1rem; font-weight: 700; flex: 1 1 100%; }
    .sc-meta { font-size: 0.82rem; color: var(--muted); width: 100%; }
    .step-list { margin: 0.5rem 0 0; padding-left: 1.15rem; font-size: 0.88rem; }
    .step-list li { margin: 0.25rem 0; }
    .step-list li.ok { color: var(--ok); }
    .step-list li.bad { color: var(--bad); }
    .step-list li.skip { color: var(--muted); }
    .step-type { font-weight: 600; color: var(--text); }
    .step-detail { color: var(--muted); font-size: 0.86rem; }
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
      .section, .target-card, .kpi, .sc-card { break-inside: avoid; box-shadow: none; }
    }
  </style>
</head>
<body>
<div class="wrap">
  <div class="top-bar">
    <div>
      <h1 class="brand">테스트 결과</h1>
      <p class="sub">자동으로 실행한 점검 요약입니다. 아래에서 통과 여부와 각 항목 설명을 확인하세요.</p>
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

  ${donutHtml}

  <div class="kpi-row" id="summary">
    <div class="kpi"><div class="num ok">${esc(passPct)}%</div><div class="lbl">전체 통과율</div></div>
    <div class="kpi"><div class="num">${esc(passed)} / ${esc(total)}</div><div class="lbl">통과한 시나리오</div></div>
    <div class="kpi"><div class="num">${esc(pages)}</div><div class="lbl">크롤 페이지</div></div>
    <div class="kpi"><div class="num">${esc(total)}</div><div class="lbl">실행한 시나리오 수</div></div>
  </div>

  <nav class="jump no-print" aria-label="섹션 이동">
    <a href="#criteria">점검 기준 요약</a>
    <a href="#scenarios">시나리오별 결과</a>
    <a href="#errors">오류 메시지</a>
    <a href="#crawl">수집 범위</a>
  </nav>

  <section class="section" id="criteria">
    <h2>점검 기준별 요약</h2>
    <p class="lead">각 항목이 몇 번 통과·실패했는지 보여 줍니다. 한 시나리오에 여러 기준이 붙을 수 있습니다.</p>
    <div class="scroll-x">
      <table class="data">
        <thead>
          <tr>
            <th>기준</th>
            <th>설명</th>
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
    <p class="lead">각 줄은 하나의 테스트 묶음입니다. ✓는 성공, 실패 시 빨간 줄과 원인 힌트가 표시됩니다.</p>
    ${scenarioCards}
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

  const chipHtml = chips
    .map((c) => `<div class="stat-chip"><strong>${esc(c.value)}</strong> ${esc(c.label)}</div>`)
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
    return `<tr><td colspan="5" style="color:var(--muted)">표시할 요약이 없습니다.</td></tr>`;
  }

  const entries = Object.entries(summary).filter(([, row]) => (row.pass || 0) + (row.fail || 0) > 0);
  if (!entries.length) {
    return `<tr><td colspan="5" style="color:var(--muted)">이번 실행에 태깅된 기준이 없습니다.</td></tr>`;
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
      return `<tr>
        <td><strong>${esc(label)}</strong></td>
        <td style="color:var(--muted);font-size:0.88rem">${esc(desc)}</td>
        <td class="crit-ok">${esc(row.pass)} <span style="color:var(--muted);font-weight:500">(${esc(rate)}%)</span></td>
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
function buildScenarioCard(s) {
  const badge = s.passed ? "pass" : "fail";
  const badgeText = s.passed ? "통과" : "실패";
  const crit = (s.criteria || []).map((c) => `<span class="pill">${esc(criterionLabelKo(c))}</span>`).join(" ");

  const arts = [];
  if (s.artifacts?.trace) {
    arts.push(`<a href="./${esc(s.artifacts.trace)}">실행 기록(trace) 열기</a>`);
  }
  if (s.artifacts?.screenshot) {
    arts.push(`<a href="./${esc(s.artifacts.screenshot)}">실패 화면 캡처</a>`);
  }
  const artBlock =
    arts.length > 0 ? `<div class="artifacts">${arts.join(" · ")}</div>` : "";

  const sec = Math.round((s.durationMs || 0) / 100) / 10;

  const errBlock =
    s.passed === false && s.consoleErrors?.length
      ? `<ul class="err-list">${(s.consoleErrors || [])
          .slice(0, 6)
          .map((e) => {
            const t =
              typeof e === "object" && e != null && "text" in e
                ? String(e.text)
                : JSON.stringify(e);
            return `<li>${esc(t.slice(0, 280))}</li>`;
          })
          .join("")}</ul>`
      : "";

  const steps = (s.steps || [])
    .map((st) => {
      const cls = st.skipped ? "skip" : st.ok ? "ok" : "bad";
      const label = STEP_LABEL_KO[st.type] || st.type;
      const detail = formatStepDetailHuman(st);
      const note = st.note ? ` <span class="step-detail">(${esc(st.note)})</span>` : "";
      const ico = stepIconSvg(st.type);
      return `<li class="${cls}">${ico}<span class="step-type">${esc(label)}</span>${note}${detail}</li>`;
    })
    .join("");

  return `<article class="sc-card ${badge}">
    <div class="sc-head">
      <span class="sc-badge ${badge}">${esc(badgeText)}</span>
      <h3 class="sc-title">${esc(s.name)}</h3>
      <div class="sc-meta">약 ${esc(sec)}초 소요 · ${crit || "기준 태그 없음"}</div>
    </div>
    <ol class="step-list">${steps || "<li class=\"skip\">스텝 없음</li>"}</ol>
    ${artBlock}
    ${errBlock}
  </article>`;
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
