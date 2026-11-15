import type { MonsterEffect, MonsterFace, MonsterPose, MonsterState, MonsterView } from "../anim/types.ts";
import type { ClipMap, IMonsterVisual } from "./types.ts";

/** 位置/朝向寫入端（Babylon 端傳入一個設定 TransformNode 的函式） */
export type TransformSink = (x: number, y: number, z: number, yaw: number) => void;

/**
 * 程式化模型轉接器：把既有 MonsterView（例：星露啵啵）包成 IMonsterVisual。
 * 程式化模型自行用姿勢資料做身體變形，因此 onStateEnter 不需要做事。
 */
export class ProceduralVisual implements IMonsterVisual {
  readonly kind = "procedural" as const;
  private readonly model: MonsterView & { setFace?(face: MonsterFace): void };
  private readonly sink: TransformSink;

  constructor(model: MonsterView & { setFace?(face: MonsterFace): void }, sink: TransformSink) {
    this.model = model;
    this.sink = sink;
  }

  load(): Promise<void> {
    return Promise.resolve();
  }
  setTransform(x: number, y: number, z: number, yaw: number): void {
    this.sink(x, y, z, yaw);
  }
  onStateEnter(_state: MonsterState): void {
    /* 程式化模型由姿勢曲線驅動 */
  }
  applyPose(pose: MonsterPose): void {
    this.model.applyPose(pose);
  }
  setFace(face: MonsterFace): void {
    this.model.setFace?.(face);
  }
  playEffect(effect: MonsterEffect): void {
    this.model.playEffect(effect);
  }
  update(dt: number): void {
    this.model.update(dt);
  }
  dispose(): void {
    this.model.dispose();
  }
}

/** 動畫片段播放器（GLB 的 AnimationGroup 由 Babylon 端實作；測試可用假實作） */
export interface ClipPlayer {
  play(name: string, loop: boolean, speed: number): void;
  stopAll(): void;
  has(name: string): boolean;
}

/** GLB 模型其餘需要的能力（材質、透明度、特效、表情、位置） */
export interface ClipModelHooks {
  load(): Promise<void>;
  setTransform: TransformSink;
  /** 受擊閃白 0~1、整體透明度 0~1、是否顯示 */
  setMaterialState(hitFlash: number, opacity: number, visible: boolean): void;
  setFace?(face: MonsterFace): void;
  playEffect?(effect: MonsterEffect): void;
  update?(dt: number): void;
  dispose(): void;
}

/**
 * 骨骼/節點動畫視覺（GLB 用）：進入狀態時切換動畫片段，不做程式化變形。
 * 與程式化模型實作同一個 IMonsterVisual，所以狀態機、AI、戰鬥事件完全共用。
 */
export class ClipMonsterVisual implements IMonsterVisual {
  readonly kind = "gltf" as const;
  private readonly player: ClipPlayer;
  private readonly clips: ClipMap;
  private readonly hooks: ClipModelHooks;
  private lastFace: MonsterFace | null = null;
  /** 最近一次切換的片段名稱（測試與除錯用） */
  currentClip: string | null = null;

  constructor(player: ClipPlayer, clips: ClipMap, hooks: ClipModelHooks) {
    this.player = player;
    this.clips = clips;
    this.hooks = hooks;
  }

  load(): Promise<void> {
    return this.hooks.load();
  }

  setTransform(x: number, y: number, z: number, yaw: number): void {
    this.hooks.setTransform(x, y, z, yaw);
  }

  onStateEnter(state: MonsterState): void {
    // dead：維持死亡動畫最後一格（不切換）
    if (state === "dead") return;
    const c = this.clips[state];
    this.player.stopAll();
    if (this.player.has(c.name)) {
      this.player.play(c.name, c.loop, c.speed);
      this.currentClip = c.name;
    } else {
      this.currentClip = null;
    }
  }

  applyPose(pose: MonsterPose): void {
    this.hooks.setMaterialState(pose.hitFlash, pose.opacity, pose.bodyVisible);
    if (pose.face !== this.lastFace) this.setFace(pose.face);
  }

  setFace(face: MonsterFace): void {
    this.lastFace = face;
    this.hooks.setFace?.(face);
  }

  playEffect(effect: MonsterEffect): void {
    this.hooks.playEffect?.(effect);
  }

  update(dt: number): void {
    this.hooks.update?.(dt);
  }

  dispose(): void {
    this.player.stopAll();
    this.hooks.dispose();
  }
}
