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
  // V1.2：以一般混色顯示，使用設定圖的星空藍（上淺、中深、下淺），不再過暗或疊白
  g.addColorStop(0, "#7fb2ff");
  g.addColorStop(0.45, "#3b69d6");
  g.addColorStop(1, "#6a9cf6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const nebula = ["rgba(170,120,255,0.55)", "rgba(110,220,255,0.5)", "rgba(255,170,240,0.35)"];
  for (let i = 0; i < 18; i++) {
    const x = rng.range(0, W);
    const y = rng.range(H * 0.3, H);
    const r = rng.range(30, 90);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, nebula[i % nebula.length]!);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  for (let i = 0; i < 320; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, H);
    const s = rng.next() < 0.12 ? rng.range(2.2, 3.4) : rng.range(0.9, 1.7);
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.5, 1)})`;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
  // 幾顆十字閃光
  for (let i = 0; i < 24; i++) drawSparkle(ctx, rng.range(0, W), rng.range(H * 0.2, H), rng.range(7, 14), "rgba(255,255,255,0.95)");

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

/** V1.2：只有星點的透明貼圖（加法混色層，與星空層產生視差） */
export function createStarfieldTexture(scene: Scene, seed = 2): DynamicTexture {
  const W = 512;
  const H = 256;
  const tex = new DynamicTexture("PH_boboStarfield", { width: W, height: H }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const rng = createRng(seed);
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < 140; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, H);
    const r = rng.next() < 0.15 ? rng.range(2.4, 3.6) : rng.range(1, 2);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.35, "rgba(200,225,255,0.6)");
    glow.addColorStop(1, "rgba(160,200,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  }
  for (let i = 0; i < 16; i++) drawSparkle(ctx, rng.range(0, W), rng.range(0, H), rng.range(8, 15), "rgba(255,255,255,1)");
  tex.hasAlpha = true;
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}
