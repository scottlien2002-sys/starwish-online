/**
 * 特效用程式貼圖（Canvas 畫出來，不下載圖檔、不用付費素材）。全部白色／灰階，顏色由材質或粒子顏色決定，
 * 所以六大職業可以共用同一組貼圖、只換調色盤。解析度依品質（64／128／256）。
 */
import { DynamicTexture, type Scene, Texture } from "@babylonjs/core";

export type TexKey = "dot" | "star" | "spark" | "ring" | "crescent" | "flare" | "rune" | "runeBig" | "streak" | "shock" | "smoke" | "glowDisc";

type Draw = (c: CanvasRenderingContext2D, s: number) => void;

const TAU = Math.PI * 2;

function radial(c: CanvasRenderingContext2D, s: number, stops: [number, string][]): void {
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
}

function starPath(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: number, n: number, rot = -Math.PI / 2): void {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const rr = i % 2 === 0 ? R : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
}

const DRAW: Record<TexKey, Draw> = {
  dot: (c, s) => radial(c, s, [[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,0.85)"], [0.6, "rgba(255,255,255,0.25)"], [1, "rgba(255,255,255,0)"]]),
  glowDisc: (c, s) => radial(c, s, [[0, "rgba(255,255,255,0.9)"], [0.5, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]]),
  smoke: (c, s) => {
    radial(c, s, [[0, "rgba(255,255,255,0.55)"], [0.55, "rgba(255,255,255,0.22)"], [1, "rgba(255,255,255,0)"]]);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      c.fillStyle = "rgba(255,255,255,0.08)";
      c.beginPath();
      c.arc(s / 2 + Math.cos(a) * s * 0.18, s / 2 + Math.sin(a) * s * 0.18, s * 0.16, 0, TAU);
      c.fill();
    }
  },
  star: (c, s) => {
    radial(c, s, [[0, "rgba(255,255,255,0.6)"], [0.35, "rgba(255,255,255,0.12)"], [1, "rgba(255,255,255,0)"]]);
    c.fillStyle = "rgba(255,255,255,1)";
    starPath(c, s / 2, s / 2, s * 0.48, s * 0.1, 4);
    c.fill();
    c.globalAlpha = 0.6;
    starPath(c, s / 2, s / 2, s * 0.26, s * 0.06, 4, -Math.PI / 4);
    c.fill();
    c.globalAlpha = 1;
  },
  spark: (c, s) => {
    const g = c.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(s / 2, s / 2, s * 0.5, s * 0.08, 0, 0, TAU);
    c.fill();
  },
  ring: (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.55, "rgba(255,255,255,0.25)");
    g.addColorStop(0.82, "rgba(255,255,255,1)");
    g.addColorStop(0.9, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  },
  shock: (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.7, "rgba(255,255,255,0.05)");
    g.addColorStop(0.9, "rgba(255,255,255,0.9)");
    g.addColorStop(0.96, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  },
  // 新月形劍氣：u 方向 = 弧長（左→右漸亮再漸消），v = 內外緣
  crescent: (c, s) => {
    c.save();
    c.translate(s / 2, s * 0.95);
    for (let i = 0; i < 3; i++) {
      const R = s * (0.86 - i * 0.05);
      const w = s * (0.16 - i * 0.045);
      c.lineWidth = w;
      c.strokeStyle = `rgba(255,255,255,${[0.35, 0.7, 1][i]})`;
      c.lineCap = "round";
      c.beginPath();
      c.arc(0, 0, R, Math.PI * 1.1, Math.PI * 1.9);
      c.stroke();
    }
    c.restore();
    const m = c.createLinearGradient(0, 0, s, 0);
    m.addColorStop(0, "rgba(0,0,0,1)");
    m.addColorStop(0.25, "rgba(0,0,0,0)");
    m.addColorStop(1, "rgba(0,0,0,0)");
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = m;
    c.fillRect(0, 0, s, s);
    c.globalCompositeOperation = "source-over";
  },
  flare: (c, s) => {
    radial(c, s, [[0, "rgba(255,255,255,1)"], [0.12, "rgba(255,255,255,0.9)"], [0.35, "rgba(255,255,255,0.25)"], [1, "rgba(255,255,255,0)"]]);
    c.fillStyle = "rgba(255,255,255,0.85)";
    for (const a of [0, Math.PI / 2]) {
      c.save();
      c.translate(s / 2, s / 2);
      c.rotate(a);
      c.beginPath();
      c.ellipse(0, 0, s * 0.5, s * 0.025, 0, 0, TAU);
      c.fill();
      c.restore();
    }
  },
  streak: (c, s) => {
    // 拖尾：u = 新→舊（亮→淡），v = 刀刃中心最亮
    const g = c.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(0.5, "rgba(255,255,255,1)");
    g.addColorStop(0.65, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  },
  rune: (c, s) => drawCircle(c, s, 6, false),
  runeBig: (c, s) => drawCircle(c, s, 8, true),
};

/** 魔法陣：多層圓環、刻度、星形、符文點（不用文字字型，避免平台差異） */
function drawCircle(c: CanvasRenderingContext2D, s: number, points: number, big: boolean): void {
  const cx = s / 2;
  c.strokeStyle = "rgba(255,255,255,1)";
  c.fillStyle = "rgba(255,255,255,1)";
  const ring = (r: number, w: number, a = 1) => {
    c.globalAlpha = a;
    c.lineWidth = w;
    c.beginPath();
    c.arc(cx, cx, r, 0, TAU);
    c.stroke();
  };
  const g = c.createRadialGradient(cx, cx, 0, cx, cx, s / 2);
  g.addColorStop(0, "rgba(255,255,255,0.18)");
  g.addColorStop(0.7, "rgba(255,255,255,0.06)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  c.fillStyle = "rgba(255,255,255,1)";
  ring(s * 0.48, s * 0.012);
  ring(s * 0.455, s * 0.006, 0.8);
  ring(s * 0.36, s * 0.01);
  ring(s * 0.2, s * 0.008, 0.9);
  // 刻度
  c.globalAlpha = 0.9;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    const r0 = s * 0.37;
    const r1 = s * (i % 4 === 0 ? 0.44 : 0.41);
    c.lineWidth = s * (i % 4 === 0 ? 0.008 : 0.004);
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
    c.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1);
    c.stroke();
  }
  // 星形（兩個交錯多邊形）
  c.globalAlpha = 1;
  c.lineWidth = s * 0.007;
  for (const off of [0, Math.PI / points]) {
    c.beginPath();
    for (let i = 0; i <= points; i++) {
      const a = off + (i * 2 * TAU) / points / (points % 2 === 0 ? 2 : 1) - Math.PI / 2;
      const x = cx + Math.cos(a) * s * 0.36;
      const y = cx + Math.sin(a) * s * 0.36;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  // 符文點
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * TAU;
    const x = cx + Math.cos(a) * s * 0.405;
    const y = cx + Math.sin(a) * s * 0.405;
    c.beginPath();
    starPath(c, x, y, s * 0.02, s * 0.007, 4, a);
    c.fill();
  }
  if (big) {
    c.globalAlpha = 0.9;
    starPath(c, cx, cx, s * 0.17, s * 0.05, 5);
    c.lineWidth = s * 0.008;
    c.stroke();
  }
  c.globalAlpha = 1;
}

const cache = new Map<string, Texture>();

export function fxTexture(scene: Scene, key: TexKey, size: number): Texture {
  const id = `${scene.uid}|${key}|${size}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const s = key === "rune" || key === "runeBig" ? Math.min(512, size * 2) : size;
  const tex = new DynamicTexture(`fx_${key}_${s}`, { width: s, height: s }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, s, s);
  DRAW[key](ctx, s);
  tex.update(false);
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  cache.set(id, tex);
  scene.onDisposeObservable.addOnce(() => cache.delete(id));
  return tex;
}

export function clearFxTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
