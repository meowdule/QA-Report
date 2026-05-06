/**
 * structure.json 기준 내부(크롤 방문) URL · 외부(http 링크 수집) URL 목록
 * @param {any} structure
 */
export function internalOkPageUrls(structure) {
  const pages = structure?.pages || [];
  return pages
    .filter((p) => !p.error && p.httpStatus >= 200 && p.httpStatus < 400)
    .map((p) => p.url);
}

/**
 * @param {any} structure
 */
export function externalHttpUrlsSorted(structure) {
  const set = new Set();
  for (const p of structure?.pages || []) {
    for (const o of p.outboundNav || []) {
      if (o.category === "external_http" && o.url) {
        try {
          const u = new URL(o.url);
          u.hash = "";
          set.add(u.href);
        } catch {
          /* */
        }
      }
    }
  }
  return [...set].sort();
}
