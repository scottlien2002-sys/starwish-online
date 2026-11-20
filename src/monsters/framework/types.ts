/**
 * 通用怪物框架（Monster Framework V1.0）— 核心型別。
 * 本資料夾（framework/）完全不依賴 Babylon.js，可在 Node 單元測試與未來的伺服器端執行。
 */
import type { AnimProfile } from "../anim/MonsterAnimator.ts";
import type { MonsterEffect, MonsterFace, MonsterPose, MonsterState } from "../anim/types.ts";

export type { MonsterAction, MonsterEffect, MonsterFace, MonsterPose, MonsterState } from "../anim/types.ts";

// ============================== 靜態資料 ==============================

/** 每種怪物的靜態資料（MonsterDefinition） */
export interface MonsterDefinition {
  monsterId: string;
  name: string;
  level: number;
  maxHp: number;
  attack: number;
  defense: number;
  /** 公尺/秒 */
  moveSpeed: number;
  /** 公尺 */
  attackRange: number;
  /** 公尺：玩家進入此距離開始追擊 */
  aggroRange: number;
  /** 秒 */
  attackCooldown: number;
  /** 秒：死亡動畫播完後多久重生 */
  respawnTime: number;
  experience: number;
  dropTableId: string;
  modelId: string;
  animationProfileId: string;

  // ---- 以下為框架額外欄位（選填） ----
  /** 巡邏半徑（公尺），預設 3 */
  patrolRadius?: number;
  /** 離開出生點超過此距離就放棄追擊、返回（公尺），預設 aggroRange × 2.5 */
  leashRange?: number;
  /** 模型高度（公尺） */
  height?: number;
  /** true = 數值為暫定，待企劃確認 */
  provisional?: boolean;
  /** true = 僅供程式測試，不是正式怪物 */
  testOnly?: boolean;
  note?: string;
}

// ============================== 動畫設定 ==============================

/** 骨骼 / 節點動畫片段設定（GLB 模型使用） */
export interface ClipSpec {
  /** GLB 內的動畫名稱 */
  name: string;
  loop: boolean;
  /** 播放速度倍率 */
  speed: number;
}

export type ClipMap = Record<Exclude<MonsterState, "dead">, ClipSpec>;

/**
 * 每種怪物的動畫設定（MonsterAnimationProfile）。
 * - procedural：以 anim 內的曲線輸出姿勢，由程式化模型套用（例：星露啵啵的伸縮變形）
 * - clips：播放 GLB 內的骨骼/節點動畫片段；anim 只提供時長、特效時間點與通用效果（閃白、淡出）
 * 兩者共用同一套狀態機與事件。
 */
export interface MonsterAnimationProfile {
  id: string;
  kind: "procedural" | "clips";
  /** 時長、特效觸發時間、姿勢曲線（狀態機與動畫完成事件依此運作） */
  anim: AnimProfile;
  /** kind = "clips" 時必填 */
  clips?: ClipMap;
}

// ============================== 視覺介面 ==============================

/**
 * 怪物視覺介面（IMonsterVisual）。
 * 負責：建立/銷毀模型、更新位置與朝向、播放動畫、特效、表情、材質。
 * 狀態機與 AI 只透過這個介面通知視覺，完全不接觸 Babylon。
 */
export interface IMonsterVisual {
  readonly kind: "procedural" | "gltf";
  /** 建立模型（GLB 需非同步載入；程式化模型可立即完成） */
  load(): Promise<void>;
  setTransform(x: number, y: number, z: number, yaw: number): void;
  /** 進入新狀態（GLB 在此切換動畫片段；程式化模型可忽略） */
  onStateEnter(state: MonsterState): void;
  /** 每幀姿勢（程式化模型套用全部；GLB 只取通用效果如閃白、透明度） */
  applyPose(pose: MonsterPose): void;
  setFace(face: MonsterFace): void;
  playEffect(effect: MonsterEffect): void;
  /** 選填：受擊反應（連續受擊抗性：後退幅度倍率、是否硬直）。在同一幀的 onStateEnter 之前呼叫 */
  onHitReaction?(r: { stagger: number; recoil: number; immune: boolean; kind?: "normal" | "control" }): void;
  update(dt: number): void;
  dispose(): void;
}

/** 依 modelId 建立視覺的工廠函式（由 Babylon 端註冊；測試時可用假實作） */
export type MonsterVisualFactory = (definition: MonsterDefinition, profile: MonsterAnimationProfile) => IMonsterVisual;

// ============================== 執行期 ==============================

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** AI 看到的目標（通常是玩家） */
export interface MonsterTarget {
  id: string;
  x: number;
  z: number;
  alive: boolean;
}

export type BrainMode = "idle" | "patrol" | "chase" | "attack" | "return" | "dead" | "respawn";
