/**
 * Stage 5.4：男／女初心者角色（GLB，共用骨架）— 純邏輯，不依賴 Babylon，可單元測試。
 * 模型由 art/novice-v1/build_novice.py（Blender）產生，放在 public/models/。
 */

export type NoviceGender = "male" | "female";
export type NoviceLod = "high" | "low";
export const NOVICE_VERSION = "v1";

/** 動畫（GLB 內的 animation 名稱） */
export const NOVICE_ANIMS = ["Idle", "Walk", "Run", "Attack", "Hurt", "Death"] as const;
export type NoviceAnim = (typeof NOVICE_ANIMS)[number];

/** 循環播放的動畫；其他播一次（攻擊、受傷播完回待機；死亡停在最後一格） */
export const NOVICE_LOOPING: Readonly<Record<NoviceAnim, boolean>> = Object.freeze({ Idle: true, Walk: true, Run: true, Attack: false, Hurt: false, Death: false });

/** 動畫長度（秒）；與建模腳本一致（攻擊 0.50 秒、0.20 秒揮中 = 遊戲的 ATTACK_TIMING） */
export const NOVICE_ANIM_SECONDS: Readonly<Record<NoviceAnim, number>> = Object.freeze({ Idle: 2.4, Walk: 0.9, Run: 0.56, Attack: 0.5, Hurt: 0.45, Death: 1.3 });

/** 共用骨架（兩個角色完全相同；名稱、階層） */
export const NOVICE_BONES = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "upperarm_l",
  "lowerarm_l",
  "hand_l",
  "thigh_l",
  "shin_l",
  "foot_l",
  "upperarm_r",
  "lowerarm_r",
  "hand_r",
  "thigh_r",
  "shin_r",
  "foot_r",
] as const;

/** 表情圖集（4 欄 × 2 列）；臉部貼片的 UV 對準第 0 格 */
export const NOVICE_EXPRESSIONS = ["smile", "happy", "surprised", "serious", "hurt", "ko", "blink", "spare"] as const;
export type NoviceExpression = (typeof NOVICE_EXPRESSIONS)[number];
export const NOVICE_ATLAS = Object.freeze({ cols: 4, rows: 2, cellU: 0.25, cellV: 0.5 });

export const EXPRESSION_LABEL: Readonly<Record<NoviceExpression, string>> = Object.freeze({
  smile: "微笑",
  happy: "開心",
  surprised: "驚訝",
  serious: "認真",
  hurt: "受傷",
  ko: "倒下",
  blink: "閉眼",
  spare: "微笑2",
});

export const ANIM_LABEL: Readonly<Record<NoviceAnim, string>> = Object.freeze({ Idle: "待機", Walk: "走路", Run: "跑步", Attack: "攻擊", Hurt: "受傷", Death: "死亡" });

/** 動畫預設表情（依設定圖：待機微笑、戰鬥認真、受傷、倒下） */
export function expressionForAnim(a: NoviceAnim): NoviceExpression {
  switch (a) {
    case "Attack":
      return "serious";
    case "Hurt":
      return "hurt";
    case "Death":
      return "ko";
    case "Run":
      return "serious";
    default:
      return "smile";
  }
}

export function noviceFile(g: NoviceGender, lod: NoviceLod): string {
  return `novice_${g}_${NOVICE_VERSION}_${lod}.glb`;
}

/** GLB 根節點（骨架物件）名稱 */
export function noviceRootName(g: NoviceGender): string {
  return g === "male" ? "NoviceMale" : "NoviceFemale";
}

/** 第 index 格的 UV 平移量（glTF／Babylon UV：v 往下） */
export function atlasOffset(index: number): { du: number; dv: number } {
  const col = index % NOVICE_ATLAS.cols;
  const row = Math.floor(index / NOVICE_ATLAS.cols) % NOVICE_ATLAS.rows;
  return { du: col * NOVICE_ATLAS.cellU, dv: row * NOVICE_ATLAS.cellV };
}

export interface NoviceBenchOptions {
  enabled: boolean;
  /** 角色數（男女交替） */
  count: number;
  anim: NoviceAnim;
  lod: NoviceLod;
  seconds: number;
  warmup: number;
}

/** ?lab=novice&bench=1&count=10&anim=Run&lod=high&dur=20 */
export function noviceBenchFromSearch(search: string): NoviceBenchOptions {
  const p = new URLSearchParams(search);
  const num = (k: string, d: number, lo: number, hi: number): number => {
    const v = Number(p.get(k));
    return Number.isFinite(v) && p.has(k) ? Math.min(hi, Math.max(lo, v)) : d;
  };
  const a = (p.get("anim") ?? "Run").toLowerCase();
  const anim = NOVICE_ANIMS.find((x) => x.toLowerCase() === a) ?? "Run";
  return {
    enabled: p.get("bench") === "1",
    count: Math.round(num("count", 10, 1, 30)),
    anim,
    lod: p.get("lod") === "low" ? "low" : "high",
    seconds: num("dur", 20, 3, 120),
    warmup: num("warmup", 2, 0.5, 10),
  };
}

/** 效能測試的站位：count 個角色排成網格，彼此間隔 0.9 公尺，置中 */
export function benchLayout(count: number): { x: number; z: number }[] {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({ x: (c - (cols - 1) / 2) * 0.9, z: (r - (rows - 1) / 2) * 0.9 });
  }
  return out;
}
