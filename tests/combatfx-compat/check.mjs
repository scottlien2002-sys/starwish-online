// Stage 8.5（Claude D）：多人戰鬥事件 → Claude C「CombatFx 正式接入模組」相容測試。
// 從指定的 C 版本（預設穩定備份 556fee8）取出 src/combat-vfx 到暫存資料夾（不改 C 的分支），然後：
//  1) 型別：C 的 CombatFx 可以直接當作 D 的 CombatFxPort 使用；C 的 SkillDef／ClipTiming 與伺服器使用的相同結構
//  2) 資料：伺服器使用的技能 id、動作片段、命中段 id、武器在 C 版本中都存在且一致
//   node tests/combatfx-compat/check.mjs [git-ref ...]   → test-results/combatfx-compat.json
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const refs = process.argv.slice(2).length ? process.argv.slice(2) : ["556fee88619418bdbe4813fc4db9f43a22afe5f6"];
const root = resolve(".");
const out = { checkedAt: new Date().toISOString(), versions: [] };
let failed = 0;
for (const ref of refs) {
  const sha = execFileSync("git", ["rev-parse", ref]).toString().trim();
  const dir = join(root, ".cvfx-compat", sha.slice(0, 7));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = execFileSync("git", ["archive", "--format=tar", sha, "src/combat-vfx", "src/core/rules.ts"], { maxBuffer: 1 << 28 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  const rel = (p) => "../../" + p;
  writeFileSync(
    join(dir, "compat.ts"),
    `import type { CombatFx } from "./src/combat-vfx/integration/index.ts";
import { SKILLS as C_SKILLS } from "./src/combat-vfx/integration/index.ts";
import type { SkillDef as CSkillDef, ClipTiming as CClip } from "./src/combat-vfx/integration/index.ts";
import type { CombatFxPort } from "${rel("src/net/mpCombatFxBridge.ts")}";
import type { SkillDef as DSkillDef } from "${rel("src/combat-vfx/core/skills.ts")}";
import type { ClipTiming as DClip } from "${rel("src/combat-vfx/core/timeline.ts")}";
import type { Vector3 } from "@babylonjs/core";
declare const fx: CombatFx;
// C 的 CombatFx 直接接到 D 的橋接
export const port: CombatFxPort<Vector3> = fx;
// 技能定義與動作時間：C 與伺服器使用的結構雙向相容
export const a: DSkillDef = C_SKILLS[0]!;
declare const ds: DSkillDef;
export const b: CSkillDef = ds;
declare const cc: CClip;
declare const dc: DClip;
export const c1: DClip = cc;
export const c2: CClip = dc;
`,
  );
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: rel("tsconfig.json"), include: ["compat.ts"] }));
  let types = "ok";
  try {
    execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", join(dir, "tsconfig.json")], { stdio: "pipe" });
  } catch (e) {
    types = (e.stdout?.toString() || e.message).slice(0, 4000);
  }
  // 資料比對（Node 直接載入 C 版本的 skills.ts）
  const cs = (await import(join(dir, "src/combat-vfx/core/skills.ts"))).SKILLS;
  const ds = (await import(join(root, "src/combat-vfx/core/skills.ts"))).SKILLS;
  const sig = (s) => ({ id: s.id, weapon: s.weapon, clip: s.clip, cooldown: s.cooldown, range: s.range, hits: s.events.filter((e) => e.kind === "hit" || e.kind === "projectile").map((e) => `${e.hit.id}:${e.hit.shape.type}:${e.hit.shape.radius}`) });
  const cMap = new Map(cs.map((s) => [s.id, sig(s)]));
  const diffs = [];
  for (const s of ds) {
    const c = cMap.get(s.id);
    if (!c) diffs.push({ id: s.id, issue: "C 版本沒有這個技能" });
    else if (JSON.stringify(c) !== JSON.stringify(sig(s))) diffs.push({ id: s.id, d: sig(s), c });
  }
  const extra = cs.filter((s) => !ds.some((d) => d.id === s.id)).map((s) => s.id);
  const ok = types === "ok" && diffs.length === 0;
  if (!ok && ref === refs[0]) failed++;
  out.versions.push({ ref, sha, types, skillDiffs: diffs, cOnlySkills: extra, ok });
  console.log(`${ok ? "PASS" : "DIFF"} ${sha.slice(0, 7)} 型別 ${types === "ok" ? "相容" : "不相容"}、技能差異 ${diffs.length}、C 新增 ${extra.length}`);
}
mkdirSync("test-results", { recursive: true });
writeFileSync("test-results/combatfx-compat.json", JSON.stringify(out, null, 2));
// 第一個版本（穩定備份）必須相容；之後的版本（C 仍在更新）只記錄差異
process.exit(failed ? 1 : 0);
