import type { MonsterAssetSpec } from "../assets/spec.ts";

/**
 * 星露啵啵 V3.7 的資源規範（使用共用規範 src/monsters/assets/spec.ts）。
 * 表情順序與 V3 起相同：一般、開心、好奇、生氣、害怕、暈眩、昏睡、受傷。
 */
export const BOBO_V37_SPEC: MonsterAssetSpec = {
  monsterId: "star_dew_bobo",
  assetId: "bobo",
  pascalName: "StarDewBobo",
  version: "v37",
  family: "jelly",
  tier: "normal",
  heightM: 0.8,
  footprintRadiusM: 0.5,
  requiredParts: ["Body_", "Eyes", "Mouth", "Blush", "Stars"],
  expressions: {
    names: ["normal", "happy", "curious", "angry", "scared", "dizzy", "sleepy", "hurt"],
    parts: [
      // 眼睛貼圖 4×2 格（每格 0.25 × 0.5）；嘴巴在表情貼圖上半部 4×2 格（每格 0.25 × 0.25）
      { mesh: "Eyes", cols: 4, rows: 2, cellU: 0.25, cellV: 0.5 },
      { mesh: "Mouth", cols: 4, rows: 2, cellU: 0.25, cellV: 0.25 },
    ],
  },
  features: { jelly: true, nebula: true, wings: true, bellyStarInShader: true, headStar: true },
};
