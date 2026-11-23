/**
 * Stage 5.4 C1.0-B：男女初心者（靜態美術初步驗收版）實機整合測試 — 純邏輯，不依賴 Babylon，可單元測試。
 * 模型：art-novice-c10b 分支（CI Blender 產出）複製到 public/models/novice_c10b_<g>_<hq|lite>.glb。
 * 尚未綁骨架、沒有動畫（靜態模型）。
 */
export type C10bGender = "male" | "female";
export type C10bLod = "hq" | "lite";

/** 男生披風徽記版本：0 = C1.0-B 原版、1 = C1.0-B1（貼合修正）、2 = C1.0-B2（縮小到與女生徽記同尺寸，正式美術基準） */
export type C10bStar = 0 | 1 | 2;

export function c10bFile(g: C10bGender, lod: C10bLod, star: C10bStar | boolean = 0): string {
  // 只有男生有徽記修正版（其他零件與 C1.0-B 相同）；女生一律用 C1.0-B
  const v = star === true ? 1 : star === false ? 0 : star;
  if (g !== "male" || v === 0) return `novice_c10b_${g}_${lod}.glb`;
  return v === 2 ? `novice_c10b2_${g}_${lod}.glb` : `novice_c10b1_${g}_${lod}.glb`;
}

export function c10bStarLabel(star: C10bStar): string {
  return star === 2 ? "C1.0-B2（徽記縮小・正式基準）" : star === 1 ? "C1.0-B1（徽記修正）" : "C1.0-B";
}

/** 建置時的參考值（art-novice-c10b 320df1fb 的 c10b_report.json／glTF Validator） */
export const C10B_REFERENCE = Object.freeze({
  male: { hq: { triangles: 199961, bytes: 5242260, meshes: 32 }, lite: { triangles: 40393, bytes: 1336172, meshes: 32 } },
  female: { hq: { triangles: 199957, bytes: 5196104, meshes: 31 }, lite: { triangles: 39980, bytes: 1298492, meshes: 31 } },
  materials: 26,
});

export type C10bView = "front" | "left45" | "side" | "back" | "low" | "lowBack" | "head" | "skirt" | "emblem" | "emblemL45" | "emblemR45" | "femEmblem" | "femEmblemL45" | "femEmblemR45" | "free";

/** 鏡頭（ArcRotateCamera）：alpha、beta、radius、注視高度 y（從腳底起算）。從正面看（+Z）= alpha π/2 */
export const C10B_VIEWS: Readonly<Record<Exclude<C10bView, "free">, { alpha: number; beta: number; radius: number; y: number; label: string; x?: number; z?: number }>> = Object.freeze({
  front: { alpha: Math.PI / 2, beta: 1.42, radius: 3.0, y: 0.6, label: "正面" },
  left45: { alpha: Math.PI / 4, beta: 1.42, radius: 3.0, y: 0.6, label: "45 度" },
  side: { alpha: 0, beta: 1.42, radius: 3.0, y: 0.6, label: "側面" },
  back: { alpha: -Math.PI / 2, beta: 1.42, radius: 3.0, y: 0.6, label: "背面" },
  // 低角度：鏡頭在腳底下方約 7 公分、由下往上看裙內（拍攝時暫時隱藏地面與廣場地台，與 Blender 低角度檢查相同）
  low: { alpha: Math.PI / 2, beta: 1.85, radius: 1.55, y: 0.36, label: "低角度正面" },
  lowBack: { alpha: -Math.PI / 2, beta: 1.85, radius: 1.55, y: 0.36, label: "低角度背面" },
  head: { alpha: Math.PI / 2, beta: 1.5, radius: 1.35, y: 0.9, label: "頭部" },
  skirt: { alpha: Math.PI / 3, beta: 1.5, radius: 1.45, y: 0.32, label: "裙裝" },
  // 男生背後披風徽記特寫（男生站在 x = 0.45）
  // C1.0-B2：鏡頭對準徽記本身（背面在 -Z，男生披風徽記約 z = -0.2、女生外裙徽記約 z = -0.22），男女同距離 0.9 m → 畫面上大小可直接比較
  emblem: { alpha: -Math.PI / 2, beta: 1.45, radius: 0.9, y: 0.33, x: 0.45, z: -0.2, label: "披風徽記" },
  // 徽記左後、右後 45 度（角色左手邊在 -X）與女生外裙徽記（女生站在 x = -0.45）
  emblemL45: { alpha: (-3 * Math.PI) / 4, beta: 1.45, radius: 0.9, y: 0.33, x: 0.45, z: -0.2, label: "徽記左後45°" },
  emblemR45: { alpha: -Math.PI / 4, beta: 1.45, radius: 0.9, y: 0.33, x: 0.45, z: -0.2, label: "徽記右後45°" },
  femEmblem: { alpha: -Math.PI / 2, beta: 1.45, radius: 0.9, y: 0.33, x: -0.45, z: -0.22, label: "女徽記" },
  femEmblemL45: { alpha: (-3 * Math.PI) / 4, beta: 1.45, radius: 0.9, y: 0.33, x: -0.45, z: -0.22, label: "女徽記左後45°" },
  femEmblemR45: { alpha: -Math.PI / 4, beta: 1.45, radius: 0.9, y: 0.33, x: -0.45, z: -0.22, label: "女徽記右後45°" },
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
  /** P3-1 陰影診斷（只量成本，不是正式設定）：once = 陰影貼圖載入後只畫一次（?shadowrefresh=once） */
  shadowRefresh: "every" | "once";
  /** P3-1：陰影取樣對照（?shadowfilter=low|high|pcf；default = 正式 PCSS32 中品質） */
  shadowFilter: "default" | "low" | "high" | "pcf";
  /** P3-1：陰影貼圖解析度對照（?shadowmap=1024；null = 畫質預設 2048） */
  shadowMap: 1024 | 2048 | null;
  /** P3-1：載入後先停止繪製幾秒再開始（?rest=30，0～120） */
  rest: number;
  /** P3-1：測試期間鎖定畫布尺寸（?fixsize=1），Safari 工具列收放不改變渲染解析度 */
  fixSize: boolean;
  /** 男生披風徽記版本（?star=1 → C1.0-B1、?star=2 → C1.0-B2） */
  star: C10bStar;
  /** P3-2 優化組合（?p3=1）：陰影只在投影者或太陽改變時重畫、色調映射改在材質內＋畫布 MSAA 4x、沒有發光物件時暫停發光層 */
  p3: boolean;
  /** C1.0-B2 效能診斷 D2：固定解析度倍率（?res=1|1.25|1.5|2；null = 畫質預設，iPhone 高畫質為 2） */
  res: C10dRes | null;
  /** 第二輪診斷：?round=2 → 組別標 E0／E1／E2；第三輪 ?round=3 → F1／F2／F3 */
  round: 1 | 2 | 3;
  /** 第二輪 E2：?raf=1 → 不建立 3D，只量 requestAnimationFrame */
  raf: boolean;
}

/** C1.0-B2 效能診斷：可用的解析度倍率 */
export type C10dRes = 1 | 1.25 | 1.5 | 2;
const C10D_RES: readonly C10dRes[] = [1, 1.25, 1.5, 2];

/**
 * C1.0-B2 效能診斷組別（每組只改一個因素）：
 * D0 原始 HQ、D1 只降陰影取樣（shadowfilter=low）、D2 只降解析度（res=1.5）。
 * 同時改了兩個以上（或其他診斷開關）時標「混合」，報告會提醒不能直接比較。
 */
export function c10dGroup(o: Pick<C10bOptions, "res" | "shadowFilter" | "shadowMap" | "shadowRefresh" | "diag" | "gpuProbe"> & Partial<Pick<C10bOptions, "round" | "raf">>): string {
  if (o.round === 3) {
    // 第三輪：與 E0 只差一個因素 — F1 簡化材質、F2 解析度 1.0x、F3 只有男角色
    const d = o.diag.join(",");
    const shadowSame = o.shadowFilter === "default" && o.shadowMap === null && o.shadowRefresh === "every" && !o.gpuProbe;
    if (o.raf || !shadowSame) return "混合（第三輪）— 不只改一個因素，不能直接比較";
    if (o.res === null && d === "") return "F0 雙角色 HQ（同 E0）";
    if (o.res === null && d === "simplemat") return "F1 雙角色 簡化材質";
    if (o.res === 1 && d === "") return "F2 雙角色 解析度 1.0x";
    if (o.res === null && d === "nofemale") return "F3 只有男角色";
    return "混合（第三輪）— 不只改一個因素，不能直接比較";
  }
  if (o.round === 2) {
    // 第二輪：E0 雙角色（＋新量測）、E1 只隱藏角色、E2 不繪製 3D
    const others = o.res !== null || o.shadowFilter !== "default" || o.shadowMap !== null || o.shadowRefresh !== "every" || o.gpuProbe;
    if (o.raf) return "E2 不繪製 3D（只量畫面更新）";
    const d = o.diag.join(",");
    if (!others && d === "") return "E0 雙角色 HQ";
    if (!others && d === "nochars") return "E1 無角色（其餘場景相同）";
    return `混合（第二輪）— 不只改一個因素，不能直接比較`;
  }
  const changes: string[] = [];
  if (o.shadowFilter !== "default") changes.push(o.shadowFilter === "low" ? "D1 陰影取樣降低（PCSS 低）" : `陰影取樣 ${o.shadowFilter}`);
  if (o.res !== null) changes.push(o.res === 1.5 ? "D2 解析度降低（1.5x）" : `解析度 ${o.res}x`);
  if (o.shadowMap !== null) changes.push(`陰影貼圖 ${o.shadowMap}`);
  if (o.shadowRefresh !== "every") changes.push("陰影只畫一次");
  if (o.diag.length) changes.push(`診斷 ${o.diag.join(",")}`);
  if (o.gpuProbe) changes.push("GPU 探測");
  if (!changes.length) return "D0 原始 HQ";
  return changes.length === 1 ? changes[0]! : `混合（${changes.join("＋")}）— 不只改一個因素，不能直接與 D0 比較`;
}

/** 前 sec 秒與最後 sec 秒的 FPS（影格數 ÷ 實際秒數）與差距 */
export function firstLastFps(dts: readonly number[], sec = 30): { first: number; last: number; diff: number; diffPct: number } {
  const take = (arr: readonly number[]): number => {
    let t = 0;
    let n = 0;
    for (const dt of arr) {
      if (t >= sec) break;
      t += dt;
      n++;
    }
    return t > 0 ? n / t : 0;
  };
  const first = take(dts);
  const last = take([...dts].reverse());
  const diff = first - last;
  return { first: +first.toFixed(1), last: +last.toFixed(1), diff: +diff.toFixed(1), diffPct: first > 0 ? +((diff / first) * 100).toFixed(1) : 0 };
}

/** 第一次「5 秒平均」低於 limit FPS 的時間（秒，從量測開始算；從未低於 → null） */
export function firstBelow(timeline: readonly { t0: number; fps: number }[], limit = 45): number | null {
  const w = timeline.find((x) => x.fps < limit);
  return w ? w.t0 : null;
}

/** 冷卻時間判定（方案：每組之間 10 分鐘） */
export const C10D_COOLDOWN_SEC = 600;
export function cooldownText(sec: number | null): string {
  if (sec === null) return "沒有上一次測試紀錄（本瀏覽器第一次測試）";
  const m = Math.floor(sec / 60);
  const t = `${m} 分 ${Math.round(sec - m * 60)} 秒`;
  return sec < C10D_COOLDOWN_SEC ? `${t}　⚠ 冷卻不足（未滿 10 分鐘）` : `${t}（已滿 10 分鐘）`;
}

/** P3-2 優化內容（報告用） */
export const C10P_P3_ITEMS = Object.freeze([
  "陰影貼圖只在投影者移動／顯示改變、或太陽改變時重畫（支援之後角色與怪物移動；有骨架動畫的網格每格重畫）",
  "不使用半浮點 HDR 後製管線：色調映射、曝光、對比改在材質內計算（同一組 KHR PBR Neutral 設定），MSAA 4x 改由畫布原生提供",
  "沒有任何發光物件時暫停發光層（之後有星星、光環等發光物加入時自動開啟）",
]);

/** P3-1 陰影診斷代號（報告與畫面標題用） */
export function c10pShadowMode(o: Pick<C10bOptions, "diag" | "shadowRefresh" | "shadowFilter" | "shadowMap" | "gpuProbe">): string {
  const parts: string[] = [];
  if (o.diag.includes("noshadow")) parts.push("S1 關陰影");
  if (o.shadowRefresh === "once") parts.push("S2 陰影貼圖只畫一次");
  if (o.shadowFilter === "low") parts.push("S3a PCSS 低取樣");
  if (o.shadowFilter === "high") parts.push("S3b PCSS 高取樣");
  if (o.shadowFilter === "pcf") parts.push("S3c 一般 PCF");
  if (o.shadowMap === 1024) parts.push("S4 陰影貼圖 1024");
  if (!parts.length) parts.push(o.gpuProbe ? "S0 原始 HQ 陰影" : "S0n 原始 HQ 陰影（無 GPU 探測）");
  return parts.join("＋");
}

export type C10pDiag = "noshadow" | "noglow" | "nopost" | "nomsaa" | "nochars" | "simplemat" | "nofemale";
export const C10P_DIAG_LABEL: Readonly<Record<C10pDiag, string>> = Object.freeze({
  noshadow: "不畫陰影",
  noglow: "關發光層",
  nopost: "關 HDR 後製",
  nomsaa: "關 MSAA",
  nochars: "隱藏角色",
  simplemat: "角色簡化材質（診斷）",
  nofemale: "隱藏女角色",
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
    shadowRefresh: p.get("shadowrefresh") === "once" ? "once" : "every",
    shadowFilter: ((f) => (f === "low" || f === "high" || f === "pcf" ? f : "default"))(p.get("shadowfilter")),
    shadowMap: p.get("shadowmap") === "1024" ? 1024 : p.get("shadowmap") === "2048" ? 2048 : null,
    rest: Math.round(num("rest", 0, 0, 120)),
    fixSize: p.get("fixsize") === "1",
    star: p.get("star") === "2" ? 2 : p.get("star") === "1" ? 1 : 0,
    p3: p.get("p3") === "1",
    round: p.get("round") === "3" ? 3 : p.get("round") === "2" ? 2 : 1,
    raf: p.get("raf") === "1",
    res: ((r) => (C10D_RES as readonly number[]).includes(r) ? (r as C10dRes) : null)(Number(p.get("res") ?? NaN)),
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


// ---------- 第二輪效能診斷：獨立畫面更新時間（rAF 時間戳）與非阻塞 GPU 完成時間（WebGL2 fence）----------

/** 一個時間點的量測值（t = 從量測開始算的秒數） */
export interface TimedValue {
  t: number;
  v: number;
}

/** 間隔（毫秒）→ FPS 與分布 */
export function intervalStats(intervalsMs: readonly number[]): { fps: number; n: number; le20: number; le37: number; le54: number; gt54: number } {
  const total = intervalsMs.reduce((a, b) => a + b, 0);
  const h = frameHistogram(intervalsMs.map((x) => x / 1000));
  return { fps: total > 0 ? +((intervalsMs.length / total) * 1000).toFixed(1) : 0, n: intervalsMs.length, ...h };
}

/** 依時間切段（windowSec 秒），每段回傳該段的值 */
export function timeWindows<T>(points: readonly TimedValue[], windowSec: number, durationSec: number, f: (vs: number[]) => T): { t0: number; value: T | null }[] {
  const out: { t0: number; value: T | null }[] = [];
  for (let t0 = 0; t0 < durationSec - 1e-6; t0 += windowSec) {
    const vs = points.filter((p) => p.t >= t0 && p.t < t0 + windowSec).map((p) => p.v);
    out.push({ t0: Math.round(t0), value: vs.length ? f(vs) : null });
  }
  return out;
}

/** rAF 時間戳間隔 → 每段 FPS */
export const rafFps = (vs: number[]): number => intervalStats(vs).fps;

/** fence 完成延遲（毫秒）的平均與 95 百分位 */
export function latencyStats(vs: readonly number[]): { avg: number; p95: number; n: number } {
  if (!vs.length) return { avg: 0, p95: 0, n: 0 };
  const s = [...vs].sort((a, b) => a - b);
  return { avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1), p95: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!.toFixed(1), n: s.length };
}

/** fence 精度說明（報告用） */
export const FENCE_NOTE =
  "GPU 完成時間＝送出後放 WebGL2 fence，之後每次畫面更新時查詢（不等待、不阻塞）；只能在畫面更新時查到，精度約 1 格（約 16.7 ms），數值是「最晚何時已完成」的上限，不是 GPU 實際工作時間。";
