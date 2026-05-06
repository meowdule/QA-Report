import { displayPathRelativeToSeed, normalizeStructureUrl } from "./crawl.mjs";
import { CRITERION_IDS, STEP_TYPES } from "./schema.mjs";

const MAX_LINK_NAV_SCENARIOS = 8;
const MAX_BUTTON_CLICK_SCENARIOS = 6;
const MAX_PAGES_FOR_UI = 10;
const MAX_FORM_SELECT = 4;
const MAX_FORM_RADIO = 3;
const MAX_FORM_CHECK = 2;
const MAX_FORM_SWITCH = 2;
const MAX_FORM_ARIA_TOGGLE = 2;

/**
 * 크롤 결과로부터 초안 시나리오를 생성합니다.
 * criteria: schema.mjs 의 CriterionId 와 일치
 * @param {any} structure crawlSite 결과
 */
export function buildDraftScenarios(structure) {
  const pages = structure.pages.filter((p) => !p.error && p.httpStatus >= 200 && p.httpStatus < 400);
  const seed = structure.targetUrl || pages[0]?.url || "";
  /** @type {any[]} */
  const scenarios = [];

  pages.forEach((p, i) => {
    const n = i + 1;
    const pathHint = displayPathRelativeToSeed(seed, p.url);
    const titleExtra = p.title && String(p.title).trim() && String(p.title).trim() !== pathHint ? ` · ${String(p.title).trim().slice(0, 48)}` : "";
    scenarios.push({
      id: `render-${n}`,
      name: `렌더 ${pathHint}${titleExtra}`,
      criteria: ["page_rendering", "console_errors"],
      steps: [
        { type: "navigate", url: p.url },
        { type: "assertVisible", selector: "body" },
        { type: "assertNoConsoleError" },
      ],
    });
  });

  /** @type {Set<string>} */
  const usedLinkPairs = new Set();
  let linkNavCount = 0;
  let linkScenarioSeq = 0;

  /**
   * @param {string} pageUrl
   * @param {string} targetHref
   * @param {string} label
   * @param {Record<string, { target?: string; opensNewTab?: boolean; rel?: string }> | undefined} linkClickMeta
   */
  function addLinkClickScenario(pageUrl, targetHref, label, linkClickMeta) {
    if (linkNavCount >= MAX_LINK_NAV_SCENARIOS) return;
    const key = `${pageUrl}→${targetHref}`;
    if (usedLinkPairs.has(key)) return;
    usedLinkPairs.add(key);
    linkNavCount++;
    linkScenarioSeq++;
    const norm = normalizeStructureUrl(targetHref, pageUrl);
    const meta = linkClickMeta?.[norm] || linkClickMeta?.[targetHref];
    /** @type {any} */
    const clickStep = { type: "click", href: targetHref, fallbackSelector: "a[href]" };
    if (meta?.opensNewTab) {
      clickStep.opensNewTab = true;
      clickStep.target = meta.target || "_blank";
    }
    scenarios.push({
      id: `link-nav-${linkScenarioSeq}`,
      name: label,
      criteria: ["core_action", "console_errors"],
      steps: [
        { type: "navigate", url: pageUrl },
        { type: "assertVisible", selector: "body" },
        clickStep,
        { type: "waitForResponse", urlPattern: "", optional: true, timeout: 8000 },
        { type: "assertVisible", selector: "body" },
        { type: "assertNoConsoleError" },
      ],
    });
  }

  for (const p of pages.slice(0, MAX_PAGES_FOR_UI)) {
    const candidates = (p.links || []).filter((u) => u !== p.url);
    const uniq = [...new Set(candidates)];
    const second = uniq[1];
    const third = uniq[2];
    if (second) {
      addLinkClickScenario(
        p.url,
        second,
        `링크 ${displayPathRelativeToSeed(seed, p.url)} → ${displayPathRelativeToSeed(seed, second)}`,
        p.linkClickMeta,
      );
    }
    if (third && linkNavCount < MAX_LINK_NAV_SCENARIOS) {
      addLinkClickScenario(
        p.url,
        third,
        `링크(3) ${displayPathRelativeToSeed(seed, p.url)} → ${displayPathRelativeToSeed(seed, third)}`,
        p.linkClickMeta,
      );
    }
  }

  const home = pages[0];
  if (home?.links?.length && linkNavCount < MAX_LINK_NAV_SCENARIOS) {
    const first = home.links.find((u) => u !== home.url) || home.links[0];
    if (first && !usedLinkPairs.has(`${home.url}→${first}`)) {
      addLinkClickScenario(
        home.url,
        first,
        `링크(홈) ${displayPathRelativeToSeed(seed, home.url)} → ${displayPathRelativeToSeed(seed, first)}`,
        home.linkClickMeta,
      );
    }
  }

  let buttonClickCount = 0;
  for (const p of pages.slice(0, MAX_PAGES_FOR_UI)) {
    if (buttonClickCount >= MAX_BUTTON_CLICK_SCENARIOS) break;
    const interactables = p.interactables || [];
    const clickable = interactables.find(
      (it) =>
        it.kind === "button" ||
        it.kind === "roleButton" ||
        it.kind === "clickableDiv" ||
        it.kind === "inputButton",
    );
    if (!clickable?.selector && !clickable?.getByRole) continue;

    /** @type {any} */
    const clickStep = { type: "click" };
    if (clickable.getByRole) {
      clickStep.getByRole = clickable.getByRole;
      if (clickable.accessibleName) clickStep.accessibleName = clickable.accessibleName;
    }
    if (clickable.href) clickStep.href = clickable.href;
    if (clickable.selector) clickStep.selector = clickable.selector;
    if (clickable.opensNewTab) {
      clickStep.opensNewTab = true;
      clickStep.target = clickable.linkTarget || "_blank";
    }
    if (!clickStep.href && !clickStep.selector && !clickStep.getByRole) continue;

    buttonClickCount++;
    scenarios.push({
      id: `ui-click-${safeId(p.url)}-${buttonClickCount}`,
      name: `UI 클릭: ${clickable.kind} — ${(clickable.name || p.title || "").slice(0, 60)}`,
      criteria: ["core_action", "console_errors"],
      steps: [
        { type: "navigate", url: p.url },
        { type: "assertVisible", selector: "body" },
        clickStep,
        { type: "waitForResponse", urlPattern: "", optional: true, timeout: 8000 },
        { type: "assertVisible", selector: "body" },
        { type: "assertNoConsoleError" },
      ],
    });
  }

  const withForm = pages.find((p) => p.forms?.length > 0);
  if (withForm) {
    const form = withForm.forms[0];
    const textInput = pickFillableField(form.types);
    if (textInput) {
      scenarios.push({
        id: "input-smoke",
        name: "입력 데이터: 첫 폼에 더미 값 입력 (저장 검증은 후속 단계)",
        criteria: ["input_data", "console_errors"],
        steps: [
          { type: "navigate", url: withForm.url },
          { type: "assertVisible", selector: "body" },
          {
            type: "fill",
            selector: `${form.selector} input`,
            value: dummyValueForType(textInput),
          },
          { type: "waitForResponse", urlPattern: "", optional: true, timeout: 5000 },
          { type: "assertNoConsoleError" },
        ],
      });
    }
  }

  /** @type {Set<string>} */
  const usedFormKeys = new Set();
  let nFormSelect = 0;
  let nFormRadio = 0;
  let nFormCheck = 0;
  let nFormSwitch = 0;
  let nFormToggle = 0;

  function formKey(pageUrl, kind, id) {
    return `${pageUrl}|${kind}|${id}`;
  }

  for (const p of pages.slice(0, MAX_PAGES_FOR_UI)) {
    const fcs = p.formControls || [];
    for (const fc of fcs) {
      const idPart = fc.selector || fc.name || String(fcs.indexOf(fc));
      const fk = formKey(p.url, fc.kind, idPart);
      if (usedFormKeys.has(fk)) continue;

      if (fc.kind === "select" && !fc.disabled && nFormSelect < MAX_FORM_SELECT) {
        if (fc.multiple) {
          const picks = fc.options.filter((/** @type {any} */ o) => !o.selected && !o.disabled).slice(0, 2);
          if (!picks.length) continue;
          const values = picks.map((/** @type {any} */ o) => (o.value !== "" ? o.value : o.label));
          usedFormKeys.add(fk);
          nFormSelect++;
          const title = fc.label || fc.name || shortUrl(p.url);
          scenarios.push({
            id: `form-select-multi-${nFormSelect}`,
            name: `입력 데이터: 다중 선택 <select> (${fc.selectionMode}) — ${title.slice(0, 56)}`,
            criteria: ["input_data", "console_errors"],
            steps: [
              { type: "navigate", url: p.url },
              { type: "assertVisible", selector: "body" },
              { type: "selectOption", selector: fc.selector, values },
              { type: "waitForResponse", urlPattern: "", optional: true, timeout: 6000 },
              { type: "assertNoConsoleError" },
            ],
          });
        } else {
          const selIdx = fc.options.findIndex((/** @type {any} */ o) => o.selected);
          const next =
            selIdx < 0
              ? fc.options.find((/** @type {any} */ o, i) => i > 0 && !o.disabled)
              : fc.options.find((/** @type {any} */ o, i) => i !== selIdx && !o.disabled);
          if (!next) continue;
          usedFormKeys.add(fk);
          nFormSelect++;
          const title = fc.label || fc.name || shortUrl(p.url);
          /** @type {any} */
          const selStep = { type: "selectOption", selector: fc.selector };
          if (next.value !== "") selStep.value = next.value;
          else selStep.label = next.label;
          scenarios.push({
            id: `form-select-${nFormSelect}`,
            name: `입력 데이터: 단일 <select> (${fc.selectionMode}) — ${title.slice(0, 56)}`,
            criteria: ["input_data", "console_errors"],
            steps: [
              { type: "navigate", url: p.url },
              { type: "assertVisible", selector: "body" },
              selStep,
              { type: "waitForResponse", urlPattern: "", optional: true, timeout: 6000 },
              { type: "assertNoConsoleError" },
            ],
          });
        }
        continue;
      }

      if (fc.kind === "radioGroup" && nFormRadio < MAX_FORM_RADIO) {
        const second = fc.options[1];
        const pick =
          second && !second.checked
            ? second
            : fc.options.find((/** @type {any} */ o) => !o.checked);
        if (!pick) continue;
        usedFormKeys.add(fk);
        nFormRadio++;
        const title = fc.name || shortUrl(p.url);
        scenarios.push({
          id: `form-radio-${nFormRadio}`,
          name: `입력 데이터: 라디오 그룹 (${fc.selectionMode}) — ${title.slice(0, 56)}`,
          criteria: ["input_data", "console_errors"],
          steps: [
            { type: "navigate", url: p.url },
            { type: "assertVisible", selector: "body" },
            { type: "check", selector: pick.selector, control: "radio", checked: true },
            { type: "waitForResponse", urlPattern: "", optional: true, timeout: 6000 },
            { type: "assertNoConsoleError" },
          ],
        });
        continue;
      }

      if (fc.kind === "checkbox" && !fc.checked && nFormCheck < MAX_FORM_CHECK) {
        const hay = `${fc.name || ""} ${fc.id || ""} ${fc.label || ""}`;
        const risky = /terms|privacy|agree|marketing|subscribe|약관|개인정보|수신|필수/i.test(hay);
        if (risky && (fc.label || "").length > 48) continue;
        usedFormKeys.add(fk);
        nFormCheck++;
        const title = fc.label || fc.name || shortUrl(p.url);
        scenarios.push({
          id: `form-checkbox-${nFormCheck}`,
          name: `입력 데이터: 체크박스 (${fc.selectionMode}) — ${title.slice(0, 56)}`,
          criteria: ["input_data", "console_errors"],
          steps: [
            { type: "navigate", url: p.url },
            { type: "assertVisible", selector: "body" },
            { type: "check", selector: fc.selector, control: "checkbox", checked: true },
            { type: "waitForResponse", urlPattern: "", optional: true, timeout: 6000 },
            { type: "assertNoConsoleError" },
          ],
        });
        continue;
      }

      if (fc.kind === "switch" && nFormSwitch < MAX_FORM_SWITCH) {
        usedFormKeys.add(fk);
        nFormSwitch++;
        const title = fc.label || shortUrl(p.url);
        scenarios.push({
          id: `form-switch-${nFormSwitch}`,
          name: `핵심 액션: 스위치(role=switch) — ${title.slice(0, 56)}`,
          criteria: ["core_action", "console_errors"],
          steps: [
            { type: "navigate", url: p.url },
            { type: "assertVisible", selector: "body" },
            { type: "click", selector: fc.selector },
            { type: "waitForResponse", urlPattern: "", optional: true, timeout: 6000 },
            { type: "assertVisible", selector: "body" },
            { type: "assertNoConsoleError" },
          ],
        });
        continue;
      }

      if (fc.kind === "ariaToggle" && nFormToggle < MAX_FORM_ARIA_TOGGLE) {
        usedFormKeys.add(fk);
        nFormToggle++;
        const title = fc.label || shortUrl(p.url);
        scenarios.push({
          id: `form-aria-toggle-${nFormToggle}`,
          name: `핵심 액션: 토글(aria-checked) — ${title.slice(0, 56)}`,
          criteria: ["core_action", "console_errors"],
          steps: [
            { type: "navigate", url: p.url },
            { type: "assertVisible", selector: "body" },
            { type: "click", selector: fc.selector },
            { type: "waitForResponse", urlPattern: "", optional: true, timeout: 6000 },
            { type: "assertVisible", selector: "body" },
            { type: "assertNoConsoleError" },
          ],
        });
      }
    }
  }

  const chain = pages.slice(0, Math.min(3, pages.length)).map((p) => p.url);
  if (chain.length > 1) {
    /** @type {any[]} */
    const steps = [];
    for (const url of chain) {
      steps.push({ type: "navigate", url });
      steps.push({ type: "assertVisible", selector: "body" });
    }
    steps.push({ type: "waitForResponse", urlPattern: "", optional: true, timeout: 4000 });
    steps.push({ type: "assertNoConsoleError" });
    scenarios.push({
      id: "primary-flow-linear",
      name: "주요 흐름: 상위 페이지 순차 방문",
      criteria: ["primary_flow", "page_rendering", "console_errors"],
      steps,
    });
  }

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    targetUrl: structure.targetUrl,
    schema: {
      stepTypes: [...STEP_TYPES],
      criterionIds: [...CRITERION_IDS],
    },
    scenarios,
  };
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    return (x.pathname + x.search).slice(0, 48) || x.host;
  } catch {
    return String(u).slice(0, 48);
  }
}

function safeId(s) {
  return String(s)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}

function pickFillableField(types) {
  const order = ["text", "email", "search", "tel", "url", "number", "password"];
  for (const o of order) {
    if (types.includes(o)) return o;
  }
  return types.find((t) => t !== "submit" && t !== "button" && t !== "checkbox" && t !== "radio") || null;
}

function dummyValueForType(t) {
  if (t === "email") return "qa-automation@example.com";
  if (t === "password") return "QA-test-pass-9!";
  if (t === "tel") return "+821012345678";
  if (t === "url") return "https://example.com";
  if (t === "number") return "1";
  return "QA automation sample";
}
