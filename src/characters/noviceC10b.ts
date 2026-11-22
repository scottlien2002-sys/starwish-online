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

/** 鏡頭（ArcRotateCamera）：alpha、beta、radius、注視高度 y（從腳底起算）。從正面看（+Z）= alpha π/2 */
export const C10B_VIEWS: Readonly<Record<Exclude<C10bView, "free">, { alpha: number; beta: number; radius: number; y: number; label: string }>> = Object.freeze({
  front: { alpha: Math.PI / 2, beta: 1.42, radius: 3.0, y: 0.6, label: "正面" },
  left45: { alpha: Math.PI / 4, beta: 1.42, radius: 3.0, y: 0.6, label: "45 度" },
  side: { alpha: 0, beta: 1.42, radius: 3.0, y: 0.6, label: "側面" },
  back: { alpha: -Math.PI / 2, beta: 1.42, radius: 3.0, y: 0.6, label: "背面" },
  // 低角度：鏡頭在腳底下方約 7 公分、由下往上看裙內（拍攝時暫時隱藏地面與廣場地台，與 Blender 低角度檢查相同）
  low: { alpha: Math.PI / 2, beta: 1.85, radius: 1.55, y: 0.36, label: "低角度正面" },
  lowBack: { alpha: -Math.PI / 2, beta: 1.85, radius: 1.55, y: 0.36, label: "低角度背面" },
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
  /** C1.0-P 第一階段 P1：發光層只處理標記為發光的物件（?p1=1） */
  p1: boolean;
  /** C1.0-P 第一階段 P2：同模組、同材質設定的零件合併（?p2=1） */
  p2: boolean;
  /** P3 診斷開關（只用來量成本，不是優化方案）：?diag=noshadow,noglow,nopost,nomsaa,nochars */
  diag: C10pDiag[];
  /** P3 診斷：每 0.5 秒用 gl.finish() 量一次「CPU 提交＋GPU 完成」時間（?gpu=1） */
  gpuProbe: boolean;
}

export type C10pDiag = "noshadow" | "noglow" | "nopost" | "nomsaa" | "nochars";
export const C10P_DIAG_LABEL: Readonly<Record<C10pDiag, string>> = Object.freeze({
  noshadow: "不畫陰影",
  noglow: "關發光層",
  nopost: "關 HDR 後製",
  nomsaa: "關 MSAA",
  nochars: "隱藏角色",
});

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
    p1: p.get("p1") === "1",
    p2: p.get("p2") === "1",
    diag: (p.get("diag") ?? "").split(",").filter((d): d is C10pDiag => d in C10P_DIAG_LABEL),
    gpuProbe: p.get("gpu") === "1",
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

/** 低角度視角（需要暫時隱藏地面） */
export function isLowView(v: C10bView): boolean {
  return v === "low" || v === "lowBack";
}

/** 出生廣場的星形地台頂面比地形高 0.13 公尺（Meadow：廣場 0.04＋0.06、星形 +0.02＋0.07） */
export const PLAZA_TOP = 0.13;

/** A/B 組名（C1.0-P：每次只改一項） */
export function c10pAbLabel(o: Pick<C10bOptions, "p1" | "p2">): string {
  if (o.p1 && o.p2) return "A2（P1＋P2 材質合併）";
  if (o.p2) return "P2 單獨（未含 P1）";
  return o.p1 ? "A1（P1 發光層只處理發光物件）" : "A0（原始 C1.0-B）";
}

/**
 * P2 合併時的模組分類：不同模組永遠不合併，之後換髮型、換職業服裝、換手套靴子裝備時可以整組替換。
 *   face  臉（唯一有 UV 與貼圖的零件）
 *   body  身體皮膚（身體、手）
 *   hair  髮型（頭髮、馬尾、髮飾蝴蝶結）
 *   hands 手部裝備（手套、鉚釘、手套金環）
 *   feet  腳部裝備（靴子、靴底、靴帶、扣環、寶石）
 *   outfit 服裝（其他：上衣、背心、披風／外裙、腰帶、飾品）
 */
export type C10pSlot = "face" | "body" | "hair" | "hands" | "feet" | "outfit";

export function c10pSlot(partName: string): C10pSlot {
  const n = partName.replace(/^(male|female)\d+_/, "");
  if (n === "head") return "face";
  if (n === "body" || /^hand_[lr]$/.test(n)) return "body";
  if (/^(hair|ponytail|bow|bow_star)$/.test(n)) return "hair";
  if (/^(glove|rivet|glove_band)/.test(n)) return "hands";
  if (/^boot/.test(n)) return "feet";
  return "outfit";
}

/** 依（模組, 材質設定）分組；回傳每組的零件索引（保持原順序） */
export function c10pMergeGroups(parts: readonly { name: string; materialKey: string }[]): { slot: C10pSlot; materialKey: string; indices: number[] }[] {
  const map = new Map<string, { slot: C10pSlot; materialKey: string; indices: number[] }>();
  parts.forEach((p, i) => {
    const slot = c10pSlot(p.name);
    const k = `${slot}|${p.materialKey}`;
    if (!map.has(k)) map.set(k, { slot, materialKey: p.materialKey, indices: [] });
    map.get(k)!.indices.push(i);
  });
  return [...map.values()];
}

/** 影格時間分布（Safari 60 Hz：16.7／33.3／50 ms 量化），用來判斷 FPS 掉落是 GPU 變慢還是偶發卡頓 */
export function frameHistogram(dts: readonly number[]): { le20: number; le37: number; le54: number; gt54: number } {
  const h = { le20: 0, le37: 0, le54: 0, gt54: 0 };
  for (const dt of dts) {
    const ms = dt * 1000;
    if (ms <= 20) h.le20++;
    else if (ms <= 37) h.le37++;
    else if (ms <= 54) h.le54++;
    else h.gt54++;
  }
  return h;
}

/** 依 windowSec 秒切段的影格時間分布 */
export function windowHistograms(dts: readonly number[], windowSec: number): ReturnType<typeof frameHistogram>[] {
  const out: ReturnType<typeof frameHistogram>[] = [];
  let t = 0;
  let cur: number[] = [];
  for (const dt of dts) {
    t += dt;
    cur.push(dt);
    if (t >= windowSec) {
      out.push(frameHistogram(cur));
      t = 0;
      cur = [];
    }
  }
  if (cur.length && t > windowSec * 0.5) out.push(frameHistogram(cur));
  return out;
}

/** 物件是否標記為要發光（P1：只有 metadata.glow === true 的物件進發光層） */
export function wantsGlow(metadata: unknown): boolean {
  return !!metadata && typeof metadata === "object" && (metadata as { glow?: unknown }).glow === true;
}

export interface FrameSample {
  /** 與上一格的間隔（秒） */
  dt: number;
  /** scene.render() 的 JS（CPU 提交）時間（毫秒） */
  cpu: number;
  /** gl.finish() 量到的 CPU＋GPU 完成時間（毫秒）；沒量的格為 null */
  gpu: number | null;
}

export interface TimelineWindow {
  t0: number;
  fps: number;
  cpuAvg: number;
  cpuP95: number;
  gpuAvg: number | null;
  gpuN: number;
  le20: number;
  le37: number;
  le54: number;
  gt54: number;
}

/** P3 診斷：每 windowSec 秒一段的 FPS、CPU 時間、GPU 探測時間與 60 Hz 掉幀分布 */
export function frameTimeline(samples: readonly FrameSample[], windowSec: number): TimelineWindow[] {
  const out: TimelineWindow[] = [];
  let cur: FrameSample[] = [];
  let t = 0;
  let t0 = 0;
  const flush = (): void => {
    const span = cur.reduce((a, s) => a + s.dt, 0);
    const cpus = cur.map((s) => s.cpu).sort((a, b) => a - b);
    const gpus = cur.filter((s) => s.gpu !== null).map((s) => s.gpu!);
    const h = frameHistogram(cur.map((s) => s.dt));
    out.push({
      t0: Math.round(t0),
      fps: +(cur.length / span).toFixed(1),
      cpuAvg: +(cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(2),
      cpuP95: +cpus[Math.min(cpus.length - 1, Math.floor(cpus.length * 0.95))]!.toFixed(2),
      gpuAvg: gpus.length ? +(gpus.reduce((a, b) => a + b, 0) / gpus.length).toFixed(2) : null,
      gpuN: gpus.length,
      ...h,
    });
  };
  for (const s of samples) {
    cur.push(s);
    t += s.dt;
    if (t - t0 >= windowSec - 1e-6) {
      flush();
      t0 = t;
      cur = [];
    }
  }
  if (cur.length && t - t0 > windowSec * 0.5) flush();
  return out;
}
