/**
 * 시나리오 스키마·기준(criteria) 표준 정의 (Phase 2)
 * scenarios.draft.json 의 criteria 배열 값과 일치해야 합니다.
 */

/** @typedef {'navigate' | 'click' | 'fill' | 'selectOption' | 'check' | 'assertVisible' | 'assertNoConsoleError' | 'waitForResponse' | 'waitForSelector'} StepType */

/** @typedef {'page_rendering' | 'core_action' | 'input_data' | 'console_errors' | 'primary_flow'} CriterionId */

/** 지원 스텝 타입 (런너와 동기화) */
export const STEP_TYPES = /** @type {const} */ ([
  "navigate",
  "click",
  "fill",
  "selectOption",
  "check",
  "assertVisible",
  "assertNoConsoleError",
  "waitForResponse",
  "waitForSelector",
]);

/** 기준 정의: 검증에 사용되는 스텝·메트릭 */
export const CRITERIA = /** @type {Record<CriterionId, { labelKo: string; description: string; primarySteps: StepType[]; metrics: string[] }>} */ ({
  page_rendering: {
    labelKo: "페이지 렌더링",
    description: "문서 로드 후 핵심 요소가 화면에 보이는지",
    primarySteps: ["navigate", "assertVisible"],
    metrics: ["httpStatus", "selectorVisible", "finalUrl"],
  },
  core_action: {
    labelKo: "핵심 액션",
    description: "클릭 등 주요 인터랙션이 오류 없이 수행되는지",
    primarySteps: ["click", "navigate", "assertVisible", "waitForSelector"],
    metrics: ["clickResolved", "navigation", "dialogs", "popupOrNewTab"],
  },
  input_data: {
    labelKo: "입력 데이터",
    description: "폼 필드에 값이 입력되는지(저장·서버 검증은 별도)",
    primarySteps: ["fill", "selectOption", "check", "assertVisible"],
    metrics: ["fieldFilled"],
  },
  console_errors: {
    labelKo: "UI 콘솔 에러",
    description: "콘솔 error 및 페이지 미처리 예외가 없는지",
    primarySteps: ["assertNoConsoleError", "navigate"],
    metrics: ["consoleErrorCount", "pageErrorCount"],
  },
  primary_flow: {
    labelKo: "주요 흐름",
    description: "핵심 URL 순서로 이동·표시가 완료되는지",
    primarySteps: ["navigate", "assertVisible", "waitForResponse"],
    metrics: ["stepSequenceComplete", "chainLength"],
  },
});

/** @type {readonly CriterionId[]} */
export const CRITERION_IDS = /** @type {any} */ (Object.keys(CRITERIA));

/**
 * 기준별로 시나리오 통과·실패 건수를 집계합니다.
 * @param {any[]} scenarioResults runner 산출
 */
export function summarizeCriteria(scenarioResults) {
  /** @type {Record<string, { labelKo: string; pass: number; fail: number; scenarioIds: { id: string; passed: boolean }[] }>} */
  const out = {};

  for (const id of Object.keys(CRITERIA)) {
    out[id] = {
      labelKo: CRITERIA[/** @type {CriterionId} */ (id)].labelKo,
      pass: 0,
      fail: 0,
      scenarioIds: [],
    };
  }

  for (const s of scenarioResults) {
    const ids = s.criteria || [];
    for (const cid of ids) {
      if (!out[cid]) {
        out[cid] = { labelKo: cid, pass: 0, fail: 0, scenarioIds: [] };
      }
      if (s.passed) out[cid].pass++;
      else out[cid].fail++;
      out[cid].scenarioIds.push({ id: s.id, passed: !!s.passed });
    }
  }

  return out;
}

/**
 * @param {any} scenariosDoc
 */
export function validateScenarioSteps(scenariosDoc) {
  const issues = [];
  const allowed = new Set(STEP_TYPES);
  for (const sc of scenariosDoc.scenarios || []) {
    for (const step of sc.steps || []) {
      if (!allowed.has(step.type)) {
        issues.push({ scenarioId: sc.id, stepType: step.type, message: "Unknown step type" });
      }
    }
    for (const c of sc.criteria || []) {
      if (!CRITERIA[c]) {
        issues.push({ scenarioId: sc.id, criterion: c, message: "Unknown criterion id" });
      }
    }
  }
  return issues;
}
