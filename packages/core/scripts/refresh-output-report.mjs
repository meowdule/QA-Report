/**
 * output/report.html 을 output/*.json 기준으로 다시 씁니다.
 * 기존 report.html 은 output/versions/legacy/ 에 스냅샷·CSS 로 보관합니다.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildReportHtml } from "../src/report-html.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreRoot = path.join(__dirname, "..");
const outDir = path.join(coreRoot, "output");
const legacyDir = path.join(outDir, "versions", "legacy");
const stamp = "2026-05-06";

const reportPath = path.join(outDir, "report.html");

if (fs.existsSync(reportPath)) {
  fs.mkdirSync(legacyDir, { recursive: true });
  const oldHtml = fs.readFileSync(reportPath, "utf8");
  fs.writeFileSync(path.join(legacyDir, `report-full-${stamp}.html`), oldHtml, "utf8");
  const m = oldHtml.match(/<style>\s*([\s\S]*?)\s*<\/style>/);
  if (m) {
    fs.writeFileSync(path.join(legacyDir, `report-style-${stamp}-legacy.css`), m[1].trim() + "\n", "utf8");
  }
}

const structure = JSON.parse(fs.readFileSync(path.join(outDir, "structure.json"), "utf8"));
const scenariosDoc = JSON.parse(fs.readFileSync(path.join(outDir, "scenarios.draft.json"), "utf8"));
const runResults = JSON.parse(fs.readFileSync(path.join(outDir, "results.json"), "utf8"));

let lighthouseSummary;
const lhPath = path.join(outDir, "lighthouse-summary.json");
if (fs.existsSync(lhPath)) {
  lighthouseSummary = JSON.parse(fs.readFileSync(lhPath, "utf8"));
}

const html = buildReportHtml({
  structure,
  scenariosDoc,
  runResults,
  jobId: runResults.jobId || "local",
  reportGeneratedAt: new Date().toISOString(),
  lighthouseSummary,
});

fs.writeFileSync(reportPath, html, "utf8");
console.log("Wrote", reportPath);
if (fs.existsSync(path.join(legacyDir, `report-full-${stamp}.html`))) {
  console.log("Archived previous report + CSS to", legacyDir);
}
