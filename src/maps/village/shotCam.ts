import type { ArcRotateCamera } from "@babylonjs/core";

/**
 * Stage 6.6 美術截圖用鏡頭（只給自動化截圖呼叫；一般遊玩不會用到）：
 * 暫停遊戲邏輯（frozen），把第三人稱鏡頭直接放到指定位置，取消距離與俯角限制；
 * on=false 時還原限制並恢復遊戲。不改相機的後製、色調與抗鋸齒設定（截圖與實際遊玩一致）。
 */
interface ShotHost {
  frozen: boolean;
  camera: { camera: ArcRotateCamera };
}

const saved = new WeakMap<object, { lr: number | null; ur: number | null; lb: number | null; ub: number | null }>();

export function shotCam(host: unknown, on: boolean, tx = 0, ty = 0, tz = 0, alphaDeg = 0, betaDeg = 60, radius = 10): boolean {
  const h = host as ShotHost;
  const c = h.camera.camera;
  if (!on) {
    const s = saved.get(h);
    if (s) {
      c.lowerRadiusLimit = s.lr;
      c.upperRadiusLimit = s.ur;
      c.lowerBetaLimit = s.lb;
      c.upperBetaLimit = s.ub;
      saved.delete(h);
    }
    h.frozen = false;
    return true;
  }
  if (!saved.has(h)) saved.set(h, { lr: c.lowerRadiusLimit, ur: c.upperRadiusLimit, lb: c.lowerBetaLimit, ub: c.upperBetaLimit });
  c.lowerRadiusLimit = null;
  c.upperRadiusLimit = null;
  c.lowerBetaLimit = 0.01;
  c.upperBetaLimit = Math.PI - 0.01;
  h.frozen = true;
  c.target.set(tx, ty, tz);
  c.alpha = (alphaDeg * Math.PI) / 180;
  c.beta = (betaDeg * Math.PI) / 180;
  c.radius = radius;
  return true;
}

/** 截圖用：會移動的角色（洛恩）目前位置與面向（world forward） */
export function shotTargets(host: unknown): { merchant: { x: number; y: number; z: number; fx: number; fz: number } | null } {
  const h = host as { full?: { merchant?: { root: { position: { x: number; y: number; z: number }; computeWorldMatrix(f: boolean): unknown; forward: { x: number; z: number } } } | null } | null };
  const m = h.full?.merchant;
  if (!m) return { merchant: null };
  m.root.computeWorldMatrix(true);
  const f = m.root.forward;
  return { merchant: { x: m.root.position.x, y: m.root.position.y, z: m.root.position.z, fx: f.x, fz: f.z } };
}
