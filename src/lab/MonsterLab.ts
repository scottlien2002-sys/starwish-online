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
import { MonsterAnimator } from "../monsters/anim/MonsterAnimator.ts";
import type { MonsterAction, MonsterPose, MonsterState } from "../monsters/anim/types.ts";
import { StarDewBoboModel } from "../monsters/star-dew-bobo/StarDewBoboModel.ts";
import { STAR_DEW_BOBO_PROFILE } from "../monsters/star-dew-bobo/profile.ts";
import { MONSTER_CANON, MONSTER_CANON_EN } from "../core/canon.ts";
import { checkHud, type Insets } from "../ui/layout-check.ts";

const ACTIONS: { action: MonsterAction; label: string }[] = [
  { action: "idle", label: "待機" },
  { action: "move", label: "移動" },
  { action: "attack", label: "攻擊" },
  { action: "hit", label: "受傷" },
  { action: "death", label: "死亡" },
  { action: "respawn", label: "重生" },
];

const STATE_LABEL: Record<MonsterState, string> = {
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
  request(a: MonsterAction): { accepted: boolean; reason?: string; overlay?: boolean; queued?: boolean };
  state(): MonsterState;
  pose(): MonsterPose;
  history(): MonsterState[];
  hudIssues(insets?: Insets): string[];
  fps(): number;
  setAutoDemo(on: boolean): void;
}

declare global {
  interface Window {
    __starwishLab?: LabDebugApi;
  }
}

export function startMonsterLab(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  const engine = new Engine(canvas, true, { stencil: true, premultipliedAlpha: false }, false);
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, TUNING.render.maxDevicePixelRatio));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.skipPointerMovePicking = true;
  scene.autoClearDepthAndStencil = true;

  const hemi = new HemisphericLight("sky", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.85;
  hemi.groundColor = new Color3(0.6, 0.68, 0.6);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.5).normalize(), scene);
  sun.position = new Vector3(4, 10, 5);
  sun.intensity = 0.6;
  // V1.2 效能：陰影貼圖 1024 → 512（只有一隻怪物，畫質差異不明顯）
  const shadows = new ShadowGenerator(512, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.darkness = 0.4;

  // V1.2 效能：光暈運算解析度 0.5 → 0.3、模糊半徑 24 → 16
  const glow = new GlowLayer("glow", scene, { mainTextureRatio: 0.3, blurKernelSize: 16 });
  glow.intensity = 0.75;

  // 小草地
  const grassMat = new StandardMaterial("PH_labGrass", scene);
  grassMat.diffuseColor = new Color3(0.55, 0.82, 0.45);
  grassMat.specularColor = new Color3(0.03, 0.03, 0.03);
  const ground = MeshBuilder.CreateCylinder("PH_labGround", { diameter: 9, height: 0.2, tessellation: 48 }, scene);
  ground.position.y = -0.1;
  ground.material = grassMat;
  ground.receiveShadows = true;

  const model = new StarDewBoboModel(scene, { height: 0.8, shadows, glow });
  const animator = new MonsterAnimator(STAR_DEW_BOBO_PROFILE, model);

  const camera = new ArcRotateCamera("labCam", Math.PI / 2, 1.2, 3.4, new Vector3(0, 0.45, 0), scene);
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
      <div class="lab-name">${MONSTER_CANON.star_dew_bobo} <small>${MONSTER_CANON_EN.star_dew_bobo}</small></div>
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
    const r = animator.request(a);
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
  let lastPose: MonsterPose = STAR_DEW_BOBO_PROFILE.idle(0);
  // V1.2：移動改為在鏡頭前左右來回（原本繞圓圈，身體一直旋轉）
  let moveX = 0;
  let moveDir = 1;
  let uiTimer = 0;
  const MOVE_RANGE = 1.1;
  const SPEED = 0.9;
  // V1.2 效能：自動調整解析度（連續 2 秒低於 40 FPS 就降一級，最低為 1 倍像素）
  const scaleSteps = [Math.min(window.devicePixelRatio || 1, TUNING.render.maxDevicePixelRatio), 1.5, 1.25, 1].filter(
    (v, i, arr) => i === 0 || v < arr[0]!,
  );
  let scaleIndex = 0;
  let lowFpsTime = 0;
  let qualityCooldown = 3;

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

    const frame = animator.update(dt);
    lastPose = frame.pose;
    if (history[history.length - 1] !== frame.state) history.push(frame.state);

    // 移動狀態：沿小圓彈跳前進，面向前進方向
    if (frame.state === "move") {
      moveX += moveDir * SPEED * dt;
      if (Math.abs(moveX) > MOVE_RANGE) {
        moveX = Math.sign(moveX) * MOVE_RANGE;
        moveDir = -moveDir;
      }
      model.root.position.x = moveX;
      // 以 3/4 側面朝向鏡頭前進：轉身只在折返時發生，而且平滑轉動
      const moveYaw = moveDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      const camYaw = Math.atan2(camera.position.x - model.root.position.x, camera.position.z - model.root.position.z);
      const diff = Math.atan2(Math.sin(camYaw - moveYaw), Math.cos(camYaw - moveYaw));
      const target = moveYaw + diff * 0.65;
      let d = target - model.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      model.root.rotation.y += d * Math.min(1, dt * 6);
    } else if (frame.state === "idle" || frame.state === "respawn" || frame.state === "attack") {
      // 待機/重生：轉回面向鏡頭
      // 攻擊（V1.2）：轉成 3/4 側面，讓蓄力、衝撞、回彈三階段看得清楚（原本正對鏡頭衝過來，會被按鈕擋住）
      const camYaw = Math.atan2(camera.position.x - model.root.position.x, camera.position.z - model.root.position.z);
      const attacking = frame.state === "attack";
      const target = attacking ? camYaw + 1.05 : camYaw;
      let d = target - model.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      model.root.rotation.y += d * Math.min(1, dt * (attacking ? 14 : 3));
    }
    const tgt = model.root.position;
    camera.target.x += (tgt.x - camera.target.x) * Math.min(1, dt * 4);
    camera.target.z += (tgt.z - camera.target.z) * Math.min(1, dt * 4);

    scene.render();

    // 自動解析度
    qualityCooldown -= dt;
    if (engine.getFps() < 40) lowFpsTime += dt;
    else lowFpsTime = 0;
    if (lowFpsTime > 2 && qualityCooldown <= 0 && scaleIndex < scaleSteps.length - 1) {
      scaleIndex++;
      engine.setHardwareScalingLevel(1 / scaleSteps[scaleIndex]!);
      lowFpsTime = 0;
      qualityCooldown = 3;
    }

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
      fpsEl.textContent = `${Math.round(engine.getFps())} FPS · ${scaleSteps[scaleIndex]}x`;
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
    request: (a) => doRequest(a),
    state: () => animator.sm.state,
    pose: () => lastPose,
    history: () => [...history],
    hudIssues: (insets) => checkHud(document, insets),
    fps: () => engine.getFps(),
    setAutoDemo: (on) => {
      autoDemo = on;
      demoBtn.classList.toggle("on", on);
      demoIndex = 0;
      demoWait = 0;
    },
  };
}
