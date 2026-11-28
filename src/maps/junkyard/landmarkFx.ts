/**
 * 星廢垃圾場 V3：四大地標的動態特效（熔爐火焰／火星／煙囪煙霧／間歇蒸氣、巨像眼睛與胸口核心、反應爐魔導核心與旋轉環）。
 *
 * 手機效能：
 * - 全部是低負載粒子（CPU ParticleSystem，每座熔爐 4～5 組、總數受畫質上限控制）＋柔和光暈（GlowHalos，全場 1 次繪製）
 * - 不用即時光源、不用 GlowLayer
 * - 距離分級：近（< 40 m）全量、中（< 75 m）一半、遠（< far）四分之一；超過 far 或不在畫面內 → 停止發射
 * - 兩座熔爐的火焰、煙霧、蒸氣使用不同的隨機週期，不會同步
 */
import { FresnelParameters,
  BoundingInfo,
  Color3,
  Color4,
  type Camera,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  type Scene,
  StandardMaterial,
  Texture,
  type TransformNode,
  Vector3,
} from "@babylonjs/core";
import { ANCHORS } from "./landmarkSlots.ts";

export type FxTier = "high" | "medium" | "low";

/** 程序化粒子貼圖（data URL，不需下載） */
function blobUrl(kind: "flame" | "smoke" | "spark" | "mote"): string {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = S / 2;
  if (kind === "smoke") {
    // 不規則的柔和雲團：幾個偏移圓疊加
    let s = 7;
    const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9; i++) {
      const x = r + (rnd() - 0.5) * r * 0.7;
      const y = r + (rnd() - 0.5) * r * 0.7;
      const rr = r * (0.35 + rnd() * 0.35);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      // V3.1：中心較濃（0.42 → 0.62），亮背景（天空、山壁）前也看得到煙團輪廓
      gr.addColorStop(0, "rgba(255,255,255,0.62)");
      gr.addColorStop(0.55, "rgba(255,255,255,0.28)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
    }
  } else {
    const gr = g.createRadialGradient(r, kind === "flame" ? r * 1.15 : r, 0, r, r, r);
    if (kind === "flame") {
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.35, "rgba(255,255,255,0.65)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
    } else {
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(kind === "spark" ? 0.25 : 0.4, "rgba(255,255,255,0.5)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  return c.toDataURL("image/png");
}

const texCache = new WeakMap<Scene, Record<string, Texture>>();
function tex(scene: Scene, kind: "flame" | "smoke" | "spark" | "mote"): Texture {
  let m = texCache.get(scene);
  if (!m) {
    m = {};
    texCache.set(scene, m);
  }
  return (m[kind] ??= new Texture(blobUrl(kind), scene, true, false));
}

interface FxGroup {
  center: Vector3;
  radius: number;
  systems: { ps: ParticleSystem; base: number }[];
  meshes: Mesh[];
  running: boolean;
  /** 每幀更新（脈動、旋轉、間歇蒸氣） */
  tick?: (t: number, dt: number, near: boolean) => void;
}

export class LandmarkFx {
  private readonly groups: FxGroup[] = [];
  private timer = 0;
  private readonly far: number;
  private readonly cap: number;

  private readonly scene: Scene;
  readonly tier: FxTier;

  constructor(scene: Scene, tier: FxTier) {
    this.scene = scene;
    this.tier = tier;
    this.far = tier === "high" ? 115 : tier === "medium" ? 85 : 60;
    this.cap = tier === "high" ? 1 : tier === "medium" ? 0.55 : 0.3;
  }

  get stats(): { groups: number; systems: number; running: number; particles: number } {
    let systems = 0;
    let running = 0;
    let particles = 0;
    for (const g of this.groups) {
      systems += g.systems.length;
      if (g.running) running += g.systems.length;
      for (const s of g.systems) particles += s.ps.getActiveCount();
    }
    return { groups: this.groups.length, systems, running, particles };
  }

  private ps(name: string, capacity: number, kind: "flame" | "smoke" | "spark" | "mote"): ParticleSystem {
    const ps = new ParticleSystem(name, Math.max(4, Math.round(capacity * this.cap)), this.scene);
    ps.particleTexture = tex(this.scene, kind);
    ps.blendMode = kind === "smoke" ? ParticleSystem.BLENDMODE_STANDARD : ParticleSystem.BLENDMODE_ADD;
    ps.isLocal = false;
    ps.preWarmCycles = 0;
    return ps;
  }

  /** 每 0.25 秒依距離與是否在畫面內調整（停止／啟動、發射量） */
  update(dt: number, px: number, pz: number, cam: Camera | null): void {
    this.timer -= dt;
    const t = performance.now() / 1000;
    for (const g of this.groups) g.tick?.(t, dt, g.running);
    if (this.timer > 0) return;
    this.timer = 0.25;
    for (const g of this.groups) {
      const d = Math.hypot(g.center.x - px, g.center.z - pz);
      let vis = d < this.far + g.radius;
      if (vis && cam) {
        const bi = new BoundingInfo(g.center.subtract(new Vector3(g.radius, g.radius, g.radius)), g.center.add(new Vector3(g.radius, g.radius, g.radius)));
        vis = cam.isInFrustum(bi);
      }
      const k = d < 40 ? 1 : d < 75 ? 0.5 : 0.25;
      if (vis) {
        for (const s of g.systems) {
          s.ps.emitRate = s.base * k * this.cap;
          if (!s.ps.isStarted()) s.ps.start();
        }
      } else if (g.running) {
        for (const s of g.systems) s.ps.stop();
      }
      g.running = vis;
    }
  }

  // ------------------------------------------------------------------ 熔爐
  /**
   * @param model 模型節點（yawFix 之下、未縮放的模型座標；local→world 用它的世界矩陣）
   * @param unit 公尺／模型單位
   * @param seed 不同熔爐用不同的隨機週期
   */
  furnace(id: string, model: TransformNode, unit: number, seed: number, halo: (p: Vector3, size: number, color: [number, number, number], o: object) => void): void {
    const A = ANCHORS.furnace;
    model.computeWorldMatrix(true);
    const W = (x: number, y: number, z: number): Vector3 => Vector3.TransformCoordinates(new Vector3(x, y, z), model.getWorldMatrix());
    const k = unit / 11.2;
    let s = seed * 9301 + 49297;
    const rnd = (): number => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const g: FxGroup = { center: W(0, 0, 0), radius: 0.6 * unit, systems: [], meshes: [], running: false };
    const M = A.mouth;
    const mz = (M.z0 + M.z1) / 2;
    const my = (M.floor + M.top) / 2;
    // 爐內高溫：爐口內側一塊自發光的熔煉面（在框面內 0.03 單位，不會凸出外殼）
    const glow = MeshBuilder.CreatePlane(`${id}_mouthglow`, { width: (M.z1 - M.z0) * 0.98, height: M.top - M.floor }, this.scene);
    glow.parent = model;
    glow.position.set(M.face + 0.035, my, mz);
    glow.rotation.y = Math.PI / 2; // 面向模型 −X（爐口外）
    const gm = new StandardMaterial(`${id}_mouthglow_m`, this.scene);
    gm.disableLighting = true;
    gm.emissiveColor = new Color3(1, 0.42, 0.12);
    gm.diffuseTexture = tex(this.scene, "flame");
    gm.opacityTexture = gm.diffuseTexture;
    gm.backFaceCulling = false;
    glow.material = gm;
    glow.isPickable = false;
    g.meshes.push(glow);
    // 爐口柔和暖光（光暈，不是即時光源）
    halo(W(M.face - 0.02, my, mz), 3.2 * k, [1, 0.55, 0.2], { alpha: 0.55, pulse: { speed: 2.3 + rnd(), amp: 0.25, phase: rnd() * 6 } });
    // 火焰：從爐口內的底部升起，壽命短、速度慢 → 只在爐口內燃燒，不會飄出外殼
    const fire = this.ps(`${id}_fire`, 70, "flame");
    fire.emitter = W(M.face + 0.07, M.floor + 0.01, mz);
    const half = ((M.z1 - M.z0) / 2) * 0.62 * unit;
    fire.minEmitBox = new Vector3(-0.35 * k, 0, -half);
    fire.maxEmitBox = new Vector3(0.35 * k, 0.05, half);
    fire.color1 = new Color4(1, 0.78, 0.32, 1);
    fire.color2 = new Color4(1, 0.45, 0.12, 1);
    fire.colorDead = new Color4(0.35, 0.06, 0, 0);
    fire.minSize = 0.45 * k;
    fire.maxSize = 1.05 * k;
    fire.minLifeTime = 0.28;
    fire.maxLifeTime = 0.6;
    fire.direction1 = new Vector3(-0.15, 1, -0.15);
    fire.direction2 = new Vector3(0.15, 1, 0.15);
    fire.minEmitPower = 0.7 * k;
    fire.maxEmitPower = 1.6 * k;
    fire.gravity = new Vector3(0, 0.6, 0);
    fire.addSizeGradient(0, 0.7);
    fire.addSizeGradient(0.4, 1);
    fire.addSizeGradient(1, 0.2);
    fire.minAngularSpeed = -1.5;
    fire.maxAngularSpeed = 1.5;
    g.systems.push({ ps: fire, base: 55 });
    // 火星：少量自然飛散（從爐口往外上方）
    const sp = this.ps(`${id}_sparks`, 26, "spark");
    sp.emitter = W(M.face - 0.01, my, mz);
    sp.minEmitBox = new Vector3(-0.2 * k, -0.3 * k, -half * 0.8);
    sp.maxEmitBox = new Vector3(0.2 * k, 0.3 * k, half * 0.8);
    sp.color1 = new Color4(1, 0.85, 0.45, 1);
    sp.color2 = new Color4(1, 0.55, 0.15, 1);
    sp.colorDead = new Color4(0.5, 0.1, 0, 0);
    sp.minSize = 0.06 * k;
    sp.maxSize = 0.14 * k;
    sp.minLifeTime = 0.6;
    sp.maxLifeTime = 1.4;
    // 往模型 −X（爐口外）與上方
    const out = W(M.face - 1, my, mz).subtract(W(M.face, my, mz)).normalize();
    sp.direction1 = out.scale(0.6).add(new Vector3(-0.5, 1.2, -0.5));
    sp.direction2 = out.scale(1.4).add(new Vector3(0.5, 2.2, 0.5));
    sp.minEmitPower = 1.2 * k;
    sp.maxEmitPower = 2.6 * k;
    sp.gravity = new Vector3(0, -6, 0);
    // 低畫質：省下火星與副煙囪（每座熔爐少 2 次繪製），主煙囪與火焰保留
    if (this.tier === "low") sp.dispose();
    else g.systems.push({ ps: sp, base: 5 });
    // 煙囪煙霧：從實際開口冒出，慢慢上升、隨高度擴散淡出，隨陣風飄移（V3.1：較濃、灰褐色、一開始就有完整煙柱）
    const wind = new Vector3(0.32, 0, 0.18);
    const smokes: { ps: ParticleSystem; k: number; ph: number }[] = [];
    A.chimneys.forEach((c, i) => {
      if (this.tier === "low" && i > 0) return;
      const sm = this.ps(`${id}_smoke${i}`, i === 0 ? 56 : 36, "smoke");
      sm.emitter = W(c.x, c.y + 0.005, c.z);
      const rr = c.r * unit * 0.55;
      sm.minEmitBox = new Vector3(-rr, 0, -rr);
      sm.maxEmitBox = new Vector3(rr, 0.1, rr);
      const gray = 0.27 + rnd() * 0.05;
      const warm = (v: number, a: number): Color4 => new Color4(v * 1.04, v, v * 0.94, a);
      sm.color1 = warm(gray, 0.8);
      sm.color2 = warm(gray + 0.06, 0.7);
      sm.colorDead = warm(0.6, 0);
      sm.minSize = c.r * unit * 1.2;
      sm.maxSize = c.r * unit * 1.8;
      sm.addSizeGradient(0, 0.55);
      sm.addSizeGradient(0.35, 1.5);
      sm.addSizeGradient(1, 3.2);
      // 出口最濃（深灰褐）→ 上升變淡、偏亮灰 → 消散
      sm.addColorGradient(0, warm(gray, 0));
      sm.addColorGradient(0.05, warm(gray, 0.82));
      sm.addColorGradient(0.35, warm(gray + 0.1, 0.6));
      sm.addColorGradient(0.75, warm(gray + 0.24, 0.26));
      sm.addColorGradient(1, warm(0.6, 0));
      sm.minLifeTime = 5 + rnd();
      sm.maxLifeTime = 8 + rnd() * 1.5;
      sm.direction1 = new Vector3(-0.1, 1, -0.1);
      sm.direction2 = new Vector3(0.1, 1, 0.1);
      sm.minEmitPower = 0.9 * k;
      sm.maxEmitPower = 1.5 * k;
      sm.gravity = wind.clone();
      sm.minAngularSpeed = -0.3;
      sm.maxAngularSpeed = 0.3;
      sm.minInitialRotation = 0;
      sm.maxInitialRotation = Math.PI * 2;
      // 進入範圍啟動時直接是完整煙柱（不會從空的煙囪慢慢長出來）
      sm.preWarmCycles = 70;
      sm.preWarmStepOffset = 6;
      smokes.push({ ps: sm, k: 0.55 + rnd() * 0.35, ph: rnd() * 20 });
      g.systems.push({ ps: sm, base: i === 0 ? 7 : 4.5 });
    });
    // 藍色排氣管：間歇白色蒸氣
    const st = this.ps(`${id}_steam`, 30, "smoke");
    st.emitter = W(A.vent.x, A.vent.y + 0.01, A.vent.z);
    st.minEmitBox = new Vector3(-0.08 * k, 0, -0.08 * k);
    st.maxEmitBox = new Vector3(0.08 * k, 0.05, 0.08 * k);
    st.color1 = new Color4(0.97, 0.98, 1, 0.85);
    st.color2 = new Color4(0.9, 0.92, 0.97, 0.75);
    st.colorDead = new Color4(1, 1, 1, 0);
    st.minSize = 0.4 * k;
    st.maxSize = 0.7 * k;
    st.addSizeGradient(0, 0.45);
    st.addSizeGradient(1, 2.8);
    st.minLifeTime = 1.2;
    st.maxLifeTime = 2;
    st.direction1 = new Vector3(-0.2, 1, -0.2);
    st.direction2 = new Vector3(0.2, 1, 0.2);
    st.minEmitPower = 1.6 * k;
    st.maxEmitPower = 2.6 * k;
    st.gravity = wind.scale(0.8);
    const steam = { ps: st, base: 0 };
    g.systems.push(steam);
    const period = 5.5 + rnd() * 4;
    const phase = rnd() * period;
    const fPhase = rnd() * 10;
    const fSpeed = 9 + rnd() * 5;
    g.tick = (t) => {
      // 火焰亮度變化（兩座不同頻率）、爐內熔煉面閃爍
      const fl = 0.82 + 0.12 * Math.sin(t * fSpeed + fPhase) + 0.06 * Math.sin(t * 23.7 + fPhase * 2);
      gm.emissiveColor.set(1 * fl, 0.42 * fl, 0.12 * fl);
      // 間歇蒸氣：每 period 秒噴 1.3 秒
      const u = (t + phase) % period;
      // 噴發開頭 0.3 秒最強（「嘶」一聲的感覺），之後減弱到停
      steam.base = u < 0.3 ? 26 : u < 1.4 ? 12 : 0;
      if (g.running) st.emitRate = steam.base * this.cap;
      // 陣風：風向與強度緩慢變化，兩座熔爐不同步
      for (const sm of smokes) {
        const gust = sm.k * (0.75 + 0.35 * Math.sin(t * 0.23 + sm.ph) + 0.15 * Math.sin(t * 0.71 + sm.ph * 2));
        const turn = 0.35 * Math.sin(t * 0.09 + sm.ph);
        sm.ps.gravity.set((wind.x * Math.cos(turn) - wind.z * Math.sin(turn)) * gust, 0.05, (wind.x * Math.sin(turn) + wind.z * Math.cos(turn)) * gust);
      }
    };
    this.groups.push(g);
  }

  // ------------------------------------------------------------------ 巨像
  colossus(model: TransformNode, unit: number, halo: (p: Vector3, size: number, color: [number, number, number], o: object) => void): void {
    const A = ANCHORS.colossus;
    model.computeWorldMatrix(true);
    const W = (v: readonly number[]): Vector3 => Vector3.TransformCoordinates(new Vector3(v[0]!, v[1]!, v[2]!), model.getWorldMatrix());
    // 雙眼微弱魔導光（往臉外推一點，避免被面罩遮住）
    for (const e of A.eyes) halo(W([e[0] - 0.012, e[1], e[2]]), 0.075 * unit, [1, 0.62, 0.25], { alpha: 0.8, pulse: { speed: 0.9, amp: 0.3 }, flicker: { phase: e[2] * 30 } });
    // 胸口核心：緩慢呼吸式發光
    const core = W(A.core);
    halo(W([A.core[0] - 0.01, A.core[1], A.core[2]]), 0.11 * unit, [1, 0.66, 0.24], { alpha: 0.6, pulse: { speed: 0.7, amp: 0.45 } });
    halo(W([A.core[0] - 0.02, A.core[1], A.core[2]]), 0.22 * unit, [1, 0.55, 0.2], { alpha: 0.18, pulse: { speed: 0.7, amp: 0.5, phase: 0.4 } });
    // 少量能量粒子：從胸口緩慢上升
    const g: FxGroup = { center: W([0, 0, 0]), radius: 0.55 * unit, systems: [], meshes: [], running: false };
    const ps = this.ps("colossus_motes", 18, "mote");
    ps.emitter = core;
    ps.minEmitBox = new Vector3(-1.5, -0.5, -1.5);
    ps.maxEmitBox = new Vector3(1.5, 1, 1.5);
    ps.color1 = new Color4(1, 0.7, 0.3, 0.9);
    ps.color2 = new Color4(0.45, 0.9, 1, 0.8);
    ps.colorDead = new Color4(0.4, 0.8, 1, 0);
    ps.minSize = 0.12;
    ps.maxSize = 0.28;
    ps.minLifeTime = 3;
    ps.maxLifeTime = 5;
    ps.direction1 = new Vector3(-0.2, 1, -0.2);
    ps.direction2 = new Vector3(0.2, 1, 0.2);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.7;
    ps.gravity = new Vector3(0, 0.05, 0);
    g.systems.push({ ps, base: 3 });
    this.groups.push(g);
  }

  // ------------------------------------------------------------------ 反應爐
  reactor(model: TransformNode, unit: number, halo: (p: Vector3, size: number, color: [number, number, number], o: object) => void): void {
    const A = ANCHORS.reactor;
    model.computeWorldMatrix(true);
    const W = (v: readonly number[]): Vector3 => Vector3.TransformCoordinates(new Vector3(v[0]!, v[1]!, v[2]!), model.getWorldMatrix());
    const center = W(A.core);
    const g: FxGroup = { center, radius: 0.5 * unit, systems: [], meshes: [], running: false };
    // 懸浮魔導核心（自發光球；呼吸式脈動）
    const coreMat = new StandardMaterial("reactor_core_m", this.scene);
    coreMat.disableLighting = true;
    coreMat.emissiveColor = new Color3(1, 0.74, 0.32);
    // 邊緣亮、中心透：以 Fresnel 讓核心有能量球的體積感，不會變成一塊平面黃圓
    coreMat.alpha = 0.85;
    coreMat.emissiveFresnelParameters = new FresnelParameters();
    coreMat.emissiveFresnelParameters.leftColor = new Color3(1, 0.9, 0.55);
    coreMat.emissiveFresnelParameters.rightColor = new Color3(0.75, 0.32, 0.08);
    coreMat.emissiveFresnelParameters.power = 1.6;
    const core = MeshBuilder.CreateSphere("reactor_core", { diameter: A.coreR * 2 * unit, segments: 16 }, this.scene);
    core.position.copyFrom(center);
    core.material = coreMat;
    core.isPickable = false;
    g.meshes.push(core);
    // 內層亮核（較小、較白）
    const inner = MeshBuilder.CreateSphere("reactor_core_in", { diameter: A.coreR * 1.15 * unit, segments: 12 }, this.scene);
    inner.parent = core;
    const im = new StandardMaterial("reactor_core_in_m", this.scene);
    im.disableLighting = true;
    im.emissiveColor = new Color3(1, 0.95, 0.8);
    inner.material = im;
    inner.isPickable = false;
    g.meshes.push(inner);
    halo(center, 0.2 * unit, [1, 0.72, 0.35], { alpha: 0.5, pulse: { speed: 1.4, amp: 0.25 } });
    halo(center, 0.42 * unit, [1, 0.6, 0.3], { alpha: 0.14, pulse: { speed: 1.4, amp: 0.3, phase: 0.5 } });
    // 三道不同方向緩慢旋轉的魔導環（半徑都小於核心艙內半徑 0.19 單位，不會穿過拱架）
    const rings: { m: Mesh; ax: Vector3; sp: number }[] = [];
    // 金屬環本體（受光、保留明暗）＋低強度青色自發光，避免光暈蓋過艙體細節
    const ringCols = [new Color3(0.18, 0.55, 0.65), new Color3(0.55, 0.38, 0.12), new Color3(0.2, 0.45, 0.62)];
    A.ringR.forEach((r, i) => {
      const m = MeshBuilder.CreateTorus(`reactor_ring${i}`, { diameter: r * 2 * unit, thickness: 0.009 * unit * (i === 1 ? 1.4 : 1), tessellation: 40 }, this.scene);
      m.position.copyFrom(center);
      const mat = new StandardMaterial(`reactor_ring${i}_m`, this.scene);
      mat.diffuseColor = i === 1 ? new Color3(0.75, 0.55, 0.25) : new Color3(0.35, 0.42, 0.46);
      mat.specularColor = new Color3(0.6, 0.6, 0.55);
      mat.specularPower = 48;
      mat.emissiveColor = ringCols[i]!;
      m.material = mat;
      m.isPickable = false;
      m.rotation.set(i === 0 ? 0.25 : i === 1 ? 1.1 : -0.6, i * 0.9, i === 2 ? 0.9 : 0);
      rings.push({ m, ax: [new Vector3(0, 1, 0), new Vector3(1, 0, 0.3).normalize(), new Vector3(0.3, 0.8, -0.5).normalize()][i]!, sp: [0.35, -0.28, 0.22][i]! });
      g.meshes.push(m);
    });
    // 青藍能量粒子（核心艙內緩慢上升，在艙頂前消失）
    const ps = this.ps("reactor_motes", 36, "mote");
    ps.emitter = center;
    const er = A.ringR[2]! * unit;
    ps.minEmitBox = new Vector3(-er, -er * 0.8, -er);
    ps.maxEmitBox = new Vector3(er, er * 0.2, er);
    ps.color1 = new Color4(0.45, 0.95, 1, 0.9);
    ps.color2 = new Color4(0.7, 0.85, 1, 0.8);
    ps.colorDead = new Color4(0.3, 0.7, 1, 0);
    ps.minSize = 0.1;
    ps.maxSize = 0.22;
    ps.minLifeTime = 1.8;
    ps.maxLifeTime = 2.6;
    ps.direction1 = new Vector3(-0.1, 1, -0.1);
    ps.direction2 = new Vector3(0.1, 1, 0.1);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 0.9;
    ps.gravity = Vector3.Zero();
    g.systems.push({ ps, base: 9 });
    g.tick = (t, dt, near) => {
      const b = 1 + 0.06 * Math.sin(t * 1.4);
      core.scaling.setAll(b);
      const e = 0.85 + 0.15 * Math.sin(t * 1.4);
      coreMat.emissiveColor.set(1 * e, 0.74 * e, 0.32 * e);
      if (!near) return;
      for (const r of rings) r.m.rotate(r.ax, r.sp * dt);
    };
    this.groups.push(g);
  }

  /** 釋放：粒子系統、特效網格與它們的材質、共用粒子貼圖 */
  dispose(): void {
    for (const g of this.groups) {
      for (const s of g.systems) s.ps.dispose(false);
      for (const m of g.meshes) m.dispose(false, true);
    }
    this.groups.length = 0;
    const cached = texCache.get(this.scene);
    if (cached) for (const t of Object.values(cached)) t?.dispose();
    texCache.delete(this.scene);
  }
}
