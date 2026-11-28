// 輸出地標模型預算（給 tools/junkyard-lm/process.mjs；與遊戲同一份資料 landmarkSlots.ts）
import { MODELS } from "../src/maps/junkyard/landmarkSlots.ts";
const out: Record<string, { hqTris: number; liteTris: number; hqTex: number; liteTex: number; raw: string }> = {};
for (const m of Object.values(MODELS)) out[m.stem] = { hqTris: m.hqTris, liteTris: m.liteTris, hqTex: m.hqTex, liteTex: m.liteTex, raw: m.raw };
process.stdout.write(JSON.stringify(out, null, 2));
