import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { MotionProbe, Spring2, SPRINGS } from "../../src/characters/secondaryMotion.ts";
import { noviceVersionFor, NOVICE_MALE_N75 } from "../../src/game/noviceVersion.ts";
import { ANIM_TIMING } from "../../src/actors/animTiming.ts";

const MODELS = new URL("../../public/models/", import.meta.url).pathname;

// ---------------- 版本選擇 ----------------
test("7.5 版本：男性預設新版 n75；&nv=c10b5b 切回舊版；女性維持 C1.0-B5b", () => {
  assert.equal(noviceVersionFor("male"), NOVICE_MALE_N75);
  assert.equal(noviceVersionFor("male", new URLSearchParams("nv=c10b5b")), "c10b5b");
  assert.equal(noviceVersionFor("female"), "c10b5b");
  assert.equal(noviceVersionFor("female", new URLSearchParams("nv=n75")), "c10b5b", "女性這階段不換");
  assert.ok(ANIM_TIMING.run.groundSpeedBy.n75!.male > 3, "新版腿長約 2.1 倍 → 跑步地面速度要重新量測");
});

// ---------------- 次級動態 ----------------
test("7.5 次級動態：起跑、急停時頭髮甩動，之後回到靜止；角度有上限", () => {
  const s = new Spring2(SPRINGS.Hair_Back);
  let maxP = 0;
  for (let i = 0; i < 20; i++) {
    s.step(1 / 60, 25, 0, 0, Math.min(5, i * 0.4));
    maxP = Math.max(maxP, s.pitch);
  }
  assert.ok(maxP > 0.05, `起跑時往後甩（${maxP.toFixed(3)}）`);
  assert.ok(maxP <= SPRINGS.Hair_Back.limit + 1e-9);
  for (let i = 0; i < 600; i++) s.step(1 / 60, 0, 0, 0, 0);
  assert.ok(Math.abs(s.pitch) < 0.005 && Math.abs(s.roll) < 0.005, "停下 10 秒後回到原位");
});

test("7.5 次級動態：極端輸入（瞬移、大 dt）也不會爆掉或超過上限", () => {
  const s = new Spring2(SPRINGS.Hood);
  for (let i = 0; i < 100; i++) s.step(i % 2 ? 0.5 : 1 / 60, i % 2 ? 999 : -999, 999, 99, 50);
  assert.ok(Number.isFinite(s.pitch) && Number.isFinite(s.roll));
  assert.ok(Math.abs(s.pitch) <= SPRINGS.Hood.limit + 1e-9 && Math.abs(s.roll) <= SPRINGS.Hood.limit + 1e-9);
});

test("7.5 次級動態：MotionProbe 從位置推得本地前進加速度與轉向", () => {
  const p = new MotionProbe();
  let x = 0;
  let v = 0;
  for (let i = 0; i < 30; i++) {
    v += 5 / 30;
    x += v / 60;
    p.sample(1 / 60, 0, x, 0);
  }
  assert.ok(p.accFwd > 3, `往前加速（${p.accFwd.toFixed(2)}）`);
  const q = new MotionProbe();
  for (let i = 0; i < 30; i++) q.sample(1 / 60, 0, 0, i * 0.05);
  assert.ok(q.turnRate > 2, `轉向角速度（${q.turnRate.toFixed(2)}）`);
});

// ---------------- GLB 資產 ----------------
function glbJson(file: string): Record<string, unknown> & { [k: string]: any } {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
}

const REQUIRED = [
  "Idle", "Walk", "Run", "Wait", "Attack", "Hurt", "Death", "Jump", "Jump_Land",
  "Attack_Unarmed", "Attack_1H_Chop", "Attack_1H_Thrust", "Attack_2H_Slash", "Attack_2H_Smash",
  "Attack_Polearm_Thrust", "Attack_Polearm_Swing", "Attack_Hammer_Smash", "Cast_Staff", "Cast_Heal", "Attack_Throw", "Block",
];

for (const lod of ["hq", "lite"] as const) {
  test(`7.5 GLB（${lod}）：動作、骨架、掛點、輔助骨骼齊全；沒有需要外部解碼器的壓縮`, () => {
    const f = `${MODELS}novice_n75_male_${lod}.glb`;
    assert.ok(existsSync(f), f);
    const j = glbJson(f);
    const names = (j.animations as { name: string }[]).map((a) => a.name);
    for (const r of REQUIRED) assert.ok(names.includes(r), `缺少動作 ${r}`);
    const nodes = (j.nodes as { name: string }[]).map((n) => n.name);
    for (const n of ["Weapon_R", "Weapon_L", "Hair_Back", "Hood", "Hem_F", "Hem_B", "Head", "R_Hand", "L_Hand"]) assert.ok(nodes.includes(n), `缺少節點 ${n}`);
    const skin = (j.skins as { joints: number[] }[])[0]!;
    assert.equal(skin.joints.length, 78 + 4, "Tripo 原本 78 根骨骼＋4 根輔助骨骼");
    const ext = (j.extensionsUsed as string[] | undefined) ?? [];
    assert.ok(!ext.some((e) => /meshopt|draco/i.test(e)), `不使用需要外部解碼器的壓縮：${ext}`);
    assert.ok(statSync(f).size < (lod === "hq" ? 6e6 : 3e6), `檔案大小 ${statSync(f).size}`);
  });
}

test("7.5 動作清單 JSON：攻擊類動作都有命中／釋放時間標記", () => {
  const m = JSON.parse(readFileSync(`${MODELS}novice_n75_male.json`, "utf8"));
  for (const n of REQUIRED.filter((x) => /^Attack|^Cast/.test(x))) {
    const marks = m.clips[n].marks;
    assert.ok(typeof marks.hit === "number" || typeof marks.release === "number", `${n} 缺少命中時間`);
  }
  assert.ok(m.clips.Idle.loop && m.clips.Run.loop && m.clips.Walk.loop);
});
