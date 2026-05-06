import fs from "fs";
import path from "path";
import { normalizeStructureUrl } from "./crawl.mjs";
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
    const browserContext = page.context();
    for (const step of sc.steps) {
      const sr = await runStep(page, step, { consoleErrors, pageErrors }, browserContext);
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
 * @param {import('playwright').BrowserContext} browserContext
 */
async function runStep(page, step, buckets, browserContext) {
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
        const r = await performClick(page, browserContext, step);
        if (!r.ok) return { type: step.type, ok: false, error: r.error };
        return {
          type: step.type,
          href: step.href,
          selector: step.selector,
          getByRole: step.getByRole,
          ok: true,
          startUrl: r.startUrl,
          finalUrl: r.finalUrl,
          navigationMode: r.navigationMode,
          popupUrl: r.popupUrl,
          dialogs: r.dialogs?.length ? r.dialogs : undefined,
          popupClosed: r.popupClosed,
        };
      } catch (e) {
        if (step.fallbackSelector) {
          try {
            const r2 = await performClick(page, browserContext, {
              ...step,
              href: undefined,
              getByRole: undefined,
              selector: step.fallbackSelector,
            });
            if (!r2.ok) return { type: step.type, ok: false, error: String(r2.error) };
            return {
              type: step.type,
              href: step.href,
              ok: true,
              note: "used fallbackSelector",
              startUrl: r2.startUrl,
              finalUrl: r2.finalUrl,
              navigationMode: r2.navigationMode,
              popupUrl: r2.popupUrl,
              dialogs: r2.dialogs?.length ? r2.dialogs : undefined,
              popupClosed: r2.popupClosed,
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
    case "selectOption": {
      try {
        const loc = page.locator(step.selector).first();
        await loc.waitFor({ state: "attached", timeout: 12_000 });
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        if (step.values && Array.isArray(step.values) && step.values.length > 0) {
          await loc.selectOption(step.values.map((v) => String(v)));
        } else if (step.label != null && String(step.label) !== "") {
          await loc.selectOption({ label: String(step.label), exact: true });
        } else if (step.value != null && String(step.value) !== "") {
          await loc.selectOption(String(step.value));
        } else if (step.index != null && Number.isFinite(Number(step.index))) {
          await loc.selectOption({ index: Number(step.index) });
        } else {
          return {
            type: step.type,
            selector: step.selector,
            ok: false,
            error: "selectOption needs values[], label, value, or index",
          };
        }
        return { type: step.type, selector: step.selector, ok: true };
      } catch (e) {
        return { type: step.type, selector: step.selector, ok: false, error: String(e?.message || e) };
      }
    }
    case "check": {
      try {
        const loc = page.locator(step.selector).first();
        await loc.waitFor({ state: "attached", timeout: 12_000 });
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        const want = step.checked !== false;
        const control = step.control ? String(step.control) : "checkbox";
        if (want) {
          await loc.check({ timeout: 10_000 });
        } else if (control === "radio") {
          return {
            type: step.type,
            selector: step.selector,
            ok: false,
            error: "uncheck radio is not supported; pick another option in the group",
          };
        } else {
          await loc.uncheck({ timeout: 10_000 });
        }
        return {
          type: step.type,
          selector: step.selector,
          control,
          checked: want,
          ok: true,
        };
      } catch (e) {
        return { type: step.type, selector: step.selector, ok: false, error: String(e?.message || e) };
      }
    }
    case "waitForSelector": {
      const state = step.state === "attached" ? "attached" : "visible";
      const timeout = step.timeout ?? 15_000;
      try {
        await page.waitForSelector(step.selector, { state, timeout });
        return { type: step.type, selector: step.selector, state, ok: true };
      } catch (e) {
        const err = { type: step.type, selector: step.selector, ok: false, error: String(e?.message || e) };
        if (step.optional) {
          return { ...err, ok: true, skipped: true, note: `optional: ${err.error}` };
        }
        return err;
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

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 120);
}

function pageOrigin(u) {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} targetHref
 * @returns {Promise<import('playwright').Locator | null>}
 */
async function findLinkLocatorForHref(page, targetHref) {
  const base = page.url();
  const want = normalizeStructureUrl(targetHref, base);
  const selectors = ['a[href]', '[role="link"][href]'];
  for (const sel of selectors) {
    const count = await page.locator(sel).count();
    for (let i = 0; i < count; i++) {
      const el = page.locator(sel).nth(i);
      const h = await el.getAttribute("href");
      if (!h) continue;
      let abs;
      try {
        abs = normalizeStructureUrl(h, base);
      } catch {
        continue;
      }
      if (abs === want) return el;
    }
  }
  return null;
}

/**
 * 클릭 후 동작: 브라우저 다이얼로그(alert 등) 기록·dismiss, target=_blank 는 새 페이지 이벤트로 감지 후 닫음,
 * 동일 탭 전체 이동은 URL 비교로 구분(외부 사이트·mailto 등은 Playwright 맥락에 따라 다름).
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {any} step
 */
async function performClick(page, context, step) {
  const startUrl = page.url();
  /** @type {{ type: string; message: string }[]} */
  const dialogs = [];
  const onDialog = async (d) => {
    dialogs.push({ type: d.type(), message: d.message().slice(0, 800) });
    await d.dismiss().catch(() => {});
  };
  page.on("dialog", onDialog);

  let popup = /** @type {import('playwright').Page | null} */ (null);
  let popupUrl;
  let popupClosed = false;

  try {
    let expectPopup =
      step.opensNewTab === true ||
      step.target === "_blank" ||
      step.target === "blank";

    /** @type {import('playwright').Locator | null} */
    let loc = null;

    if (step.href) {
      loc = await findLinkLocatorForHref(page, step.href);
      if (!loc) return { ok: false, error: `No link resolved to ${step.href}` };
      const targetAttr = ((await loc.getAttribute("target")) || "").trim().toLowerCase();
      if (targetAttr === "_blank" || targetAttr === "blank") expectPopup = true;
    } else if (step.getByRole) {
      const role = step.getByRole;
      const nm = step.accessibleName || step.name;
      loc = nm
        ? page.getByRole(role, { name: new RegExp(escapeRe(String(nm)), "i") })
        : page.getByRole(role).first();
      const t = ((await loc.getAttribute("target").catch(() => null)) || "").trim().toLowerCase();
      if (t === "_blank" || t === "blank") expectPopup = true;
    } else if (step.selector) {
      loc = page.locator(step.selector).first();
      const tag = (await loc.evaluate((el) => el.tagName).catch(() => "")) || "";
      if (tag === "A" || tag === "AREA") {
        const t = ((await loc.getAttribute("target").catch(() => null)) || "").trim().toLowerCase();
        if (t === "_blank" || t === "blank") expectPopup = true;
      }
    } else {
      return { ok: false, error: "Missing href, getByRole, or selector" };
    }

    const popupTimeout = expectPopup ? 12_000 : step.detectPopupMs ?? 0;
    /** @type {Promise<import('playwright').Page | null>} */
    let popupPromise = Promise.resolve(null);
    if (popupTimeout > 0) {
      popupPromise = context.waitForEvent("page", { timeout: popupTimeout }).catch(() => null);
    }

    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: 12_000 });

    popup = await popupPromise;
    if (popup) {
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 12_000 }).catch(() => {});
      } catch {
        /* ignore */
      }
      popupUrl = popup.url();
      if (!step.keepPopupOpen) {
        await popup.close().catch(() => {});
        popupClosed = true;
      }
    } else {
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    }

    const finalUrl = page.url();
    let navigationMode = "same_tab_or_spa";
    if (popup) {
      navigationMode = "new_tab_or_popup";
    } else if (pageOrigin(finalUrl) !== pageOrigin(startUrl)) {
      navigationMode = "full_navigation_same_tab";
    } else if (finalUrl !== startUrl) {
      navigationMode = "same_origin_navigation";
    }

    return {
      ok: true,
      startUrl,
      finalUrl,
      navigationMode,
      popupUrl,
      dialogs,
      popupClosed: !!popupClosed,
    };
  } finally {
    page.off("dialog", onDialog);
  }
}
