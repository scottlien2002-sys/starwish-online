import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { MonsterAction, MonsterPose, MonsterState } from "../monsters/anim/types.ts";
import { MonsterFactory, createMonsterRegistry } from "../monsters/framework/index.ts";
import { registerBabylonVisuals } from "../monsters/babylon/registerVisuals.ts";
import { MONSTER_CANON_EN, type MonsterId } from "../core/canon.ts";
import { checkHud, type Insets } from "../ui/layout-check.ts";
import { createEngine, createShadows, createSkyDome, pickQuality, setupRendering } from "../render/RenderQuality.ts";
import { PerfOverlay, type PerfStats } from "../render/PerfOverlay.ts";

const ACTIONS: { action: MonsterAction; label: string }[] = [
  { action: "idle", label: "待機" },
  { action: "move", label: "移動" },
  { action: "attack", label: "攻擊" },
  { action: "hit", label: "受傷" },
  { action: "death", label: "死亡" },
  { action: "respawn", label: "重生" },
];

const GENERIC_LABEL: Record<MonsterState, string> = {
  idle: "Idle 待機",
  move: "Move 移動",
  attack: "Attack 攻擊",
  hit: "Hit 受傷",
  death: "Death 死亡",
  dead: "已死亡（等待重生）",
  respawn: "Respawn 重生",
};

/** 星露啵啵專用說明（依設定圖動作名稱） */
const BOBO_LABEL: Record<MonsterState, string> = {
  idle: "Idle 待機（呼吸）",
  move: "Move 移動（彈跳）",
  attack: "Attack 攻擊（撞擊）",
  hit: "Hit 受傷",
  death: "Death 死亡（消散）",
  dead: "已死亡（等待重生）",
  respawn: "Respawn 重生（凝聚）",
};

/** 自動示範腳本：[等待秒數, 動作] */
const DEMO: [number, MonsterAction][] = [
  [0, "idle"],
  [2.4, "move"],
  [2.6, "idle"],
  [0.6, "attack"],
  [1.2, "hit"],
  [0.8, "attack"],
  [0.3, "hit"],
  [1.2, "death"],
  [2.2, "respawn"],
  [2.2, "idle"],
];

export interface LabDebugApi {
  ready: boolean;
  monsterId: string;
  hp(): number;
  request(a: MonsterAction): { accepted: boolean; reason?: string; overlay?: boolean; queued?: boolean };
  state(): MonsterState;
  pose(): MonsterPose;
  history(): MonsterState[];
  hudIssues(insets?: Insets): string[];
  fps(): number;
  setAutoDemo(on: boolean): void;
  perf(): PerfStats;
}

declare global {
  interface Window {
    __starwishLab?: LabDebugApi;
  }
}

/**
 * 單隻怪物動作測試頁（?lab=bobo、?lab=dummy）。
 * 通用怪物框架 V1.0 起，怪物由 MonsterFactory 建立（關閉 AI，以按鈕手動控制）。
 */
export async function startMonsterLab(canvas: HTMLCanvasElement, uiRoot: HTMLElement, monsterId = "star_dew_bobo"): Promise<void> {
  // 渲染升級：依畫質建立引擎（抗鋸齒方式）、3D 天空
  const quality = pickQuality();
  const engine = createEngine(canvas, quality);
  const scene = new Scene(engine);
  createSkyDome(scene);
  scene.skipPointerMovePicking = true;
  scene.autoClearDepthAndStencil = true;

  const hemi = new HemisphericLight("sky", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.85;
  hemi.groundColor = new Color3(0.6, 0.68, 0.6);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.5).normalize(), scene);
  sun.position = new Vector3(4, 10, 5);
  sun.intensity = 0.6;
  // 陰影依畫質（高 = 柔和接觸陰影）；測試頁只有一隻怪物，陰影貼圖上限 1024
  const shadows = createShadows(sun, { ...quality, shadows: { ...quality.shadows, mapSize: Math.min(1024, quality.shadows.mapSize) } });
  shadows.darkness = 0.4;

  // 小草地
  const grassMat = new StandardMaterial("PH_labGrass", scene);
  grassMat.diffuseColor = new Color3(0.55, 0.82, 0.45);
  grassMat.specularColor = new Color3(0.03, 0.03, 0.03);
  const ground = MeshBuilder.CreateCylinder("PH_labGround", { diameter: 9, height: 0.2, tessellation: 48 }, scene);
  ground.position.y = -0.1;
  ground.material = grassMat;
  ground.receiveShadows = true;

  const camera = new ArcRotateCamera("labCam", Math.PI / 2, 1.2, 3.4, new Vector3(0, 0.45, 0), scene);
  // 色調映射、曝光、後製抗鋸齒、選擇性 Bloom（星星與光環）；低畫質沒有 Bloom
  const render = setupRendering(scene, camera, quality);
  const glow = render.glow ?? undefined;
  const registry = registerBabylonVisuals(createMonsterRegistry(), { scene, shadows, glow });
  const def = registry.definition(monsterId);
  const ctrl = new MonsterFactory(registry).create(monsterId, { x: 0, y: 0, z: 0 }, { ai: false, instanceId: "lab" });
  await ctrl.visual?.load();
  const inst = ctrl.instance;
  const animator = ctrl.animator;
  const STATE_LABEL = monsterId === "star_dew_bobo" ? BOBO_LABEL : GENERIC_LABEL;
  const enName = MONSTER_CANON_EN[monsterId as MonsterId] ?? (def.testOnly ? "程式測試用" : "");

  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 1.6;
  camera.upperRadiusLimit = 7;
  camera.lowerBetaLimit = 0.35;
  camera.upperBetaLimit = 1.5;
  camera.panningSensibility = 0;
  camera.wheelPrecision = 60;
  camera.pinchPrecision = 120;
  camera.minZ = 0.05;

  // ---------- UI ----------
  uiRoot.innerHTML = `
    <div class="lab-title" data-layout="lab-title">
      <div class="lab-name">${def.name} <small>${enName}</small></div>
      <div class="lab-state">-</div>
      <div class="lab-msg"></div>
    </div>
    <div class="lab-fps" data-layout="lab-fps">-- FPS</div>
    <div class="lab-panel">
      ${ACTIONS.map((a) => `<button class="lab-btn" data-action="${a.action}" data-layout="btn-${a.action}">${a.label}</button>`).join("")}
      <button class="lab-btn lab-demo" data-layout="btn-demo">自動示範</button>
    </div>`;
  const stateEl = uiRoot.querySelector<HTMLDivElement>(".lab-state")!;
  const msgEl = uiRoot.querySelector<HTMLDivElement>(".lab-msg")!;
  const fpsEl = uiRoot.querySelector<HTMLDivElement>(".lab-fps")!;
  const demoBtn = uiRoot.querySelector<HTMLButtonElement>(".lab-demo")!;
  const buttons = [...uiRoot.querySelectorAll<HTMLButtonElement>("[data-action]")];

  let messageTimer = 0;
  const say = (text: string): void => {
    messageTimer = 2;
    msgEl.textContent = text;
  };

  const doRequest = (a: MonsterAction) => {
    const r = ctrl.request(a);
    if (!r.accepted) say(`無法執行：${r.reason ?? ""}`);
    else if (r.overlay) say("攻擊中受擊：只閃白，不中斷攻擊");
    else if (r.queued) say("已排隊：目前動作結束後切換");
    return r;
  };

  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      autoDemo = false;
      demoBtn.classList.remove("on");
      doRequest(btn.dataset.action as MonsterAction);
    });
  }

  let autoDemo = false;
  let demoIndex = 0;
  let demoWait = 0;
  demoBtn.addEventListener("click", () => {
    autoDemo = !autoDemo;
    demoBtn.classList.toggle("on", autoDemo);
    demoIndex = 0;
    demoWait = 0;
  });

  // ---------- 迴圈 ----------
  const history: MonsterState[] = [];
  let lastPose: MonsterPose = ctrl.profile.anim.idle(0);
  let now = 0;
  // V1.2：移動改為在鏡頭前左右來回（原本繞圓圈，身體一直旋轉）
  let moveX = 0;
  let moveDir = 1;
  let uiTimer = 0;
  const MOVE_RANGE = 1.1;
  const SPEED = 0.9;
  // 效能資訊＋畫質切換＋動態解析度（沿用 V1.2 機制：連續 2 秒低於 40 FPS 降一級）
  const perf = new PerfOverlay(engine, scene, quality, uiRoot);

  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);

    if (autoDemo) {
      demoWait -= dt;
      if (demoWait <= 0) {
        const [, action] = DEMO[demoIndex]!;
        doRequest(action);
        demoIndex = (demoIndex + 1) % DEMO.length;
        demoWait = DEMO[demoIndex]![0];
      }
    }

    now += dt;
    const frame = ctrl.update(dt, now);
    lastPose = frame.pose;
    if (history[history.length - 1] !== frame.state) history.push(frame.state);

    // 移動狀態：沿小圓彈跳前進，面向前進方向
    if (frame.state === "move") {
      moveX += moveDir * SPEED * dt;
      if (Math.abs(moveX) > MOVE_RANGE) {
        moveX = Math.sign(moveX) * MOVE_RANGE;
        moveDir = -moveDir;
      }
      inst.currentPosition.x = moveX;
      // 以 3/4 側面朝向鏡頭前進：轉身只在折返時發生，而且平滑轉動
      const moveYaw = moveDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      const camYaw = Math.atan2(camera.position.x - inst.currentPosition.x, camera.position.z - inst.currentPosition.z);
      const diff = Math.atan2(Math.sin(camYaw - moveYaw), Math.cos(camYaw - moveYaw));
      const target = moveYaw + diff * 0.65;
      let d = target - inst.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      inst.yaw += d * Math.min(1, dt * 6);
    } else if (frame.state === "idle" || frame.state === "respawn" || frame.state === "attack") {
      // 待機/重生：轉回面向鏡頭
      // 攻擊（V1.2）：轉成 3/4 側面，讓蓄力、衝撞、回彈三階段看得清楚（原本正對鏡頭衝過來，會被按鈕擋住）
      const camYaw = Math.atan2(camera.position.x - inst.currentPosition.x, camera.position.z - inst.currentPosition.z);
      const attacking = frame.state === "attack";
      const target = attacking ? camYaw + 1.05 : camYaw;
      let d = target - inst.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      inst.yaw += d * Math.min(1, dt * (attacking ? 14 : 3));
    }
    // 測試頁在框架更新後才移動/轉向，渲染前同步一次（與重構前相同：本幀立即生效）
    ctrl.visual?.setTransform(inst.currentPosition.x, inst.currentPosition.y, inst.currentPosition.z, inst.yaw);
    const tgt = inst.currentPosition;
    camera.target.x += (tgt.x - camera.target.x) * Math.min(1, dt * 4);
    camera.target.z += (tgt.z - camera.target.z) * Math.min(1, dt * 4);

    scene.render();

    perf.update(dt);

    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) msgEl.textContent = "";
    }
    uiTimer += dt;
    if (uiTimer > 0.1) {
      uiTimer = 0;
      stateEl.textContent = STATE_LABEL[frame.state];
      for (const b of buttons) {
        const a = b.dataset.action as MonsterAction;
        const ok = animator.check(a).accepted;
        b.classList.toggle("disabled", !ok);
        b.classList.toggle("active", (a === "idle" || a === "move") ? animator.sm.locomotion === a && (frame.state === "idle" || frame.state === "move") : frame.state === a);
      }
      fpsEl.textContent = `${Math.round(engine.getFps())} FPS · ${perf.pixelRatio}x`;
    }
  });

  const resize = (): void => engine.resize();
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  const block = (e: Event): void => e.preventDefault();
  document.addEventListener("gesturestart", block, { passive: false });
  document.addEventListener("dblclick", block, { passive: false });

  window.__starwishLab = {
    ready: true,
    monsterId,
    hp: () => inst.currentHp,
    request: (a) => doRequest(a),
    state: () => animator.sm.state,
    pose: () => lastPose,
    history: () => [...history],
    hudIssues: (insets) => checkHud(document, insets),
    fps: () => engine.getFps(),
    perf: () => perf.stats(),
    setAutoDemo: (on) => {
      autoDemo = on;
      demoBtn.classList.toggle("on", on);
      demoIndex = 0;
      demoWait = 0;
    },
  };
}
