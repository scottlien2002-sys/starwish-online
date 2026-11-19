/**
 * 星露啵啵 V3.8R 第四階段：動畫（純計算，不依賴 Babylon，方便測試）。
 *
 * 低成本做法（不增加 Draw Calls、不加網格或透明層）：
 * - 整隻的伸縮、搖擺：只改角色根節點的 scaling／rotation（CPU，每隻每幀幾個數字）
 *   伸縮維持體積（高 × 寬² ≈ 1），以接地點為支點 → 果凍「呼吸」不會浮空或陷入地面
 * - 觸角擺動、翅膀拍動：果凍材質的頂點著色器依高度／左右位置位移（只動觸角與翅膀，臉部不受影響）
 * - 頭頂星星：跟著觸角末端的位移一起移動（仍是真正的 3D 物件，不面向鏡頭）
 * - 眨眼：只換眼睛貼圖座標（和表情同一張貼圖），模型外型不變
 *
 * 目前完成：待機（idle）。移動、攻擊、受傷、死亡在待機驗收後依序加入。
 */

export type BoboAnimName = "none" | "idle";
export const BOBO_ANIMS: readonly BoboAnimName[] = ["none", "idle"];

/** 一幀的姿勢（全部是相對於靜止姿勢的變化量） */
export interface BoboPose {
  /** 高度方向縮放（1 = 原本） */
  sy: number;
  /** 水平方向縮放（維持體積：sxz = 1 / √sy） */
  sxz: number;
  /** 左右輕晃（弧度，以接地點為支點） */
  roll: number;
  /** 前後輕晃（弧度） */
  pitch: number;
  /** 觸角末端位移（模型單位；身體座標的 x、z） */
  swayX: number;
  swayZ: number;
  /** 翅膀拍動量（約為角度，弧度） */
  flap: number;
}

export const REST_POSE: BoboPose = { sy: 1, sxz: 1, roll: 0, pitch: 0, swayX: 0, swayZ: 0, flap: 0 };

/** 待機週期（秒）：一次慢慢的「呼吸」 */
export const IDLE_PERIOD = 2.6;

const TAU = Math.PI * 2;

/**
 * 待機：柔軟的果凍呼吸（主波＋小幅二次回彈）、很輕的左右晃、觸角比身體慢半拍地擺、翅膀小幅輕拍。
 * phase 讓同場多隻不同步（0～1）。
 */
export function idlePose(t: number, phase = 0): BoboPose {
  const w = TAU / IDLE_PERIOD;
  const p = phase * TAU;
  const a = w * t + p;
  // 主呼吸 ±3%，加一個兩倍頻、較小的回彈 → 像果凍而不是機械式脈動
  const sy = 1 + 0.03 * Math.sin(a) + 0.008 * Math.sin(2 * a + 0.6);
  const sxz = 1 / Math.sqrt(sy);
  // 很輕的晃動（約 ±1.2°、±0.6°），週期較長
  const roll = 0.021 * Math.sin(a * 0.5 + 0.3);
  const pitch = 0.01 * Math.sin(a * 0.5 + 1.9);
  // 觸角：比身體慢約 1 弧度（慣性），加一點不同頻率的小擺動（所有頻率都是半頻的整數倍 → 兩個週期完整循環、不跳動）
  const swayX = 0.035 * Math.sin(a - 1.1) + 0.01 * Math.sin(a * 1.5 + 0.4) - roll * 0.6;
  const swayZ = 0.022 * Math.sin(a * 0.5 - 0.4) - pitch * 0.6;
  // 翅膀：兩倍頻率輕拍
  const flap = 0.12 * Math.sin(2 * a + 0.9);
  return { sy, sxz, roll, pitch, swayX, swayZ, flap };
}

export function poseAt(name: BoboAnimName, t: number, phase = 0): BoboPose {
  return name === "idle" ? idlePose(t, phase) : REST_POSE;
}

/**
 * 觸角位移權重（和頂點著色器相同的公式，用來讓頭頂星星跟著觸角末端移動）。
 * y 為身體模型座標的高度（圓頂 0.99、小瓶口頂 1.075、觸角最高約 1.37）
 */
export function antennaWeight(y: number): number {
  const t = Math.min(1, Math.max(0, (y - 1.02) / (1.37 - 1.02)));
  const s = t * t * (3 - 2 * t);
  return s * s;
}

/** 眨眼計時：每 2.6～4.6 秒眨一次、閉眼 0.13 秒；用固定種子，結果可重現 */
export class BlinkTimer {
  private next: number;
  private closedUntil = -1;
  private time = 0;
  private seed: number;

  constructor(seed = 1) {
    this.seed = seed;
    this.next = 1.2 + this.rand() * 2;
  }

  private rand(): number {
    // 線性同餘，0～1
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  /** 前進 dt 秒，回傳現在是否閉眼 */
  update(dt: number): boolean {
    this.time += dt;
    if (this.time >= this.next) {
      this.closedUntil = this.time + 0.13;
      this.next = this.time + 2.6 + this.rand() * 2;
    }
    return this.time < this.closedUntil;
  }
}
