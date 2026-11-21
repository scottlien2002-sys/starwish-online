/**
 * Stage 5.4 C1.0-B：男女初心者（靜態美術初步驗收版）實機整合測試 — 純邏輯，不依賴 Babylon，可單元測試。
 * 模型：art-novice-c10b 分支（CI Blender 產出）複製到 public/models/novice_c10b_<g>_<hq|lite>.glb。
 * 尚未綁骨架、沒有動畫（靜態模型）。
 */
export type C10bGender = "male" | "female";
export type C10bLod = "hq" | "lite";

export function c10bFile(g: C10bGender, lod: C10bLod): string {
  return `novice_c10b_${g}_${lod}.glb`;
}

/** 建置時的參考值（art-novice-c10b 320df1fb 的 c10b_report.json／glTF Validator） */
export const C10B_REFERENCE = Object.freeze({
  male: { hq: { triangles: 199961, bytes: 5242260, meshes: 32 }, lite: { triangles: 40393, bytes: 1336172, meshes: 32 } },
  female: { hq: { triangles: 199957, bytes: 5196104, meshes: 31 }, lite: { triangles: 39980, bytes: 1298492, meshes: 31 } },
  materials: 26,
});

export type C10bView = "front" | "left45" | "side" | "back" | "low" | "lowBack" | "head" | "skirt" | "free";

/** 鏡頭（ArcRotateCamera）：alpha、beta、radius、注視高度 y。從正面看（+Z）= alpha π/2 */
export const C10B_VIEWS: Readonly<Record<Exclude<C10bView, "free">, { alpha: number; beta: number; radius: number; y: number; label: string }>> = Object.freeze({
  front: { alpha: Math.PI / 2, beta: 1.42, radius: 3.0, y: 0.6, label: "正面" },
  left45: { alpha: Math.PI / 4, beta: 1.42, radius: 3.0, y: 0.6, label: "45 度" },
  side: { alpha: 0, beta: 1.42, radius: 3.0, y: 0.6, label: "側面" },
  back: { alpha: -Math.PI / 2, beta: 1.42, radius: 3.0, y: 0.6, label: "背面" },
  // 低角度：鏡頭在腰下、由下往上看裙內（鏡頭高度約 0.1 公尺，不穿到地面以下）
  low: { alpha: Math.PI / 2, beta: 1.74, radius: 1.55, y: 0.36, label: "低角度正面" },
  lowBack: { alpha: -Math.PI / 2, beta: 1.74, radius: 1.55, y: 0.36, label: "低角度背面" },
  head: { alpha: Math.PI / 2, beta: 1.5, radius: 1.35, y: 0.9, label: "頭部" },
  skirt: { alpha: Math.PI / 3, beta: 1.5, radius: 1.45, y: 0.32, label: "裙裝" },
});

export interface C10bOptions {
  lod: C10bLod;
  /** 角色數（男女交替；2 = 男女各 1） */
  count: number;
  /** 自動效能測試秒數（0 = 不自動） */
  bench: number;
  warmup: number;
  /** 視角 */
  view: Exclude<C10bView, "free">;
}

/** ?lab=c10b&lod=lite&count=10&bench=30&view=low */
export function c10bOptionsFromSearch(search: string): C10bOptions {
  const p = new URLSearchParams(search);
  const num = (k: string, d: number, lo: number, hi: number): number => {
    const v = Number(p.get(k));
    return p.has(k) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  };
  const v = p.get("view") ?? "front";
  return {
    lod: p.get("lod") === "lite" ? "lite" : "hq",
    count: Math.round(num("count", 2, 1, 20)),
    bench: num("bench", 0, 0, 600),
    warmup: num("warmup", 2, 0, 10),
    view: (v in C10B_VIEWS ? v : "front") as Exclude<C10bView, "free">,
  };
}

/** count 個角色排一排（男女交替、間隔 0.9 公尺），2 個時男左女右（從正面看） */
export function c10bLayout(count: number): { gender: C10bGender; x: number; z: number }[] {
  if (count <= 2) return [{ gender: "male", x: 0.45, z: 0 }, ...(count === 2 ? [{ gender: "female" as const, x: -0.45, z: 0 }] : [])];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return Array.from({ length: count }, (_, i) => ({
    gender: i % 2 === 0 ? "male" : "female",
    x: -((i % cols) - (cols - 1) / 2) * 0.9,
    z: (Math.floor(i / cols) - (rows - 1) / 2) * 0.9,
  }));
}

/** 長時間測試：每 windowSec 秒一段的平均 FPS（看是否因發熱降頻而下滑） */
export function windowAverages(dts: readonly number[], windowSec: number): number[] {
  const out: number[] = [];
  let t = 0;
  let n = 0;
  for (const dt of dts) {
    t += dt;
    n++;
    if (t >= windowSec) {
      out.push(n / t);
      t = 0;
      n = 0;
    }
  }
  if (n > 0 && t > windowSec * 0.5) out.push(n / t);
  return out;
}

/** 超過 limitMs 的影格數（卡頓） */
export function countHitches(dts: readonly number[], limitMs = 100): number {
  return dts.reduce((s, dt) => s + (dt * 1000 > limitMs ? 1 : 0), 0);
}
