import { DynamicTexture, Scene, Texture } from "@babylonjs/core";
import { createRng } from "../../core/rng.ts";

/** 程式繪製貼圖（不需外部圖檔） */

/** 身體內部的星空：深藍到淺藍漸層 + 紫/青星雲 + 星點 */
export function createGalaxyTexture(scene: Scene, seed = 1): DynamicTexture {
  const W = 512;
  const H = 256;
  const tex = new DynamicTexture("PH_boboGalaxy", { width: W, height: H }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const rng = createRng(seed);

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#9fd4ff");
  g.addColorStop(0.45, "#4f86ef");
  g.addColorStop(1, "#7fb9ff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const nebula = ["rgba(170,120,255,0.35)", "rgba(110,220,255,0.35)", "rgba(255,170,240,0.22)"];
  for (let i = 0; i < 14; i++) {
    const x = rng.range(0, W);
    const y = rng.range(H * 0.3, H);
    const r = rng.range(30, 90);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, nebula[i % nebula.length]!);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, H);
    const s = rng.next() < 0.08 ? rng.range(1.6, 2.6) : rng.range(0.5, 1.2);
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.5, 1)})`;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
  // 幾顆十字閃光
  for (let i = 0; i < 10; i++) drawSparkle(ctx, rng.range(0, W), rng.range(H * 0.3, H), rng.range(5, 10), "rgba(255,255,255,0.9)");

  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/** 粒子用：四角星光 */
export function createSparkleTexture(scene: Scene): DynamicTexture {
  const S = 64;
  const tex = new DynamicTexture("PH_sparkle", { width: S, height: S }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const rg = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.25, "rgba(255,255,255,0.6)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, S, S);
  drawSparkle(ctx, S / 2, S / 2, S * 0.48, "rgba(255,255,255,1)");
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

/** 地面柔和陰影 */
export function createBlobShadowTexture(scene: Scene): DynamicTexture {
  const S = 128;
  const tex = new DynamicTexture("PH_blobShadow", { width: S, height: S }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const rg = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, "rgba(40,50,110,0.55)");
  rg.addColorStop(0.6, "rgba(40,50,110,0.25)");
  rg.addColorStop(1, "rgba(40,50,110,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, S, S);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}
