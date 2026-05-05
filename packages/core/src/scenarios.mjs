/**
 * 크롤 결과로부터 초안 시나리오를 생성합니다.
 * criteria: page_rendering | core_action | input_data | console_errors | primary_flow
 * @param {any} structure crawlSite 결과
 */
export function buildDraftScenarios(structure) {
  const pages = structure.pages.filter((p) => !p.error && p.httpStatus >= 200 && p.httpStatus < 400);
  /** @type {any[]} */
  const scenarios = [];

  pages.forEach((p, i) => {
    const n = i + 1;
    scenarios.push({
      id: `render-${n}`,
      name: `페이지 렌더링: ${p.title || p.url}`,
      criteria: ["page_rendering", "console_errors"],
      steps: [
        { type: "navigate", url: p.url },
        { type: "assertVisible", selector: "body" },
        { type: "assertNoConsoleError" },
      ],
    });
  });

  const home = pages[0];
  if (home?.links?.length) {
    const first = home.links.find((u) => u !== home.url) || home.links[0];
    scenarios.push({
      id: "core-action-first-link",
      name: "핵심 액션: 홈에서 첫 동일 출처 링크 클릭",
      criteria: ["core_action", "console_errors"],
      steps: [
        { type: "navigate", url: home.url },
        { type: "assertVisible", selector: "body" },
        { type: "click", href: first, fallbackSelector: "a[href]" },
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
          { type: "assertNoConsoleError" },
        ],
      });
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
    steps.push({ type: "assertNoConsoleError" });
    scenarios.push({
      id: "primary-flow-linear",
      name: "주요 흐름: 상위 페이지 순차 방문",
      criteria: ["primary_flow", "page_rendering", "console_errors"],
      steps,
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    targetUrl: structure.targetUrl,
    scenarios,
  };
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
