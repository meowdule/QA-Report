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

/** 도넛 차트 (통과·실패 비율) */
function donutChartHtml(pass, fail) {
  const p = Math.max(0, Number(pass) || 0);
  const f = Math.max(0, Number(fail) || 0);
  const t = p + f || 1;
  const pct = Math.round((p / t) * 100);
  const c = 2 * Math.PI * 16;
  const dashOk = (p / t) * c;
  return `<div class="donut-block" role="img" aria-label="통과 ${p}건, 실패 ${f}건">
    <svg class="donut-svg" viewBox="0 0 40 40" aria-hidden="true">
      <circle class="donut-track" cx="20" cy="20" r="16" fill="none" stroke-width="6"/>
      <circle class="donut-arc" cx="20" cy="20" r="16" fill="none" stroke-width="6"
        stroke-dasharray="${dashOk} ${c}" stroke-linecap="round" transform="rotate(-90 20 20)"/>
    </svg>
    <div class="donut-cap"><strong>${esc(String(pct))}%</strong><span>통과</span><span class="donut-sub">${esc(p)} / ${esc(t)} 묶음</span></div>
  </div>`;
}

function svgScenarioFolder() {
  return `<svg class="ico ico-folder" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
}

/**
 * @param {string} kind
 */
function stepGlyphSvg(kind) {
  const common = 'viewBox="0 0 24 24" aria-hidden="true" class="ico ico-step"';
  const paths = {
    navigate:
      '<path fill="currentColor" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2zm0 15.17L6.83 18 12 5.83 17.17 18 12 17.17z"/>',
    click: '<path fill="currentColor" d="M13 1.07V9h7L10 23 9 14H2l11-12.93z"/>',
    fill: '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
    selectOption:
      '<path fill="currentColor" d="M7 10l5 5 5-5H7zm0-2h10l-5-5-5 5z"/>',
    check: '<path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
    assertVisible:
      '<path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>',
    assertNoConsoleError:
      '<path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',
    waitForResponse:
      '<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
    waitForSelector:
      '<path fill="currentColor" d="M15 1H9v2h6V1zm4.03 6.39l2.02-.98L18.85 4l-2.42.59c-.4-.56-.86-1.08-1.39-1.55L19 1H5v2h14.17l-1.09 2.08zM11 10H9v7h2v-7zm8 1h2v7c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V9H5v7h14v-5z"/>',
  };
  const p = paths[kind] || paths.assertVisible;
  return `<svg ${common}>${p}</svg>`;
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
      inp("이동할 주소", "step-url", s.url || "", "url");
      break;
    case "click":
      inp("링크 주소(있으면)", "step-href", s.href || "", "url");
      inp("요소 찾기(선택자)", "step-selector", s.selector || "");
      inp("대체 찾기(선택)", "step-fallback", s.fallbackSelector || "");
      inp("역할(예: button, link)", "step-gr-role", s.getByRole || "");
      inp("버튼·링크 이름", "step-gr-name", s.accessibleName || "");
      break;
    case "fill":
      inp("입력 칸(선택자)", "step-selector", s.selector || "");
      inp("넣을 내용", "step-value", s.value != null ? String(s.value) : "");
      break;
    case "selectOption":
      inp("목록(선택자)", "step-selector", s.selector || "");
      inp("보이는 글자로 고르기", "step-sel-label", s.label || "");
      inp("또는 값으로 고르기", "step-sel-value", s.value != null ? String(s.value) : "");
      inp("또는 몇 번째(0부터)", "step-sel-index", s.index != null ? String(s.index) : "");
      break;
    case "check":
      inp("체크 칸(선택자)", "step-selector", s.selector || "");
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
      inp("보일 때까지 기다릴 영역(선택자)", "step-selector", s.selector || "");
      break;
    case "assertNoConsoleError": {
      const p = document.createElement("p");
      p.className = "step-block-note";
      p.textContent = "이 단계는 별도 입력 없이, 화면에 오류가 없는지만 봅니다.";
      wrap.appendChild(p);
      break;
    }
    case "waitForResponse":
      inp("응답 주소 일부(비우면 무시)", "step-urlpattern", s.urlPattern || "");
      {
        const lab = document.createElement("label");
        lab.className = "check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "step-optional";
        cb.checked = !!s.optional;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(" 없어도 넘어가도 됨"));
        wrap.appendChild(lab);
      }
      inp("최대 기다림(밀리초)", "step-timeout", s.timeout != null ? String(s.timeout) : "8000", "number");
      break;
    case "waitForSelector":
      inp("나타날 영역(선택자)", "step-selector", s.selector || "");
      {
        const lab = document.createElement("label");
        lab.className = "check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "step-optional";
        cb.checked = !!s.optional;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(" 없어도 넘어가도 됨"));
        wrap.appendChild(lab);
      }
      inp("최대 기다림(밀리초)", "step-timeout", s.timeout != null ? String(s.timeout) : "15000", "number");
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
  const glyph = document.createElement("span");
  glyph.className = "step-block-glyph";
  glyph.innerHTML = stepGlyphSvg(type);
  const ttl = document.createElement("span");
  ttl.className = "step-block-title";
  ttl.textContent = STEP_LABEL_KO[type] || type;
  head.appendChild(glyph);
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

  row.appendChild(head);
  row.appendChild(tools);
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
  z.textContent = "➕ 단계 추가…";
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

/**
 * @param {string} u
 */
function shortUrlSpa(u) {
  try {
    const x = new URL(u);
    return (x.hostname + x.pathname).slice(0, 52) + (String(u).length > 52 ? "…" : "");
  } catch {
    return String(u).slice(0, 52);
  }
}

/**
 * @param {any} st
 */
function formatStepLineKo(st) {
  const parts = [];
  if (st.url) parts.push(`주소 ${esc(shortUrlSpa(st.url))}`);
  if (st.finalUrl && st.finalUrl !== st.url) parts.push(`이동 후 ${esc(shortUrlSpa(st.finalUrl))}`);
  if (st.status != null) parts.push(`응답 ${esc(st.status)}`);
  if (st.selector) parts.push("지정한 영역");
  if (st.href) parts.push(`링크 ${esc(shortUrlSpa(st.href))}`);
  if (st.accessibleName) parts.push(`이름 「${esc(String(st.accessibleName).slice(0, 36))}」`);
  if (st.value != null && String(st.value) !== "") parts.push(`입력값 ${esc(String(st.value).slice(0, 36))}`);
  if (st.label != null && String(st.label) !== "") parts.push(`선택 ${esc(String(st.label).slice(0, 36))}`);
  if (st.error) parts.push(`원인 ${esc(String(st.error).slice(0, 120))}`);
  if (!parts.length) return "";
  return ` — ${parts.join(" · ")}`;
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
  scenariosSection: document.getElementById("scenarios-section"),
  scenariosBody: document.getElementById("scenarios-body"),
  editSection: document.getElementById("edit-section"),
  scenarioFormRows: document.getElementById("scenario-form-rows"),
  editHint: document.getElementById("edit-hint"),
  btnPostRerun: document.getElementById("btn-post-rerun"),
  dispatchHint: document.getElementById("dispatch-hint"),
  structureSection: document.getElementById("structure-section"),
  structureBody: document.getElementById("structure-body"),
  resultsSection: document.getElementById("results-section"),
  resultsBody: document.getElementById("results-body"),
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

/** @param {number | null | undefined} ms */
function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}초`;
}

/** @param {string[]} criterionIds */
function chipsHtmlCriteria(criterionIds) {
  const list = (criterionIds || []).filter(Boolean);
  if (!list.length) return `<span class="chip chip--muted">—</span>`;
  return list
    .map((id) => {
      const d = CRITERIA_DEF[id];
      const t = d ? `${d.label}` : criterionLabel(id);
      return `<span class="chip" title="${esc(d?.desc || "")}">${esc(t)}</span>`;
    })
    .join("");
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
  const donutMini = tot > 0 ? donutChartHtml(pass, failN) : "";

  el.summaryBody.innerHTML = `
    <div class="summary-kpi" role="group" aria-label="작업 요약">
      <div class="kpi-tile kpi-tile--accent">
        <span class="kpi-label">작업 ID</span>
        <span class="kpi-value kpi-value--mono">${esc(jobId)}</span>
        <span class="kpi-hint">이 번호로 나중에 다시 이 결과를 열 수 있습니다.</span>
      </div>
      <div class="kpi-tile kpi-tile--viz">
        ${donutMini || `<span class="kpi-label">통과율</span><span class="kpi-value">—</span><span class="kpi-hint">${esc(resultsHint)}</span>`}
        ${donutMini ? `<span class="kpi-hint kpi-hint--below">${esc(resultsHint)}</span>` : ""}
      </div>
      <div class="kpi-tile">
        <span class="kpi-label">수집한 페이지</span>
        <span class="kpi-value">${esc(pages)}</span>
        <span class="kpi-hint">시나리오 ${esc(scenariosCount)}개</span>
      </div>
    </div>
    <div class="summary-target-card">
      <span class="summary-target-label">분석한 주소</span>
      <div class="summary-target-url">${targetBlock}</div>
    </div>
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
        `<tr><td class="cell-title">${esc(p.title || "제목 없음")}</td><td class="cell-url"><a href="${esc(
          p.url,
        )}" target="_blank" rel="noopener noreferrer" class="table-link">${esc(p.url)}</a></td><td class="cell-status">${esc(
          p.httpStatus ?? p.error ?? "—",
        )}</td></tr>`,
    )
    .join("");
  const more =
    pages.length > 50
      ? `<p class="hint">목록이 길어 처음 50개만 보여 드립니다.</p>`
      : "";
  el.structureBody.innerHTML = `
    <p class="structure-lead">총 <strong>${pages.length}</strong>개 페이지를 살펴보았습니다.</p>
    <div class="table-scroll"><table class="data data--pages"><thead><tr><th>페이지 이름</th><th>주소</th><th>응답</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=3>페이지 없음</td></tr>"}</tbody></table></div>${more}
  `;
}

/**
 * @param {any} doc
 */
function renderScenarios(doc) {
  const list = doc?.scenarios || [];
  const ver = doc?.version ?? "?";
  const rows = list
    .map(
      (s, idx) =>
        `<tr>
          <td class="cell-scen-name">
            <span class="scen-ico" aria-hidden="true">${svgScenarioFolder()}</span>
            <span class="scen-name">${esc(s.name || "이름 없음")}</span>
            <span class="scen-sub">묶음 ${idx + 1} · 단계 ${esc(s.steps?.length ?? 0)}개</span>
          </td>
          <td class="cell-chips">${chipsHtmlCriteria(s.criteria || [])}</td>
        </tr>`,
    )
    .join("");
  el.scenariosBody.innerHTML = `
    <p class="scenarios-meta"><span class="ver-pill">목록 버전 ${esc(ver)}</span></p>
    <div class="table-scroll"><table class="data data--scenarios"><thead><tr><th>시나리오</th><th>점검 기준</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=2>시나리오가 없습니다.</td></tr>"}</tbody></table></div>
  `;
}

/**
 * @param {any} results
 */
function renderResults(results) {
  const list = results?.scenarios || [];
  const passN = list.filter((s) => s.passed).length;
  const failN = list.length - passN;
  const donut = list.length ? donutChartHtml(passN, failN) : "";

  const summary = results?.criteriaSummary;
  let table = "";
  if (summary && Object.keys(summary).length) {
    const rows = Object.entries(summary)
      .filter(([, row]) => (row.pass || 0) + (row.fail || 0) > 0)
      .map(([id, row]) => {
        const label = row.labelKo || criterionLabel(id);
        const total = (row.pass || 0) + (row.fail || 0);
        const rate = total ? Math.round(((row.pass || 0) / total) * 100) : 0;
        return `<tr>
          <td class="cell-criterion">
            <span class="crit-label">${esc(label)}</span>
            <span class="crit-mini">${esc(CRITERIA_DEF[id]?.desc || "")}</span>
          </td>
          <td class="cell-num cell-num--ok">${esc(row.pass)} <span class="crit-pct">(${esc(rate)}%)</span></td>
          <td class="cell-num cell-num--bad">${esc(row.fail)}</td>
        </tr>`;
      })
      .join("");
    table = `<h3 class="subh subh--ico"><span class="subh-ico" aria-hidden="true">📊</span> 기준별 요약</h3>
      <div class="table-scroll"><table class="data data--criteria"><thead><tr><th>점검 항목</th><th>통과</th><th>실패</th></tr></thead><tbody>${
        rows || "<tr><td colspan=3>집계할 항목이 없습니다.</td></tr>"
      }</tbody></table></div>`;
  }

  const scen = list
    .map((s) => {
      const steps = (s.steps || [])
        .map((st) => {
          const cls = st.skipped ? "step-li--skip" : st.ok === false ? "step-li--bad" : "step-li--ok";
          const lab = STEP_LABEL_KO[st.type] || st.type;
          const line = formatStepLineKo(st);
          const mark =
            st.skipped ? "◦" : st.ok === false ? "✕" : "✓";
          return `<li class="step-li ${cls}"><span class="step-li-glyph" aria-hidden="true">${stepGlyphSvg(st.type)}</span><span class="step-li-mark">${mark}</span><span class="step-li-txt"><strong>${esc(lab)}</strong>${line}</span></li>`;
        })
        .join("");
      const crits = chipsHtmlCriteria(s.criteria || []);
      return `<article class="result-scen-detail ${s.passed ? "is-pass" : "is-fail"}">
        <header class="result-scen-detail__head">
          <span class="badge ${s.passed ? "badge--ok" : "badge--bad"}">${s.passed ? "통과" : "실패"}</span>
          <h4 class="result-scen-detail__title">${esc(s.name || "이름 없음")}</h4>
          <p class="result-scen-detail__meta">⏱ ${esc(formatDuration(s.durationMs))} · 점검 ${crits}</p>
        </header>
        <ol class="step-ol">${steps || '<li class="step-li step-li--skip">단계 없음</li>'}</ol>
      </article>`;
    })
    .join("");

  el.resultsBody.innerHTML = `
    <div class="results-viz-row">${donut ? `<div class="results-donut-slot">${donut}</div>` : ""}
    <p class="results-viz-caption">${list.length ? `총 ${esc(list.length)}개 묶음 중 ${esc(passN)}개 통과` : "아직 결과가 없습니다."}</p></div>
    ${table}
    <h3 class="subh subh--ico"><span class="subh-ico" aria-hidden="true">📋</span> 시나리오별 상세</h3>
    <div class="result-scen-stack">${scen || '<p class="hint">시나리오 결과가 없습니다.</p>'}</div>
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
    det.open = i === 0;

    const sum = document.createElement("summary");
    sum.className = "scenario-editor-summary";
    const iconDoc = document.createElement("span");
    iconDoc.className = "scenario-doc-icon";
    iconDoc.innerHTML = svgScenarioFolder();
    const titleWrap = document.createElement("div");
    titleWrap.className = "scenario-summary-text";
    const lab = document.createElement("span");
    lab.className = "scenario-summary-label";
    lab.textContent = `시나리오 ${i + 1}`;
    const namePrev = document.createElement("span");
    namePrev.className = "scenario-summary-name";
    namePrev.textContent = s.name || "이름 없음";
    titleWrap.appendChild(lab);
    titleWrap.appendChild(namePrev);
    const badge = document.createElement("span");
    badge.className = "scenario-step-badge";
    badge.textContent = `${(s.steps || []).length}단계`;
    sum.appendChild(iconDoc);
    sum.appendChild(titleWrap);
    sum.appendChild(badge);

    const body = document.createElement("div");
    body.className = "scenario-editor-body";

    const nameL = document.createElement("label");
    nameL.className = "field";
    nameL.innerHTML = "<span>이 시나리오 이름</span>";
    const nameI = document.createElement("input");
    nameI.type = "text";
    nameI.className = "sc-name";
    nameI.value = s.name || "";
    nameL.appendChild(nameI);
    body.appendChild(nameL);

    const critWrap = document.createElement("div");
    critWrap.className = "field criteria-field";
    const critLbl = document.createElement("span");
    critLbl.textContent = "적용할 점검 기준";
    critWrap.appendChild(critLbl);
    const grid = document.createElement("div");
    grid.className = "criteria-grid";
    for (const id of CRITERION_ORDER) {
      const def = CRITERIA_DEF[id];
      if (!def) continue;
      const labEl = document.createElement("label");
      labEl.className = "crit-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "sc-crit-cb";
      cb.value = id;
      cb.checked = (s.criteria || []).includes(id);
      const strong = document.createElement("strong");
      strong.textContent = def.label;
      const small = document.createElement("small");
      small.textContent = def.desc;
      labEl.appendChild(cb);
      labEl.appendChild(strong);
      labEl.appendChild(small);
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
  el.reportLink.href = reportUrl;
  el.reportFrame.src = reportUrl;
}

function hideAllPanels() {
  show(el.dashboardNav, false);
  show(el.summarySection, false);
  show(el.scenariosSection, false);
  show(el.editSection, false);
  show(el.structureSection, false);
  show(el.resultsSection, false);
  show(el.reportSection, false);
  el.reportFrame.removeAttribute("src");
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
  setDashboardNavLinkVisible("#section-scenarios", !el.scenariosSection?.classList.contains("hidden"));
  setDashboardNavLinkVisible("#section-edit", !el.editSection?.classList.contains("hidden"));
  setDashboardNavLinkVisible("#section-structure", !el.structureSection?.classList.contains("hidden"));
  setDashboardNavLinkVisible("#section-report", !el.reportSection?.classList.contains("hidden"));
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
      el.dispatchHint.textContent = "재실행 요청이 안전하게 서명되어 전송됩니다.";
    } else {
      el.dispatchHint.textContent = "";
    }
  }

  renderSummary(structure, scenarios, results);
  renderStructure(structure);
  if (scenarios) {
    renderScenarios(scenarios);
    show(el.scenariosSection, true);
    renderScenarioForms(scenarios);
    show(el.editSection, true);
    if (el.editHint) {
      el.editHint.textContent = "";
      el.editHint.dataset.kind = "";
    }
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
  show(el.dashboardNav, true);
  wireReport(jobRel);
  show(el.reportSection, true);
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
