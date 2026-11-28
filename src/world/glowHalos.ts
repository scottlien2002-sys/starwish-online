/**
 * 世界場景共用：發光光暈（燈泡、爐口、能量核心、怪物眼睛…）。
 * 用一個 SpriteManager（永遠面向鏡頭的小方片）＋加法混合畫柔和光暈：
 * 全部光暈只有 1 次 Draw Call，不需要 GlowLayer（GlowLayer 每個發光網格都要多畫一次，手機負擔大）。
 * 支援脈動與閃爍；距離太遠的光暈自動隱藏（霧裡看不到）。
 */
import { Color4, Constants, type Scene, Sprite, SpriteManager, type Vector3 } from "@babylonjs/core";

/** 柔和光暈圖（中心白、邊緣透明）的 data URL：不需要下載任何檔案 */
export function haloDataUrl(size = 64): string {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c.toDataURL("image/png");
}

export interface HaloOptions {
  /** 直徑（公尺） */
  size: number;
  color: [number, number, number];
  /** 0～1 */
  alpha?: number;
  /** 脈動：每秒弧度、幅度（0～1） */
  pulse?: { speed: number; amp: number; phase?: number };
  /** 閃爍（壞掉的燈）：大部分時間亮、偶爾熄滅 */
  flicker?: { phase: number };
}

interface HaloRec {
  sprite: Sprite;
  base: number;
  alpha: number;
  rgb: [number, number, number];
  o: HaloOptions;
  x: number;
  z: number;
}

export class GlowHalos {
  readonly manager: SpriteManager;
  private readonly list: HaloRec[] = [];
  private t = 0;

  /**
   * @param capacity 最大光暈數
   * @param maxDist 超過這個距離隱藏（應落在霧裡）
   */
  private readonly maxDistIn: number;
  constructor(scene: Scene, capacity: number, maxDist = 150) {
    this.maxDistIn = maxDist;
    this.manager = new SpriteManager("world_halos", haloDataUrl(64), capacity, { width: 64, height: 64 }, scene);
    this.manager.blendMode = Constants.ALPHA_ADD;
    this.manager.isPickable = false;
    this.manager.fogEnabled = true;
    this.manager.disableDepthWrite = true;
  }

  get maxDist(): number {
    return this.maxDistIn;
  }

  get count(): number {
    return this.list.length;
  }

  add(pos: Vector3, o: HaloOptions): Sprite | null {
    if (this.list.length >= this.manager.capacity) return null;
    const s = new Sprite(`halo${this.list.length}`, this.manager);
    s.position.copyFrom(pos);
    s.size = o.size;
    const a = o.alpha ?? 0.7;
    s.color = new Color4(o.color[0] * a, o.color[1] * a, o.color[2] * a, 1);
    s.isPickable = false;
    this.list.push({ sprite: s, base: o.size, alpha: a, rgb: o.color, o, x: pos.x, z: pos.z });
    return s;
  }

  /** 每幀（或每 2 幀）呼叫 */
  update(dt: number, px: number, pz: number): void {
    this.t += dt;
    const t = this.t;
    const md2 = this.maxDistIn * this.maxDistIn;
    for (const h of this.list) {
      const dx = h.x - px;
      const dz = h.z - pz;
      const vis = dx * dx + dz * dz < md2;
      h.sprite.isVisible = vis;
      if (!vis) continue;
      let k = 1;
      if (h.o.pulse) k = 1 + h.o.pulse.amp * Math.sin(t * h.o.pulse.speed + (h.o.pulse.phase ?? 0));
      if (h.o.flicker) {
        const ph = (t * 0.83 + h.o.flicker.phase) % 4;
        if (ph > 3.75 && !(ph > 3.85 && ph < 3.9)) k = 0.08;
      }
      h.sprite.size = h.base * (0.85 + 0.15 * k);
      const a = h.alpha * Math.max(0, k);
      h.sprite.color.set(h.rgb[0] * a, h.rgb[1] * a, h.rgb[2] * a, 1);
    }
  }

  dispose(): void {
    this.manager.dispose();
  }
}
