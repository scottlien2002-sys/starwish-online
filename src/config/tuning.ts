/**
 * W1 操作手感參數（非核心規則，可自由調整）。
 * 距離單位：公尺；角度單位：弧度。
 */
export const TUNING = Object.freeze({
  world: {
    /** 地圖半寬：可走範圍為 [-halfSize, halfSize] */
    halfSize: 70,
    /** 邊界內縮，避免角色貼到柵欄 */
    edgePadding: 2,
    /** 出生點周圍保持平坦的半徑 */
    spawnFlatRadius: 9,
    seed: 20261115,
  },
  player: {
    /** 3.2 頭身暫代角色的總身高 */
    height: 1.25,
    headsTall: 3.2,
    moveSpeed: 5,
    /** 轉身速度（數值越大越快） */
    turnSharpness: 14,
  },
  camera: {
    distance: 9,
    minDistance: 5,
    maxDistance: 15,
    /** 俯角限制（ArcRotateCamera 的 beta，0 = 正上方） */
    minBeta: 0.55,
    maxBeta: 1.38,
    defaultBeta: 1.05,
    rotateSensitivity: 0.0065,
    pitchSensitivity: 0.005,
    pinchSensitivity: 0.02,
    followSharpness: 10,
    targetHeight: 0.85,
  },
  joystick: {
    radius: 56,
    deadZone: 0.12,
  },
  render: {
    /** 手機最高像素比（iPhone 為 3，限制以維持效能） */
    maxDevicePixelRatio: 2,
    shadowMapSize: 1024,
  },
});
