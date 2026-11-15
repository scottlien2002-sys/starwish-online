/**
 * 星露啵啵 V2 臉部：貼合身體曲面的單一網格 + 手繪風表情貼圖。
 * 本檔不依賴 Babylon（只用數學與 Canvas 2D），可單元測試，也可在瀏覽器外預覽貼圖。
 *
 * 座標約定：
 * - 模型空間：怪物面向 +z，角色右側為 +x。
 * - 「觀看者座標」X：從正面看時畫面往右為正，所以 X = -x。
 * - 貼圖 UV 採正面投影：u = 0.5 + X / (2W)，v = (y - y0) / (y1 - y0)。
 *   因此在畫布上作畫時，看到的就是正面觀看時的樣子。
 */
import { FACE_LAYOUT, surfacePoint } from "./shape.ts";

export type FaceExpression = "normal" | "angry" | "hurt";

export const FACE_PATCH = Object.freeze({
  y0: 0.26,
  y1: 0.76,
  /** 左右包覆角度（弧度） */
  theta: 1.0,
  /** 沿法線往外推一點，避免與身體表面重疊閃爍 */
  lift: 0.004,
});

export interface FacePatchGeometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  /** 正面投影半寬（模型單位） */
  halfWidth: number;
}

/** 正面投影半寬：補丁在 x 方向的最大範圍 */
export function faceHalfWidth(): number {
  let w = 0;
  for (let k = 0; k <= 20; k++) {
    const y = FACE_PATCH.y0 + ((FACE_PATCH.y1 - FACE_PATCH.y0) * k) / 20;
    w = Math.max(w, Math.abs(surfacePoint(y, FACE_PATCH.theta).x));
  }
  return w;
}

/** 模型座標 (x, y) → 貼圖 UV */
export function faceUV(x: number, y: number, halfWidth: number): [number, number] {
  return [0.5 - x / (2 * halfWidth), (y - FACE_PATCH.y0) / (FACE_PATCH.y1 - FACE_PATCH.y0)];
}

/**
 * 建立貼合曲面的臉部網格：在 (y, θ) 上取格點，每個頂點都落在身體表面（再沿法線浮起 lift）。
 * 三角形繞向以「法線朝外」為準（左手座標、Babylon 預設正面）。
 */
export function buildFacePatch(rows = 24, cols = 32): FacePatchGeometry {
  const W = faceHalfWidth();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const y = FACE_PATCH.y0 + ((FACE_PATCH.y1 - FACE_PATCH.y0) * r) / rows;
    for (let c = 0; c <= cols; c++) {
      const th = -FACE_PATCH.theta + (2 * FACE_PATCH.theta * c) / cols;
      const p = surfacePoint(y, th);
      positions.push(p.x + p.nx * FACE_PATCH.lift, p.y + p.ny * FACE_PATCH.lift, p.z + p.nz * FACE_PATCH.lift);
      normals.push(p.nx, p.ny, p.nz);
      const [u, v] = faceUV(p.x, p.y, W);
      uvs.push(u, v);
    }
  }
  const at = (r: number, c: number): number => r * (cols + 1) + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = at(r, c), b = at(r, c + 1), d = at(r + 1, c), e = at(r + 1, c + 1);
      indices.push(a, b, e, a, e, d);
    }
  }
  // 依第一個三角形的幾何法線與表面法線比對，必要時翻轉繞向
  const tri = triangleNormal(positions, indices[0]!, indices[1]!, indices[2]!);
  const n0 = [normals[indices[0]! * 3]!, normals[indices[0]! * 3 + 1]!, normals[indices[0]! * 3 + 2]!];
  if (tri[0] * n0[0]! + tri[1] * n0[1]! + tri[2] * n0[2]! < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]!;
      indices[i + 1] = indices[i + 2]!;
      indices[i + 2] = t;
    }
  }
  return { positions, normals, uvs, indices, halfWidth: W };
}

/**
 * Babylon（左手座標）判定正面的幾何法線方向：cross(p1 - p0, p2 - p0) 取負（與 VertexData.ComputeNormals 一致）。
 */
export function triangleNormal(pos: number[], i0: number, i1: number, i2: number): [number, number, number] {
  const ax = pos[i1 * 3]! - pos[i0 * 3]!, ay = pos[i1 * 3 + 1]! - pos[i0 * 3 + 1]!, az = pos[i1 * 3 + 2]! - pos[i0 * 3 + 2]!;
  const bx = pos[i2 * 3]! - pos[i0 * 3]!, by = pos[i2 * 3 + 1]! - pos[i0 * 3 + 1]!, bz = pos[i2 * 3 + 2]! - pos[i0 * 3 + 2]!;
  // ComputeNormals 使用 (p1-p2) × (p3-p2) 的慣例 → 等價於 -(a × b)
  return [-(ay * bz - az * by), -(az * bx - ax * bz), -(ax * by - ay * bx)];
}

/** 五官在「觀看者座標」(X 往右、y 往上) 的位置 */
export function faceFeatureCenters(): { eyeL: [number, number]; eyeR: [number, number]; blushL: [number, number]; blushR: [number, number]; mouth: [number, number] } {
  const e = surfacePoint(FACE_LAYOUT.eye.y, FACE_LAYOUT.eye.theta);
  const b = surfacePoint(FACE_LAYOUT.blush.y, FACE_LAYOUT.blush.theta);
  const m = surfacePoint(FACE_LAYOUT.mouth.y, FACE_LAYOUT.mouth.theta);
  return {
    eyeL: [-e.x, e.y],
    eyeR: [e.x, e.y],
    blushL: [-b.x, b.y],
    blushR: [b.x, b.y],
    mouth: [m.x, m.y],
  };
}

/** Canvas 2D 介面的最小子集（瀏覽器與 OffscreenCanvas 皆可） */
type Ctx = CanvasRenderingContext2D;

/** 依寬度求貼圖高度，使 x、y 每單位像素相同（筆畫粗細一致、圓不變形） */
export function faceTextureHeight(width: number, halfWidth = faceHalfWidth()): number {
  return Math.max(16, Math.round((width * (FACE_PATCH.y1 - FACE_PATCH.y0)) / (2 * halfWidth)));
}

/**
 * 在 width×height 的畫布上繪製一種表情（透明背景）。
 * 以「觀看者座標」作畫：X 往右、y 往上，單位與模型相同。
 */
export function paintFace(ctx: Ctx, width: number, height: number, expression: FaceExpression, halfWidth = faceHalfWidth()): void {
  const Y = FACE_PATCH.y1 - FACE_PATCH.y0;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  // X → 畫布 x：width/2 + X·width/(2W)；y → 畫布 y：height·(y1 - y)/Y
  ctx.setTransform(width / (2 * halfWidth), 0, 0, -height / Y, width / 2, (height * FACE_PATCH.y1) / Y);
  const c = faceFeatureCenters();

  drawBlush(ctx, c.blushL);
  drawBlush(ctx, c.blushR);

  if (expression === "hurt") {
    drawHurtEye(ctx, c.eyeL, 1);
    drawHurtEye(ctx, c.eyeR, -1);
    drawHurtMouth(ctx, c.mouth);
  } else {
    drawEye(ctx, c.eyeL, -1, expression === "angry");
    drawEye(ctx, c.eyeR, 1, expression === "angry");
    if (expression === "angry") drawAngryMouth(ctx, c.mouth);
    else drawSmile(ctx, c.mouth);
  }
  ctx.restore();
}

const EYE_RX = 0.088;
const EYE_RY = 0.112;

/** side：-1 = 畫面左眼、1 = 畫面右眼（決定生氣時眼角斜切方向） */
function drawEye(ctx: Ctx, [x, y]: [number, number], side: number, angry: boolean): void {
  ctx.save();
  ctx.save();
  // 眼形（生氣時上緣靠鼻樑側被斜切：瞇眼瞪人）
  const shape = new Path2D();
  shape.ellipse(x, y, EYE_RX, EYE_RY, 0, 0, Math.PI * 2);
  ctx.clip(shape);
  if (angry) {
    const cut = new Path2D();
    const inner = x - side * EYE_RX * 1.3;
    const outer = x + side * EYE_RX * 1.3;
    cut.moveTo(inner, y + EYE_RY * 0.3);
    cut.lineTo(outer, y + EYE_RY * 0.9);
    cut.lineTo(outer, y - EYE_RY * 1.3);
    cut.lineTo(inner, y - EYE_RY * 1.3);
    cut.closePath();
    ctx.clip(cut);
  }
  // 底色：上深下亮的深藍漸層
  const base = ctx.createLinearGradient(0, y + EYE_RY, 0, y - EYE_RY);
  base.addColorStop(0, "#0a1238");
  base.addColorStop(0.55, "#172c86");
  base.addColorStop(1, "#2a58d8");
  ctx.fillStyle = base;
  ctx.fillRect(x - EYE_RX * 1.5, y - EYE_RY * 1.5, EYE_RX * 3, EYE_RY * 3);
  // 虹膜：下半部亮青藍（設定圖的水汪汪感）
  const iris = ctx.createRadialGradient(x, y - EYE_RY * 0.45, 0.005, x, y - EYE_RY * 0.35, EYE_RX * 0.95);
  iris.addColorStop(0, "#9ff0ff");
  iris.addColorStop(0.45, "#46b6ff");
  iris.addColorStop(1, "rgba(40,110,240,0)");
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.ellipse(x, y - EYE_RY * 0.38, EYE_RX * 0.82, EYE_RY * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  // 瞳孔暗區
  ctx.fillStyle = "rgba(8,14,50,0.55)";
  ctx.beginPath();
  ctx.ellipse(x, y + EYE_RY * 0.05, EYE_RX * 0.42, EYE_RY * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 上眼線（較粗、外眼角微翹）
  ctx.strokeStyle = "#070b2a";
  ctx.lineCap = "round";
  ctx.lineWidth = 0.016;
  ctx.beginPath();
  if (angry) {
    ctx.moveTo(x - side * EYE_RX * 0.95, y + EYE_RY * 0.28);
    ctx.lineTo(x + side * EYE_RX * 1.0, y + EYE_RY * 0.86);
  } else {
    ctx.ellipse(x, y, EYE_RX * 1.02, EYE_RY * 1.02, 0, Math.PI * 0.18, Math.PI * 0.82);
  }
  ctx.stroke();

  // 高光（光源在左上）：大、中、小三層
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(x - EYE_RX * 0.32, y + EYE_RY * 0.38, EYE_RX * 0.36, EYE_RY * 0.27, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + EYE_RX * 0.38, y - EYE_RY * 0.42, EYE_RX * 0.17, EYE_RY * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(x + EYE_RX * 0.05, y + EYE_RY * 0.62, EYE_RX * 0.08, EYE_RY * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (angry) {
    // 怒眉：內低外高的粗短眉
    ctx.save();
    ctx.strokeStyle = "#0b1240";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.024;
    ctx.beginPath();
    ctx.moveTo(x - side * EYE_RX * 0.9, y + EYE_RY * 1.12);
    ctx.lineTo(x + side * EYE_RX * 0.95, y + EYE_RY * 1.62);
    ctx.stroke();
    ctx.restore();
  }
}

/** 受傷 > <：dir = 1 畫「>」、-1 畫「<」 */
function drawHurtEye(ctx: Ctx, [x, y]: [number, number], dir: number): void {
  ctx.save();
  ctx.strokeStyle = "#0b1240";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 0.022;
  const w = EYE_RX * 0.85, h = EYE_RY * 0.6;
  ctx.beginPath();
  ctx.moveTo(x - dir * w, y + h);
  ctx.lineTo(x + dir * w, y);
  ctx.lineTo(x - dir * w, y - h);
  ctx.stroke();
  ctx.restore();
}

function drawBlush(ctx: Ctx, [x, y]: [number, number]): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1.6, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.055);
  g.addColorStop(0, "rgba(255,120,160,0.75)");
  g.addColorStop(0.6, "rgba(255,130,170,0.4)");
  g.addColorStop(1, "rgba(255,140,180,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 腮紅上的三道細斜線（日系插畫常見筆觸）
  ctx.save();
  ctx.strokeStyle = "rgba(255,95,140,0.55)";
  ctx.lineWidth = 0.005;
  ctx.lineCap = "round";
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * 0.022 - 0.008, y - 0.012);
    ctx.lineTo(x + i * 0.022 + 0.008, y + 0.012);
    ctx.stroke();
  }
  ctx.restore();
}

/** 張開的「D」形笑口 + 舌頭 */
function drawSmile(ctx: Ctx, [x, y]: [number, number]): void {
  const w = 0.068, h = 0.066;
  ctx.save();
  const mouth = new Path2D();
  mouth.moveTo(x - w, y + h * 0.35);
  mouth.quadraticCurveTo(x, y + h * 0.52, x + w, y + h * 0.35);
  mouth.bezierCurveTo(x + w * 0.95, y - h * 0.75, x - w * 0.95, y - h * 0.75, x - w, y + h * 0.35);
  mouth.closePath();
  ctx.fillStyle = "#b8284a";
  ctx.fill(mouth);
  ctx.save();
  ctx.clip(mouth);
  ctx.fillStyle = "#ff8fa6";
  ctx.beginPath();
  ctx.ellipse(x, y - h * 0.55, w * 0.62, h * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#5a1028";
  ctx.lineWidth = 0.007;
  ctx.lineJoin = "round";
  ctx.stroke(mouth);
  ctx.restore();
}

/** 生氣：小小的倒 D 嘴（咬牙不滿） */
function drawAngryMouth(ctx: Ctx, [x, y]: [number, number]): void {
  const w = 0.05, h = 0.045;
  ctx.save();
  const m = new Path2D();
  m.moveTo(x - w, y - h * 0.3);
  m.bezierCurveTo(x - w * 0.9, y + h * 0.9, x + w * 0.9, y + h * 0.9, x + w, y - h * 0.3);
  m.quadraticCurveTo(x, y - h * 0.05, x - w, y - h * 0.3);
  m.closePath();
  ctx.fillStyle = "#a82344";
  ctx.fill(m);
  ctx.strokeStyle = "#5a1028";
  ctx.lineWidth = 0.007;
  ctx.stroke(m);
  ctx.restore();
}

/** 受傷：波浪小嘴 */
function drawHurtMouth(ctx: Ctx, [x, y]: [number, number]): void {
  ctx.save();
  ctx.strokeStyle = "#5a1028";
  ctx.lineWidth = 0.012;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const w = 0.06;
  ctx.moveTo(x - w, y);
  for (let i = 1; i <= 4; i++) ctx.lineTo(x - w + (2 * w * i) / 4, y + (i % 2 ? 0.022 : 0));
  ctx.stroke();
  ctx.restore();
}
