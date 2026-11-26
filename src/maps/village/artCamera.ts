import { PORTALS, PORTAL_R, SOUTH_GATE, villageCameraDistance } from "./layout.ts";

/**
 * 全村整合（&art=full）專用的鏡頭避障補充：正式美術新增了「頭頂以上」的結構（傳送門後方石拱、南門橫樑），
 * 這些不是碰撞物（玩家可以從下面走過），但鏡頭不能卡進石拱裡。
 * 只影響鏡頭距離，不影響移動、碰撞與配置（layout.ts 不改）。
 */
interface CamBox {
  x: number;
  z: number;
  rot: number;
  hw: number;
  hd: number;
  y0: number;
  y1: number;
}

const PAD = 0.3;

export const ART_CAMERA_BOXES: readonly CamBox[] = (() => {
  const out: CamBox[] = [];
  for (const p of PORTALS) {
    const t = (p.bearing * Math.PI) / 180;
    // 後方兩柱在相對村莊方向 ±130°：沿外側方向 (PORTAL_R+0.6)·cos50° ≈ 2.96 m，拱寬 ±3.52 m（含拱腳石墩）
    const off = (PORTAL_R + 0.6) * Math.cos((50 * Math.PI) / 180);
    out.push({ x: p.x + Math.sin(t) * off, z: p.z + Math.cos(t) * off, rot: t, hw: 4.0, hd: 0.45, y0: p.floor + 2.55, y1: p.floor + 5.7 });
  }
  out.push({ x: 0, z: SOUTH_GATE.z, rot: 0, hw: SOUTH_GATE.halfW + 0.8, hd: 0.5, y0: 6.2, y1: 8.4 });
  return out;
})();

/** 射線（角色 → 鏡頭方向）與一個旋轉長方體的最近交點距離（沒有交點＝Infinity） */
export function rayBox(b: CamBox, tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, maxT: number): number {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  // 本地座標：lx 沿寬度（世界 x 旋轉）、lz 沿深度
  const ox = tx - b.x;
  const oz = tz - b.z;
  const lx = ox * c - oz * s;
  const lz = ox * s + oz * c;
  const ldx = dx * c - dz * s;
  const ldz = dx * s + dz * c;
  let t0 = 0;
  let t1 = maxT;
  const slab = (p: number, v: number, h: number): boolean => {
    if (Math.abs(v) < 1e-9) return Math.abs(p) <= h;
    let a = (-h - p) / v;
    let bb = (h - p) / v;
    if (a > bb) [a, bb] = [bb, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, bb);
    return t0 <= t1;
  };
  if (!slab(lx, ldx, b.hw + PAD) || !slab(lz, ldz, b.hd + PAD) || !slab(ty - (b.y0 + b.y1) / 2, dy, (b.y1 - b.y0) / 2 + PAD)) return Infinity;
  return t0;
}

export function artCameraDistance(tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, maxR: number): number {
  let best = villageCameraDistance(tx, ty, tz, dx, dy, dz, maxR);
  for (const b of ART_CAMERA_BOXES) {
    const t = rayBox(b, tx, ty, tz, dx, dy, dz, best);
    if (t < best) best = Math.max(1.4, t);
  }
  return best;
}
