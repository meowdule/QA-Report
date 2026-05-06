/**
 * 동일 사이트(same origin) 링크를 BFS 로 제한 크롤합니다.
 * 링크: a, area, 흔한 data-* 패턴. 각 페이지에서 클릭 후보(button, role 등)와
 * 폼 컨트롤(select 단일/다중, 라디오 그룹, 체크박스, 스위치·aria 토글, label[for])도 수집합니다.
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

  /** @type {Map<string, any>} */
  const pages = new Map();
  /** @type {{ url: string; depth: number; from: string | null }[]} */
  const queue = [{ url: normalizedStart, depth: 0, from: null }];
  const seen = new Set([normalizedStart]);

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (compatible; QA-Site-Core/1.0; +https://github.com/) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  });

  try {
    while (queue.length > 0 && pages.size < maxPages) {
      const { url, depth, from } = /** @type {{ url: string; depth: number; from: string | null }} */ (
        queue.shift()
      );
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
            linkClickMeta: {},
            outboundNav: [],
            forms: [],
            interactables: [],
            formControls: [],
            httpStatus: status,
            error: `HTTP ${status}`,
            crawlDepth: depth,
            parentUrl: from || undefined,
          });
          continue;
        }

        const title = (await page.title()) || "";
        const { links, linkClickMeta } = await collectSameOriginLinksWithMeta(page, origin);
        const outboundNav = await extractOutboundNav(page, origin);
        const forms = await detectForms(page);
        const interactables = await extractInteractables(page, origin);
        const formControls = await extractFormControls(page);

        pages.set(url, {
          url,
          title,
          links,
          linkClickMeta,
          outboundNav,
          forms,
          interactables,
          formControls,
          httpStatus: status,
          crawlDepth: depth,
          parentUrl: from || undefined,
        });

        if (depth >= maxDepth) continue;

        for (const link of links) {
          if (seen.has(link) || pages.size >= maxPages) continue;
          seen.add(link);
          queue.push({ url: link, depth: depth + 1, from: url });
        }
      } catch (err) {
        if (!pages.has(url)) {
          pages.set(url, {
            url,
            title: "",
            links: [],
            linkClickMeta: {},
            outboundNav: [],
            forms: [],
            interactables: [],
            formControls: [],
            httpStatus: 0,
            error: String(err?.message || err),
            crawlDepth: depth,
            parentUrl: from || undefined,
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
 * 구조 JSON·그래프용 URL 정규화 (해시 제거, 트레일링 슬래시 정리)
 * @param {string} href
 * @param {string} base
 */
export function normalizeStructureUrl(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = "";
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    u.pathname = path || "/";
    return u.href;
  } catch {
    return href;
  }
}

/**
 * 동일 출처 링크(BFS) + URL별 `target`/`rel` 메타(새 탭·noopener 등 추론)
 * @returns {{ links: string[]; linkClickMeta: Record<string, { target: string; opensNewTab: boolean; rel: string }> }}
 */
async function collectSameOriginLinksWithMeta(page, origin) {
  const pageBase = page.url();
  return page.evaluate(
    ({ pageOrigin, base }) => {
      const BINARY =
        /\.(pdf|zip|tar|gz|rar|7z|png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|eot|mp4|webm|mp3|wav|docx?|xlsx?)(\?|$)/i;
      function normHref(absUrl) {
        try {
          const u = new URL(absUrl);
          u.hash = "";
          let path = u.pathname;
          if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
          u.pathname = path || "/";
          return u.href;
        } catch {
          return absUrl;
        }
      }
      const nodes = [
        ...document.querySelectorAll(
          "a[href], area[href], [data-href], [data-url], [data-link], [data-to], [router-link][href]",
        ),
      ];
      const linkSet = new Set();
      /** @type {Record<string, { target: string; opensNewTab: boolean; rel: string }>} */
      const meta = {};
      const mergeMeta = (key, targetAttr, rel) => {
        const t = (targetAttr || "").trim();
        const tl = t.toLowerCase();
        const target = tl === "" ? "_self" : tl;
        const opensNewTab = target === "_blank" || target === "blank";
        if (!meta[key]) meta[key] = { target: "_self", opensNewTab: false, rel: rel || "" };
        if (opensNewTab) {
          meta[key].opensNewTab = true;
          meta[key].target = "_blank";
        }
        if (rel) {
          const cur = meta[key].rel;
          meta[key].rel = cur && !cur.includes(rel) ? `${cur} ${rel}` : cur || rel;
        }
      };
      for (const el of nodes) {
        const tag = el.tagName.toLowerCase();
        let h =
          el.getAttribute("href") ||
          el.getAttribute("data-href") ||
          el.getAttribute("data-url") ||
          el.getAttribute("data-link") ||
          el.getAttribute("data-to") ||
          "";
        if (tag === "area") h = el.getAttribute("href") || "";
        h = h.trim();
        if (!h) continue;
        let abs;
        try {
          abs = new URL(h, base);
        } catch {
          continue;
        }
        if (abs.origin !== pageOrigin) continue;
        if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
        abs.hash = "";
        if (BINARY.test(abs.pathname)) continue;
        const key = normHref(abs.href);
        linkSet.add(key);
        mergeMeta(key, el.getAttribute("target"), el.getAttribute("rel") || "");
      }
      return { links: [...linkSet], linkClickMeta: meta };
    },
    { pageOrigin: origin, base: pageBase },
  );
}

/**
 * 크롤 범위 밖 내비: 외부 https/http, mailto, tel, javascript: (통계·LLM·수동 시나리오용)
 * @param {import('playwright').Page} page
 * @param {string} origin
 */
async function extractOutboundNav(page, origin) {
  const pageBase = page.url();
  return page.evaluate(
    ({ pageOrigin, base }) => {
      const max = 28;
      /** @type {any[]} */
      const out = [];
      const seen = new Set();
      const push = (row) => {
        const k = `${row.category}|${row.url}`;
        if (seen.has(k) || out.length >= max) return;
        seen.add(k);
        out.push(row);
      };
      const visible = (el) => {
        if (!(el instanceof Element)) return false;
        const st = window.getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      };
      const siteOrigin = new URL(pageOrigin).origin;
      document.querySelectorAll("a[href]").forEach((a) => {
        if (!visible(a)) return;
        const h = (a.getAttribute("href") || "").trim();
        if (!h) return;
        let abs;
        try {
          abs = new URL(h, base);
        } catch {
          return;
        }
        abs.hash = "";
        const rawT = (a.getAttribute("target") || "").trim().toLowerCase();
        const target = rawT === "" ? "_self" : rawT;
        const opensNewTab = target === "_blank" || target === "blank";
        const rel = (a.getAttribute("rel") || "").trim();
        const download = a.hasAttribute("download");
        const label = (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (abs.protocol === "mailto:") {
          push({ category: "mailto", url: abs.href, label, target, opensNewTab, rel, download });
        } else if (abs.protocol === "tel:") {
          push({ category: "tel", url: abs.href, label, target, opensNewTab, rel, download });
        } else if (abs.protocol === "javascript:") {
          push({ category: "javascript", url: abs.href.slice(0, 160), label, target, opensNewTab, rel, download });
        } else if (
          (abs.protocol === "http:" || abs.protocol === "https:") &&
          abs.origin !== siteOrigin
        ) {
          push({
            category: "external_http",
            url: abs.href,
            label,
            target,
            opensNewTab,
            rel,
            download,
          });
        }
      });
      return out;
    },
    { pageOrigin: origin, base: pageBase },
  );
}

/**
 * 클릭·역할 기반 인터랙션 후보 (div에 onclick, button, role=button/link 등)
 * @param {import('playwright').Page} page
 * @param {string} origin
 */
async function extractInteractables(page, origin) {
  const base = page.url();
  return page.evaluate(
    ({ origin: pageOrigin, pageBase }) => {
      const maxItems = 28;
      /** @type {any[]} */
      const items = [];
      const seenSel = new Set();

      const push = (obj) => {
        if (!obj.selector && !obj.getByRole) return;
        const key = obj.selector || `${obj.getByRole}:${obj.name || ""}`;
        if (seenSel.has(key)) return;
        seenSel.add(key);
        items.push(obj);
      };

      function cssPath(el) {
        if (!(el instanceof Element)) return "";
        if (el.id) return `#${CSS.escape(el.id)}`;
        const parts = [];
        let e = el;
        for (let depth = 0; depth < 6 && e && e.nodeType === 1; depth++) {
          let sel = e.tagName.toLowerCase();
          const parent = e.parentElement;
          if (parent) {
            const sameTag = [...parent.children].filter((c) => c.tagName === e.tagName);
            if (sameTag.length > 1) {
              const idx = sameTag.indexOf(e) + 1;
              sel += `:nth-of-type(${idx})`;
            }
          }
          parts.unshift(sel);
          e = parent;
        }
        return parts.join(" > ");
      }

      const visible = (el) => {
        if (!(el instanceof Element)) return false;
        const st = window.getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      };

      const labelText = (el) => {
        const aria = el.getAttribute("aria-label");
        if (aria) return aria.trim().slice(0, 120);
        const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
        return txt.slice(0, 120);
      };

      document.querySelectorAll("a[href]").forEach((a) => {
        if (!visible(a)) return;
        let abs;
        try {
          abs = new URL(a.getAttribute("href") || "", pageBase);
        } catch {
          return;
        }
        if (abs.origin !== pageOrigin) return;
        abs.hash = "";
        const name = labelText(a);
        const rawT = (a.getAttribute("target") || "").trim().toLowerCase();
        const linkTarget = rawT === "" ? "_self" : rawT;
        const opensNewTab = linkTarget === "_blank" || linkTarget === "blank";
        push({
          kind: "anchor",
          selector: cssPath(a),
          href: abs.href,
          name: name || undefined,
          getByRole: "link",
          accessibleName: name || undefined,
          linkTarget,
          opensNewTab,
        });
      });

      document.querySelectorAll('button:not([disabled]):not([aria-disabled="true"])').forEach((btn) => {
        if (!visible(btn)) return;
        const t = (btn.getAttribute("type") || "").toLowerCase();
        if (t === "hidden") return;
        const name = labelText(btn);
        push({
          kind: "button",
          selector: cssPath(btn),
          name: name || undefined,
          getByRole: "button",
          accessibleName: name || undefined,
        });
      });

      document.querySelectorAll('[role="button"]:not([aria-disabled="true"])').forEach((el) => {
        if (el.tagName === "BUTTON") return;
        if (!visible(el)) return;
        const name = labelText(el);
        push({
          kind: "roleButton",
          selector: cssPath(el),
          name: name || undefined,
          getByRole: "button",
          accessibleName: name || undefined,
        });
      });

      document.querySelectorAll('[role="link"][href]').forEach((el) => {
        if (!visible(el)) return;
        let abs;
        try {
          abs = new URL(el.getAttribute("href") || "", pageBase);
        } catch {
          return;
        }
        if (abs.origin !== pageOrigin) return;
        abs.hash = "";
        const name = labelText(el);
        const rawT = (el.getAttribute("target") || "").trim().toLowerCase();
        const linkTarget = rawT === "" ? "_self" : rawT;
        const opensNewTab = linkTarget === "_blank" || linkTarget === "blank";
        push({
          kind: "roleLink",
          selector: cssPath(el),
          href: abs.href,
          name: name || undefined,
          getByRole: "link",
          accessibleName: name || undefined,
          linkTarget,
          opensNewTab,
        });
      });

      document.querySelectorAll("[onclick]").forEach((el) => {
        if (!visible(el)) return;
        if (["A", "BUTTON", "INPUT"].includes(el.tagName)) return;
        const oc = el.getAttribute("onclick") || "";
        if (!/\b(location|href|open|navigate|router|pushState)\b/i.test(oc)) return;
        const name = labelText(el);
        push({
          kind: "clickableDiv",
          selector: cssPath(el),
          name: name || "(onclick)",
          note: "onclick handler",
        });
      });

      document.querySelectorAll("input[type='submit']:not([disabled]), input[type='button']:not([disabled])").forEach((inp) => {
        if (!visible(inp)) return;
        const name = inp.getAttribute("value") || labelText(inp) || "submit";
        push({
          kind: "inputButton",
          selector: cssPath(inp),
          name,
          getByRole: "button",
          accessibleName: name,
        });
      });

      return items.slice(0, maxItems);
    },
    { origin, pageBase: base },
  );
}

/**
 * 폼 컨트롤: select(단일/다중), 라디오 그룹, 체크박스, 스위치·aria 토글.
 * selectionMode: single | multi | group-single | boolean
 * @param {import('playwright').Page} page
 */
async function extractFormControls(page) {
  return page.evaluate(() => {
    const maxControls = 28;

    function cssPath(el) {
      if (!(el instanceof Element)) return "";
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts = [];
      let e = el;
      for (let depth = 0; depth < 6 && e && e.nodeType === 1; depth++) {
        let sel = e.tagName.toLowerCase();
        const parent = e.parentElement;
        if (parent) {
          const sameTag = [...parent.children].filter((c) => c.tagName === e.tagName);
          if (sameTag.length > 1) {
            const idx = sameTag.indexOf(e) + 1;
            sel += `:nth-of-type(${idx})`;
          }
        }
        parts.unshift(sel);
        e = parent;
      }
      return parts.join(" > ");
    }

    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    };

    const labelForControl = (el) => {
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) {
          const t = (lab.textContent || "").replace(/\s+/g, " ").trim();
          if (t) return { text: t.slice(0, 220), forId: el.id };
        }
      }
      const wrap = el.closest("label");
      if (wrap) {
        const clone = wrap.cloneNode(true);
        const rm = clone.querySelector("input, select, textarea, button");
        if (rm) rm.remove();
        const t = (clone.textContent || "").replace(/\s+/g, " ").trim();
        if (t) return { text: t.slice(0, 220), forId: null };
      }
      const aria = el.getAttribute("aria-label");
      if (aria) return { text: aria.trim().slice(0, 220), forId: null };
      const al = el.getAttribute("aria-labelledby");
      if (al) {
        const ids = al.split(/\s+/).filter(Boolean);
        let acc = "";
        for (const lid of ids) {
          const le = document.getElementById(lid);
          if (le) acc += (le.textContent || "") + " ";
        }
        const t = acc.replace(/\s+/g, " ").trim();
        if (t) return { text: t.slice(0, 220), forId: null };
      }
      return { text: "", forId: null };
    };

    /** @type {any[]} */
    const out = [];
    const push = (o) => {
      if (out.length >= maxControls) return;
      out.push(o);
    };

    document.querySelectorAll("select").forEach((sel) => {
      if (!visible(sel)) return;
      const multiple = sel.hasAttribute("multiple");
      const optEls = [...sel.querySelectorAll("option")];
      if (optEls.length < 2) return;
      const options = optEls.map((o, index) => {
        const og = o.parentElement && o.parentElement.tagName === "OPTGROUP" ? o.parentElement : null;
        return {
          value: o.value,
          label: (o.textContent || "").replace(/\s+/g, " ").trim(),
          selected: o.selected,
          index,
          disabled: o.disabled,
          optgroupLabel: og ? (og.getAttribute("label") || "").trim() || null : null,
        };
      });
      const lb = labelForControl(sel);
      push({
        kind: "select",
        selectionMode: multiple ? "multi" : "single",
        selector: cssPath(sel),
        name: sel.getAttribute("name") || undefined,
        id: sel.id || undefined,
        multiple,
        disabled: sel.disabled,
        label: lb.text || undefined,
        labelForId: lb.forId || undefined,
        options,
      });
    });

    const radios = [...document.querySelectorAll('input[type="radio"]')].filter(
      (r) => visible(r) && !r.disabled,
    );
    const radioByName = new Map();
    for (const r of radios) {
      const nm = r.getAttribute("name") ?? "";
      const key = nm === "" ? `__noname_${radioByName.size}` : nm;
      if (!radioByName.has(key)) radioByName.set(key, []);
      radioByName.get(key).push(r);
    }
    for (const [, group] of radioByName) {
      if (group.length < 2) continue;
      const options = group.map((r) => {
        const lb = labelForControl(r);
        return {
          selector: cssPath(r),
          value: r.value,
          label: lb.text || r.value || "",
          checked: r.checked,
        };
      });
      const nm = group[0].getAttribute("name") || undefined;
      push({
        kind: "radioGroup",
        selectionMode: "group-single",
        name: nm,
        options,
      });
    }

    [...document.querySelectorAll('input[type="checkbox"]')].forEach((cb) => {
      if (!visible(cb) || cb.disabled) return;
      const role = (cb.getAttribute("role") || "").toLowerCase();
      if (role === "switch") return;
      const lb = labelForControl(cb);
      push({
        kind: "checkbox",
        selectionMode: "multi",
        selector: cssPath(cb),
        name: cb.getAttribute("name") || undefined,
        id: cb.id || undefined,
        checked: cb.checked,
        label: lb.text || undefined,
        labelForId: lb.forId || undefined,
      });
    });

    document.querySelectorAll('[role="switch"]').forEach((el) => {
      if (!visible(el) || el.getAttribute("aria-disabled") === "true") return;
      if (el.disabled) return;
      const lb = labelForControl(el);
      push({
        kind: "switch",
        selectionMode: "boolean",
        selector: cssPath(el),
        ariaChecked: el.getAttribute("aria-checked"),
        label: lb.text || undefined,
      });
    });

    document.querySelectorAll("button[aria-checked], [role='button'][aria-checked]").forEach((el) => {
      if (!visible(el) || el.getAttribute("aria-disabled") === "true") return;
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (role === "switch") return;
      const lb = labelForControl(el);
      push({
        kind: "ariaToggle",
        selectionMode: "boolean",
        selector: cssPath(el),
        ariaChecked: el.getAttribute("aria-checked"),
        label: lb.text || undefined,
      });
    });

    return out;
  });
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
