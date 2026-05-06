import fs from "fs";
import path from "path";

/**
 * `web/Icon.svg` 를 리포트 산출 폴더에 복사해 `report.html` 과 같은 디렉터리에서 `./Icon.svg` 로 제공합니다.
 * @param {string} outDir
 * @param {string} [cwd] 기본 `process.cwd()` — `packages/core` 에서 실행한다고 가정
 */
export function copyWebIconToOutput(outDir, cwd = process.cwd()) {
  const iconSrc = path.join(cwd, "..", "..", "web", "Icon.svg");
  if (!fs.existsSync(iconSrc)) return false;
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(iconSrc, path.join(outDir, "Icon.svg"));
  return true;
}
