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
 * 내부(크롤 정상 응답) URL 전부만 감사합니다. 외부 URL Lighthouse는 하지 않습니다.
 * Playwright는 이미 종료된 뒤, chrome-launcher + Lighthouse 전용 Chrome만 사용합니다.
 *
 * @param {{ structure: any; outDir: string }} p
 */
export async function runLighthouseBatch(p) {
  const { structure, outDir } = p;
  const lhDir = path.join(outDir, "lighthouse");
  fs.mkdirSync(lhDir, { recursive: true });

  const internal = internalOkPageUrls(structure);
  const external = externalHttpUrlsSorted(structure);
  const queue = [...internal];

  /** @type {any[]} */
  const items = [];

  if (queue.length === 0) {
    return {
      version: 1,
      skipped: false,
      scope: "internal_only",
      reason: "no_ok_internal_pages",
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
    for (let i = 0; i < queue.length; i++) {
      const url = queue[i];
      const slug = urlSlug(url);
      const baseName = `${slug}`;
      /** @type {any} */
      const row = {
        url,
        kind: "internal",
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
        const runnerResult = await lighthouse(
          url,
          {
            logLevel: "error",
            port: chrome.port,
            output: "html",
            onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
          },
          {
            extends: "lighthouse:default",
            settings: {
              formFactor: "desktop",
              screenEmulation: {
                mobile: false,
                width: 1350,
                height: 940,
                deviceScaleFactor: 1,
                disabled: false,
              },
            },
          },
        );
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
      console.log(`Lighthouse ${i + 1}/${queue.length} ${url.slice(0, 72)}${url.length > 72 ? "…" : ""}`);
    }
  } finally {
    await chrome.kill();
  }

  return {
    version: 1,
    skipped: false,
    scope: "internal_only",
    generatedAt: new Date().toISOString(),
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
    scope: "internal_only",
    reason: "lighthouse not run",
    generatedAt: new Date().toISOString(),
    internalUrls: internalOkPageUrls(structure),
    externalUrls: externalHttpUrlsSorted(structure),
    auditedUrls: [],
    items: [],
  };
}
