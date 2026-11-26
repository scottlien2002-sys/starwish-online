import { type AbstractMesh, type AnimationGroup, type Camera, Color3, type Material, type Node, type Scene, type ShadowGenerator, StandardMaterial, type Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { PetMerchantPatrolClock, petMerchantPose, type PetMerchantPose } from "./petMerchant.ts";
import { type NpcLodOptions, skinnedBounds } from "./NpcP3.ts";
import { lodLevel } from "./villagePerf.ts";

/**
 * 寵物商人 V2「星靈培育師・洛恩」（只在獨立預覽頁使用；尚未接進村莊）。
 * - 骨架角色（17 根骨頭）＋動作 Idle／Walk／Talk／Turn（混合切換）
 * - 巡走路線、停留點、互動距離與 V1 相同（petMerchantPose）；開啟介面時暫停巡走、轉身面向玩家並播放 Talk，關閉後接著巡走
 *   （PetMerchantPatrolClock：多人模式有回報逾時與連續暫停上限，不會被單一玩家永久停住）
 * - 白色長耳小寵物（PetPal_*）漂浮在洛恩頭部右上方，輕輕上下浮動、繞一點小圈
 * - 材質：GLB 的頂點色＋臉部貼圖改用 StandardMaterial（與村莊其他物件同一套光照）；晶石自發光
 */
export interface PetMerchantV2 {
  readonly root: TransformNode;
  readonly clock: PetMerchantPatrolClock;
  readonly pickMeshes: readonly AbstractMesh[];
  readonly stats: { meshes: number; triangles: number; farTriangles: number; bones: number; animations: string[]; shadowCasters: number };
  /** now：秒；回傳目前姿勢與動作 */
  update(now: number, dt?: number, camera?: Camera | null): PetMerchantPose & { anim: string; facing: number; lod: 0 | 1; paused: boolean };
  setEnabled(on: boolean): void;
}

const SCALE = 1.06; // 成年男性：比初心者略高
const TURN_RATE = 3.2; // rad/s
const PAL_OFF = new Vector3(0.3, 0.16, 0.06); // 相對頭部（角色右上方；本地座標 x 右、z 前）

function toStandard(scene: Scene, m: Material, cache: Map<Material, StandardMaterial>): StandardMaterial {
  const hit = cache.get(m);
  if (hit) return hit;
  const s = new StandardMaterial(`${m.name}_std`, scene);
  const tex = (m as unknown as { albedoTexture?: Texture | null }).albedoTexture ?? null;
  s.diffuseColor = new Color3(1, 1, 1);
  if (tex) s.diffuseTexture = tex;
  const n = m.name;
  if (n.includes("glow")) {
    s.diffuseColor = new Color3(0, 0, 0);
    s.emissiveColor = new Color3(1, 1, 1);
    s.disableLighting = false;
  } else if (n.includes("metal")) {
    s.specularColor = new Color3(0.55, 0.48, 0.3);
    s.specularPower = 36;
    s.emissiveColor = new Color3(0.06, 0.05, 0.02);
  } else {
    s.specularColor = new Color3(0.07, 0.07, 0.07);
    s.specularPower = 16;
    s.emissiveColor = new Color3(0.05, 0.05, 0.06);
  }
  cache.set(m, s);
  return s;
}

export function setupPetMerchantV2(
  scene: Scene,
  loaded: { meshes: AbstractMesh[]; animationGroups: AnimationGroup[]; transformNodes: TransformNode[]; rootNodes: Node[] },
  opt: { lite: boolean; shadows?: ShadowGenerator | null; shared?: boolean; far?: { meshes: AbstractMesh[]; animationGroups: AnimationGroup[]; transformNodes: TransformNode[]; rootNodes: Node[] } | null; lod?: NpcLodOptions },
): PetMerchantV2 {
  const lodOpt: NpcLodOptions = opt.lod ?? { lod: false, near: 18, animThrottle: false, animFar: 32 };
  const root = new TransformNode("petMerchantV2", scene);
  root.scaling.setAll(SCALE);
  const body = new TransformNode("petMerchantV2_body", scene);
  body.parent = root;
  for (const n of loaded.rootNodes) n.parent = body;
  const pal = new TransformNode("petMerchantV2_pal", scene);
  const cache = new Map<Material, StandardMaterial>();
  const pick: AbstractMesh[] = [];
  let tris = 0;
  let casters = 0;
  for (const m of loaded.meshes) {
    if (m.getTotalIndices() === 0) continue;
    if (m.material) m.material = toStandard(scene, m.material, cache);
    m.isPickable = true;
    m.metadata = { petMerchant: true };
    // Stage 6.3：不再 alwaysSelectAsActiveMesh（畫面外也會繪製、也會畫進陰影）；改用依骨架計算＋放大的包圍盒（Walk 動作幅度也涵蓋）
    skinnedBounds(m, 1.45);
    tris += m.getTotalIndices() / 3;
    pick.push(m);
    if (m.name.startsWith("PetPal_")) {
      m.setParent(pal);
      continue;
    }
    m.receiveShadows = true;
    // 只讓大輪廓零件投射陰影（外套、頭髮、頭、身體、長褲、靴子）：小配件不進陰影繪製，省下約 20 次繪製
    // V2.1 起網格依材質合併（pm_cloth、pm_hair、pm_face、pm_skin、pm_leather…）：大面積布料、頭髮、臉、皮革投射陰影
    const big = /(cloth|hair|face|skin|leather|dark)/.test(m.name) && !/(glow|metal|eye|egg)/.test(m.name);
    if (opt.shadows && big) {
      opt.shadows.addShadowCaster(m, false);
      casters++;
    }
  }
  const anims = new Map(loaded.animationGroups.map((g) => [g.name, g]));
  // Stage 6.3 距離 LOD：遠距模型（同骨架、同動作）掛在同一個節點，只顯示一組；小寵物一律用近距模型那一隻
  const nearMeshes = pick.filter((m) => !m.name.startsWith("PetPal_"));
  const farMeshes: AbstractMesh[] = [];
  const farAnims = new Map<string, AnimationGroup>();
  if (opt.far && lodOpt.lod) {
    for (const n of opt.far.rootNodes) n.parent = body;
    for (const m of opt.far.meshes) {
      if (m.getTotalIndices() === 0) continue;
      if (m.name.startsWith("PetPal_")) {
        m.setEnabled(false);
        continue;
      }
      if (m.material) m.material = toStandard(scene, m.material, cache);
      m.isPickable = true;
      m.metadata = { petMerchant: true };
      m.receiveShadows = true;
      skinnedBounds(m, 1.45);
      m.isVisible = false;
      farMeshes.push(m);
      pick.push(m);
      if (opt.shadows && /(cloth|hair|face|skin|leather|dark)/.test(m.name) && !/(glow|metal|eye|egg)/.test(m.name)) opt.shadows.addShadowCaster(m, false);
    }
    for (const g of opt.far.animationGroups) farAnims.set(g.name, g);
  } else if (opt.far) {
    for (const m of opt.far.meshes) m.setEnabled(false);
  }
  for (const g of [...loaded.animationGroups, ...farAnims.values()]) {
    g.stop();
    for (const ta of g.targetedAnimations) {
      ta.animation.enableBlending = true;
      ta.animation.blendingSpeed = 0.08;
    }
  }
  let lod: 0 | 1 = 0;
  let animPaused = false;
  const head = loaded.transformNodes.find((n) => n.name === "head") ?? null;
  const clock = new PetMerchantPatrolClock({ shared: !!opt.shared });
  let current = "";
  let facing: number | null = null;
  let lastNow: number | null = null;
  const play = (name: string, speed = 1): void => {
    for (const set of farAnims.size ? [anims, farAnims] : [anims]) {
      const g = set.get(name);
      if (!g) continue;
      g.speedRatio = speed;
      if (current === name) continue;
      for (const [n, o] of set) if (n !== name && (o.isPlaying || o.isStarted)) o.stop();
      g.start(true, speed);
      if (animPaused) g.pause();
    }
    current = name;
  };
  const pauseAnims = (p: boolean): void => {
    if (p === animPaused) return;
    animPaused = p;
    for (const set of [anims, farAnims]) {
      const g = set.get(current);
      if (!g) continue;
      if (p) g.pause();
      else g.play(true);
    }
  };
  const headPos = new Vector3();
  // Stage 6.6：眨眼（眼皮形狀鍵；只有近距模型有）
  const blinkTargets: { influence: number }[] = [];
  for (const m of nearMeshes) {
    const mm = (m as unknown as { morphTargetManager?: { numTargets: number; getTarget(i: number): { influence: number; name?: string } } | null }).morphTargetManager;
    if (!mm) continue;
    for (let i = 0; i < mm.numTargets; i++) {
      const t = mm.getTarget(i);
      t.influence = 0;
      blinkTargets.push(t);
    }
  }
  let blinkClock = 0;
  let nextBlink = 1.5;
  let blinkAt = -1;
  return {
    root,
    clock,
    pickMeshes: pick,
    stats: { meshes: nearMeshes.length + (pick.length - nearMeshes.length - farMeshes.length), triangles: Math.round(tris), farTriangles: Math.round(farMeshes.reduce((a, m) => a + m.getTotalIndices() / 3, 0)), bones: loaded.transformNodes.length, animations: [...anims.keys()], shadowCasters: casters },
    update(now, dtIn, camera) {
      const dt = dtIn ?? (lastNow === null ? 0 : Math.min(0.1, Math.max(0, now - lastNow)));
      lastNow = now;
      if (blinkTargets.length) {
        blinkClock += dt;
        if (blinkAt < 0 && blinkClock >= nextBlink) {
          blinkAt = blinkClock;
          nextBlink = blinkClock + (Math.random() < 0.15 ? 0.3 : 2.4 + Math.random() * 3.2);
        }
        let v = 0;
        if (blinkAt >= 0) {
          const t = (blinkClock - blinkAt) / 0.16;
          if (t >= 1) blinkAt = -1;
          else v = Math.sin(Math.PI * Math.min(1, t * 1.15));
        }
        for (const b of blinkTargets) b.influence = v;
      }
      const paused = clock.paused(now);
      const p = petMerchantPose(clock.patrolTime(now));
      root.position.set(p.x, 0.03, p.z);
      let want = p.yaw;
      const tgt = paused ? clock.talkTarget(now) : null;
      if (tgt) want = Math.atan2(tgt.x - p.x, tgt.z - p.z);
      if (facing === null || dt === 0) facing = want;
      let d = want - facing;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const step = TURN_RATE * dt;
      facing += Math.abs(d) <= step ? d : Math.sign(d) * step;
      root.rotation.y = facing;
      const turning = Math.abs(d) > 0.35;
      const anim = turning ? "Turn" : tgt ? "Talk" : p.walking ? "Walk" : "Idle";
      play(anim, anim === "Walk" ? 0.95 : 1);
      // 小寵物：頭部右上方漂浮
      if (head) headPos.copyFrom(head.getAbsolutePosition());
      else headPos.set(p.x, 1.0 * SCALE, p.z);
      const c = Math.cos(facing);
      const s = Math.sin(facing);
      const ox = PAL_OFF.x * Math.cos(now * 0.7) * 0.15 + PAL_OFF.x;
      const oz = PAL_OFF.z + 0.04 * Math.sin(now * 0.7);
      // 角色面向 yaw（0＝+Z）：右手方向＝(cos, −sin)、前方＝(sin, cos)
      pal.position.set(headPos.x + ox * c + oz * s, headPos.y + PAL_OFF.y + 0.035 * Math.sin(now * 2.1), headPos.z - ox * s + oz * c);
      pal.rotation.y = facing + 0.25 * Math.sin(now * 0.8);
      // 距離 LOD（以鏡頭距離判斷；對話中一定用近距模型）＋畫面外暫停動作（洛恩會走路，遠距不暫停，避免滑行）
      const cx = camera ? camera.globalPosition.x : p.x;
      const cz = camera ? camera.globalPosition.z : p.z;
      const dist = Math.hypot(p.x - cx, p.z - cz);
      if (farMeshes.length) {
        const lv = tgt ? 0 : lodLevel(dist, lodOpt.near, lod);
        if (lv !== lod) {
          lod = lv;
          for (const m of nearMeshes) m.isVisible = lv === 0;
          for (const m of farMeshes) m.isVisible = lv === 1;
        }
      }
      if (lodOpt.animThrottle && camera) {
        const shown = (lod === 0 ? nearMeshes : farMeshes)[0];
        pauseAnims(!tgt && !!shown && !camera.isInFrustum(shown));
      }
      return { ...p, anim, facing, lod, paused: animPaused };
    },
    setEnabled(on) {
      root.setEnabled(on);
      pal.setEnabled(on);
    },
  };
}
