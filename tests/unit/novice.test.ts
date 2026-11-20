import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  atlasOffset,
  benchLayout,
  expressionForAnim,
  NOVICE_ANIM_SECONDS,
  NOVICE_ANIMS,
  NOVICE_BONES,
  NOVICE_EXPRESSIONS,
  NOVICE_LOOPING,
  noviceBenchFromSearch,
  noviceFile,
} from "../../src/characters/novice.ts";
import { ATTACK_TIMING, ATTACK_DURATION } from "../../src/actors/attackAnim.ts";

test("初心者：檔名、動畫、表情對應", () => {
  assert.equal(noviceFile("male", "high"), "novice_male_v1_high.glb");
  assert.equal(noviceFile("female", "low"), "novice_female_v1_low.glb");
  assert.deepEqual([...NOVICE_ANIMS], ["Idle", "Walk", "Run", "Attack", "Hurt", "Death"]);
  assert.deepEqual(NOVICE_ANIMS.filter((a) => NOVICE_LOOPING[a]), ["Idle", "Walk", "Run"]);
  assert.equal(expressionForAnim("Idle"), "smile");
  assert.equal(expressionForAnim("Attack"), "serious");
  assert.equal(expressionForAnim("Hurt"), "hurt");
  assert.equal(expressionForAnim("Death"), "ko");
  // 攻擊動畫長度與遊戲的攻擊時間一致（0.50 秒，0.20 秒揮中）
  assert.equal(NOVICE_ANIM_SECONDS.Attack, ATTACK_DURATION);
  assert.equal(ATTACK_TIMING.hit, 0.2);
});

test("初心者：表情圖集 4×2 的 UV 平移", () => {
  assert.equal(NOVICE_EXPRESSIONS.length, 8);
  assert.deepEqual(atlasOffset(0), { du: 0, dv: 0 });
  assert.deepEqual(atlasOffset(3), { du: 0.75, dv: 0 });
  assert.deepEqual(atlasOffset(4), { du: 0, dv: 0.5 });
  assert.deepEqual(atlasOffset(7), { du: 0.75, dv: 0.5 });
});

test("初心者效能測試參數與站位", () => {
  const o = noviceBenchFromSearch("?lab=novice&bench=1&count=10&anim=attack&lod=low&dur=15");
  assert.deepEqual(o, { enabled: true, count: 10, anim: "Attack", lod: "low", seconds: 15, warmup: 2 });
  const d = noviceBenchFromSearch("?lab=novice");
  assert.equal(d.enabled, false);
  assert.equal(d.anim, "Run");
  assert.equal(noviceBenchFromSearch("?bench=1&count=999").count, 30);
  const pts = benchLayout(10);
  assert.equal(pts.length, 10);
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z) >= 0.9 - 1e-9, "角色不重疊");
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  assert.ok(Math.abs(cx) < 0.5);
});

/** 讀 GLB 的 JSON 區塊 */
function glbJson(path: string): { json: Record<string, unknown>; bytes: number } {
  const b = readFileSync(path);
  assert.equal(b.readUInt32LE(0), 0x46546c67, "glTF 二進位檔");
  assert.equal(b.readUInt32LE(4), 2, "glTF 2.0");
  const len = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as Record<string, unknown>, bytes: b.length };
}

type Gltf = {
  nodes: { name: string; children?: number[] }[];
  skins: { joints: number[] }[];
  animations: { name: string; channels: { target: { node: number; path: string } }[]; samplers: { input: number }[] }[];
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  accessors: { count: number; max?: number[] }[];
  materials: { name: string; alphaMode?: string }[];
};

for (const g of ["male", "female"] as const) {
  for (const lod of ["high", "low"] as const) {
    const path = `public/models/${noviceFile(g, lod)}`;
    test(`GLB ${noviceFile(g, lod)}：真的 3D 模型（蒙皮網格、共用骨架、6 段動畫、三角形預算）`, { skip: !existsSync(path) }, () => {
      const { json, bytes } = glbJson(path);
      const j = json as unknown as Gltf;
      // 骨架：名稱集合與規格相同（兩個角色共用）
      assert.equal(j.skins.length, 1);
      const joints = j.skins[0]!.joints.map((i) => j.nodes[i]!.name);
      assert.deepEqual([...joints].sort(), [...NOVICE_BONES].sort());
      // 動畫：6 段，名稱正確，都作用在骨頭上
      const names = j.animations.map((a) => a.name);
      assert.deepEqual([...names].sort(), [...NOVICE_ANIMS].sort());
      const jointSet = new Set(j.skins[0]!.joints);
      for (const a of j.animations) {
        assert.ok(a.channels.length >= NOVICE_BONES.length, `${a.name} 通道 ${a.channels.length}`);
        assert.ok(a.channels.every((c) => jointSet.has(c.target.node)), `${a.name} 只動骨頭`);
        const tmax = Math.max(...a.samplers.map((s) => j.accessors[s.input]!.max?.[0] ?? 0));
        const want = NOVICE_ANIM_SECONDS[a.name as keyof typeof NOVICE_ANIM_SECONDS];
        assert.ok(Math.abs(tmax - want) < 0.05, `${a.name} 長度 ${tmax}，應為 ${want}`);
      }
      // 網格：3 個（身體、光澤、臉），都有蒙皮權重與頂點色或貼圖 UV
      assert.equal(j.meshes.length, 3);
      let tris = 0;
      for (const m of j.meshes) {
        assert.equal(m.primitives.length, 1, `${m.name} 一個材質`);
        const p = m.primitives[0]!;
        assert.ok("JOINTS_0" in p.attributes && "WEIGHTS_0" in p.attributes, `${m.name} 有蒙皮`);
        assert.ok(!("JOINTS_1" in p.attributes), `${m.name} 每頂點最多 4 個權重`);
        assert.ok("NORMAL" in p.attributes);
        if (/Face/.test(m.name)) assert.ok("TEXCOORD_0" in p.attributes);
        else assert.ok("COLOR_0" in p.attributes, `${m.name} 頂點色`);
        tris += j.accessors[p.indices]!.count / 3;
      }
      const budget = lod === "high" ? 12500 : 7000;
      assert.ok(tris <= budget, `三角形 ${tris} 超過 ${budget}`);
      assert.ok(tris >= (lod === "high" ? 6000 : 3000), `三角形 ${tris} 太少，不像完整模型`);
      assert.ok(bytes < 2_000_000, `檔案 ${bytes} bytes`);
      // 臉部材質透明混合
      assert.ok(j.materials.some((m) => /Face/.test(m.name) && m.alphaMode === "BLEND"));
    });
  }
}

test("男女骨架完全相同（名稱與順序）", { skip: !existsSync("public/models/novice_male_v1_high.glb") || !existsSync("public/models/novice_female_v1_high.glb") }, () => {
  const names = (g: string) => {
    const j = glbJson(`public/models/novice_${g}_v1_high.glb`).json as unknown as Gltf;
    return j.skins[0]!.joints.map((i) => j.nodes[i]!.name);
  };
  assert.deepEqual(names("male"), names("female"));
});
