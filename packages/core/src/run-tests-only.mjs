/**
 * 기존 structure.json + 편집된 scenarios.final.json 만으로 테스트·리포트만 재실행합니다.
 * (크롤 생략)
 */
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { runScenarios } from "./runner.mjs";
import { buildReportHtml } from "./report-html.mjs";
import { CRITERIA, CRITERION_IDS, STEP_TYPES, validateScenarioSteps } from "./schema.mjs";
import { copyWebIconToOutput } from "./copy-web-icon.mjs";
import { createDispatchMeta } from "./dispatch-sign.mjs";
import { lighthouseSummaryFromStructureOnly } from "./lighthouse-batch.mjs";

const inputDir = path.join(process.cwd(), "input");
const outDir = path.join(process.cwd(), "output");
const JOB_ID = process.env.JOB_ID || "local";
const _t = process.env.TRACE_MODE;
const TRACE_MODE = _t === "all" || _t === "off" || _t === "failure" ? _t : "failure";

const structurePath = path.join(inputDir, "structure.json");
const finalPath = path.join(inputDir, "scenarios.final.json");
const draftBackupPath = path.join(inputDir, "scenarios.draft.json");
const lighthouseInputPath = path.join(inputDir, "lighthouse-summary.json");

if (!fs.existsSync(structurePath)) {
  console.error("Missing input/structure.json");
  process.exit(1);
}
if (!fs.existsSync(finalPath)) {
  console.error("Missing input/scenarios.final.json");
  process.exit(1);
}

const structure = JSON.parse(fs.readFileSync(structurePath, "utf8"));
/** @type {any} */
const scenariosDoc = JSON.parse(fs.readFileSync(finalPath, "utf8"));
if (!scenariosDoc.scenarios || !Array.isArray(scenariosDoc.scenarios)) {
  console.error("scenarios.final.json must contain a scenarios array");
  process.exit(1);
}
if (!scenariosDoc.targetUrl) {
  scenariosDoc.targetUrl = structure.targetUrl;
}

const issues = validateScenarioSteps(scenariosDoc);
if (issues.length) {
  console.warn("Scenario validation:", JSON.stringify(issues, null, 2));
}
if (process.env.STRICT_SCENARIO_VALIDATE === "1" && issues.length) {
  console.error("STRICT_SCENARIO_VALIDATE: failing due to invalid scenarios.");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(structurePath, path.join(outDir, "structure.json"));
fs.writeFileSync(path.join(outDir, "scenarios.final.json"), JSON.stringify(scenariosDoc, null, 2), "utf8");

if (fs.existsSync(draftBackupPath)) {
  fs.copyFileSync(draftBackupPath, path.join(outDir, "scenarios.draft.json"));
} else {
  fs.writeFileSync(path.join(outDir, "scenarios.draft.json"), JSON.stringify(scenariosDoc, null, 2), "utf8");
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

copyWebIconToOutput(outDir);

/** @type {any} */
let lighthouseSummary = lighthouseSummaryFromStructureOnly(structure);
if (fs.existsSync(lighthouseInputPath)) {
  lighthouseSummary = JSON.parse(fs.readFileSync(lighthouseInputPath, "utf8"));
}
fs.writeFileSync(path.join(outDir, "lighthouse-summary.json"), JSON.stringify(lighthouseSummary, null, 2), "utf8");

const lhInDir = path.join(inputDir, "lighthouse");
const lhOutDir = path.join(outDir, "lighthouse");
if (fs.existsSync(lhInDir) && fs.statSync(lhInDir).isDirectory()) {
  fs.mkdirSync(lhOutDir, { recursive: true });
  for (const f of fs.readdirSync(lhInDir)) {
    fs.copyFileSync(path.join(lhInDir, f), path.join(lhOutDir, f));
  }
}

console.log(`Run-tests-only job ${JOB_ID} · trace=${TRACE_MODE}`);

const browser = await chromium.launch({ headless: true });

try {
  const runResults = await runScenarios(browser, scenariosDoc, { outDir, traceMode: TRACE_MODE });
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(runResults, null, 2), "utf8");

  const reportGeneratedAt = new Date().toISOString();
  const html = buildReportHtml({
    structure,
    scenariosDoc,
    runResults,
    jobId: JOB_ID,
    reportGeneratedAt,
    lighthouseSummary,
  });
  fs.writeFileSync(path.join(outDir, "report.html"), html, "utf8");

  const dispatchSecret = process.env.DISPATCH_HMAC_SECRET;
  if (dispatchSecret) {
    const meta = createDispatchMeta(JOB_ID, dispatchSecret);
    fs.writeFileSync(path.join(outDir, "dispatch-meta.json"), JSON.stringify(meta, null, 2), "utf8");
  }

  console.log("Run-tests-only finished. Outputs in ./output");
  const failed = runResults.scenarios.filter((s) => !s.passed).length;
  if (failed > 0) {
    console.warn(`${failed} scenario(s) failed.`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
