// 輸出地標零件預算（給 Blender 減面流程用；與遊戲同一份資料 landmarkSlots.ts）
import { LANDMARK_SLOTS } from "../src/maps/junkyard/landmarkSlots.ts";
const out: Record<string, { hqTris: number; liteTris: number; hqTex: number; liteTex: number; size: { w: number; h: number; d: number } }> = {};
for (const s of LANDMARK_SLOTS) for (const p of s.parts) out[p.stem] = { hqTris: p.hqTris, liteTris: p.liteTris, hqTex: p.hqTex, liteTex: p.liteTex, size: p.size };
process.stdout.write(JSON.stringify(out, null, 2));
