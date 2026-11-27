import { Color3, DirectionalLight, type Engine, HemisphericLight, ReflectionProbe, RenderTargetTexture, Scene, type ShadowGenerator, Vector3 } from "@babylonjs/core";
import { TUNING } from "../config/tuning.ts";
import { InputState } from "../input/InputState.ts";
import { VirtualJoystick } from "../input/VirtualJoystick.ts";
import { CameraTouchControl } from "../input/CameraTouchControl.ts";
import { KeyboardInput } from "../input/KeyboardInput.ts";
import { Hud } from "../ui/Hud.ts";
import { inputToWorld, turnTowards } from "../actors/movement.ts";
import { ThirdPersonCamera } from "../camera/ThirdPersonCamera.ts";
import { SKY_COLORS, createEngine, createShadows, createSkyDome, pickQuality, setupRendering } from "../render/RenderQuality.ts";
import { PerfOverlay } from "../render/PerfOverlay.ts";
import type { QualitySettings } from "../render/quality.ts";
import { ARRIVAL_SPOT, RESPAWN_SLOTS, WALK_SPEED, groundHeight, moveVillage } from "../maps/village/layout.ts";
import { buildVillageWorld, type VillageWorld } from "../maps/village/VillageWorld.ts";
import { artCameraDistance } from "../maps/village/artCamera.ts";
import { villageInitialCamera } from "../maps/village/spawnCamera.ts";
import { FIELD_CAMP_ARRIVAL } from "../maps/village/mapLinks.ts";
import type { VillageInteract } from "../maps/village/VillageInteract.ts";
import { modularAvailable, NoviceAvatar, type CharShadowMode, type NoviceLod } from "../characters/NoviceAvatar.ts";
import { PetFollower } from "../pets/PetFollower.ts";
import { isSoul } from "../pets/petSystem.ts";
import { WorldSession } from "./worldSession.ts";
import { WorldPanel } from "../ui/WorldPanel.ts";
import { MODEL_LOD_LABEL, pickModelLod } from "./modelLod.ts";
import { PortalTrigger } from "./portalTrigger.ts";
import { VILLAGE_SOUTH_PORTAL } from "./worldPortals.ts";
import { FIELD_TEST } from "./fieldRules.ts";
import { combatTuningFromStats } from "./fieldRules.ts";
import { NOVICE_VERSION } from "./noviceVersion.ts";

/**
 * Stage 7：星芽村（完整遊戲循環的起點）。?play=world
 * - 新角色從星願之泉出生；從星芽原野死亡也在這裡復活（星願之泉）
 * - 正式男女初心者（C1.0-B5b）走路、跑步；村莊是安全區，沒有戰鬥、沒有跳躍按鈕
 * - Claude B 的全村整合美術、NPC、洛恩（寵物鑑定接 Claude A 寵物核心＋金幣扣款）、星願商會（接角色存檔的本機服務或正式 API）
 * - 南門 → 星芽原野（存檔後切換地圖）
 */
export async function startVillageGame(canvas: HTMLCanvasElement, hudRoot: HTMLElement, world: WorldSession): Promise<void> {
  const g = new VillageGame(canvas, hudRoot, world);
  await g.init();
  g.start();
}

export interface WorldApi {
  ready: boolean;
  map: "village" | "starsprout";
  info(): Record<string, unknown>;
  [k: string]: unknown;
}
declare global {
  interface Window {
    __starwishWorld?: WorldApi;
  }
}

class VillageGame {
  private readonly params = new URLSearchParams(location.search);
  private readonly lod: NoviceLod = pickModelLod(this.params);
  private readonly charShadow: CharShadowMode = this.params.get("charshadow") === "realtime" ? "realtime" : "blob";
  private readonly quality: QualitySettings;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly world: VillageWorld;
  private readonly sun: DirectionalLight;
  private readonly shadows: ShadowGenerator;
  private readonly camera: ThirdPersonCamera;
  private readonly hud: Hud;
  private readonly perf: PerfOverlay;
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly pos = new Vector3();
  private yaw = 0;
  private avatar!: NoviceAvatar;
  private readonly follower: PetFollower;
  private readonly w: WorldSession;
  private readonly panel: WorldPanel;
  private interact: VillageInteract | null = null;
  private artStatus = "loading";
  private contextLost = 0;
  private fpsTimer = 0;
  private saveTimer = 0;
  private curSpeed = 0;
  private petTick = 0;
  private readonly hudRoot: HTMLElement;
  private readonly earTmp = new Vector3();

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, w: WorldSession) {
    this.hudRoot = hudRoot;
    this.w = w;
    const base = pickQuality();
    const p3 = this.params.get("p3") !== "0";
    this.quality = p3 && base.postProcess ? { ...base, postProcess: false, canvasAntialias: true } : base;
    this.engine = createEngine(canvas, this.quality);
    this.engine.onContextLostObservable.add(() => this.contextLost++);
    const scene = new Scene(this.engine);
    this.scene = scene;
    createSkyDome(scene);
    scene.ambientColor = new Color3(0.35, 0.33, 0.4);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = this.lod === "lite" ? 60 : 75;
    scene.fogEnd = this.lod === "lite" ? 150 : 190;
    scene.fogColor = SKY_COLORS.fog.clone();
    scene.skipPointerMovePicking = true;
    const hemi = new HemisphericLight("skyLight", new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.8;
    hemi.diffuse = new Color3(1, 0.98, 1);
    hemi.groundColor = new Color3(0.62, 0.66, 0.62);
    this.sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.35).normalize(), scene);
    this.sun.intensity = 0.75;
    this.sun.diffuse = new Color3(1, 0.95, 0.86);
    this.sun.autoUpdateExtends = false;
    this.sun.orthoLeft = -22;
    this.sun.orthoRight = 22;
    this.sun.orthoTop = 22;
    this.sun.orthoBottom = -22;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 90;
    this.shadows = createShadows(this.sun, this.quality);
    this.shadows.darkness = 0.35;

    // 出生位置：存檔的村莊位置 → 否則星願之泉出生點
    const c = w.save.character;
    const spawn = RESPAWN_SLOTS[6]!;
    const atSaved = c.map === "village" && c.x !== null && c.z !== null;
    const x = atSaved ? c.x! : spawn.x;
    const z = atSaved ? c.z! : spawn.z;
    this.yaw = atSaved && c.yaw !== null ? c.yaw : spawn.yaw;
    this.pos.set(x, groundHeight(x, z), z);
    this.camera = new ThirdPersonCamera(scene, this.pos, groundHeight, { keepPitch: true, obstruct: artCameraDistance });
    scene.activeCamera = this.camera.camera;
    const cam0 = villageInitialCamera(x, z);
    this.camera.snap(this.pos, this.alphaBehind(this.yaw), cam0.beta, cam0.distance);
    const render = setupRendering(scene, this.camera.camera, this.quality);
    if (render.glow) render.glow.isEnabled = false;
    this.world = buildVillageWorld(scene, this.quality.shadows.filter === "contact" ? this.shadows : null, this.lod === "lite", true);
    this.world.setLabels(false);
    this.world.setMarkers(false);

    this.hud = new Hud(hudRoot);
    this.hud.setLevel(1);
    const build = hudRoot.querySelector<HTMLSpanElement>(".hud-build");
    if (build) build.textContent = `Stage 7 星芽村 ${w.gender === "male" ? "男" : "女"}・${this.lod === "hq" ? "HQ" : "Lite"}${w.mode === "test" ? "・測試設定" : ""}`;
    const relabel = (cls: string, text: string, hide = false): void => {
      const b = hudRoot.querySelector<HTMLButtonElement>(cls);
      if (b) {
        b.textContent = text;
        if (hide) b.style.display = "none";
      }
    };
    // 一般移動沒有跳躍按鈕（企劃規則）；技能專用跳躍動畫保留在角色模型裡
    relabel(".skill-1", "背包");
    relabel(".skill-2", "寵物");
    relabel(".skill-3", "", true);
    this.hud.events.on("skillPressed", ({ slot }) => {
      if (slot === "attack") this.hud.toast("星芽村是安全區，沒有戰鬥。從南門前往星芽原野打怪。", 1600);
      else if (slot === "skill1") this.panel.open("bag");
      else if (slot === "skill2") this.panel.open("pet");
    });
    const joystick = new VirtualJoystick(this.hud.joystickZone, this.input, TUNING.joystick.radius, TUNING.joystick.deadZone);
    new CameraTouchControl(canvas, this.input, TUNING.camera.rotateSensitivity, TUNING.camera.pitchSensitivity, TUNING.camera.pinchSensitivity);
    const block = (e: Event): void => e.preventDefault();
    for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, block, { passive: false });
    canvas.addEventListener("contextmenu", block);
    this.keyboard = new KeyboardInput(this.input, () => joystick.active);
    this.perf = new PerfOverlay(this.engine, scene, this.quality, hudRoot);
    this.perf.setLabels({ model: MODEL_LOD_LABEL[this.lod], map: "星芽村" });
    this.follower = new PetFollower(scene, w.pets.cfg.visual?.stageSize);
    this.panel = new WorldPanel(hudRoot, w, {
      clock: () => Date.now(),
      changed: () => this.afterChange(),
      perf: () => this.perf,
      stats: () => {
        const now = w.pets.characterStats({ ...FIELD_TEST.baseStats });
        const t = combatTuningFromStats(now);
        return { base: FIELD_TEST.baseStats, now, combat: `戰鬥（測試設定）：每下 ${t.attackDamage}、${t.attackInterval.toFixed(3)} 秒一下` };
      },
      extra: (_body, btn) => {
        const go = (k: string, v: string | null): void => {
          const q = new URLSearchParams(location.search);
          if (v === null) q.delete(k);
          else q.set(k, v);
          location.search = q.toString();
        };
        btn(`模型 LOD：${MODEL_LOD_LABEL[this.lod]} → 換 ${this.lod === "hq" ? "Lite" : "HQ"}`, () => go("lod", this.lod === "hq" ? "lite" : "hq"));
        btn(this.charShadow === "blob" ? "角色即時陰影" : "腳下柔邊陰影", () => go("charshadow", this.charShadow === "blob" ? "realtime" : null));
      },
    });
    window.addEventListener("resize", () => this.engine.resize());
    window.addEventListener("pagehide", () => this.remember());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.remember();
        this.engine.stopRenderLoop(this.frame);
      } else this.engine.runRenderLoop(this.frame);
    });
  }

  async init(): Promise<void> {
    const scene = this.scene;
    const w = this.w;
    // Stage 7.2：新版初心者（Tripo 模組化：髮型、衣服、靴子、武器分開）；檔案沒交付或 &nv72=0 → 上一版
    const modelsUrl = `${import.meta.env.BASE_URL}models/`;
    const useNew = this.params.get("nv72") !== "0" && (await modularAvailable(modelsUrl, w.gender, this.lod));
    this.avatar = useNew
      ? await NoviceAvatar.loadModular(scene, { gender: w.gender, lod: this.lod, baseUrl: modelsUrl, appearance: w.save.character.appearance })
      : await NoviceAvatar.load(scene, { gender: w.gender, lod: this.lod, baseUrl: `${import.meta.env.BASE_URL}models/`, version: NOVICE_VERSION });
    this.avatar.setupShadow(this.charShadow, scene, this.shadows);
    const sky = scene.getMeshByName("PH_skyDome");
    if (sky) {
      const probe = new ReflectionProbe("villageEnv", 128, scene, true, true);
      probe.position = new Vector3(0, 0.8, 0);
      probe.renderList!.push(sky);
      probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      this.avatar.setMetalReflection(probe.cubeTexture);
    }
    this.avatar.root.position.copyFrom(this.pos);
    this.avatar.root.rotation.y = this.yaw;
    this.avatar.setAttackSpeed(w.pets.characterStats({ ...FIELD_TEST.baseStats }).attackSpeed);
    this.syncFollower();
    this.installApi();
    // 正式美術、NPC、洛恩、商會（Claude B 全村整合）
    void import("../maps/village/VillageArtFull.ts")
      .then((m) => m.loadVillageArtFull(scene, this.lod === "lite", this.quality.shadows.filter === "contact" ? this.shadows : null, (msg) => (this.artStatus = msg)))
      .then(async (full) => {
        const { VillageInteract } = await import("../maps/village/VillageInteract.ts");
        this.interact = new VillageInteract(scene, full.merchant, {
          avatarUrl: `${import.meta.env.BASE_URL}models/village-p3/pm2_avatar.png`,
          goToMap: () => this.toField(),
          appraisal: w.appraisal,
          guild: w.guild,
          onChange: () => this.afterChange(),
          autoPortals: true,
        });
        this.interact.npcs = full.npcs;
        // 洛恩的其他服務（飼料、進化、復活、培育指南）：接在角色存檔與金幣上
        const { connectPetMerchantService } = await import("../maps/village/petMerchant.ts");
        const { createWorldPetMerchantService } = await import("../economy/worldPetMerchant.ts");
        connectPetMerchantService(createWorldPetMerchantService({ pets: w.pets, save: w.save, economy: w.economy, appraisal: w.appraisal, persist: () => w.persist(), changed: () => this.afterChange() }));
        this.artStatus = full.errors.length ? `部分載入失敗：${full.errors.join("；")}` : "loaded";
      })
      .catch((e: unknown) => {
        this.artStatus = `error: ${e instanceof Error ? e.message : String(e)}`;
      });
  }

  start(): void {
    this.engine.runRenderLoop(this.frame);
    const c = this.w.save.character;
    const first = this.w.isNew ? "歡迎來到星芽村！從南門前往星芽原野打怪；洛恩可以鑑定寵物、星願商會可以買賣。" : `回到星芽村（${this.w.gold} 金幣）`;
    this.hud.toast(first + (this.w.mode === "test" ? "（測試設定・非正式數值）" : ""), 4000);
    if (c.deaths > 0 && this.params.get("respawned") === "1") this.hud.toast("你在星願之泉復活了", 2500);
  }

  private alphaBehind(yaw: number): number {
    return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  }

  private readonly portal = new PortalTrigger(VILLAGE_SOUTH_PORTAL);

  private hp(): number | null {
    return this.w.save.character.hp;
  }

  private remember(): void {
    this.w.remember("village", this.pos.x, this.pos.z, this.yaw, this.hp());
    this.w.persist();
  }

  private toField(): void {
    if (this.w.leaving) return;
    this.w.travelTo({ ...FIELD_CAMP_ARRIVAL }, this.hp());
  }

  private afterChange(): void {
    this.syncFollower();
    this.avatar.setAttackSpeed(this.w.pets.characterStats({ ...FIELD_TEST.baseStats }).attackSpeed);
    this.w.persist();
    this.panel.refresh();
    this.updateGold();
  }

  private updateGold(): void {
    const b = this.hudRoot.querySelector<HTMLSpanElement>(".hud-build");
    if (b) b.dataset.gold = String(this.w.gold);
  }

  private syncFollower(): void {
    const p = this.w.pets.enabled ? this.w.pets.equipped() : null;
    const sp = p ? this.w.pets.cfg.species.find((s) => s.id === p.species) : null;
    this.follower.setLook(p && sp && p.stage > 0 ? { species: p.species, stage: p.stage, motion: sp.motion, soul: isSoul(p) } : null);
  }

  private frame = (): void => {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
    this.keyboard.update();
    const busy = this.interact?.busy ?? false;
    const m = busy ? { x: 0, y: 0 } : this.input.getMove();
    const v = inputToWorld(m.x, m.y, this.camera.forwardYaw);
    const l = Math.hypot(v.x, v.z);
    const s = l > 1 ? 1 / l : 1;
    const speed01 = Math.min(1, l);
    this.curSpeed = 0;
    if (speed01 > 0.05) {
      const step = WALK_SPEED * speed01 * dt;
      const r = moveVillage(this.pos.x, this.pos.z, this.pos.x + v.x * s * step, this.pos.z + v.z * s * step);
      this.curSpeed = Math.hypot(r.x - this.pos.x, r.z - this.pos.z) / Math.max(dt, 1e-4);
      this.pos.x = r.x;
      this.pos.z = r.z;
      this.yaw = turnTowards(this.yaw, v.x, v.z, TUNING.player.turnSharpness, dt);
    }
    // Stage 7.1：踩進已開放的南方傳送陣 → 直接傳送（先存檔；只觸發一次）
    if (this.portal.update(this.pos.x, this.pos.z)) this.toField();
    const gy = groundHeight(this.pos.x, this.pos.z);
    this.pos.y = gy;
    this.avatar.update(dt, { speed: this.curSpeed }, gy);
    this.avatar.root.position.copyFrom(this.pos);
    this.avatar.root.rotation.y = this.yaw;
    this.camera.update(dt, this.pos, this.input.consumeCamera());
    this.sun.position.copyFrom(this.pos).subtractInPlace(this.sun.direction.scale(45));
    this.world.update(dt, this.pos.x, this.pos.z);
    this.interact?.update(performance.now() / 1000, this.pos.x, this.pos.z);
    this.follower.update(dt, this.avatar.petAnchor(this.earTmp), this.yaw, this.avatar.headHalfWidth);
    this.scene.render();
    this.perf.update(dt);
    this.petTick += dt;
    if (this.petTick >= 1) {
      this.petTick = 0;
      const before = this.w.pets.save.pets.map((p) => `${p.stage}:${p.life ?? ""}`).join();
      this.w.pets.tick(Date.now());
      if (before !== this.w.pets.save.pets.map((p) => `${p.stage}:${p.life ?? ""}`).join()) this.afterChange();
    }
    this.saveTimer += dt;
    if (this.saveTimer >= 5) {
      this.saveTimer = 0;
      this.w.remember("village", this.pos.x, this.pos.z, this.yaw, this.hp());
    }
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      this.hud.setFps(this.perf.avgFps(2));
      this.hud.setBars({ hp: this.hp() ?? 100, maxHp: combatTuningFromStats(this.w.pets.characterStats({ ...FIELD_TEST.baseStats })).maxHp, mp: 40, maxMp: 40, exp: this.w.progress.exp, expToNext: this.w.progress.expToNext });
      this.hud.setLevel(this.w.progress.level);
      this.panel.refresh();
    }
  };

  private installApi(): void {
    const self = this;
    window.__starwishWorld = {
      ready: true,
      map: "village",
      info: () => ({
        map: "village",
        gender: self.w.gender,
        file: self.avatar.file,
        avatarModel: { modular: self.avatar.parts.length > 0, weapon: self.avatar.weapon, bones: self.avatar.bones, triangles: self.avatar.triangles, parts: self.avatar.parts.map((x) => ({ kind: x.kind, file: x.file, meshes: x.meshes.length, remapped: x.remapped })), clips: [...self.avatar.groups.keys()], attackClips: [...self.avatar.attackClips.keys()] },
        state: self.avatar.state,
        pos: [self.pos.x, self.pos.y, self.pos.z],
        gold: self.w.gold,
        hp: self.hp(),
        items: { ...self.w.pets.save.items },
        bag: self.w.pets.bag().map((b) => ({ id: b.id, kind: b.kind, affixes: b.affixes, locked: !!b.locked })),
        pets: self.w.pets.save.pets.map((p) => ({ id: p.id, stage: p.stage, affixes: p.affixes, life: p.life ?? "alive", satiety: p.satiety ?? null, frozen: !!p.frozen })),
        equipped: self.w.pets.save.equippedId,
        followerVisible: self.follower.visible,
        followerSize: self.follower.size,
        ledger: self.w.save.wallet.ledger.slice(-20),
        deaths: self.w.save.character.deaths,
        level: self.w.progress.level,
        exp: self.w.progress.exp,
        appearance: { ...self.w.save.character.appearance },
        art: self.artStatus,
        interact: self.interact?.state() ?? null,
        portal: { armed: self.portal.isArmed, fired: self.portal.hasFired, dist: self.portal.distance(self.pos.x, self.pos.z), triggerR: self.portal.spec.triggerR },
        panel: self.panel.where,
        petGap: self.follower.headGap,
        headHalfWidth: self.avatar.headHalfWidth,
        quality: { lod: self.lod, render: self.params.get("quality") ?? "auto", scale: self.engine.getHardwareScalingLevel() },
        mode: self.w.mode,
        render: { drawCalls: self.perf.drawCalls, contextLost: self.contextLost, charShadow: self.charShadow },
        jumpButtonVisible: (self.hudRoot.querySelector<HTMLButtonElement>(".skill-3")?.style.display ?? "") !== "none" && /跳/.test(self.hudRoot.textContent ?? ""),
      }),
      teleport: (x: number, z: number, yaw?: number) => {
        self.pos.set(x, groundHeight(x, z), z);
        if (yaw !== undefined) self.yaw = yaw;
        self.avatar.root.position.copyFrom(self.pos);
        self.camera.snap(self.pos, self.alphaBehind(self.yaw), TUNING.camera.defaultBeta, TUNING.camera.distance);
      },
      setMove: (x: number, y: number) => (self.input.moveOverride = x === 0 && y === 0 ? null : { x, y }),
      activate: () => self.interact?.activate() ?? "none",
      confirmDialog: () => {
        const b = document.querySelector<HTMLButtonElement>('.vi-dlg button[data-a="go"]');
        b?.click();
        return !!b;
      },
      guild: (cmd: string) => self.interact?.guildCmd(cmd) ?? Promise.resolve(null),
      appraisal: () => self.w.appraisal,
      guildService: () => self.w.guild,
      give: (item: string, n = 1) => {
        self.w.pets.giveItem(item as never, n);
        self.afterChange();
      },
      save: () => JSON.parse(JSON.stringify(self.w.save)),
      toField: () => self.toField(),
      arrival: ARRIVAL_SPOT,
    };
  }
}
