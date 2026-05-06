/**
 * Inline SVG icons (Heroicons / Lucide-style strokes, MIT-licensed patterns).
 * Used by static report (Node) and GitHub Pages SPA — single source, no emoji.
 */

/**
 * @param {string} paths inner SVG path/circle/line elements
 * @param {string} tone CSS suffix for .stat-ico-svg--{tone}
 */
function statWrap(paths, tone) {
  return `<span class="stat-ico-svg stat-ico-svg--${tone}" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></span>`;
}

/** @param {string} labelKo chip label from crawl insight */
export function statChipIconHtml(labelKo) {
  /** @type {Record<string, [string, string]>} */
  const m = {
    "정상 응답 페이지": [
      "success",
      '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 12 2 2 4-4"/>',
    ],
    "건너뛰거나 오류 페이지": [
      "warn",
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    ],
    "같은 사이트 안 링크(합계)": [
      "indigo",
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    ],
    "클릭·버튼 후보(합계)": [
      "slate",
      '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>',
    ],
    "클릭 후보가 있는 페이지": [
      "info",
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    ],
    "입력·목록·토글 등 폼 요소": [
      "violet",
      '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"/><path d="M8 12h8"/><path d="M8 16h8"/>',
    ],
    "한 개만 고르는 목록": ["sky", '<path d="m6 9 6 6 6-6"/>'],
    "여러 개 고르는 목록": [
      "teal",
      '<path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/><path d="M4 6h1v4"/><path d="M4 12h1v4"/>',
    ],
    "라디오 묶음": [
      "rose",
      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>',
    ],
    "체크박스": [
      "success",
      '<path d="M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.5"/><path d="m9 11 3 3L22 4"/>',
    ],
    "스위치·토글": [
      "purple",
      '<rect width="20" height="14" x="2" y="5" rx="7"/><path d="M16 12h.01"/>',
    ],
    "새 탭으로 열리는 링크": [
      "cyan",
      '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    ],
    "외부 사이트 링크(참고)": [
      "info",
      '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    ],
    "메일 링크": [
      "info",
      '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    ],
    "전화 링크": [
      "emerald",
      '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    ],
  };
  const row = m[labelKo];
  if (!row) {
    return statWrap(
      '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/>',
      "muted",
    );
  }
  return statWrap(row[1], row[0]);
}

/** 기준별 요약 섹션 제목 옆 차트 아이콘 */
export function iconChartBarHtml() {
  return `<span class="subh-ico-svg subh-ico-svg--analytics" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg></span>`;
}
