import { test } from "node:test";
import assert from "node:assert/strict";
import { createMonsterRegistry, MonsterFactory, ProceduralVisual, type IMonsterVisual } from "../../src/monsters/framework/index.ts";
import type { MonsterView } from "../../src/monsters/anim/types.ts";
import { BOBO_MODEL_IDS, boboVariantFromSearch } from "../../src/game/boboVariant.ts";

/** Stage 5.1：V3.8R 整合適配器的框架層檢查（不需要 Babylon） */

const fakeView = (): MonsterView & { tag: string } => ({
  tag: "",
  applyPose() {},
  playEffect() {},
  update() {},
  dispose() {},
});

function setup() {
  const made: string[] = [];
  const registry = createMonsterRegistry()
    .addVisual("star_dew_bobo_procedural", () => {
      made.push("v2");
      return new ProceduralVisual(fakeView(), () => {});
    })
    .addVisual("star_dew_bobo_v38r", () => {
      made.push("v38r");
      return new ProceduralVisual(fakeView(), () => {});
    });
  return { factory: new MonsterFactory(registry), made };
}

test("外觀切換：預設 V2；只有 ?bobo=v38r 才用 V3.8R；其他值一律回退 V2", () => {
  assert.equal(boboVariantFromSearch(""), "v2");
  assert.equal(boboVariantFromSearch("?bobo=v38r"), "v38r");
  assert.equal(boboVariantFromSearch("?q=high&bobo=v38r"), "v38r");
  assert.equal(boboVariantFromSearch("?bobo=v2"), "v2");
  assert.equal(boboVariantFromSearch("?bobo=V38R"), "v2");
  assert.equal(boboVariantFromSearch("?bobo=v38"), "v2");
  assert.equal(BOBO_MODEL_IDS.v2, "star_dew_bobo_procedural");
  assert.equal(BOBO_MODEL_IDS.v38r, "star_dew_bobo_v38r");
});

test("SpawnOptions.modelId：只換外觀，數值與動畫設定與 V2 完全相同", () => {
  const { factory, made } = setup();
  const a = factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 });
  const b = factory.create("star_dew_bobo", { x: 1, y: 0, z: 0 }, { modelId: "star_dew_bobo_v38r" });
  assert.deepEqual(made, ["v2", "v38r"]);
  assert.equal(a.instance.definition, b.instance.definition);
  assert.equal(a.profile, b.profile);
  assert.equal(b.instance.definition.modelId, "star_dew_bobo_procedural", "定義本身未被修改");
  assert.equal(b.instance.definition.maxHp, a.instance.definition.maxHp);
  assert.equal(b.instance.definition.attack, a.instance.definition.attack);
  assert.equal(b.instance.definition.attackCooldown, a.instance.definition.attackCooldown);
  assert.equal(b.instance.definition.respawnTime, a.instance.definition.respawnTime);
});

test("SpawnOptions.modelId：未註冊的模型立刻報錯", () => {
  const { factory } = setup();
  assert.throws(() => factory.create("star_dew_bobo", { x: 0, y: 0, z: 0 }, { modelId: "nope" }), /找不到模型 nope/);
});

test("三隻同場：各自一個視覺實例（V3.8R 適配器的共用資源在 Babylon 端以引用計數管理）", () => {
  const { factory, made } = setup();
  const vs: (IMonsterVisual | null)[] = [0, 1, 2].map((i) => factory.create("star_dew_bobo", { x: i, y: 0, z: 0 }, { modelId: "star_dew_bobo_v38r" }).visual);
  assert.equal(made.length, 3);
  assert.equal(new Set(vs).size, 3);
});
