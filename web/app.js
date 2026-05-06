import { iconChartBarHtml } from "./ui-icons.mjs";

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

/** @type {Record<string, { label: string; desc: string }>} */
const CRITERIA_DEF = {
  page_rendering: { label: "페이지 렌더링", desc: "화면이 열리고 내용이 보이는지" },
  core_action: { label: "핵심 동작", desc: "클릭·이동이 잘 되는지" },
  input_data: { label: "입력·선택", desc: "글 입력·목록 선택이 되는지" },
  console_errors: { label: "화면 오류", desc: "빨간 오류 메시지가 없는지" },
  primary_flow: { label: "주요 흐름", desc: "중요한 페이지 순서가 지켜지는지" },
};

const CRITERION_ORDER = Object.keys(CRITERIA_DEF);

/** @type {Record<string, string>} */
const STEP_LABEL_KO = {
  navigate: "페이지로 이동",
  click: "클릭·누르기",
  fill: "글자 입력",
  selectOption: "목록에서 고르기",
  check: "체크·라디오 선택",
  assertVisible: "화면에 보이는지 확인",
  assertNoConsoleError: "오류 없음 확인",
  waitForResponse: "서버 응답 기다리기",
  waitForSelector: "특정 영역이 나올 때까지 기다리기",
};

const STEP_TYPES_ADD = [
  "navigate",
  "click",
  "fill",
  "selectOption",
  "check",
  "assertVisible",
  "assertNoConsoleError",
  "waitForResponse",
  "waitForSelector",
];

const RESULT_STEP_KEYS = new Set([
  "ok",
  "error",
  "status",
  "finalUrl",
  "note",
  "skipped",
  "consoleErrorCount",
  "pageErrorCount",
  "startUrl",
  "dialogs",
  "popupUrl",
  "navigationMode",
  "popupClosed",
  "durationMs",
]);

/**
 * @param {string} id
 */
function criterionLabel(id) {
  return CRITERIA_DEF[id]?.label ?? id;
}

/**
 * @param {any} st
 */
function stepForEditor(st) {
  /** @type {Record<string, any>} */
  const out = { type: st?.type || "navigate" };
  for (const [k, v] of Object.entries(st || {})) {
    if (k === "type" || v === undefined) continue;
    if (RESULT_STEP_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * @param {string} type
 */
function defaultStep(type) {
  switch (type) {
    case "navigate":
      return { type: "navigate", url: "" };
    case "click":
      return { type: "click", selector: "" };
    case "fill":
      return { type: "fill", selector: "", value: "" };
    case "selectOption":
      return { type: "selectOption", selector: "", label: "" };
    case "check":
      return { type: "check", selector: "", checked: true };
    case "assertVisible":
      return { type: "assertVisible", selector: "body" };
    case "assertNoConsoleError":
      return { type: "assertNoConsoleError" };
    case "waitForResponse":
      return { type: "waitForResponse", urlPattern: "", optional: true, timeout: 8000 };
    case "waitForSelector":
      return { type: "waitForSelector", selector: "", optional: true, timeout: 15000 };
    default:
      return { type: "assertVisible", selector: "body" };
  }
}

const PASS_GAUGE_ARC = 377;

/**
 * @param {number} passPct
 * @param {number} passed
 * @param {number} total
 */
function passGaugeSvg(passPct, passed, total) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(passPct) || 0)));
  const dash = Math.round((pct / 100) * PASS_GAUGE_ARC);
  const sub = total ? "시나리오 기준 통과율" : "실행 결과 없음";
  return `<svg class="pass-gauge-svg" viewBox="0 0 320 168" role="img" aria-label="통과율 ${esc(pct)}퍼센트">
    <defs>
      <linearGradient id="spaPassGaugeGrad" x1="0%" y1="50%" x2="100%" y2="50%">
        <stop offset="0%" stop-color="#5eead4"/>
        <stop offset="100%" stop-color="#0f766e"/>
      </linearGradient>
    </defs>
    <path class="pass-gauge-track" d="M40 124 A120 120 0 0 1 280 124" fill="none" stroke-width="18" stroke-linecap="round"/>
    <path class="pass-gauge-fill" d="M40 124 A120 120 0 0 1 280 124" fill="none" stroke="url(#spaPassGaugeGrad)" stroke-width="18" stroke-linecap="round" stroke-dasharray="${dash} ${PASS_GAUGE_ARC}"/>
    <text x="160" y="88" text-anchor="middle" class="pass-gauge-pct">${esc(pct)}%</text>
    <text x="160" y="112" text-anchor="middle" class="pass-gauge-sub">${esc(sub)}</text>
  </svg>`;
}

/**
 * @param {number} pages
 * @param {number} tot
 * @param {number} pass
 * @param {number} failN
 */
function statHashtagsSpa(pages, tot, pass, failN) {
  return `<div class="sd-hash-tags" aria-label="요약 지표">
    <span class="hash-tag">#크롤 ${esc(pages)}페이지</span>
    <span class="hash-tag">#실행시나리오 ${esc(tot)}</span>
    <span class="hash-tag hash-tag--ok">#통과 ${esc(pass)}</span>
    <span class="hash-tag hash-tag--fail">#실패 ${esc(failN)}</span>
  </div>`;
}

/** @param {number | null | undefined} score */
function lhStrokeColorSpa(score) {
  if (score == null || Number.isNaN(Number(score))) return "#64748b";
  const n = Number(score);
  if (n >= 90) return "#34d399";
  if (n >= 50) return "#fbbf24";
  return "#fb923c";
}

/** @param {number | null | undefined} score */
function lhBadgeLabelSpa(score) {
  if (score == null || Number.isNaN(Number(score))) return "측정 없음";
  return Number(score) >= 90 ? "강점 유지" : "개선 여지";
}

/**
 * @param {number | null} score
 * @param {string} stroke
 */
function lhDonutSvgSpa(score, stroke) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const s = score == null || Number.isNaN(Number(score)) ? null : Math.max(0, Math.min(100, Math.round(Number(score))));
  const dash = s == null ? 0 : Math.round((s / 100) * c);
  return `<svg class="lh-donut" viewBox="0 0 88 88" aria-hidden="true">
    <circle class="lh-donut-track" cx="44" cy="44" r="${r}" fill="none" stroke-width="8"/>
    <circle cx="44" cy="44" r="${r}" fill="none" stroke="${esc(stroke)}" stroke-width="8" stroke-linecap="round"
      transform="rotate(-90 44 44)" stroke-dasharray="${dash} ${c}"/>
    <text x="44" y="50" text-anchor="middle" class="lh-donut-num">${s == null ? "—" : esc(String(s))}</text>
  </svg>`;
}

const LH_BOARD_CATS_SPA = [
  { key: "performance", title: "성능", desc: "초기 로드와 상호작용 반응 속도입니다." },
  { key: "accessibility", title: "접근성", desc: "스크린 리더·대비 등 접근 가능성입니다." },
  { key: "best-practices", title: "권장", desc: "보안·모던 웹 관행 준수 여부입니다." },
  { key: "seo", title: "SEO", desc: "검색·메타 정보 등 노출 관련 항목입니다." },
];

/**
 * @param {any} summary
 */
function lighthouseBoardHtmlSpa(summary) {
  const items = summary?.items || [];
  const skipped = summary?.skipped === true;
  if (skipped) {
    return `<div class="lh-board" role="region" aria-label="Lighthouse 스코어 보드">
      <div class="lh-board-head">
        <h3 class="lh-board-title">Lighthouse 스코어 보드</h3>
      </div>
      <p class="lh-board-empty">이번 작업에서는 Lighthouse를 실행하지 않았습니다.</p>
    </div>`;
  }
  if (!items.length) {
    return `<div class="lh-board" role="region" aria-label="Lighthouse 스코어 보드">
      <div class="lh-board-head">
        <h3 class="lh-board-title">Lighthouse 스코어 보드</h3>
      </div>
      <p class="lh-board-empty">감사 결과가 없습니다.</p>
    </div>`;
  }
  const keys = /** @type {const} */ (["performance", "accessibility", "best-practices", "seo"]);
  /** @type {Record<string, number[]>} */
  const acc = { performance: [], accessibility: [], "best-practices": [], seo: [] };
  for (const row of items) {
    const s = row.scores;
    if (!s) continue;
    for (const k of keys) {
      const v = s[k];
      if (typeof v === "number" && !Number.isNaN(v)) acc[k].push(v);
    }
  }
  /** @type {Record<string, number | null>} */
  const avgs = {};
  for (const k of keys) {
    const a = acc[k];
    avgs[k] = a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  }
  const cards = LH_BOARD_CATS_SPA.map((cat) => {
    const score = avgs[cat.key];
    const stroke = lhStrokeColorSpa(score);
    const donut = lhDonutSvgSpa(score, stroke);
    return `<div class="lh-mini-card">
      <div class="lh-mini-head">
        <span class="lh-mini-title">${esc(cat.title)}</span>
        <span class="lh-badge">${esc(lhBadgeLabelSpa(score))}</span>
      </div>
      <div class="lh-mini-body">
        <div class="lh-donut-wrap">${donut}</div>
        <p class="lh-mini-desc">${esc(cat.desc)}</p>
      </div>
    </div>`;
  }).join("");
  return `<div class="lh-board" role="region" aria-label="Lighthouse 스코어 보드">
    <div class="lh-board-head">
      <h3 class="lh-board-title">Lighthouse 스코어 보드</h3>
      <span class="lh-board-scale">0–100 스코어</span>
    </div>
    <p class="lh-board-sub">감사 페이지 ${esc(items.length)}개 기준 평균 점수</p>
    <div class="lh-board-grid">${cards}</div>
  </div>`;
}

/**
 * @param {HTMLElement} row
 * @param {number} delta
 */
function moveStepRow(row, delta) {
  const parent = row.parentElement;
  if (!parent) return;
  const kids = [...parent.children];
  const idx = kids.indexOf(row);
  const j = idx + delta;
  if (j < 0 || j >= kids.length) return;
  const ref = kids[j];
  if (delta < 0) parent.insertBefore(row, ref);
  else parent.insertBefore(row, ref.nextSibling);
}

/**
 * @param {HTMLElement} wrap
 * @param {Record<string, any>} s
 */
function fillStepFields(wrap, s) {
  wrap.replaceChildren();
  const t = s.type;
  /** @param {string} lbl @param {string} name @param {string} val @param {string} [typ] */
  const inp = (lbl, name, val, typ = "text") => {
    const lab = document.createElement("label");
    lab.className = "field field--compact";
    const span = document.createElement("span");
    span.textContent = lbl;
    const i = document.createElement("input");
    i.name = name;
    i.type = typ;
    i.value = val ?? "";
    lab.appendChild(span);
    lab.appendChild(i);
    wrap.appendChild(lab);
  };

  switch (t) {
    case "navigate":
      inp("URL", "step-url", s.url || "", "url");
      break;
    case "click":
      inp("href", "step-href", s.href || "", "url");
      inp("선택자", "step-selector", s.selector || "");
      inp("대체 선택자", "step-fallback", s.fallbackSelector || "");
      inp("역할", "step-gr-role", s.getByRole || "");
      inp("이름", "step-gr-name", s.accessibleName || "");
      break;
    case "fill":
      inp("선택자", "step-selector", s.selector || "");
      inp("값", "step-value", s.value != null ? String(s.value) : "");
      break;
    case "selectOption":
      inp("선택자", "step-selector", s.selector || "");
      inp("라벨", "step-sel-label", s.label || "");
      inp("값", "step-sel-value", s.value != null ? String(s.value) : "");
      inp("인덱스", "step-sel-index", s.index != null ? String(s.index) : "");
      break;
    case "check":
      inp("선택자", "step-selector", s.selector || "");
      {
        const lab = document.createElement("label");
        lab.className = "check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "step-checked";
        cb.checked = s.checked !== false;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(" 체크된 상태로 둘 것"));
        wrap.appendChild(lab);
      }
      break;
    case "assertVisible":
      inp("선택자", "step-selector", s.selector || "");
      break;
    case "assertNoConsoleError":
      break;
    case "waitForResponse":
      inp("URL 패턴", "step-urlpattern", s.urlPattern || "");
      {
        const lab = document.createElement("label");
        lab.className = "check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "step-optional";
        cb.checked = !!s.optional;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(" 생략 가능"));
        wrap.appendChild(lab);
      }
      inp("타임아웃(ms)", "step-timeout", s.timeout != null ? String(s.timeout) : "8000", "number");
      break;
    case "waitForSelector":
      inp("선택자", "step-selector", s.selector || "");
      {
        const lab = document.createElement("label");
        lab.className = "check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "step-optional";
        cb.checked = !!s.optional;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(" 생략 가능"));
        wrap.appendChild(lab);
      }
      inp("타임아웃(ms)", "step-timeout", s.timeout != null ? String(s.timeout) : "15000", "number");
      break;
    default:
      inp("값", "step-raw", JSON.stringify(s), "text");
  }
}

/**
 * @param {HTMLElement} row
 */
function readStepFromRow(row) {
  const type = row.dataset.stepType || "navigate";
  /** @type {any} */
  const out = { type };
  const q = (n) => row.querySelector(`[name="${n}"]`);

  switch (type) {
    case "navigate": {
      const v = q("step-url")?.value?.trim();
      if (v) out.url = v;
      break;
    }
    case "click": {
      const href = q("step-href")?.value?.trim();
      const sel = q("step-selector")?.value?.trim();
      const fb = q("step-fallback")?.value?.trim();
      const gr = q("step-gr-role")?.value?.trim();
      const gname = q("step-gr-name")?.value?.trim();
      if (href) out.href = href;
      if (sel) out.selector = sel;
      if (fb) out.fallbackSelector = fb;
      if (gr) out.getByRole = gr;
      if (gname) out.accessibleName = gname;
      break;
    }
    case "fill": {
      const sel = q("step-selector")?.value?.trim();
      const val = q("step-value")?.value ?? "";
      if (sel) out.selector = sel;
      out.value = val;
      break;
    }
    case "selectOption": {
      const sel = q("step-selector")?.value?.trim();
      const lab = q("step-sel-label")?.value?.trim();
      const val = q("step-sel-value")?.value?.trim();
      const idxRaw = q("step-sel-index")?.value?.trim();
      if (sel) out.selector = sel;
      if (lab) out.label = lab;
      else if (val) out.value = val;
      else if (idxRaw !== undefined && idxRaw !== "") out.index = Number(idxRaw);
      break;
    }
    case "check": {
      const sel = q("step-selector")?.value?.trim();
      if (sel) out.selector = sel;
      const cb = q("step-checked");
      if (cb instanceof HTMLInputElement) out.checked = cb.checked;
      break;
    }
    case "assertVisible": {
      const sel = q("step-selector")?.value?.trim();
      if (sel) out.selector = sel;
      break;
    }
    case "assertNoConsoleError":
      break;
    case "waitForResponse": {
      const up = q("step-urlpattern")?.value?.trim();
      if (up) out.urlPattern = up;
      const opt = q("step-optional");
      if (opt instanceof HTMLInputElement) out.optional = opt.checked;
      const to = q("step-timeout")?.value;
      if (to !== "" && to != null) out.timeout = Number(to);
      break;
    }
    case "waitForSelector": {
      const sel = q("step-selector")?.value?.trim();
      if (sel) out.selector = sel;
      const opt = q("step-optional");
      if (opt instanceof HTMLInputElement) out.optional = opt.checked;
      const to = q("step-timeout")?.value;
      if (to !== "" && to != null) out.timeout = Number(to);
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * @param {any} st
 */
function buildStepEditorRow(st) {
  const clean = stepForEditor(st);
  const type = clean.type;
  const row = document.createElement("div");
  row.className = "step-block";
  row.dataset.stepType = type;

  const head = document.createElement("div");
  head.className = "step-block-head";
  const ttl = document.createElement("span");
  ttl.className = "step-block-title";
  ttl.textContent = STEP_LABEL_KO[type] || type;
  head.appendChild(ttl);

  const tools = document.createElement("div");
  tools.className = "step-block-tools";
  const mkBtn = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-tiny ghost";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  tools.appendChild(
    mkBtn("↑", () => {
      moveStepRow(row, -1);
    }),
  );
  tools.appendChild(
    mkBtn("↓", () => {
      moveStepRow(row, 1);
    }),
  );
  tools.appendChild(
    mkBtn("삭제", () => {
      row.remove();
    }),
  );

  const fields = document.createElement("div");
  fields.className = "step-block-fields";
  fillStepFields(fields, clean);

  const toolbar = document.createElement("div");
  toolbar.className = "step-block-toolbar";
  toolbar.appendChild(head);
  toolbar.appendChild(tools);
  row.appendChild(toolbar);
  row.appendChild(fields);
  return row;
}

/**
 * @param {HTMLElement} stepsHost
 */
function buildAddStepBar(stepsHost) {
  const bar = document.createElement("div");
  bar.className = "step-add-bar";
  const sel = document.createElement("select");
  sel.className = "step-add-select";
  const z = document.createElement("option");
  z.value = "";
  z.textContent = "+ 단계 추가…";
  sel.appendChild(z);
  for (const typ of STEP_TYPES_ADD) {
    const o = document.createElement("option");
    o.value = typ;
    o.textContent = STEP_LABEL_KO[typ] || typ;
    sel.appendChild(o);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn ghost btn-small";
  btn.textContent = "추가";
  btn.addEventListener("click", () => {
    const typ = sel.value;
    if (!typ) return;
    stepsHost.appendChild(buildStepEditorRow(defaultStep(typ)));
    sel.value = "";
  });
  bar.appendChild(sel);
  bar.appendChild(btn);
  return bar;
}

/**
 * @param {any} doc
 * @returns {string} 오류 문구 또는 빈 문자열
 */
function validateScenariosDoc(doc) {
  if (!doc?.scenarios?.length) return "편집할 시나리오가 없습니다.";
  for (let i = 0; i < doc.scenarios.length; i++) {
    const sc = doc.scenarios[i];
    const lab = `「시나리오 ${i + 1}」`;
    if (!String(sc.name || "").trim()) return `${lab} 이름을 적어 주세요.`;
    if (!sc.criteria?.length) return `${lab}에서 점검 기준을 한 가지 이상 골라 주세요.`;
    if (!sc.steps?.length) return `${lab}에 실행 단계가 없습니다. 단계를 추가하세요.`;
    for (let j = 0; j < sc.steps.length; j++) {
      const st = sc.steps[j];
      const p = `${lab} ${j + 1}번째 단계`;
      if (!st?.type) return `${p}의 종류가 없습니다.`;
      if (st.type === "navigate" && !String(st.url || "").trim()) return `${p}: 이동할 주소를 적어 주세요.`;
      if (st.type === "assertVisible" && !String(st.selector || "").trim())
        return `${p}: 확인할 영역(선택자)을 적어 주세요.`;
      if (st.type === "fill" && !String(st.selector || "").trim()) return `${p}: 입력 칸(선택자)을 적어 주세요.`;
      if (st.type === "selectOption" && !String(st.selector || "").trim())
        return `${p}: 목록(선택자)을 적어 주세요.`;
      if (st.type === "check" && !String(st.selector || "").trim()) return `${p}: 체크 칸(선택자)을 적어 주세요.`;
      if (st.type === "waitForSelector" && !String(st.selector || "").trim())
        return `${p}: 기다릴 영역(선택자)을 적어 주세요.`;
      if (st.type === "click") {
        const ok = !!(String(st.href || "").trim() || String(st.selector || "").trim() || String(st.getByRole || "").trim());
        if (!ok) return `${p}: 클릭할 링크 주소, 또는 선택자, 또는 역할 중 하나는 적어 주세요.`;
      }
    }
  }
  return "";
}

const qs = new URLSearchParams(window.location.search);
const initialJob = (qs.get("job") || qs.get("jobId") || "").trim();

if (window.location.protocol === "file:") {
  document.getElementById("file-protocol-banner")?.classList.remove("hidden");
}

/** @type {{ jobId: string; jobStoragePath: string; structure: any; scenariosDoc: any; results: any | null; dispatchMeta: any | null; lighthouseSummary: any | null }} */
const state = {
  jobId: "",
  jobStoragePath: "",
  structure: null,
  scenariosDoc: null,
  results: null,
  dispatchMeta: null,
  lighthouseSummary: null,
};

const el = {
  dashboardNav: document.getElementById("dashboard-nav"),
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
  editSection: document.getElementById("edit-section"),
  scenarioFormRows: document.getElementById("scenario-form-rows"),
  editHint: document.getElementById("edit-hint"),
  btnPostRerun: document.getElementById("btn-post-rerun"),
  dispatchHint: document.getElementById("dispatch-hint"),
  resultsSection: document.getElementById("results-section"),
  resultsBody: document.getElementById("results-body"),
  dashNavReport: document.getElementById("dash-nav-report"),
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
  const t = String(text ?? "").trim();
  el.analyzeStatus.textContent = t;
  el.analyzeStatus.dataset.kind = t ? kind : "";
  el.analyzeStatus.classList.toggle("analyze-status--hidden", !t);
  el.analyzeStatus.toggleAttribute("aria-hidden", !t);
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

/** 시나리오 「테스트 수행」 대기 중: 폼·편집 비활성화(중지 버튼 제외). */
/** @param {boolean} on */
function setRerunWaiting(on) {
  for (const form of [el.analyzeForm, el.form]) {
    if (!form) continue;
    for (const node of form.querySelectorAll("input, select, textarea, button")) {
      if (el.btnStop && node === el.btnStop) continue;
      if (
        node instanceof HTMLInputElement ||
        node instanceof HTMLSelectElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLButtonElement
      ) {
        node.disabled = on;
      }
    }
  }
  if (el.editSection) {
    for (const node of el.editSection.querySelectorAll("input, select, textarea, button")) {
      if (
        node instanceof HTMLInputElement ||
        node instanceof HTMLSelectElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLButtonElement
      ) {
        node.disabled = on;
      }
    }
  }
  if (el.btnPostRerun) el.btnPostRerun.disabled = on;
  el.dashboardNav?.classList.toggle("is-rerun-waiting", on);
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

/**
 * @param {any} structure
 * @param {any} scenarios
 * @param {any} results
 * @param {any} [lighthouseSummary]
 */
function renderSummary(structure, scenarios, results, lighthouseSummary) {
  const pages = structure?.pages?.length ?? 0;
  const target = structure?.targetUrl ?? "";
  const jobId = state.jobId || "—";

  let pass = 0;
  let tot = 0;
  /** @type {number | null} */
  let pct = null;
  let resultsHint = "테스트가 아직 끝나지 않았거나 결과가 없습니다.";
  if (results?.scenarios?.length) {
    tot = results.scenarios.length;
    pass = results.scenarios.filter((s) => s.passed).length;
    pct = Math.round((pass / tot) * 100);
    resultsHint = `${pass}개 통과 · 전체 ${tot}개`;
  }

  const targetBlock =
    target && target !== "—"
      ? `<a href="${esc(target)}" target="_blank" rel="noopener noreferrer" class="summary-link">${esc(
          target,
        )}</a>`
      : `<span class="muted">—</span>`;

  const failN = tot > 0 ? tot - pass : 0;
  const pctNum = pct != null ? pct : 0;
  const gaugeBlock =
    tot > 0
      ? passGaugeSvg(pctNum, pass, tot)
      : `<div class="sd-gauge-empty"><p class="hint">${esc(resultsHint)}</p></div>`;
  const hashTags = statHashtagsSpa(pages, tot, pass, failN);
  const lhBoard = lighthouseBoardHtmlSpa(lighthouseSummary);

  el.summaryBody.innerHTML = `
    <div class="summary-stack">
      <div class="summary-dashboard" role="group" aria-label="작업 요약">
        <div class="sd-target-card">
          <div class="sd-target-left">
            <span class="kpi-label">분석한 주소</span>
            <div class="summary-target-url">${targetBlock}</div>
          </div>
          <div class="sd-target-right">
            <span class="kpi-label">작업 ID</span>
            <div class="sd-job-inline kpi-value kpi-value--mono">${esc(jobId)}</div>
          </div>
        </div>
        <div class="sd-gauge-card">
          <div class="sd-card-head">
            <h3 class="sd-card-title">테스트 통과</h3>
            <p class="sd-card-desc">시나리오 실행 결과</p>
          </div>
          ${gaugeBlock}
          ${hashTags}
        </div>
        <div class="sd-lh-col">${lhBoard}</div>
      </div>
      ${tot > 0 ? `<p class="summary-mini-hint muted">${esc(resultsHint)}</p>` : ""}
    </div>
  `;
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
      .map(([id, row]) => {
        const label = row.labelKo || criterionLabel(id);
        const rowTot = (row.pass || 0) + (row.fail || 0);
        const rate = rowTot ? Math.round(((row.pass || 0) / rowTot) * 100) : 0;
        const bar = `<div class="crit-bar-cell"><div class="crit-bar-track" title="${esc(rate)}%"><span class="crit-bar-fill" style="width:${esc(rate)}%"></span></div><span class="crit-bar-pct">${esc(rate)}%</span></div>`;
        return `<tr>
          <td class="cell-criterion">
            <span class="crit-label">${esc(label)}</span>
            <span class="crit-mini">${esc(CRITERIA_DEF[id]?.desc || "")}</span>
          </td>
          <td class="cell-bar">${bar}</td>
          <td class="cell-num cell-num--ok">${esc(row.pass)}</td>
          <td class="cell-num cell-num--bad">${esc(row.fail)}</td>
        </tr>`;
      })
      .join("");
    table = `<h3 class="subh subh--ico">${iconChartBarHtml()} 기준별 요약</h3>
      <div class="table-scroll"><table class="data data--criteria"><thead><tr><th>점검 항목</th><th>통과 비율</th><th>통과</th><th>실패</th></tr></thead><tbody>${
        rows || "<tr><td colspan=4>집계할 항목이 없습니다.</td></tr>"
      }</tbody></table></div>`;
  }

  el.resultsBody.innerHTML = `
    ${table || '<p class="hint">표시할 기준 요약이 없습니다.</p>'}
  `;
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
    det.className = "scenario-editor";
    det.open = false;

    const sum = document.createElement("summary");
    sum.className = "scenario-editor-summary";
    const titleWrap = document.createElement("div");
    titleWrap.className = "scenario-summary-text";
    const idx = document.createElement("span");
    idx.className = "scenario-idx";
    idx.textContent = String(i + 1);
    const nameEl = document.createElement("span");
    nameEl.className = "scenario-summary-name";
    nameEl.textContent = (s.name || "").trim() || "(이름 없음)";
    titleWrap.appendChild(idx);
    titleWrap.appendChild(nameEl);
    const badge = document.createElement("span");
    badge.className = "scenario-step-badge";
    badge.textContent = `${(s.steps || []).length}단계`;
    sum.appendChild(titleWrap);
    sum.appendChild(badge);

    const body = document.createElement("div");
    body.className = "scenario-editor-body";

    const nameL = document.createElement("label");
    nameL.className = "field";
    nameL.innerHTML = "<span>이름</span>";
    const nameI = document.createElement("input");
    nameI.type = "text";
    nameI.className = "sc-name";
    nameI.value = s.name || "";
    nameL.appendChild(nameI);
    body.appendChild(nameL);

    const critWrap = document.createElement("div");
    critWrap.className = "field criteria-field";
    const critLbl = document.createElement("span");
    critLbl.textContent = "기준";
    critWrap.appendChild(critLbl);
    const grid = document.createElement("div");
    grid.className = "criteria-strip";
    for (const id of CRITERION_ORDER) {
      const def = CRITERIA_DEF[id];
      if (!def) continue;
      const labEl = document.createElement("label");
      labEl.className = "crit-chip";
      labEl.title = def.desc;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "sc-crit-cb";
      cb.value = id;
      cb.checked = (s.criteria || []).includes(id);
      const span = document.createElement("span");
      span.className = "crit-chip-text";
      span.textContent = def.label;
      labEl.appendChild(cb);
      labEl.appendChild(span);
      grid.appendChild(labEl);
    }
    critWrap.appendChild(grid);
    body.appendChild(critWrap);

    const stepsHost = document.createElement("div");
    stepsHost.className = "step-blocks";
    for (const st of s.steps || []) {
      stepsHost.appendChild(buildStepEditorRow(st));
    }
    body.appendChild(stepsHost);
    body.appendChild(buildAddStepBar(stepsHost));

    det.appendChild(sum);
    det.appendChild(body);
    el.scenarioFormRows.appendChild(det);
  });
}

/**
 * @param {any} baseDoc
 */
function readScenarioFormsIntoDoc(baseDoc) {
  const doc = JSON.parse(JSON.stringify(baseDoc));
  const editors = /** @type {HTMLElement[]} */ ([...document.querySelectorAll(".scenario-editor")]);
  editors.forEach((det, i) => {
    if (!doc.scenarios[i]) return;
    doc.scenarios[i].name = det.querySelector(".sc-name")?.value ?? doc.scenarios[i].name;
    const checked = [...det.querySelectorAll(".sc-crit-cb:checked")].map((c) => /** @type {HTMLInputElement} */ (c).value);
    doc.scenarios[i].criteria = checked;
    const rows = [...det.querySelectorAll(".step-blocks .step-block")];
    doc.scenarios[i].steps = rows.map((r) => readStepFromRow(r));
  });
  return doc;
}

function wireReport(jobRel) {
  const reportUrl = jobFileUrl(jobRel, "report.html");
  if (el.dashNavReport instanceof HTMLAnchorElement) {
    el.dashNavReport.href = reportUrl;
    el.dashNavReport.classList.remove("hidden");
  }
}

function hideAllPanels() {
  show(el.dashboardNav, false);
  show(el.summarySection, false);
  show(el.editSection, false);
  show(el.resultsSection, false);
  if (el.dashNavReport instanceof HTMLAnchorElement) {
    el.dashNavReport.classList.add("hidden");
    el.dashNavReport.href = "#";
  }
}

/**
 * @param {string} href
 * @param {boolean} visible
 */
function setDashboardNavLinkVisible(href, visible) {
  const a = el.dashboardNav?.querySelector(`a[href="${href}"]`);
  if (a instanceof HTMLAnchorElement) a.classList.toggle("hidden", !visible);
}

function syncDashboardNavLinks() {
  if (!el.dashboardNav) return;
  setDashboardNavLinkVisible("#section-summary", !el.summarySection?.classList.contains("hidden"));
  setDashboardNavLinkVisible("#section-results", !el.resultsSection?.classList.contains("hidden"));
  setDashboardNavLinkVisible("#section-edit", !el.editSection?.classList.contains("hidden"));
  const jobOpen = Boolean(state.jobStoragePath && !el.summarySection?.classList.contains("hidden"));
  if (el.dashNavReport) el.dashNavReport.classList.toggle("hidden", !jobOpen);
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

  /** @type {any} */
  let lighthouseSummary = null;
  try {
    lighthouseSummary = await fetchJson(jobFileUrl(jobRel, "lighthouse-summary.json"), { signal });
  } catch {
    lighthouseSummary = null;
  }
  state.lighthouseSummary = lighthouseSummary;
  if (el.dispatchHint) {
    if (state.dispatchMeta?.sig) {
      el.dispatchHint.textContent = "재실행 요청이 안전하게 서명되어 전송됩니다.";
    } else {
      el.dispatchHint.textContent = "";
    }
  }

  renderSummary(structure, scenarios, results, lighthouseSummary);
  if (scenarios) {
    renderScenarioForms(scenarios);
    show(el.editSection, true);
    if (el.editHint) {
      el.editHint.textContent = "";
      el.editHint.dataset.kind = "";
    }
  } else {
    show(el.editSection, false);
  }
  if (results) {
    renderResults(results);
    show(el.resultsSection, true);
  } else {
    show(el.resultsSection, false);
  }

  show(el.summarySection, true);
  show(el.dashboardNav, true);
  wireReport(jobRel);
  syncDashboardNavLinks();

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

el.btnPostRerun?.addEventListener("click", async () => {
  const url = workerRerunEndpoint();
  const secret = qaWebhookSecret();
  if (!state.jobId) {
    setStatus("Job ID가 없습니다. 먼저 불러오기를 실행하세요.", "err");
    return;
  }
  let scenarios;
  try {
    if (!state.scenariosDoc) throw new Error("시나리오를 불러오지 못했습니다.");
    scenarios = readScenarioFormsIntoDoc(state.scenariosDoc);
    const verr = validateScenariosDoc(scenarios);
    if (verr) {
      if (el.editHint) {
        el.editHint.textContent = verr;
        el.editHint.dataset.kind = "err";
      }
      return;
    }
    state.scenariosDoc = scenarios;
    if (el.editHint) {
      el.editHint.textContent = "";
      el.editHint.dataset.kind = "";
    }
  } catch (e) {
    if (el.editHint) {
      el.editHint.textContent = /** @type {Error} */ (e).message;
      el.editHint.dataset.kind = "err";
    }
    return;
  }
  if (!url) {
    setStatus("지금은 테스트를 실행할 수 없습니다. 잠시 후 다시 시도해 주세요.", "warn");
    return;
  }

  const prevFinished = state.results?.finishedAt ?? null;
  const postStartedAt = new Date().toISOString();

  setRerunWaiting(true);
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
  } finally {
    setRerunWaiting(false);
  }
});

if (initialJob) {
  document.getElementById("job-id-panel")?.setAttribute("open", "");
  el.input.value = initialJob;
  loadJob(initialJob);
} else {
  setStatus("위에서 사이트 주소를 넣고 분석을 시작하세요.", "");
}
