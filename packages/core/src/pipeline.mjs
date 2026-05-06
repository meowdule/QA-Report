import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { crawlSite } from "./crawl.mjs";
import { buildDraftScenarios } from "./scenarios.mjs";
import { runScenarios } from "./runner.mjs";
import { buildReportHtml } from "./report-html.mjs";
import { CRITERIA, CRITERION_IDS, STEP_TYPES, validateScenarioSteps } from "./schema.mjs";
import { createDispatchMeta } from "./dispatch-sign.mjs";

const TARGET_URL = process.env.TARGET_URL;
const MAX_PAGES = Math.min(100, Math.max(1, parseInt(process.env.MAX_PAGES || "20", 10)));
const MAX_DEPTH = Math.min(10, Math.max(0, parseInt(process.env.MAX_DEPTH || "2", 10)));
const JOB_ID = process.env.JOB_ID || "local";
const _t = process.env.TRACE_MODE;
const TRACE_MODE = _t === "all" || _t === "off" || _t === "failure" ? _t : "failure";

if (!TARGET_URL) {
  console.error("TARGET_URL is required");
  process.exit(1);
}

const outDir = path.join(process.cwd(), "output");
fs.mkdirSync(outDir, { recursive: true });

console.log(
  `Job ${JOB_ID} → ${TARGET_URL} (maxPages=${MAX_PAGES}, maxDepth=${MAX_DEPTH}, trace=${TRACE_MODE})`,
);

const browser = await chromium.launch({ headless: true });

try {
  const structure = await crawlSite(browser, TARGET_URL, {
    maxPages: MAX_PAGES,
    maxDepth: MAX_DEPTH,
  });
  fs.writeFileSync(path.join(outDir, "structure.json"), JSON.stringify(structure, null, 2), "utf8");

  const scenariosDoc = buildDraftScenarios(structure);
  fs.writeFileSync(path.join(outDir, "scenarios.draft.json"), JSON.stringify(scenariosDoc, null, 2), "utf8");

  const issues = validateScenarioSteps(scenariosDoc);
  if (issues.length) {
    console.warn("Scenario validation:", JSON.stringify(issues, null, 2));
  }

  fs.writeFileSync(
    path.join(outDir, "schema.json"),
    JSON.stringify(
      {
        stepTypes: STEP_TYPES,
        criterionIds: CRITERION_IDS,
        criteria: CRITERIA,
      },
      null,
      2,
    ),
    "utf8",
  );

  const runResults = await runScenarios(browser, scenariosDoc, { outDir, traceMode: TRACE_MODE });
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(runResults, null, 2), "utf8");

  const reportGeneratedAt = new Date().toISOString();
  const html = buildReportHtml({
    structure,
    scenariosDoc,
    runResults,
    jobId: JOB_ID,
    reportGeneratedAt,
  });
  fs.writeFileSync(path.join(outDir, "report.html"), html, "utf8");

  const dispatchSecret = process.env.DISPATCH_HMAC_SECRET;
  if (dispatchSecret) {
    const meta = createDispatchMeta(JOB_ID, dispatchSecret);
    fs.writeFileSync(path.join(outDir, "dispatch-meta.json"), JSON.stringify(meta, null, 2), "utf8");
  }

  console.log("Pipeline finished. Outputs in ./output");
  const failed = runResults.scenarios.filter((s) => !s.passed).length;
  if (failed > 0) {
    console.warn(`${failed} scenario(s) failed (non-zero exit for CI visibility).`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
