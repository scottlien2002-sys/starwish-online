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
 * 目前完成：待機、移動、攻擊（皆已驗收）；受傷（hurt）。死亡之後再加入。
 */

/**
 * "down"：受傷時生命值已歸零 → 受傷播完後停住、不回待機，等死亡動畫接手（死亡動畫尚未製作）
 */
export type BoboAnimName = "none" | "idle" | "move" | "attack" | "hurt" | "down";
/** 預覽頁「動畫」按鈕輪流切換的項目（受傷另有按鈕手動觸發） */
export const BOBO_ANIMS: readonly BoboAnimName[] = ["none", "idle", "move", "attack"];
/** 可用網址或 setAnim 指定的全部動畫 */
export const BOBO_ANIMS_ALL: readonly BoboAnimName[] = ["none", "idle", "move", "attack", "hurt", "down"];
/** 只播一次、播完自動回到待機的動畫 */
export const ONE_SHOT: readonly BoboAnimName[] = ["attack", "hurt"];

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
  /** 離地高度（公尺；彈跳用，其他動畫為 0） */
  lift: number;
  /** 前後方向額外伸縮（攻擊往前彈擊時拉長；1 = 無）。左右寬 = 1/√(sy·sfwd)、前後 = 左右 × sfwd → 體積仍為 1 */
  sfwd: number;
  /** 沿朝向的位移（公尺；攻擊往前彈出再回來；不累積） */
  fwd: number;
}

export const REST_POSE: BoboPose = { sy: 1, sxz: 1, roll: 0, pitch: 0, swayX: 0, swayZ: 0, flap: 0, lift: 0, sfwd: 1, fwd: 0 };

/** 根節點三軸縮放（左右、上下、前後），體積 = 1 */
export function poseScale(p: BoboPose): [number, number, number] {
  const sx = 1 / Math.sqrt(p.sy * p.sfwd);
  return [sx, p.sy, sx * p.sfwd];
}

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
  return { sy, sxz, roll, pitch, swayX, swayZ, flap, lift: 0, sfwd: 1, fwd: 0 };
}

/** 關鍵格軌道（第一欄為時間，其餘為數值）：Catmull-Rom 斜率、兩端斜率 0 */
function track(keys: readonly (readonly number[])[], x: number, col: number): number {
  if (x <= keys[0]![0]!) return keys[0]![col]!;
  if (x >= keys[keys.length - 1]![0]!) return keys[keys.length - 1]![col]!;
  let i = 0;
  while (i < keys.length - 2 && x > keys[i + 1]![0]!) i++;
  const u0 = keys[i]![0]!;
  const u1 = keys[i + 1]![0]!;
  const v0 = keys[i]![col]!;
  const v1 = keys[i + 1]![col]!;
  const slope = (j: number): number => (j <= 0 || j >= keys.length - 1 ? 0 : (keys[j + 1]![col]! - keys[j - 1]![col]!) / (keys[j + 1]![0]! - keys[j - 1]![0]!));
  const h = u1 - u0;
  const s = (x - u0) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * slope(i) * h + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * slope(i + 1) * h;
}

// ---------------------------------------------------------------- 移動：果凍彈跳

/** 一次彈跳的時間（秒） */
export const HOP_PERIOD = 0.62;
/** 每次彈跳前進距離（公尺；角色高約 0.8 公尺） */
export const HOP_DISTANCE = 0.3;

/**
 * 彈跳關鍵格：u（0～1 一次彈跳）→ 高度縮放 sy、離地 lift（公尺）、前傾 pitch（正 = 往前）、觸角前後 swayZ（正 = 往前）
 * 0.00 站立 → 0.12 壓扁蓄力 → 0.20 起跳拉長 → 0.42 最高點 → 0.62 下落 → 0.70 落地壓縮 → 0.84 回彈 → 1.00 站立
 */
const HOP_KEYS: readonly [u: number, sy: number, lift: number, pitch: number, swayZ: number][] = [
  [0.0, 1.0, 0.0, 0.0, 0.0],
  [0.12, 0.88, 0.0, -0.04, 0.02],
  [0.2, 1.13, 0.03, 0.07, -0.05],
  [0.42, 1.04, 0.16, 0.03, -0.02],
  [0.62, 1.07, 0.05, -0.02, 0.03],
  [0.7, 0.84, 0.0, 0.06, 0.06],
  [0.84, 1.05, 0.0, -0.02, -0.02],
  [1.0, 1.0, 0.0, 0.0, 0.0],
];

function hermite(u: number, col: 1 | 2 | 3 | 4): number {
  const k = HOP_KEYS;
  let i = 0;
  while (i < k.length - 2 && u > k[i + 1]![0]) i++;
  const [u0, u1] = [k[i]![0], k[i + 1]![0]];
  const v0 = k[i]![col];
  const v1 = k[i + 1]![col];
  // 斜率：相鄰兩段平均（Catmull-Rom），兩端為 0 → 循環時銜接平順
  const slope = (j: number): number => {
    if (j <= 0 || j >= k.length - 1) return 0;
    return (k[j + 1]![col] - k[j - 1]![col]) / (k[j + 1]![0] - k[j - 1]![0]);
  };
  const h = u1 - u0;
  const s = (u - u0) / h;
  const m0 = slope(i) * h;
  const m1 = slope(i + 1) * h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * m1;
}

/** 空中權重（起跳到落地之間為 1，平滑過渡）：決定前進與翅膀快拍 */
export function hopAir(u: number): number {
  const a = Math.min(1, Math.max(0, (u - 0.16) / 0.08));
  const b = Math.min(1, Math.max(0, (0.72 - u) / 0.08));
  const w = Math.min(a, b);
  return w * w * (3 - 2 * w);
}

/** 一次彈跳中，到 u 為止已前進的比例（0～1；只在空中前進） */
export function hopProgress(u: number): number {
  const x = Math.min(1, Math.max(0, (u - 0.18) / 0.5));
  return x * x * (3 - 2 * x);
}

/** 移動：u 為一次彈跳中的位置（0～1） */
export function hopPose(u: number): BoboPose {
  u = ((u % 1) + 1) % 1;
  const sy = hermite(u, 1);
  const lift = Math.max(0, hermite(u, 2));
  const pitch = hermite(u, 3);
  const air = hopAir(u);
  // 觸角：慣性（起跳時往後、落地時往前甩）；翅膀：空中快速輕拍，地面幾乎不動
  const swayZ = hermite(u, 4) - pitch * 0.3;
  const flap = air * 0.3 * Math.sin(TAU * 3 * u) + (1 - air) * 0.04 * Math.sin(TAU * u);
  return { sy, sxz: 1 / Math.sqrt(sy), roll: 0, pitch, swayX: 0, swayZ, flap, lift, sfwd: 1, fwd: 0 };
}

// ---------------------------------------------------------------- 攻擊：果凍蓄力 → 向前彈擊 → 回彈

/** 攻擊全長（秒）；三階段：蓄力 0～0.34、出招 0.34～0.56、收招 0.56～0.95 */
export const ATTACK_DURATION = 0.95;
export const ATTACK_PHASES = { windup: [0, 0.34], strike: [0.34, 0.56], recover: [0.56, 0.95] } as const;
/** 命中時間點（出招最遠處；遊戲整合時在這一刻判定傷害） */
export const ATTACK_HIT_TIME = 0.5;

// [時間, sy, sfwd, fwd(公尺), lift(公尺), pitch(正 = 前傾), swayZ(觸角，正 = 往前), flap]
const ATTACK_KEYS: readonly (readonly number[])[] = [
  [0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  [0.14, 0.9, 0.96, -0.03, 0.0, -0.06, 0.03, 0.16], // 蓄力：往下壓、往後縮
  [0.34, 0.8, 0.93, -0.07, 0.0, -0.13, 0.065, 0.3], // 蓄力最深：最扁、後仰、翅膀張開
  [0.4, 0.9, 1.12, 0.03, 0.02, 0.06, -0.02, 0.15], // 放開：開始往前彈
  [0.48, 0.95, 1.22, 0.21, 0.05, 0.17, -0.09, -0.16], // 出招：往前拉長、前傾、離地一點（觸角往後甩）
  [0.56, 0.9, 0.88, 0.24, 0.015, 0.1, -0.03, -0.1], // 命中後：前端被壓扁
  [0.68, 1.06, 1.02, 0.15, 0.0, -0.04, 0.07, 0.1], // 收招：回彈、往後退（觸角往前甩）
  [0.82, 0.97, 1.0, 0.04, 0.0, 0.02, -0.02, 0.0],
  [0.95, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
];

export function attackPose(t: number): BoboPose {
  const k = ATTACK_KEYS;
  const sy = track(k, t, 1);
  const sfwd = track(k, t, 2);
  return {
    sy,
    sfwd,
    sxz: 1 / Math.sqrt(sy * sfwd),
    fwd: track(k, t, 3),
    lift: Math.max(0, track(k, t, 4)),
    pitch: track(k, t, 5),
    roll: 0,
    swayX: 0,
    swayZ: track(k, t, 6),
    flap: track(k, t, 7),
  };
}

// ---------------------------------------------------------------- 受傷：衝擊 → 後退 → 果凍回彈 → 恢復

/** 受傷全長（秒）；四階段：衝擊 0～0.15、後退 0.15～0.32、回彈 0.32～0.55、恢復 0.55～0.75 */
export const HURT_DURATION = 0.75;
export const HURT_PHASES = { impact: [0, 0.15], recoil: [0.15, 0.32], rebound: [0.32, 0.55], recover: [0.55, HURT_DURATION] } as const;
/** 受傷表情顯示到這個時間點，之後換回受傷前的表情 */
export const HURT_FACE_UNTIL = 0.6;
/** 受傷期間再次受擊：衝擊階段（前 0.15 秒）內忽略，之後從頭重播（每一擊都有反應，但不會抖動卡住） */
export const HURT_REHIT_LOCK = 0.15;

// [時間, sy, sfwd, fwd(公尺；負 = 往後退), lift, pitch(負 = 後仰), swayZ(觸角，正 = 往前), flap(正 = 翅膀張開), roll]
const HURT_KEYS: readonly (readonly number[])[] = [
  [0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  [0.06, 0.92, 0.9, -0.015, 0.0, -0.11, 0.05, 0.3, 0.0], // 衝擊：突然被正面壓縮
  [0.15, 0.88, 0.9, -0.035, 0.0, -0.175, 0.075, 0.38, 0.0], // 壓縮最大 12%、後仰 10°、觸角往前、翅膀張開
  [0.24, 0.92, 1.03, -0.065, 0.0, -0.12, 0.01, 0.05, 0.0], // 後退：果凍延遲變形（前後回彈）、觸角翅膀回擺
  [0.32, 0.95, 1.04, -0.08, 0.0, -0.07, -0.03, -0.1, 0.0], // 退到最遠 0.08 公尺
  [0.42, 1.04, 0.98, -0.075, 0.0, 0.03, 0.03, 0.06, 0.03], // 果凍回彈一次，小幅左右晃
  [0.5, 0.99, 1.0, -0.06, 0.0, 0.0, -0.015, -0.03, -0.02],
  [0.55, 1.0, 1.0, -0.05, 0.0, 0.01, 0.005, 0.0, 0.008],
  [0.66, 1.0, 1.0, -0.015, 0.0, 0.0, 0.0, 0.0, 0.0], // 恢復：回到原位
  [0.75, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
];

export function hurtPose(t: number): BoboPose {
  const k = HURT_KEYS;
  const sy = track(k, t, 1);
  const sfwd = track(k, t, 2);
  return {
    sy,
    sfwd,
    sxz: 1 / Math.sqrt(sy * sfwd),
    fwd: track(k, t, 3),
    lift: Math.max(0, track(k, t, 4)),
    pitch: track(k, t, 5),
    swayZ: track(k, t, 6),
    flap: track(k, t, 7),
    roll: track(k, t, 8),
    swayX: 0,
  };
}

export function poseAt(name: BoboAnimName, t: number, phase = 0): BoboPose {
  if (name === "idle") return idlePose(t, phase);
  if (name === "move") return hopPose(t / HOP_PERIOD + phase);
  if (name === "attack") return attackPose(Math.min(t, ATTACK_DURATION));
  if (name === "hurt") return hurtPose(Math.min(t, HURT_DURATION));
  return REST_POSE;
}

export function lerpPose(a: BoboPose, b: BoboPose, s: number): BoboPose {
  const m = (x: number, y: number): number => x + (y - x) * s;
  const sy = m(a.sy, b.sy);
  const sfwd = m(a.sfwd, b.sfwd);
  return {
    sy,
    sfwd,
    sxz: 1 / Math.sqrt(sy * sfwd),
    roll: m(a.roll, b.roll),
    pitch: m(a.pitch, b.pitch),
    swayX: m(a.swayX, b.swayX),
    swayZ: m(a.swayZ, b.swayZ),
    flap: m(a.flap, b.flap),
    lift: m(a.lift, b.lift),
    fwd: m(a.fwd, b.fwd),
  };
}

/**
 * 動畫播放器（每隻一個）：
 * - 切換動畫時用 0.3 秒交叉淡化，不會跳格
 * - 從「移動」切到其他動畫時，先把目前這一跳跳完、落地回彈後才切換 → 停止移動自然銜接待機
 * - 攻擊只播一次：淡入 0.12 秒（蓄力要立刻開始），播完自動淡回待機；播放中再按攻擊不會重來
 * - update 回傳這一幀的姿勢與前進距離（公尺；只有移動時大於 0）
 */
export class BoboAnimPlayer {
  current: BoboAnimName;
  private requested: BoboAnimName;
  private t = 0;
  private from: BoboPose | null = null;
  private fade = 1;
  private lastPose: BoboPose = REST_POSE;
  private readonly phase: number;
  static readonly FADE = 0.3;

  constructor(initial: BoboAnimName, phase = 0) {
    this.current = initial;
    this.requested = initial;
    this.phase = phase;
  }

  /** 待切換的動畫（正在等這一跳落地時與 current 不同） */
  get pending(): BoboAnimName {
    return this.requested;
  }

  /** 動畫已播放的時間（秒） */
  get time(): number {
    return this.t;
  }

  request(name: BoboAnimName): void {
    if (this.current === "attack" && name === "attack") return;
    if (this.current === "down") return; // 已倒下：只等死亡動畫
    this.requested = name;
    if (this.current !== "move" && this.current !== "attack" && this.current !== "hurt") this.switchNow();
  }

  /** 生命值歸零：受傷播完後不回待機，停在 "down" 等死亡動畫 */
  private lethal = false;

  /**
   * 受傷（一次性）：立刻打斷待機、移動、攻擊；記下受傷後要回去的動畫（移動中被打則回待機）。
   * 受傷期間再受擊：前 0.15 秒（衝擊階段）忽略，之後從頭重播。lethal = 生命值已歸零
   */
  hurt(lethal = false): void {
    if (this.current === "down") return;
    this.lethal = this.lethal || lethal;
    if (this.current === "hurt" && this.t < HURT_REHIT_LOCK) return;
    this.requested = "hurt";
    this.from = this.lastPose;
    this.fade = 0;
    this.fadeTime = 0.05; // 衝擊要立刻發生
    this.current = "hurt";
    this.t = 0;
  }

  private fadeTime = BoboAnimPlayer.FADE;

  private switchNow(): void {
    if (this.requested === this.current) return;
    this.from = this.lastPose;
    this.fade = 0;
    this.fadeTime = this.requested === "attack" ? 0.12 : BoboAnimPlayer.FADE;
    if (this.requested === "hurt") this.fadeTime = 0.05;
    this.current = this.requested;
    this.t = 0;
  }

  update(dt: number): { pose: BoboPose; travel: number } {
    let travel = 0;
    if (this.current === "move") {
      const u0 = this.t / HOP_PERIOD;
      const u1 = (this.t + dt) / HOP_PERIOD;
      // 前進：本幀在這一跳中的進度差（跨越一跳時分兩段計算）
      const f0 = u0 - Math.floor(u0);
      const crossed = Math.floor(u1) > Math.floor(u0);
      const f1 = crossed ? 1 : u1 - Math.floor(u1);
      travel = (hopProgress(f1) - hopProgress(f0)) * HOP_DISTANCE;
      this.t += dt;
      if (crossed && this.requested !== "move") {
        // 這一跳已落地回彈 → 切換（從站立姿勢淡入，所以 from 用 REST）
        this.lastPose = REST_POSE;
        this.switchNow();
      } else if (crossed) {
        travel += hopProgress(u1 - Math.floor(u1)) * HOP_DISTANCE;
      }
    } else if (this.current === "hurt") {
      this.t += dt;
      if (this.t >= HURT_DURATION) {
        // 播完：生命值歸零 → 停住等死亡；否則回待機（不回到受傷前的移動／攻擊）
        const next: BoboAnimName = this.lethal ? "down" : "idle";
        this.requested = next;
        this.lastPose = hurtPose(HURT_DURATION);
        this.switchNow();
        if (next === "down") this.fade = 1;
      }
    } else if (this.current === "attack") {
      this.t += dt;
      if (this.t >= ATTACK_DURATION) {
        // 收招結束 → 回到待機（若播放中已要求別的動畫，就接那個；停在攻擊則接待機）
        if (this.requested === "attack") this.requested = "idle";
        this.lastPose = attackPose(ATTACK_DURATION);
        this.switchNow();
      }
    } else {
      this.t += dt;
    }
    let pose = this.current === "move" ? hopPose(this.t / HOP_PERIOD) : poseAt(this.current, this.t, this.phase);
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / this.fadeTime);
      const s = this.fade * this.fade * (3 - 2 * this.fade);
      pose = lerpPose(this.from ?? REST_POSE, pose, s);
    }
    this.lastPose = pose;
    return { pose, travel };
  }
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
