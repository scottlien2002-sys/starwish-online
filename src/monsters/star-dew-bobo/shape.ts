/**
 * 星露啵啵身體輪廓（純函式，可測試）。
 * 以球面參數 t（0 = 底部、1 = 頂端）描述：底部略平、中下最寬、頂端收成水滴尖。
 * 身高 1 單位（模型座標），實際大小由外部縮放。
 */
export const BODY_HEIGHT = 1.04;
/** V2：依設定圖「略微扁平」，寬高比約 1.29（V1.2 為 1.19） */
export const BODY_MAX_RADIUS = 0.67;

const TIP_HEIGHT = 0.05;

export function profileY(t: number): number {
  const sphereY = ((BODY_HEIGHT - TIP_HEIGHT) * (1 - Math.cos(Math.PI * t))) / 2;
  // 底部壓平：t < 0.25 時高度壓縮
  const flatten = t < 0.25 ? 0.55 + 0.45 * (t / 0.25) : 1;
  // 頂端微微拉尖，接上觸角（水滴感）；總高度仍為 BODY_HEIGHT
  const k = t > 0.7 ? (t - 0.7) / 0.3 : 0;
  const tip = TIP_HEIGHT * k * k * (3 - 2 * k);
  return sphereY * flatten + tip;
}

export function profileR(t: number): number {
  const s = Math.sin(Math.PI * t);
  // 下半部較飽滿（圓潤下盤），上半部收窄成水滴頂
  const fullness = t < 0.5 ? Math.pow(s, 0.7) : s;
  const taper = t < 0.5 ? 1 : 1 - 0.22 * Math.pow((t - 0.5) / 0.5, 1.3);
  return BODY_MAX_RADIUS * fullness * taper;
}

/** 五官與零件在身體表面的位置（高度 y、繞軸角 theta；模型與藍圖共用） */
export const FACE_LAYOUT = Object.freeze({
  eye: { y: 0.55, theta: 0.36 },
  blush: { y: 0.43, theta: 0.78 },
  mouth: { y: 0.4, theta: 0 },
  chestStar: { y: 0.2, theta: 0.22 },
  wing: { y: 0.4, theta: Math.PI * 0.55 },
});

/** 給定高度 y，求身體表面半徑（只看上半到頂端，用於臉部定位） */
export function radiusAtHeight(y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (profileY(mid) < y) lo = mid;
    else hi = mid;
  }
  return profileR((lo + hi) / 2);
}

/** 表面點與法線（theta：繞 y 軸，0 = 正前方 +z） */
export function surfacePoint(y: number, theta: number): { x: number; y: number; z: number; nx: number; ny: number; nz: number } {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (profileY(mid) < y) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  const r = profileR(t);
  const e = 1e-4;
  const dr = profileR(Math.min(1, t + e)) - profileR(Math.max(0, t - e));
  const dy = profileY(Math.min(1, t + e)) - profileY(Math.max(0, t - e));
  // 輪廓切線 (dr, dy) 的外法線為 (dy, -dr)
  const len = Math.hypot(dy, dr) || 1;
  const nr = dy / len;
  const ny = -dr / len;
  return {
    x: r * Math.sin(theta),
    y,
    z: r * Math.cos(theta),
    nx: nr * Math.sin(theta),
    ny,
    nz: nr * Math.cos(theta),
  };
}

/** 將「面向法線」轉成 Babylon 旋轉（pitch, yaw） */
export function normalToRotation(nx: number, ny: number, nz: number): { x: number; y: number } {
  return { x: -Math.asin(Math.max(-1, Math.min(1, ny))), y: Math.atan2(nx, nz) };
}

/**
 * 五官反向補償（V1.1）：身體伸縮時，五官位置仍貼著身體表面移動，
 * 但五官本身只承受 (1 - strength) 的變形，避免眼睛、嘴巴被壓扁。
 */
export function featureCounterScale(scaleXZ: number, scaleY: number, strength = 0.8): { x: number; y: number; z: number } {
  const sxz = Math.max(0.05, scaleXZ);
  const sy = Math.max(0.05, scaleY);
  return { x: Math.pow(sxz, -strength), y: Math.pow(sy, -strength), z: Math.pow(sxz, -strength) };
}

// ============================== V2 造型數據 ==============================

/**
 * 觸角彎曲方向：-1 = 角色自己的左側 = 正面觀看時在畫面右側（依設定圖三視圖與主圖）。
 * Babylon 座標：怪物面向 +z，角色自己的右側為 +x。
 */
export const ANTENNA_SIDE = -1;

/** 觸角中心線（未套用方向，x 為往側邊彎的量）：從頭頂直立升起 → 往側邊拱起 → 末端下垂 */
export const ANTENNA_POINTS: readonly (readonly [number, number, number])[] = Object.freeze([
  [0, 0, 0],
  [0, 0.12, 0],
  [0.02, 0.26, -0.01],
  [0.09, 0.38, 0],
  [0.2, 0.445, 0.03],
  [0.31, 0.43, 0.06],
  [0.385, 0.36, 0.08],
  [0.415, 0.28, 0.09],
]);

/** 頭頂星星懸掛位置（觸角末端下方） */
export const HEAD_STAR_POS = Object.freeze([0.425, 0.205, 0.1] as const);

/** 觸角粗細：根部粗（與身體融合）→ 快速收細 → 末端細 */
export function antennaRadius(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return 0.024 + 0.052 * Math.pow(1 - k, 3);
}

/**
 * 圓潤五角星輪廓：角度 a（弧度）→ 半徑。尖端 = outer、凹處 = inner，兩者之間平滑過渡（沒有銳角）。
 * a = PI/2 時為朝上的尖端。
 */
export function softStarRadius(a: number, outer: number, inner: number, points = 5, sharpness = 0.8): number {
  const t = 0.5 + 0.5 * Math.cos(points * (a - Math.PI / 2));
  return inner + (outer - inner) * Math.pow(t, sharpness);
}
