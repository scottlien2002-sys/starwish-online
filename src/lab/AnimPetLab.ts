import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  type AnimationGroup,
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  HemisphericLight,
  Scene,
  SceneLoader,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { createEngine, createShadows, createSkyDome, pickQuality, setupRendering, SKY_COLORS } from "../render/RenderQuality.ts";
import { PerfOverlay } from "../render/PerfOverlay.ts";
import { buildMeadow } from "../world/Meadow.ts";
import { heightAt } from "../world/terrain.ts";
import { InputState } from "../input/InputState.ts";
import { VirtualJoystick } from "../input/VirtualJoystick.ts";
import { KeyboardInput } from "../input/KeyboardInput.ts";
import { AnimStateMachine, ANIM_NAMES, ONE_SHOT, type AnimName } from "../actors/animState.ts";
import { createRng } from "../core/rng.ts";
import { CORE_RULES } from "../core/rules.ts";
import petCfgJson from "../config/pets.json";
import {
  addItems,
  affixText,
  appraise,
  applyPetBonus,
  bonusScale,
  canEvolve,
  equip,
  equippedPet,
  evolve,
  feedPet,
  ITEM_IDS,
  parseSave,
  resolveTuning,
  rollDrops,
  stageCount,
  startHatch,
  tickPet,
  validatePetConfig,
  type FeedId,
  type ItemId,
  type Pet,
  type PetConfig,
  type PetSourceId,
} from "../pets/petSystem.ts";
import { PetFollower } from "../pets/PetFollower.ts";

/**
 * ?lab=anim：Stage 5.5 角色動畫＋星靈寵物測試頁（C1.0-B4 候選模型）。
 * - 男女角色：骨架、蒙皮、Idle／Run／Jump／Attack／Hurt 五個動作與狀態切換（搖桿或方向鍵移動、按鈕跳躍／攻擊／受傷）
 * - 寵物：測試怪物掉落 → 孵化 → 時間成長、餵食 → 鑑定 → 進化 → 裝備後在頭部附近漂浮／飛翔跟隨
 * - 寵物數值使用 pets.json 的 preview 暫定值（不是正式平衡），畫面上會標示
 * 網址：&g=female 女生、&lod=lite 輕量版、&seed=123 固定亂數
 */

const ITEM_LABEL: Record<ItemId, string> = { seed: "種子", egg: "孵化蛋", birdEgg: "鳥蛋", monsterMaterial: "怪物材料", shopFeed: "商店飼料" };
const SAVE_KEY = "starwish.pets.preview.v1";
const BASE_STATS = Object.freeze({ attack: 100, attackSpeed: 100, defense: 50, maxHp: 1000 }); // 測試用基礎屬性

export interface AnimLabApi {
  ready: boolean;
  gender: "male" | "female";
  lod: "hq" | "lite";
  info(): { file: string; bones: number; skinnedMeshes: number; triangles: number; animations: string[]; state: AnimName; jumpY: number; contextLost: number; drawCalls: number };
  setInput(x: number, y: number): void;
  press(a: "jump" | "attack" | "hurt"): void;
  pet: {
    kill(n?: number): ItemId[];
    give(item: ItemId, n?: number): void;
    hatch(source: PetSourceId): Pet | null;
    feed(food: FeedId): boolean;
    appraise(): boolean;
    evolve(): boolean;
    equip(id: number | null): boolean;
    timeWarp(seconds: number): void;
    state(): { items: Record<ItemId, number>; pets: Pet[]; equippedId: number | null; stats: ReturnType<typeof applyPetBonus>; followerVisible: boolean; followerPos: number[]; headPos: number[] };
    reset(): void;
  };
}

declare global {
  interface Window {
    __starwishAnim?: AnimLabApi;
  }
}

export async function startAnimPetLab(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<void> {
  const qs = new URLSearchParams(location.search);
  const gender: "male" | "female" = qs.get("g") === "female" ? "female" : "male";
  const lod: "hq" | "lite" = qs.get("lod") === "lite" ? "lite" : "hq";
  const rng = createRng(Number(qs.get("seed") ?? Date.now()) >>> 0);
  const cfg = petCfgJson as unknown as PetConfig;
  const cfgErrors = validatePetConfig(cfg);
  const T = resolveTuning(cfg, "preview");

  const quality = pickQuality();
  const engine = createEngine(canvas, quality);
  const scene = new Scene(engine);
  createSkyDome(scene);
  scene.ambientColor = new Color3(0.35, 0.33, 0.4);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 45;
  scene.fogEnd = 120;
  scene.fogColor = SKY_COLORS.fog.clone();
  scene.skipPointerMovePicking = true;
  let contextLost = 0;
  engine.onContextLostObservable.add(() => contextLost++);

  const hemi = new HemisphericLight("skyLight", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.78;
  hemi.groundColor = new Color3(0.62, 0.7, 0.6);
  const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.35).normalize(), scene);
  sun.intensity = 0.75;
  sun.diffuse = new Color3(1, 0.95, 0.86);
  const shadows = createShadows(sun, quality);
  shadows.darkness = 0.35;
  buildMeadow(scene, shadows);

  const camera = new ArcRotateCamera("animCam", -Math.PI / 2, 1.2, 3.2, new Vector3(0, 0.7, 0), scene);
  camera.lowerRadiusLimit = 1.2;
  camera.upperRadiusLimit = 9;
  camera.attachControl(canvas, true);
  setupRendering(scene, camera, quality);

  // ---------- 角色（C1.0-B4 候選：骨架＋五個動作）----------
  const file = `novice_c10b4_${gender}_${lod}.glb`;
  const res = await SceneLoader.ImportMeshAsync("", `${import.meta.env.BASE_URL}models/`, file, scene);
  // 玩家節點：移動、轉向都在這一層（glTF 的 __root__ 保留左右手座標轉換，不要改它）
  const charRoot = new TransformNode("player", scene);
  (res.meshes[0] as AbstractMesh).parent = charRoot;
  const skinned = res.meshes.filter((m) => !!m.skeleton);
  for (const m of res.meshes) {
    m.isPickable = false;
    if (m.getTotalVertices() > 0) shadows.addShadowCaster(m, false);
    m.receiveShadows = false;
  }
  const groups = new Map<AnimName, AnimationGroup>();
  for (const ag of res.animationGroups) {
    const a = ANIM_NAMES.find((n) => ag.name === n || ag.name.endsWith(n));
    if (a) groups.set(a, ag);
    ag.stop();
  }
  const triangles = res.meshes.reduce((a, m) => a + Math.round((m.getTotalIndices() || 0) / 3), 0);
  const headBone = res.skeletons[0]?.bones.find((b) => b.name === "head") ?? null;

  // 動作切換：交叉淡入（0.15 秒），one-shot 播一次
  const sm = new AnimStateMachine(Object.fromEntries([...groups].map(([n, g]) => [n, (g.to - g.from) / 60])) as Partial<Record<AnimName, number>>);
  const weights = new Map<AnimName, number>(ANIM_NAMES.map((n) => [n, n === "Idle" ? 1 : 0]));
  const startGroup = (n: AnimName): void => {
    const g = groups.get(n);
    if (!g) return;
    g.stop();
    g.start(!ONE_SHOT[n], 1, g.from, g.to, false);
    g.setWeightForAllAnimatables(weights.get(n) ?? 0);
  };
  for (const n of ANIM_NAMES) startGroup(n);
  for (const n of ANIM_NAMES) if (n !== "Idle") groups.get(n)?.stop();

  // ---------- 輸入 ----------
  const input = new InputState();
  const zone = document.createElement("div");
  zone.className = "joystick-zone";
  zone.style.cssText = "position:absolute;left:0;bottom:0;width:45%;height:45%;pointer-events:auto;touch-action:none";
  hudRoot.append(zone);
  const joy = new VirtualJoystick(zone, input, 56, 0.12);
  new KeyboardInput(input, () => joy.active);
  let pending: { jump?: boolean; attack?: boolean; hurt?: boolean } = {};
  let override: { x: number; y: number } | null = null;

  // ---------- 寵物 ----------
  let save = (() => {
    try {
      return parseSave(localStorage.getItem(SAVE_KEY));
    } catch {
      return parseSave(null);
    }
  })();
  const persist = (): void => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch {
      /* 無法儲存時略過 */
    }
  };
  let clock = Date.now(); // 寵物時間（可以快轉）
  const follower = new PetFollower(scene);
  const syncFollower = (): void => {
    const p = equippedPet(save);
    const sp = p ? cfg.species.find((s) => s.id === p.species) : null;
    follower.setLook(p && sp ? { species: p.species, stage: p.stage, motion: sp.motion } : null);
  };
  syncFollower();

  // ---------- 畫面 ----------
  const top = document.createElement("div");
  top.className = "v3-top";
  top.innerHTML = `<div class="lab-name">Stage 5.5 角色動畫＋星靈寵物 <small>C1.0-B4 候選｜${gender === "male" ? "男" : "女"}｜${lod === "hq" ? "HQ" : "Lite"}｜寵物數值＝測試用暫定值（非正式平衡）</small></div><div class="lab-state" data-anim-state></div>`;
  hudRoot.append(top);
  const stateEl = top.querySelector("[data-anim-state]") as HTMLElement;
  const panel = document.createElement("div");
  panel.className = "lab-panel";
  hudRoot.append(panel);
  const btn = (label: string, fn: () => void, cls = "lab-btn"): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", fn);
    panel.append(b);
    return b;
  };
  btn("跳躍", () => (pending.jump = true));
  btn("攻擊", () => (pending.attack = true));
  btn("受傷", () => (pending.hurt = true));
  btn(gender === "male" ? "換女生" : "換男生", () => {
    qs.set("g", gender === "male" ? "female" : "male");
    location.search = qs.toString();
  }, "lab-btn lab-demo");
  btn(lod === "hq" ? "換 Lite" : "換 HQ", () => {
    qs.set("lod", lod === "hq" ? "lite" : "hq");
    location.search = qs.toString();
  }, "lab-btn lab-demo");
  const petBtn = btn("寵物", () => (petPanel.hidden = !petPanel.hidden), "lab-btn lab-demo");
  petBtn.dataset.pet = "toggle";

  const petPanel = document.createElement("div");
  petPanel.className = "lab-bench-result";
  petPanel.style.cssText = "position:absolute;right:8px;top:64px;max-width:min(420px,92vw);max-height:58vh;overflow:auto;white-space:normal;pointer-events:auto;font-size:13px";
  petPanel.hidden = true;
  hudRoot.append(petPanel);

  const api: AnimLabApi = {
    ready: false,
    gender,
    lod,
    info: () => ({
      file,
      bones: res.skeletons[0]?.bones.length ?? 0,
      skinnedMeshes: skinned.length,
      triangles,
      animations: [...groups.keys()],
      state: sm.state,
      jumpY: sm.jumpHeight(),
      contextLost,
      drawCalls: (engine as unknown as { _drawCalls?: { current: number } })._drawCalls?.current ?? 0,
    }),
    setInput: (x, y) => (override = x === 0 && y === 0 ? null : { x, y }),
    press: (a) => (pending[a] = true),
    pet: {
      kill: (n = 1) => {
        const got: ItemId[] = [];
        for (let i = 0; i < n; i++) got.push(...rollDrops(rng, T));
        addItems(save, got);
        persist();
        renderPet(got.length ? `擊倒測試怪物 ×${n}：獲得 ${got.map((k) => ITEM_LABEL[k]).join("、")}` : `擊倒測試怪物 ×${n}：沒有掉落`);
        return got;
      },
      give: (item, n = 1) => {
        save.items[item] += n;
        persist();
        renderPet();
      },
      hatch: (source) => {
        const p = startHatch(save, cfg, source, clock);
        if (p && !save.equippedId) equip(save, p.id);
        persist();
        syncFollower();
        renderPet(p ? `開始孵化：${ITEM_LABEL[source]}（#${p.id}）` : `背包沒有${ITEM_LABEL[source]}`);
        return p;
      },
      feed: (food) => {
        const p = equippedPet(save);
        const ok = !!p && feedPet(save, p, food, T);
        persist();
        renderPet(ok ? `餵食${ITEM_LABEL[food]}` : "不能餵食（沒有裝備寵物、還沒孵化或沒有食物）");
        return ok;
      },
      appraise: () => {
        const p = equippedPet(save);
        if (!p || p.affixes) return false;
        p.affixes = appraise(cfg, T, rng, "preview");
        persist();
        renderPet(`鑑定結果：${p.affixes.length ? p.affixes.map((a) => affixText(cfg, a)).join("、") : "無屬性"}`);
        return true;
      },
      evolve: () => {
        const p = equippedPet(save);
        const ok = !!p && evolve(cfg, p, T);
        persist();
        syncFollower();
        renderPet(ok ? "進化成功！" : "還不能進化（經驗或餵食次數不足）");
        return ok;
      },
      equip: (id) => {
        const ok = equip(save, id);
        persist();
        syncFollower();
        renderPet();
        return ok;
      },
      timeWarp: (seconds) => {
        clock += seconds * 1000;
        tickAll();
        renderPet(`時間快轉 ${seconds} 秒`);
      },
      state: () => {
        const p = equippedPet(save);
        const head = headWorld();
        return {
          items: { ...save.items },
          pets: save.pets.map((x) => ({ ...x })),
          equippedId: save.equippedId,
          stats: applyPetBonus({ ...BASE_STATS }, cfg, p, T),
          followerVisible: follower.visible,
          followerPos: follower.position.asArray(),
          headPos: head.asArray(),
        };
      },
      reset: () => {
        save = parseSave(null);
        clock = Date.now();
        persist();
        syncFollower();
        renderPet("已清除測試資料");
      },
    },
  };

  const tickAll = (): void => {
    let hatched = false;
    for (const p of save.pets) hatched = tickPet(p, T, clock).hatched || hatched;
    if (hatched) syncFollower();
    persist();
  };

  function renderPet(msg = ""): void {
    const p = equippedPet(save);
    const bonus = applyPetBonus({ ...BASE_STATS }, cfg, p, T);
    const sp = (x: Pet): string => {
      const s = cfg.species.find((y) => y.id === x.species);
      return `${s?.label ?? x.species}・${s?.stages[x.stage]?.label ?? x.stage}`;
    };
    const items = ITEM_IDS.map((k) => `${ITEM_LABEL[k]} ${save.items[k]}`).join("　");
    const list = save.pets
      .map((x) => {
        const on = x.id === save.equippedId;
        const hatchLeft = x.stage === 0 ? Math.max(0, (T.hatchSeconds ?? 0) - (clock - x.obtainedAt) / 1000) : 0;
        return `<div style="margin:4px 0;padding:4px;border-radius:8px;background:${on ? "rgba(255,210,110,.35)" : "rgba(255,255,255,.12)"}">
          #${x.id} ${sp(x)}　${x.stage === 0 ? `孵化剩 ${Math.ceil(hatchLeft)} 秒` : `經驗 ${Math.floor(x.exp)}／餵食 ${x.feedCount}`}
          ${x.stage > 0 ? `｜加成倍率 ${(bonusScale(cfg, x, T) * 100).toFixed(0)}%` : ""}${x.stage < stageCount(cfg, x) - 1 && canEvolve(cfg, x, T) ? "｜<b>可進化</b>" : ""}
          <br>詞條：${x.affixes ? (x.affixes.length ? x.affixes.map((a) => affixText(cfg, a)).join("、") : "無屬性") : "未鑑定"}
          <button class="lab-btn" style="min-height:30px;font-size:12px;margin-left:6px" data-equip="${x.id}">${on ? "卸下" : "裝備"}</button></div>`;
      })
      .join("");
    const st = bonus.stats;
    petPanel.innerHTML = `
      <b>星靈寵物（測試用暫定數值，非正式平衡）</b>${cfgErrors.length ? `<div style="color:#ffb0b0">設定錯誤：${cfgErrors.join("；")}</div>` : ""}
      <div>${msg}</div>
      <div style="margin:4px 0">背包：${items}</div>
      <div class="pet-actions" style="display:flex;flex-wrap:wrap;gap:4px"></div>
      ${list || "<div>還沒有寵物：先擊倒測試怪物取得種子或蛋，再孵化。</div>"}
      <div style="margin-top:6px">角色屬性（基礎 → 加上裝備寵物）：攻擊 ${BASE_STATS.attack} → ${st.attack}｜攻速 ${BASE_STATS.attackSpeed} → ${st.attackSpeed}（上限 ${CORE_RULES.maxAttackSpeed}）｜防禦 ${BASE_STATS.defense} → ${st.defense}｜生命 ${BASE_STATS.maxHp} → ${st.maxHp}</div>`;
    const acts = petPanel.querySelector(".pet-actions") as HTMLElement;
    const a = (label: string, fn: () => void): void => {
      const b = document.createElement("button");
      b.className = "lab-btn";
      b.style.cssText = "min-height:34px;font-size:12px;padding:0 8px";
      b.textContent = label;
      b.addEventListener("click", fn);
      acts.append(b);
    };
    a("擊倒怪物 ×1", () => api.pet.kill(1));
    a("擊倒 ×10", () => api.pet.kill(10));
    a("孵化種子", () => api.pet.hatch("seed"));
    a("孵化蛋", () => api.pet.hatch("egg"));
    a("孵化鳥蛋", () => api.pet.hatch("birdEgg"));
    a("餵材料", () => api.pet.feed("monsterMaterial"));
    a("餵飼料", () => api.pet.feed("shopFeed"));
    a("買飼料 +5（測試）", () => api.pet.give("shopFeed", 5));
    a("鑑定", () => api.pet.appraise());
    a("進化", () => api.pet.evolve());
    a("快轉 60 秒", () => api.pet.timeWarp(60));
    a("清除", () => api.pet.reset());
    for (const b of petPanel.querySelectorAll<HTMLButtonElement>("[data-equip]")) {
      b.addEventListener("click", () => {
        const id = Number(b.dataset.equip);
        api.pet.equip(save.equippedId === id ? null : id);
      });
    }
  }
  renderPet();

  // ---------- 迴圈 ----------
  const perf = new PerfOverlay(engine, scene, quality, hudRoot);
  perf.lockResolution(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
  const pos = new Vector3(0, heightAt(0, 0), 0);
  let yaw = 0;
  const headTmp = new Vector3();
  const headWorld = (): Vector3 => {
    // 頭骨的起點在脖子上方（約 0.67 m）；頭頂約 1.25 m → 往上 0.55 m 是頭頂
    const sk = skinned[0];
    if (headBone && sk) {
      headBone.getAbsolutePositionToRef(sk, headTmp);
      return headTmp.add(new Vector3(0, 0.55, 0));
    }
    return charRoot.position.add(new Vector3(0, 1.25, 0));
  };
  let petTick = 0;
  engine.runRenderLoop(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    const mv = override ?? input.getMove();
    const len = Math.hypot(mv.x, mv.y);
    const moving = len > 0.15;
    if (moving && sm.state !== "Attack" && sm.state !== "Hurt") {
      // 搖桿方向相對於鏡頭
      const camYaw = -camera.alpha - Math.PI / 2;
      const dx = mv.x * Math.cos(camYaw) - mv.y * Math.sin(camYaw);
      const dz = mv.x * Math.sin(camYaw) + mv.y * Math.cos(camYaw);
      const sp = 2.4 * Math.min(1, len);
      pos.x += (dx / Math.max(len, 1e-6)) * sp * dt;
      pos.z += (dz / Math.max(len, 1e-6)) * sp * dt;
      yaw = Math.atan2(dx, dz);
    }
    const before = sm.state;
    sm.update(dt, { moving, ...pending });
    pending = {};
    if (sm.state !== before || (ONE_SHOT[sm.state] && sm.time === 0)) startGroup(sm.state);
    for (const n of ANIM_NAMES) {
      const w = weights.get(n)!;
      const target = n === sm.state ? 1 : 0;
      const nw = w + (target - w) * Math.min(1, dt / 0.15);
      weights.set(n, nw);
      const g = groups.get(n);
      if (!g) continue;
      if (nw < 0.01 && n !== sm.state) {
        if (g.isPlaying) g.stop();
      } else g.setWeightForAllAnimatables(nw);
    }
    charRoot.position.set(pos.x, heightAt(pos.x, pos.z) + sm.jumpHeight(), pos.z);
    charRoot.rotation.y = yaw; // 模型正面朝 +z（yaw 0）
    camera.target.copyFrom(Vector3.Lerp(camera.target, new Vector3(pos.x, charRoot.position.y + 0.7, pos.z), Math.min(1, dt * 6)));
    follower.update(dt, headWorld(), yaw);
    petTick += dt;
    if (petTick > 1) {
      petTick = 0;
      clock += 1000;
      tickAll();
      if (!petPanel.hidden) renderPet();
    }
    stateEl.textContent = `動作 ${sm.state}　骨頭 ${api.info().bones}　三角形 ${triangles.toLocaleString()}`;
    scene.render();
    perf.update(dt);
  });
  window.addEventListener("resize", () => engine.resize());
  api.ready = true;
  window.__starwishAnim = api;
}
