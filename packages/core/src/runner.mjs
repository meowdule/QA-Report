import fs from "fs";
import path from "path";
import { summarizeCriteria } from "./schema.mjs";

/**
 * @param {import('playwright').Browser} browser
 * @param {any} scenariosDoc
 * @param {{ outDir: string; traceMode?: "failure" | "all" | "off" }} [opts]
 */
export async function runScenarios(browser, scenariosDoc, opts = {}) {
  const { outDir, traceMode = "failure" } = opts;
  if (!outDir) throw new Error("runScenarios: outDir is required");

  const startedAt = new Date().toISOString();
  /** @type {any[]} */
  const scenarioResults = [];

  for (const sc of scenariosDoc.scenarios) {
    const result = await runOneScenario(browser, sc, { outDir, traceMode });
    scenarioResults.push(result);
  }

  return {
    version: 2,
    jobId: process.env.JOB_ID || "local",
    targetUrl: scenariosDoc.targetUrl,
    traceMode,
    startedAt,
    finishedAt: new Date().toISOString(),
    criteriaSummary: summarizeCriteria(scenarioResults),
    scenarios: scenarioResults,
  };
}

/**
 * @param {import('playwright').Browser} browser
 * @param {any} sc
 * @param {{ outDir: string; traceMode: "failure" | "all" | "off" }} opt
 */
async function runOneScenario(browser, sc, opt) {
  const { outDir, traceMode } = opt;
  const traceDir = path.join(outDir, "traces");
  const shotDir = path.join(outDir, "screenshots");
  const idSafe = safeFileId(sc.id);
  const tracePath = path.join(traceDir, `${idSafe}.zip`);

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (compatible; QA-Site-Core/1.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  });

  const shouldTrace = traceMode !== "off";

  if (shouldTrace) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  }

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  const onConsole = (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ type: "console", text: msg.text(), location: msg.location() });
    }
  };
  const onPageError = (err) => {
    pageErrors.push({ type: "pageerror", text: String(err) });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  const t0 = Date.now();
  /** @type {any[]} */
  const stepResults = [];
  let scenarioFailed = false;

  /** @type {{ trace?: string; screenshot?: string }} */
  const artifacts = {};

  try {
    for (const step of sc.steps) {
      const sr = await runStep(page, step, { consoleErrors, pageErrors });
      stepResults.push(sr);
      if (!sr.ok) {
        scenarioFailed = true;
        break;
      }
    }
  } catch (e) {
    scenarioFailed = true;
    stepResults.push({
      type: "fatal",
      ok: false,
      error: String(e?.message || e),
    });
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);

    if (scenarioFailed) {
      try {
        await fs.promises.mkdir(shotDir, { recursive: true });
        const rel = `screenshots/${idSafe}.png`;
        const abs = path.join(outDir, rel);
        await page.screenshot({ path: abs, fullPage: true });
        artifacts.screenshot = rel;
      } catch {
        /* ignore screenshot errors */
      }
    }

    try {
      if (shouldTrace) {
        await fs.promises.mkdir(traceDir, { recursive: true });
        if (traceMode === "all" || scenarioFailed) {
          await context.tracing.stop({ path: tracePath });
          artifacts.trace = `traces/${idSafe}.zip`;
        } else {
          await context.tracing.stop();
        }
      }
    } catch {
      /* ignore trace stop errors */
    }

    await context.close();
  }

  const mergedConsole = [...consoleErrors, ...pageErrors];

  return {
    id: sc.id,
    name: sc.name,
    criteria: sc.criteria,
    passed: !scenarioFailed,
    durationMs: Date.now() - t0,
    steps: stepResults,
    consoleErrors: mergedConsole,
    artifacts,
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {any} step
 * @param {{ consoleErrors: any[]; pageErrors: any[] }} buckets
 */
async function runStep(page, step, buckets) {
  switch (step.type) {
    case "navigate": {
      try {
        const res = await page.goto(step.url, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        const ok = !!(res && res.ok());
        return {
          type: step.type,
          url: step.url,
          finalUrl: page.url(),
          status: res?.status(),
          ok,
          error: ok ? undefined : `HTTP ${res?.status()}`,
        };
      } catch (e) {
        return { type: step.type, url: step.url, ok: false, error: String(e?.message || e) };
      }
    }
    case "assertVisible": {
      try {
        await page.waitForSelector(step.selector, { state: "visible", timeout: 15_000 });
        return { type: step.type, selector: step.selector, ok: true };
      } catch (e) {
        return { type: step.type, selector: step.selector, ok: false, error: String(e?.message || e) };
      }
    }
    case "click": {
      try {
        if (step.href) {
          await clickLinkByResolvedHref(page, step.href);
        } else if (step.selector) {
          await page.click(step.selector, { timeout: 10_000 });
        } else {
          return { type: step.type, ok: false, error: "Missing href or selector" };
        }
        return { type: step.type, href: step.href, selector: step.selector, ok: true, finalUrl: page.url() };
      } catch (e) {
        if (step.fallbackSelector) {
          try {
            await page.locator(step.fallbackSelector).first().click({ timeout: 10_000 });
            return {
              type: step.type,
              href: step.href,
              ok: true,
              note: "used fallbackSelector",
              finalUrl: page.url(),
            };
          } catch (e2) {
            return { type: step.type, ok: false, error: String(e2?.message || e2) };
          }
        }
        return { type: step.type, ok: false, error: String(e?.message || e) };
      }
    }
    case "fill": {
      try {
        const loc = page.locator(step.selector).first();
        await loc.waitFor({ state: "visible", timeout: 12_000 });
        await loc.fill(step.value ?? "", { timeout: 8_000 });
        return { type: step.type, selector: step.selector, ok: true };
      } catch (e) {
        return { type: step.type, selector: step.selector, ok: false, error: String(e?.message || e) };
      }
    }
    case "waitForResponse": {
      const timeout = step.timeout ?? 30_000;
      const urlPattern = step.urlPattern;
      const method = step.method ? String(step.method).toUpperCase() : null;
      try {
        const response = await page.waitForResponse(
          (res) => {
            if (method && res.request().method() !== method) return false;
            const u = res.url();
            if (urlPattern == null || urlPattern === "") return true;
            return u.includes(String(urlPattern));
          },
          { timeout },
        );
        return {
          type: step.type,
          ok: true,
          status: response.status(),
          url: response.url(),
          requestMethod: response.request().method(),
        };
      } catch (e) {
        const err = { type: step.type, ok: false, error: String(e?.message || e) };
        if (step.optional) {
          return { ...err, ok: true, skipped: true, note: `optional: ${err.error}` };
        }
        return err;
      }
    }
    case "assertNoConsoleError": {
      const all = [...buckets.consoleErrors, ...buckets.pageErrors];
      const ok = all.length === 0;
      return {
        type: step.type,
        ok,
        error: ok ? undefined : `${all.length} console/page errors`,
        details: ok ? undefined : all.slice(0, 40),
        consoleErrorCount: buckets.consoleErrors.length,
        pageErrorCount: buckets.pageErrors.length,
      };
    }
    default:
      return { type: step.type, ok: false, error: `Unknown step type: ${step.type}` };
  }
}

function safeFileId(id) {
  return String(id).replace(/[^a-z0-9-_]+/gi, "_").slice(0, 120) || "scenario";
}

/**
 * @param {import('playwright').Page} page
 * @param {string} targetHref
 */
async function clickLinkByResolvedHref(page, targetHref) {
  const want = new URL(targetHref).href;
  const count = await page.locator("a[href]").count();
  for (let i = 0; i < count; i++) {
    const a = page.locator("a[href]").nth(i);
    const h = await a.getAttribute("href");
    if (!h) continue;
    let abs;
    try {
      abs = new URL(h, page.url()).href;
    } catch {
      continue;
    }
    if (abs === want) {
      await a.click({ timeout: 12_000 });
      return;
    }
  }
  throw new Error(`No anchor resolved to ${want}`);
}
