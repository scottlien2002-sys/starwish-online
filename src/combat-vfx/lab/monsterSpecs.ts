/**
 * 戰鬥展示頁用的骨骼動畫怪物規格。
 * M004 直接用 Claude A 的 riggedSpec；M005～M007 的數值與 Claude A 在 feature/render-stage72-world 登記的完全相同
 * （此分支的基準版本還沒有這三筆，所以在展示頁內各自宣告，不修改 Claude A 的檔案）。
 */
import { M004_WINDFEATHER_FOX, type RigClipKey, type RiggedMonsterSpec } from "../../monsters/rigged/riggedSpec.ts";

const STD_CLIPS: Record<RigClipKey, string> = { idle: "Idle", move: "Move", run: "Run", attack: "Attack", hurt: "Hurt", death: "Death", respawn: "Respawn" };

// M005～M007：數值全部取自 Claude C 的交付報告與整合說明（2026-11-27）。GLB 根節點 extras 有值時以 GLB 為準。
const RIG_COMMON = { fades: { normal: 0.15, locomotion: 0.12, urgent: 0.05 }, deathHold: 1.2, deathFade: 0.6 } as const;

/** M002 苔角獸 Rig V1.0（Lv.3～4，四足被動；26 關節；碰撞半徑依地圖文件 0.6 m；Claude C 2026-11-27 Stage 2 交付） */
export const M002_MOSS_HORN_BEAST: RiggedMonsterSpec = Object.freeze({
  modelId: "m002_moss_horn_beast_v10",
  monsterId: "moss_horn_beast",
  label: "M002 苔角獸 Rig V1.0",
  files: { hq: "monsters/m002/M002_MossHornBeast_Rig_V1_HQ.glb", lite: "monsters/m002/M002_MossHornBeast_Rig_V1_Lite.glb" },
  clips: STD_CLIPS,
  expect: { joints: 26, durations: { idle: 2.8, move: 0.64, run: 0.44, attack: 1.3, hurt: 0.45, death: 0.8, respawn: 0.7 } },
  locomotion: { moveNativeMps: 0.3, runNativeMps: 0.95, runThresholdMps: 0.62, hysteresisMps: 0.06, stopMps: 0.05, ratioMin: 0.6, ratioMax: 1.5 },
  attackHitTime: 0.55,
  ...RIG_COMMON,
  bodyRadius: 0.6,
  hpBarHeight: 1.4,
  heightM: 1.2,
});

/** M003 雲絨鳥 Rig V1.0（Lv.5～6，鳥類主動；19 關節；懸浮 0.30 m，碰撞與 AI 位置在地面；碰撞半徑 0.5 m） */
export const M003_CLOUD_FLUFF_BIRD: RiggedMonsterSpec = Object.freeze({
  modelId: "m003_cloud_fluff_bird_v10",
  monsterId: "cloud_fluff_bird",
  label: "M003 雲絨鳥 Rig V1.0",
  files: { hq: "monsters/m003/M003_CloudFluffBird_Rig_V1_HQ.glb", lite: "monsters/m003/M003_CloudFluffBird_Rig_V1_Lite.glb" },
  clips: STD_CLIPS,
  expect: { joints: 19, durations: { idle: 1.25, move: 0.8, run: 0.5, attack: 1.1, hurt: 0.45, death: 1.0, respawn: 0.9 } },
  locomotion: { moveNativeMps: 0.8, runNativeMps: 2.0, runThresholdMps: 1.4, hysteresisMps: 0.1, stopMps: 0.05, ratioMin: 0.6, ratioMax: 1.5 },
  attackHitTime: 0.52,
  ...RIG_COMMON,
  bodyRadius: 0.5,
  hpBarHeight: 1.55,
  heightM: 1.0,
});

/** M005 星雲咩咩 Rig V1.0（Lv.8，四足主動；26 關節） */
export const M005_NEBULA_SHEEP: RiggedMonsterSpec = Object.freeze({
  modelId: "m005_nebula_sheep_v10",
  monsterId: "nebula_sheep",
  label: "M005 星雲咩咩 Rig V1.0",
  files: { hq: "monsters/m005/M005_NebulaSheep_Rig_V1_HQ.glb", lite: "monsters/m005/M005_NebulaSheep_Rig_V1_Lite.glb" },
  clips: STD_CLIPS,
  expect: { joints: 26, durations: { idle: 2.4, move: 0.6, run: 0.42, attack: 1.2, hurt: 0.45, death: 0.75, respawn: 0.6 } },
  locomotion: { moveNativeMps: 0.45, runNativeMps: 1.5, runThresholdMps: 0.85, hysteresisMps: 0.08, stopMps: 0.05, ratioMin: 0.6, ratioMax: 1.5 },
  attackHitTime: 0.5,
  ...RIG_COMMON,
  bodyRadius: 0.5,
  hpBarHeight: 1.3,
  heightM: 1.15,
});

/** M006 胡蘿蔔大王 Rig V1.0（Lv.9 精英，雙足；26 關節；碰撞半徑依地圖文件 0.75 m） */
export const M006_CARROT_KING: RiggedMonsterSpec = Object.freeze({
  modelId: "m006_carrot_king_v10",
  monsterId: "carrot_king",
  label: "M006 胡蘿蔔大王 Rig V1.0",
  files: { hq: "monsters/m006/M006_CarrotKing_Rig_V1_HQ.glb", lite: "monsters/m006/M006_CarrotKing_Rig_V1_Lite.glb" },
  clips: STD_CLIPS,
  expect: { joints: 26, durations: { idle: 2.4, move: 0.9, run: 0.5, attack: 1.3, hurt: 0.5, death: 0.9, respawn: 0.7 } },
  locomotion: { moveNativeMps: 0.35, runNativeMps: 1.0, runThresholdMps: 0.68, hysteresisMps: 0.06, stopMps: 0.05, ratioMin: 0.6, ratioMax: 1.5 },
  attackHitTime: 0.55,
  ...RIG_COMMON,
  bodyRadius: 0.75,
  hpBarHeight: 1.85,
  heightM: 1.65,
});

/** M007 王冠重錘兔 Rig V1.0（Lv.10 BOSS，雙足；29 關節；碰撞半徑依地圖文件 1.3 m） */
export const M007_CROWN_HAMMER_RABBIT: RiggedMonsterSpec = Object.freeze({
  modelId: "m007_crown_hammer_rabbit_v10",
  monsterId: "crown_hammer_rabbit",
  label: "M007 王冠重錘兔 Rig V1.0",
  files: { hq: "monsters/m007/M007_CrownHammerRabbit_Rig_V1_HQ.glb", lite: "monsters/m007/M007_CrownHammerRabbit_Rig_V1_Lite.glb" },
  clips: STD_CLIPS,
  expect: { joints: 29, durations: { idle: 2.8, move: 1.1, run: 0.62, attack: 2.0, hurt: 0.6, death: 1.6, respawn: 1.1 } },
  locomotion: { moveNativeMps: 0.55, runNativeMps: 1.5, runThresholdMps: 1.02, hysteresisMps: 0.08, stopMps: 0.05, ratioMin: 0.6, ratioMax: 1.5 },
  attackHitTime: 1.05,
  ...RIG_COMMON,
  deathHold: 2.0,
  bodyRadius: 1.3,
  hpBarHeight: 2.95,
  heightM: 2.7,
});


export const LAB_MONSTERS: readonly { spec: RiggedMonsterSpec; hp: number; level: number; boss?: boolean }[] = [
  { spec: M002_MOSS_HORN_BEAST, hp: 600, level: 3 },
  { spec: M003_CLOUD_FLUFF_BIRD, hp: 750, level: 5 },
  { spec: M004_WINDFEATHER_FOX, hp: 900, level: 7 },
  { spec: M005_NEBULA_SHEEP, hp: 1100, level: 8 },
  { spec: M006_CARROT_KING, hp: 1800, level: 9 },
  { spec: M007_CROWN_HAMMER_RABBIT, hp: 4200, level: 10, boss: true },
];
