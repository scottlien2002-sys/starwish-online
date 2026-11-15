import { test } from "node:test";
import assert from "node:assert/strict";
import { BODY_HEIGHT, BODY_MAX_RADIUS, normalToRotation, profileR, profileY, radiusAtHeight, surfacePoint } from "../../src/monsters/star-dew-bobo/shape.ts";

test("身體輪廓：底部到頂端連續、高度單調、頂端收尖", () => {
  let prevY = -1;
  let maxR = 0;
  let maxAt = 0;
  for (let t = 0; t <= 1.0000001; t += 0.01) {
    const y = profileY(t);
    assert.ok(y >= prevY - 1e-12, "高度必須遞增");
    prevY = y;
    const r = profileR(t);
    if (r > maxR) {
      maxR = r;
      maxAt = y;
    }
  }
  assert.ok(Math.abs(profileY(1) - BODY_HEIGHT) < 1e-9);
  assert.ok(profileR(0) < 1e-9 && profileR(1) < 1e-9, "兩端閉合");
  assert.ok(maxR <= BODY_MAX_RADIUS + 1e-9);
  assert.ok(maxAt < BODY_HEIGHT * 0.6, "最寬處應在中下段（圓潤下盤）");
  // 頂端比底部更窄（水滴形）
  assert.ok(radiusAtHeight(BODY_HEIGHT * 0.85) < radiusAtHeight(BODY_HEIGHT * 0.15));
});

test("表面點：在身體表面上，法線為單位向量且朝外", () => {
  for (const [y, th] of [[0.5, 0.3], [0.5, -0.3], [0.36, 0], [0.22, 0.2], [0.42, Math.PI * 0.55]] as const) {
    const p = surfacePoint(y, th);
    assert.ok(Math.abs(Math.hypot(p.x, p.z) - radiusAtHeight(y)) < 1e-6);
    assert.ok(Math.abs(Math.hypot(p.nx, p.ny, p.nz) - 1) < 1e-6);
    // 朝外：法線與水平向外方向同側
    assert.ok(p.nx * p.x + p.nz * p.z > 0);
  }
});

test("臉部位置：眼睛在正面、左右對稱", () => {
  const l = surfacePoint(0.5, -0.3);
  const r = surfacePoint(0.5, 0.3);
  assert.ok(l.z > 0 && r.z > 0, "眼睛在正面 (+z)");
  assert.ok(Math.abs(l.x + r.x) < 1e-9 && Math.abs(l.z - r.z) < 1e-9, "左右對稱");
});

test("法線轉旋轉：正前方為 0，朝上時抬頭", () => {
  const f = normalToRotation(0, 0, 1);
  assert.ok(Math.abs(f.x) < 1e-9 && Math.abs(f.y) < 1e-9);
  const up = normalToRotation(0, 0.5, Math.sqrt(0.75));
  assert.ok(up.x < 0, "Babylon 中 rotation.x 為負代表 +z 往上抬");
  const side = normalToRotation(1, 0, 0);
  assert.ok(Math.abs(side.y - Math.PI / 2) < 1e-9);
});

import { featureCounterScale } from "../../src/monsters/star-dew-bobo/shape.ts";

test("五官反向補償：身體壓扁時五官形狀變形量大幅降低", () => {
  const sxz = 1.054;
  const sy = 0.9;
  const c = featureCounterScale(sxz, sy, 0.8);
  // 五官最終形狀 = 身體縮放 × 補償
  const eyeY = sy * c.y;
  const eyeX = sxz * c.x;
  assert.ok(Math.abs(eyeY - 1) < Math.abs(sy - 1) * 0.25, `高度變形 ${eyeY}`);
  assert.ok(Math.abs(eyeX - 1) < Math.abs(sxz - 1) * 0.25, `寬度變形 ${eyeX}`);
  const none = featureCounterScale(1, 1);
  assert.deepEqual(none, { x: 1, y: 1, z: 1 });
});
