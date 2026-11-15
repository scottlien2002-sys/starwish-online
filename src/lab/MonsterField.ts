import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  GlowLayer,
  HemisphericLight,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { TUNING } from "../config/tuning.ts";
import { MonsterFactory, createMonsterRegistry, type MonsterController, type MonsterTarget } from "../monsters/framework/index.ts";
import { registerBabylonVisuals } from "../monsters/babylon/registerVisuals.ts";
import { checkHud, type Insets } from "../ui/layout-check.ts";

export interface FieldMonsterInfo {
  id: string;
  monsterId: string;
  state: string;
  mode: string;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
}

export interface FieldDebugApi {
  ready: boolean;
  monsters(): FieldMonsterInfo[];
  /** 對最近的存活怪物造成傷害，回傳該怪物 id */
  damageNearest(amount: number): string | null;
  /** 固定目標位置（null = 恢復自動移動） */
  setTarget(pos: { x: number; z: number } | null): void;
  hudIssues(insets?: Insets): string[];
  fps(): number;
}

declare global {
  interface Window {
    __starwishField?: FieldDebugApi;
  }
}

const MODE_LABEL: Record<string, string> = {
  idle: "待機",
  patrol: "巡邏",
  chase: "追擊",
  attack: "攻擊",
  return: "返回",
  dead: "死亡",
  respawn: "重生",
};

/**
 * 多怪物 AI 測試場（?lab=field）：
 * 3 隻星露啵啵（程式化模型）＋ 2 隻測試方塊（GLB 模型），全部由同一套框架與 AI 控制；
 * 藍色膠囊是「測試目標」，代表玩家，會自動繞行地圖，怪物會巡邏、追擊、攻擊、返回。
 */
export async function startMonsterField(canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<void> {
  const engine = new Engine(canvas, true, { stencil: true, premultipliedAlpha: false }, false);
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.skipPointerMovePicking = true;

  const hemi = new HemisphericLight("sky", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.85;
  hemi.groundColor = new Color3(0.6, 0.68, 0.6);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.5).normalize(), scene);
  sun.position = new Vector3(8, 16, 10);
  sun.intensity = 0.6;
  const shadows = new ShadowGenerator(512, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.darkness = 0.4;
  const glow = new GlowLayer("glow", scene, { mainTextureRatio: 0.3, blurKernelSize: 16 });
  glow.intensity = 0.7;

  const grass = new StandardMaterial("PH_fieldGrass", scene);
  grass.diffuseColor = new Color3(0.55, 0.82, 0.45);
  grass.specularColor = new Color3(0.03, 0.03, 0.03);
  const ground = MeshBuilder.CreateCylinder("PH_fieldGround", { diameter: 26, height: 0.2, tessellation: 64 }, scene);
  ground.position.y = -0.1;
  ground.material = grass;
  ground.receiveShadows = true;

  // 測試目標（代表玩家）
  const targetMat = new StandardMaterial("PH_targetMat", scene);
  targetMat.diffuseColor = new Color3(0.45, 0.55, 1);
  const targetMesh = MeshBuilder.CreateCapsule("PH_fieldTarget", { height: 1.2, radius: 0.25 }, scene);
  targetMesh.material = targetMat;
  shadows.addShadowCaster(targetMesh);

  const registry = registerBabylonVisuals(createMonsterRegistry(), { scene, shadows, glow });
  const factory = new MonsterFactory(registry);
  const spawns: [string, number, number][] = [
    ["star_dew_bobo", -5, -3],
    ["star_dew_bobo", 0, -6],
    ["star_dew_bobo", 5, -3],
    ["test_dummy", -4, 4],
    ["test_dummy", 4, 4],
  ];
  const monsters: MonsterController[] = spawns.map(([id, x, z]) => factory.create(id, { x, y: 0, z }));
  await Promise.all(monsters.map((m) => m.visual?.load()));

  const camera = new ArcRotateCamera("fieldCam", Math.PI / 2, 0.85, 20, new Vector3(0, 0, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = 30;
  camera.upperBetaLimit = 1.4;
  camera.panningSensibility = 0;

  uiRoot.innerHTML = `
    <div class="lab-title" data-layout="lab-title">
      <div class="lab-name">怪物 AI 測試場 <small>Monster Framework</small></div>
      <div class="lab-state">藍色膠囊 = 測試目標（代表玩家）</div>
      <div class="field-list"></div>
    </div>
    <div class="lab-fps" data-layout="lab-fps">-- FPS</div>
    <div class="lab-panel field-panel">
      <button class="lab-btn" data-act="damage" data-layout="btn-damage">攻擊最近怪物</button>
      <button class="lab-btn" data-act="pause" data-layout="btn-pause">目標停止移動</button>
    </div>`;
  const listEl = uiRoot.querySelector<HTMLDivElement>(".field-list")!;
  const fpsEl = uiRoot.querySelector<HTMLDivElement>(".lab-fps")!;
  const pauseBtn = uiRoot.querySelector<HTMLButtonElement>('[data-act="pause"]')!;

  const target: MonsterTarget = { id: "test-target", x: 0, z: 0, alive: true };
  let fixed: { x: number; z: number } | null = null;
  let paused = false;
  let pathT = 0;
  let now = 0;
  let uiTimer = 0;

  const nearest = (): MonsterController | null => {
    let best: MonsterController | null = null;
    let bestD = Infinity;
    for (const m of monsters) {
      if (!m.instance.isAlive) continue;
      const d = Math.hypot(m.instance.currentPosition.x - target.x, m.instance.currentPosition.z - target.z);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  };
  const damageNearest = (amount: number): string | null => {
    const m = nearest();
    if (!m) return null;
    m.instance.receiveDamage(amount);
    return m.instance.instanceId;
  };

  uiRoot.querySelector('[data-act="damage"]')!.addEventListener("click", () => damageNearest(20));
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "目標繼續移動" : "目標停止移動";
  });

  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
    now += dt;
    if (fixed) {
      target.x = fixed.x;
      target.z = fixed.z;
    } else if (!paused) {
      // 8 字形路線：會經過每群怪物附近，也會遠離（觸發返回）
      pathT += dt * 0.22;
      target.x = Math.sin(pathT) * 9;
      target.z = Math.sin(pathT * 2) * 6;
    }
    targetMesh.position.set(target.x, 0.6, target.z);

    for (const m of monsters) m.update(dt, now, target);
    scene.render();

    uiTimer += dt;
    if (uiTimer > 0.25) {
      uiTimer = 0;
      listEl.innerHTML = monsters
        .map((m) => {
          const i = m.instance;
          const name = i.definition.testOnly ? "測試方塊" : i.definition.name;
          return `<div>${name}：${MODE_LABEL[m.brain?.mode ?? "idle"]}・HP ${i.currentHp}/${i.definition.maxHp}</div>`;
        })
        .join("");
      fpsEl.textContent = `${Math.round(engine.getFps())} FPS`;
    }
  });

  window.addEventListener("resize", () => engine.resize());

  window.__starwishField = {
    ready: true,
    monsters: () =>
      monsters.map((m) => ({
        id: m.instance.instanceId,
        monsterId: m.instance.definitionId,
        state: m.instance.currentState,
        mode: m.brain?.mode ?? "none",
        hp: m.instance.currentHp,
        maxHp: m.instance.definition.maxHp,
        x: m.instance.currentPosition.x,
        z: m.instance.currentPosition.z,
      })),
    damageNearest,
    setTarget: (pos) => {
      fixed = pos;
    },
    hudIssues: (insets) => checkHud(document, insets),
    fps: () => engine.getFps(),
  };
}
