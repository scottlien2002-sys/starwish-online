// Stage 6.6：把截圖鏡頭 API（shotCam）加到指定版本的 VillagePage.ts（給「升級前」基準版本建置用；已有就不重複加入）
// 用法：node tools/art66/inject-shotcam.mjs <repo 根目錄>
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2] ?? ".";
const here = new URL(".", import.meta.url).pathname;
const page = join(root, "src/maps/village/VillagePage.ts");
let s = readFileSync(page, "utf8");
if (s.includes("shotCam(")) {
  console.log("shotCam already present");
  process.exit(0);
}
copyFileSync(join(here, "../../src/maps/village/shotCam.ts"), join(root, "src/maps/village/shotCam.ts"));
s = s.replace(/(\nimport [^\n]*\n)/, `$1import { shotCam, shotTargets } from "./shotCam.ts";\n`);
const anchor = "      view: (name: string) => this.view(name),\n";
if (!s.includes(anchor)) throw new Error("anchor not found");
s = s.replace(anchor, anchor + "      shotCam: (on: boolean, tx?: number, ty?: number, tz?: number, a?: number, b?: number, r?: number) => shotCam(this, on, tx, ty, tz, a, b, r),\n      shotTargets: () => shotTargets(this),\n");
writeFileSync(page, s);
console.log("shotCam injected");
