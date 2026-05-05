/**
 * 동일 사이트(same origin) 링크만 BFS 로 제한 크롤합니다.
 * @param {import('playwright').Browser} browser
 * @param {string} startUrl
 * @param {{ maxPages: number; maxDepth: number }} opts
 */
export async function crawlSite(browser, startUrl, opts) {
  const { maxPages, maxDepth } = opts;
  let start;
  try {
    start = new URL(startUrl);
  } catch {
    throw new Error(`Invalid TARGET_URL: ${startUrl}`);
  }

  const origin = start.origin;
  const normalizedStart = stripHash(start.href);

  /** @type {Map<string, { url: string; title: string; links: string[]; forms: { selector: string; types: string[] }[] }>} */
  const pages = new Map();
  const queue = [{ url: normalizedStart, depth: 0 }];
  const seen = new Set([normalizedStart]);

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (compatible; QA-Site-Core/1.0; +https://github.com/) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  });

  try {
    while (queue.length > 0 && pages.size < maxPages) {
      const { url, depth } = queue.shift();
      if (pages.has(url)) continue;

      const page = await context.newPage();
      try {
        const res = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        const status = res?.status() ?? 0;
        if (!res || !res.ok()) {
          pages.set(url, {
            url,
            title: "",
            links: [],
            forms: [],
            httpStatus: status,
            error: `HTTP ${status}`,
          });
          continue;
        }

        const title = (await page.title()) || "";
        const links = await extractSameOriginLinks(page, origin);
        const forms = await detectForms(page);

        pages.set(url, {
          url,
          title,
          links,
          forms,
          httpStatus: status,
        });

        if (depth >= maxDepth) continue;

        for (const link of links) {
          if (seen.has(link) || pages.size >= maxPages) continue;
          seen.add(link);
          queue.push({ url: link, depth: depth + 1 });
        }
      } catch (err) {
        if (!pages.has(url)) {
          pages.set(url, {
            url,
            title: "",
            links: [],
            forms: [],
            httpStatus: 0,
            error: String(err?.message || err),
          });
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  const pageList = [...pages.values()];
  const graph = {};
  for (const p of pageList) {
    graph[p.url] = p.links;
  }

  return {
    targetUrl: start.href,
    origin,
    crawledAt: new Date().toISOString(),
    limits: { maxPages, maxDepth },
    pages: pageList,
    graph,
  };
}

function stripHash(href) {
  try {
    const u = new URL(href);
    u.hash = "";
    return u.href;
  } catch {
    return href;
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} origin
 */
async function extractSameOriginLinks(page, origin) {
  const hrefs = await page.$$eval("a[href]", (anchors) =>
    anchors.map((a) => a.getAttribute("href") || "").filter(Boolean),
  );

  const base = page.url();
  const out = new Set();
  for (const h of hrefs) {
    let abs;
    try {
      abs = new URL(h, base);
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue;
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    abs.hash = "";
    // 스킵 바이너리·문서 흔한 확장자 (단순 휴리스틱)
    if (/\.(pdf|zip|tar|gz|rar|png|jpe?g|gif|webp|svg|ico|css|js|mjs|woff2?|ttf|mp4|webm)(\?|$)/i.test(abs.pathname)) {
      continue;
    }
    out.add(abs.href);
  }
  return [...out];
}

async function detectForms(page) {
  return page.$$eval("form", (forms) =>
    forms.map((form, i) => {
      const inputs = [...form.querySelectorAll("input:not([type='hidden'])")].map((input) =>
        (input.getAttribute("type") || "text").toLowerCase(),
      );
      const id = form.getAttribute("id");
      const selector = id ? `form#${CSS.escape(id)}` : `form:nth-of-type(${i + 1})`;
      return { selector, types: inputs };
    }),
  );
}
