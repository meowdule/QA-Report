import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import lighthouse from "lighthouse";
import { launch as launchChrome } from "chrome-launcher";
import { chromium } from "playwright";
import { externalHttpUrlsSorted, internalOkPageUrls } from "./site-lists.mjs";

/** @param {string} url */
function urlSlug(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** @param {any} lhr */
function scoresFromLhr(lhr) {
  const c = lhr?.categories || {};
  /** @param {string} id */
  const pick = (id) => {
    const s = c[id]?.score;
    if (typeof s !== "number" || Number.isNaN(s)) return null;
    return Math.round(s * 100);
  };
  return {
    performance: pick("performance"),
    accessibility: pick("accessibility"),
    "best-practices": pick("best-practices"),
    seo: pick("seo"),
  };
}

/**
 * @param {{ structure: any; outDir: string }} p
 */
export async function runLighthouseBatch(p) {
  const { structure, outDir } = p;
  const lhDir = path.join(outDir, "lighthouse");
  fs.mkdirSync(lhDir, { recursive: true });

  const internal = internalOkPageUrls(structure);
  const external = externalHttpUrlsSorted(structure);

  const maxTotal = Math.min(80, Math.max(0, parseInt(process.env.LIGHTHOUSE_MAX || "8", 10)));
  const doExternal =
    process.env.LIGHTHOUSE_EXTERNAL === "1" || String(process.env.LIGHTHOUSE_EXTERNAL).toLowerCase() === "true";

  /** @type {string[]} */
  const queue = [];
  for (const u of internal) {
    if (queue.length >= maxTotal) break;
    queue.push(u);
  }
  if (doExternal) {
    for (const u of external) {
      if (queue.length >= maxTotal) break;
      if (!queue.includes(u)) queue.push(u);
    }
  }

  const internalSet = new Set(internal);

  /** @type {any[]} */
  const items = [];

  if (maxTotal === 0 || queue.length === 0) {
    return {
      version: 1,
      skipped: maxTotal === 0,
      reason: maxTotal === 0 ? "LIGHTHOUSE_MAX=0" : "no URLs",
      generatedAt: new Date().toISOString(),
      internalUrls: internal,
      externalUrls: external,
      auditedUrls: [],
      items,
    };
  }

  const chromePath = chromium.executablePath();
  const chrome = await launchChrome({
    chromePath,
    chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  try {
    for (const url of queue) {
      const slug = urlSlug(url);
      const kind = internalSet.has(url) ? "internal" : "external";
      const baseName = `${slug}`;
      /** @type {any} */
      const row = {
        url,
        kind,
        scores: {
          performance: null,
          accessibility: null,
          "best-practices": null,
          seo: null,
        },
        reportHtml: `lighthouse/${baseName}.html`,
        reportJson: `lighthouse/${baseName}.json`,
        error: null,
      };
      try {
        const runnerResult = await lighthouse(url, {
          logLevel: "error",
          port: chrome.port,
          output: "html",
          onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        });
        const lhr = runnerResult?.lhr;
        const htmlReport = runnerResult?.report;
        if (lhr) {
          row.scores = scoresFromLhr(lhr);
          fs.writeFileSync(path.join(lhDir, `${baseName}.json`), JSON.stringify(lhr), "utf8");
        }
        if (typeof htmlReport === "string") {
          fs.writeFileSync(path.join(lhDir, `${baseName}.html`), htmlReport, "utf8");
        }
      } catch (err) {
        row.error = err instanceof Error ? err.message : String(err);
      }
      items.push(row);
    }
  } finally {
    await chrome.kill();
  }

  return {
    version: 1,
    skipped: false,
    generatedAt: new Date().toISOString(),
    lighthouseMax: maxTotal,
    internalUrls: internal,
    externalUrls: external,
    auditedUrls: queue,
    items,
  };
}

/**
 * 집계 없이 URL 목록만 (SKIP_LIGHTHOUSE 등)
 * @param {any} structure
 */
export function lighthouseSummaryFromStructureOnly(structure) {
  return {
    version: 1,
    skipped: true,
    reason: "lighthouse not run",
    generatedAt: new Date().toISOString(),
    internalUrls: internalOkPageUrls(structure),
    externalUrls: externalHttpUrlsSorted(structure),
    auditedUrls: [],
    items: [],
  };
}
