import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeStructureUrl } from "../src/crawl.mjs";
import { copyWebIconToOutput } from "../src/copy-web-icon.mjs";
import { buildMaskedPack } from "../src/llm-enrich.mjs";
import { buildReportHtml } from "../src/report-html.mjs";
import { buildDraftScenarios } from "../src/scenarios.mjs";
import { STEP_TYPES, validateScenarioSteps } from "../src/schema.mjs";

const coreCwd = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("normalizeStructureUrl strips hash and trailing slash on path", () => {
  const base = "https://ex.com";
  assert.equal(normalizeStructureUrl("https://ex.com/a/", base), "https://ex.com/a");
  assert.equal(normalizeStructureUrl("https://ex.com/a#frag", base), "https://ex.com/a");
});

test("validateScenarioSteps accepts waitForSelector", () => {
  const doc = {
    scenarios: [
      {
        id: "t",
        criteria: ["core_action"],
        steps: [{ type: "waitForSelector", selector: "#x", optional: true }],
      },
    ],
  };
  assert.equal(validateScenarioSteps(doc).length, 0);
});

test("validateScenarioSteps rejects unknown step type", () => {
  const doc = {
    scenarios: [{ id: "t", criteria: [], steps: [{ type: "not_a_real_step" }] }],
  };
  assert.ok(validateScenarioSteps(doc).length > 0);
});

test("STEP_TYPES includes core step types", () => {
  for (const t of ["waitForSelector", "selectOption", "check", "click"]) {
    assert.ok(STEP_TYPES.includes(t), `missing ${t}`);
  }
});

test("buildDraftScenarios sets opensNewTab on link scenario from linkClickMeta", () => {
  const url = "https://ex.com/";
  const a = normalizeStructureUrl("https://ex.com/a", url);
  const b = normalizeStructureUrl("https://ex.com/b", url);
  const structure = {
    targetUrl: url,
    pages: [
      {
        url,
        title: "h",
        links: [a, b],
        linkClickMeta: { [b]: { target: "_blank", opensNewTab: true, rel: "noopener" } },
        forms: [],
        interactables: [],
        formControls: [],
        outboundNav: [],
        httpStatus: 200,
      },
    ],
  };
  const doc = buildDraftScenarios(structure);
  const linkScen = doc.scenarios.find((s) => s.id === "link-nav-1");
  assert.ok(linkScen, "link-nav-1 scenario");
  const click = linkScen.steps.find((s) => s.type === "click");
  assert.equal(click.opensNewTab, true);
  assert.equal(click.target, "_blank");
});

test("buildReportHtml includes favicon link", () => {
  const html = buildReportHtml({
    structure: { pages: [] },
    scenariosDoc: { scenarios: [] },
    runResults: {
      scenarios: [],
      criteriaSummary: {},
      finishedAt: new Date().toISOString(),
    },
    jobId: "test-job",
  });
  assert.match(html, /rel="icon"/);
  assert.match(html, /Icon\.svg/);
});

test("copyWebIconToOutput copies Icon.svg when repo web asset exists", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-core-"));
  const cwd = path.join(coreCwd);
  const iconSrc = path.join(cwd, "..", "..", "web", "Icon.svg");
  const ok = copyWebIconToOutput(tmp, cwd);
  if (fs.existsSync(iconSrc)) {
    assert.equal(ok, true);
    assert.ok(fs.existsSync(path.join(tmp, "Icon.svg")));
  } else {
    assert.equal(ok, false);
  }
});

test("buildMaskedPack masks email in page title", () => {
  const structure = {
    targetUrl: "https://x.com",
    origin: "https://x.com",
    pages: [
      {
        url: "https://x.com/",
        title: "Contact a@b.co",
        httpStatus: 200,
        links: [],
        outboundNav: [],
        interactables: [],
        formControls: [],
      },
    ],
  };
  const draft = { scenarios: [{ id: "a", name: "n", criteria: [], steps: [] }] };
  const pack = buildMaskedPack(structure, draft);
  const t = pack.pages[0].title;
  assert.ok(!t.includes("@"), `expected masked title, got ${t}`);
});
