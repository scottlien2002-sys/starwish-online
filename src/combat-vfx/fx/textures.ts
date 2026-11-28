/**
 * 特效用程式貼圖（Canvas 畫出來，不下載圖檔、不用付費素材）。全部白色／灰階，顏色由材質或粒子顏色決定，
 * 所以六大職業可以共用同一組貼圖、只換調色盤。解析度依品質（64／128／256）。
 */
import { DynamicTexture, type Scene, Texture } from "@babylonjs/core";

export type TexKey =
  | "dot" | "star" | "spark" | "ring" | "crescent" | "flare" | "rune" | "runeBig" | "streak" | "shock" | "smoke" | "glowDisc"
  | "glyphRing" | "crack" | "shard" | "ringThin" | "pillar" | "confetti" | "hex";

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
  // 細圓環（命中瞬間的擴散環）
  ringThin: (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.38, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.75, "rgba(255,255,255,0.15)");
    g.addColorStop(0.9, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  },
  // 符文環：外圈一圈不規則刻紋（不用字型，避免平台差異），魔法陣第三層
  glyphRing: (c, s) => {
    const cx = s / 2;
    c.strokeStyle = "rgba(255,255,255,1)";
    c.fillStyle = "rgba(255,255,255,1)";
    c.lineWidth = s * 0.006;
    c.beginPath(); c.arc(cx, cx, s * 0.485, 0, TAU); c.stroke();
    c.beginPath(); c.arc(cx, cx, s * 0.39, 0, TAU); c.stroke();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU;
      c.save();
      c.translate(cx + Math.cos(a0) * s * 0.437, cx + Math.sin(a0) * s * 0.437);
      c.rotate(a0 + Math.PI / 2);
      const w = s * 0.028, h = s * 0.034;
      c.lineWidth = s * 0.006;
      c.beginPath();
      const k = Math.floor(rnd() * 4);
      if (k === 0) { c.moveTo(-w / 2, h / 2); c.lineTo(0, -h / 2); c.lineTo(w / 2, h / 2); }
      else if (k === 1) { c.moveTo(-w / 2, -h / 2); c.lineTo(w / 2, -h / 2); c.moveTo(0, -h / 2); c.lineTo(0, h / 2); c.moveTo(-w / 3, h / 2); c.lineTo(w / 3, h / 2); }
      else if (k === 2) { c.arc(0, 0, w / 2, 0, TAU); c.moveTo(0, -h / 2); c.lineTo(0, h / 2); }
      else { c.moveTo(-w / 2, h / 2); c.lineTo(-w / 2, -h / 2); c.lineTo(w / 2, h / 2); c.lineTo(w / 2, -h / 2); }
      c.stroke();
      c.restore();
    }
  },
  // 地裂紋：放射狀鋸齒線（地面衝擊）
  crack: (c, s) => {
    const cx = s / 2;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    c.strokeStyle = "rgba(255,255,255,1)";
    c.lineCap = "round";
    for (let i = 0; i < 11; i++) {
      let a = (i / 11) * TAU + rnd() * 0.3;
      let x = cx, y = cx, r = s * 0.06;
      c.lineWidth = s * 0.02;
      c.beginPath(); c.moveTo(x, y);
      while (r < s * (0.33 + rnd() * 0.15)) {
        r += s * (0.03 + rnd() * 0.04); a += (rnd() - 0.5) * 0.5;
        x = cx + Math.cos(a) * r; y = cx + Math.sin(a) * r;
        c.lineTo(x, y); c.lineWidth *= 0.9;
      }
      c.stroke();
    }
    const g = c.createRadialGradient(cx, cx, 0, cx, cx, s * 0.2);
    g.addColorStop(0, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  },
  // 碎片（星光碎片、碎石）：菱形
  shard: (c, s) => {
    c.fillStyle = "rgba(255,255,255,1)";
    c.beginPath(); c.moveTo(s / 2, s * 0.04); c.lineTo(s * 0.72, s / 2); c.lineTo(s / 2, s * 0.96); c.lineTo(s * 0.28, s / 2); c.closePath(); c.fill();
    c.fillStyle = "rgba(255,255,255,0.5)";
    c.beginPath(); c.moveTo(s / 2, s * 0.04); c.lineTo(s * 0.72, s / 2); c.lineTo(s / 2, s / 2); c.closePath(); c.fill();
  },
  // 光柱：v＝高度（底亮頂淡），u＝中心最亮
  pillar: (c, s) => {
    const gx = c.createLinearGradient(0, 0, s, 0);
    gx.addColorStop(0, "rgba(255,255,255,0)"); gx.addColorStop(0.5, "rgba(255,255,255,1)"); gx.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = gx; c.fillRect(0, 0, s, s);
    c.globalCompositeOperation = "destination-in";
    const gy = c.createLinearGradient(0, 0, 0, s);
    gy.addColorStop(0, "rgba(255,255,255,0)"); gy.addColorStop(0.55, "rgba(255,255,255,0.6)"); gy.addColorStop(1, "rgba(255,255,255,1)");
    c.fillStyle = gy; c.fillRect(0, 0, s, s);
    c.globalCompositeOperation = "source-over";
  },
  // 彩紙／卡片（小丑道具）
  confetti: (c, s) => {
    c.fillStyle = "rgba(255,255,255,1)";
    c.fillRect(s * 0.2, s * 0.32, s * 0.6, s * 0.36);
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.fillRect(s * 0.2, s * 0.32, s * 0.6, s * 0.08);
  },
  // 六角光盾紋
  hex: (c, s) => {
    radial(c, s, [[0, "rgba(255,255,255,0.05)"], [0.8, "rgba(255,255,255,0.25)"], [0.97, "rgba(255,255,255,0.9)"], [1, "rgba(255,255,255,0)"]]);
    c.strokeStyle = "rgba(255,255,255,0.7)";
    c.lineWidth = s * 0.01;
    const r = s * 0.07;
    for (let row = -6; row <= 6; row++) for (let col = -6; col <= 6; col++) {
      const x = s / 2 + col * r * 1.5, y = s / 2 + row * r * 1.732 + (col % 2 ? r * 0.866 : 0);
      if (Math.hypot(x - s / 2, y - s / 2) > s * 0.46) continue;
      c.beginPath();
      for (let k = 0; k <= 6; k++) { const a = (k / 6) * TAU; const px = x + Math.cos(a) * r * 0.95, py = y + Math.sin(a) * r * 0.95; if (k) c.lineTo(px, py); else c.moveTo(px, py); }
      c.stroke();
    }
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
  if (hit && hit.getInternalTexture()) return hit;
  const s = key === "rune" || key === "runeBig" || key === "glyphRing" || key === "crack" || key === "hex" ? Math.min(512, size * 2) : size;
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
