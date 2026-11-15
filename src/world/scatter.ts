import { createRng } from "../core/rng.ts";
import { heightAt } from "./terrain.ts";

/** 場景裝飾物的擺放資料（純資料，畫面層依此建立模型） */
export type PropKind = "tree" | "bush" | "rock" | "flower";

export interface PropPlacement {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  /** 碰撞半徑（公尺），0 代表可穿過 */
  radius: number;
}

export interface ScatterOptions {
  seed: number;
  halfSize: number;
  /** 出生點淨空半徑 */
  clearRadius: number;
  counts: Record<PropKind, number>;
}

const BASE_RADIUS: Record<PropKind, number> = { tree: 0.7, bush: 0.0, rock: 0.6, flower: 0 };
const MIN_SPACING: Record<PropKind, number> = { tree: 4.5, bush: 2, rock: 3, flower: 0.6 };

export function scatterProps(opt: ScatterOptions): PropPlacement[] {
  const rng = createRng(opt.seed);
  const placed: PropPlacement[] = [];
  const order: PropKind[] = ["tree", "rock", "bush", "flower"];

  for (const kind of order) {
    const target = opt.counts[kind];
    let attempts = 0;
    let made = 0;
    while (made < target && attempts < target * 30) {
      attempts++;
      const x = rng.range(-opt.halfSize, opt.halfSize);
      const z = rng.range(-opt.halfSize, opt.halfSize);
      if (Math.hypot(x, z) < opt.clearRadius) continue;

      const spacing = MIN_SPACING[kind];
      const tooClose = placed.some((p) => {
        const need = p.kind === kind ? spacing : Math.max(p.radius, BASE_RADIUS[kind]) + 0.5;
        return Math.hypot(p.x - x, p.z - z) < need;
      });
      if (tooClose) continue;

      const scale = kind === "flower" ? rng.range(0.7, 1.2) : rng.range(0.8, 1.35);
      placed.push({
        kind,
        x,
        y: heightAt(x, z),
        z,
        rotation: rng.range(0, Math.PI * 2),
        scale,
        radius: BASE_RADIUS[kind] * scale,
      });
      made++;
    }
  }
  return placed;
}

/** 把位置推出所有障礙物（圓形碰撞） */
export function resolvePropCollisions(
  x: number,
  z: number,
  selfRadius: number,
  props: readonly PropPlacement[],
): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (const p of props) {
    if (p.radius <= 0) continue;
    const dx = px - p.x;
    const dz = pz - p.z;
    const min = p.radius + selfRadius;
    const d = Math.hypot(dx, dz);
    if (d < min) {
      if (d < 1e-6) {
        px = p.x + min;
        continue;
      }
      const push = (min - d) / d;
      px += dx * push;
      pz += dz * push;
    }
  }
  return { x: px, z: pz };
}
