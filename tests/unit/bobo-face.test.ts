import assert from "node:assert/strict";
import { test } from "node:test";
import { FACE_PATCH, buildFacePatch, faceFeatureCenters, faceHalfWidth, faceTextureHeight, faceUV, triangleNormal } from "../../src/monsters/star-dew-bobo/face.ts";
import { radiusAtHeight, surfacePoint } from "../../src/monsters/star-dew-bobo/shape.ts";

test("臉部補丁：每個頂點都貼在身體曲面上（只浮起 lift）", () => {
  const g = buildFacePatch(12, 16);
  for (let i = 0; i < g.positions.length; i += 3) {
    const x = g.positions[i]!, y = g.positions[i + 1]!, z = g.positions[i + 2]!;
    const nx = g.normals[i]!, ny = g.normals[i + 1]!, nz = g.normals[i + 2]!;
    // 扣掉 lift 後應落在表面：水平半徑 = 該高度的身體半徑
    const bx = x - nx * FACE_PATCH.lift, by = y - ny * FACE_PATCH.lift, bz = z - nz * FACE_PATCH.lift;
    assert.ok(Math.abs(Math.hypot(bx, bz) - radiusAtHeight(by)) < 1e-3, `vertex ${i / 3} off surface`);
    assert.ok(z > 0, "補丁只在正面");
  }
});

test("臉部補丁：三角形朝外（與表面法線同向），且 UV 在 0..1", () => {
  const g = buildFacePatch(10, 12);
  for (let i = 0; i < g.indices.length; i += 3) {
    const a = g.indices[i]!;
    const n = triangleNormal(g.positions, a, g.indices[i + 1]!, g.indices[i + 2]!);
    const d = n[0] * g.normals[a * 3]! + n[1] * g.normals[a * 3 + 1]! + n[2] * g.normals[a * 3 + 2]!;
    assert.ok(d > 0, `triangle ${i / 3} faces inward`);
  }
  for (const u of g.uvs) assert.ok(u >= -1e-9 && u <= 1 + 1e-9);
});

test("正面投影：角色右側 (+x) 出現在貼圖左半（觀看者視角）", () => {
  const W = faceHalfWidth();
  const right = surfacePoint(0.5, 0.5);
  assert.ok(faceUV(right.x, right.y, W)[0] < 0.5);
  assert.equal(faceUV(0, FACE_PATCH.y0, W)[1], 0);
  const c = faceFeatureCenters();
  assert.ok(c.eyeL[0] < 0 && c.eyeR[0] > 0 && Math.abs(c.eyeL[0] + c.eyeR[0]) < 1e-9);
  assert.ok(c.mouth[1] < c.eyeL[1] && c.blushL[1] < c.eyeL[1]);
});

test("貼圖尺寸讓 x、y 每單位像素相同", () => {
  const W = faceHalfWidth();
  const h = faceTextureHeight(1024, W);
  const pxPerUnitX = 1024 / (2 * W);
  const pxPerUnitY = h / (FACE_PATCH.y1 - FACE_PATCH.y0);
  assert.ok(Math.abs(pxPerUnitX / pxPerUnitY - 1) < 0.01);
});
