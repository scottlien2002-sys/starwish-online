import { type AbstractMesh, type AnimationGroup, type Camera, Color3, type Material, type Mesh, type Node, type Scene, type ShadowGenerator, StandardMaterial, type Texture, TransformNode } from "@babylonjs/core";
import { lodLevel } from "./villagePerf.ts";
import { NPC_SPOTS, type NpcSpot } from "./layout.ts";

/**
 * Stage 6.2 星芽村八位正式 NPC（取代粉紅色佔位人形）。
 * - 位置與面向沿用 layout.ts 的 NPC_SPOTS（不新增碰撞、不改站位）
 * - 每位 NPC 一個 GLB（HQ／Lite），骨架動作 Idle／Talk／Turn；整個角色 1 個網格、1 個材質（臉部貼圖＋頂點色）
 * - 玩家對話時：轉身面向玩家（Turn）→ 對話（Talk）；對話結束後轉回原本的面向 → 待機（Idle）
 * - 只有畫面：NPC 的實際功能（轉職、強化、倉庫、商店…）由各系統透過 VillageInteract 提供
 * - Stage 6.3 效能：距離 LOD（近：HQ／Lite 模型；遠：遠距模型，兩組動作同步播放、只顯示一組）、
 *   遠距或畫面外暫停骨架動作（不影響對話：對話中的 NPC 一定在近距離）、包圍盒依骨架計算＋餘量（保留視錐剔除）
 */
export interface NpcProfile {
  /** 對應的 NPC_SPOTS id（建築 id） */
  spot: string;
  /** GLB 檔名代號 npc_<key>_{hq,lite}.glb */
  key: string;
  name: string;
  title: string;
  greeting: string;
}

export const NPC_PROFILES: readonly NpcProfile[] = [
  { spot: "sword", key: "swordmaster", name: "雷恩", title: "劍士軍團教官", greeting: "握劍的手要穩，心更要穩。想成為劍士嗎？" },
  { spot: "knight", key: "knight", name: "艾德溫", title: "騎士軍團團長", greeting: "騎士的盾，是為了守護身後的人而舉起的。" },
  { spot: "smith", key: "smith", name: "巴爾克", title: "鐵匠師傅", greeting: "哈！好裝備要千錘百鍊。強化、修理、詞條鑑定都找我。" },
  { spot: "mage", key: "mage", name: "瑟琳娜", title: "法師軍團導師", greeting: "星光裡藏著魔法的語言，你聽得見嗎？" },
  { spot: "church", key: "priest", name: "艾莉亞", title: "祭司教堂導師", greeting: "願星願守護你。受傷了就來教堂休息吧。" },
  { spot: "circus", key: "clown", name: "波波洛", title: "小丑馬戲團團長", greeting: "歡迎光臨！笑容也是一種了不起的力量喔～" },
  { spot: "warehouse", key: "warehouse", name: "米拉", title: "倉庫管理員", greeting: "要寄放東西嗎？每一件我都會好好記在帳本上。" },
  { spot: "guild", key: "guild", name: "葛蘭特", title: "星願商會掌櫃", greeting: "歡迎光臨星願商會，買賣、掛賣都在這裡。" },
];

export function npcProfile(spotId: string): NpcProfile | null {
  return NPC_PROFILES.find((p) => p.spot === spotId) ?? null;
}

export interface VillageNpcs {
  readonly ids: readonly string[];
  readonly stats: Record<string, { triangles: number; farTriangles: number; meshes: number; animations: string[] }>;
  /** talkId：正在對話的 NPC（spot id），null＝沒有；px/pz：玩家位置；camera：用於距離 LOD 與畫面外判斷 */
  update(now: number, dt: number, talkId: string | null, px: number, pz: number, camera?: Camera | null): void;
  state(): Record<string, { anim: string; facing: number; home: number; lod: 0 | 1; paused: boolean }>;
  setEnabled(on: boolean): void;
  /** 效能診斷：false＝一律使用近距模型 */
  setLod(on: boolean): void;
  /** 所有 NPC 網格（近＋遠；效能診斷用） */
  readonly meshes: readonly AbstractMesh[];
}

export interface Loaded {
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  transformNodes: TransformNode[];
  rootNodes: Node[];
}

export interface NpcLodOptions {
  /** false＝只用主要模型 */
  lod: boolean;
  near: number;
  animThrottle: boolean;
  animFar: number;
}

const SCALE = 1.06; // 成年村民：比初心者略高（與洛恩相同）
const TURN_RATE = 3.6; // rad/s

export function toStandardNpc(scene: Scene, m: Material, cache: Map<Material, StandardMaterial>): StandardMaterial {
  const hit = cache.get(m);
  if (hit) return hit;
  const s = new StandardMaterial(`${m.name}_std`, scene);
  const tex = (m as unknown as { albedoTexture?: Texture | null }).albedoTexture ?? null;
  s.diffuseColor = new Color3(1, 1, 1);
  if (tex) s.diffuseTexture = tex;
  s.specularColor = new Color3(0.08, 0.08, 0.08);
  s.specularPower = 18;
  s.emissiveColor = new Color3(0.06, 0.06, 0.07);
  cache.set(m, s);
  return s;
}

/** 骨架角色的包圍盒：依骨架姿勢計算後放大（動作幅度小），讓視錐剔除可以正常運作（取代 alwaysSelectAsActiveMesh） */
export function skinnedBounds(m: AbstractMesh, scale = 1.35): void {
  (m as Mesh).refreshBoundingInfo({ applySkeleton: true, applyMorph: false });
  m.getBoundingInfo().scale(scale);
}

const wrap = (a: number): number => {
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** 一組模型（近或遠）的網格與動作 */
interface Set_ {
  meshes: AbstractMesh[];
  anims: Map<string, AnimationGroup>;
}

export function setupVillageNpcs(
  scene: Scene,
  loaded: Map<string, { near: Loaded; far: Loaded | null }>,
  opt: { lite: boolean; shadows?: ShadowGenerator | null; lod?: NpcLodOptions },
): VillageNpcs {
  const cache = new Map<Material, StandardMaterial>();
  const stats: VillageNpcs["stats"] = {};
  const lodOpt: NpcLodOptions = opt.lod ?? { lod: false, near: 18, animThrottle: false, animFar: 32 };
  interface One {
    spot: NpcSpot;
    root: TransformNode;
    sets: Set_[];
    current: string;
    facing: number;
    lod: 0 | 1;
    paused: boolean;
    /** Stage 6.6 生活感：下次眨眼／職業小動作的時間、正在播放小動作到何時 */
    nextBlink: number;
    blinkAt: number;
    nextAct: number;
    actUntil: number;
    morphs: { influence: number }[];
  }
  const all: One[] = [];
  let clock = 0;
  const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
  const allMeshes: AbstractMesh[] = [];
  const prep = (r: Loaded, root: TransformNode): { set: Set_; tris: number } => {
    for (const n of r.rootNodes) n.parent = root;
    let tris = 0;
    const meshes: AbstractMesh[] = [];
    for (const m of r.meshes) {
      if (m.getTotalIndices() === 0) continue;
      if (m.material) m.material = toStandardNpc(scene, m.material, cache);
      m.isPickable = false;
      m.receiveShadows = true;
      skinnedBounds(m);
      tris += m.getTotalIndices() / 3;
      meshes.push(m);
      allMeshes.push(m);
      if (opt.shadows) opt.shadows.addShadowCaster(m, false);
    }
    const anims = new Map(r.animationGroups.map((g) => [g.name, g]));
    for (const g of r.animationGroups) {
      g.stop();
      for (const ta of g.targetedAnimations) {
        ta.animation.enableBlending = true;
        ta.animation.blendingSpeed = 0.08;
      }
    }
    return { set: { meshes, anims }, tris };
  };
  let k = 0;
  for (const prof of NPC_PROFILES) {
    const spot = NPC_SPOTS.find((n) => n.id === prof.spot);
    const r = loaded.get(prof.key);
    if (!spot || !r) continue;
    const root = new TransformNode(`npc_${prof.key}`, scene);
    root.scaling.setAll(SCALE);
    root.position.set(spot.x, spot.floor + 0.02, spot.z);
    root.rotation.y = spot.yaw;
    const near = prep(r.near, root);
    const far = r.far && lodOpt.lod ? prep(r.far, root) : null;
    if (r.far && !far) for (const m of r.far.meshes) m.setEnabled(false);
    const sets = far ? [near.set, far.set] : [near.set];
    // Stage 6.6：眨眼（眼皮形狀鍵；只有近距模型有）
    const morphs: { influence: number }[] = [];
    for (const m of near.set.meshes) {
      const mm = (m as Mesh).morphTargetManager;
      if (!mm) continue;
      for (let i = 0; i < mm.numTargets; i++) {
        const t = mm.getTarget(i);
        if ((t.name ?? "").toLowerCase().includes("blink") || mm.numTargets === 1) {
          t.influence = 0;
          morphs.push(t);
        }
      }
    }
    const one: One = { spot, root, sets, current: "", facing: spot.yaw, lod: 0, paused: false, nextBlink: rnd(0.5, 4), blinkAt: -1, nextAct: rnd(22, 40), actUntil: 0, morphs };
    if (far) for (const m of far.set.meshes) m.isVisible = false;
    // 待機錯開起點：八位不會同時呼吸（近／遠兩組同一個起點，切換 LOD 時姿勢一致）
    for (const st of sets) {
      const idle = st.anims.get("Idle");
      if (idle) {
        idle.start(true, 0.92 + 0.04 * (k % 4));
        idle.goToFrame(idle.from + ((idle.to - idle.from) * k) / 8);
      }
    }
    one.current = "Idle";
    all.push(one);
    stats[prof.spot] = { triangles: Math.round(near.tris), farTriangles: Math.round(far?.tris ?? 0), meshes: near.set.meshes.length, animations: [...near.set.anims.keys()] };
    k++;
  }

  let lodOn = true;
  const play = (o: One, name: string): void => {
    if (o.current === name) return;
    for (const st of o.sets) {
      const g = st.anims.get(name);
      if (!g) continue;
      for (const [n, a] of st.anims) if (n !== name && (a.isPlaying || a.isStarted)) a.stop();
      g.start(name !== "Act", 1);
      if (o.paused) g.pause();
    }
    o.current = name;
  };
  /** Stage 6.6：職業小動作（Act，2～3 秒，播一次）長度 */
  const actLen = (o: One): number => {
    const g = o.sets[0]!.anims.get("Act");
    return g ? (g.to - g.from) / 30 : 0;
  };
  const setPaused = (o: One, p: boolean): void => {
    if (o.paused === p) return;
    o.paused = p;
    for (const st of o.sets) {
      const g = st.anims.get(o.current);
      if (!g) continue;
      if (p) g.pause();
      else g.play(true);
    }
  };

  return {
    ids: all.map((o) => o.spot.id),
    stats,
    meshes: allMeshes,
    update(_now, dtIn, talkId, px, pz, camera) {
      const dt = Math.min(0.1, Math.max(0, dtIn));
      clock += dt;
      const cx = camera ? camera.globalPosition.x : px;
      const cz = camera ? camera.globalPosition.z : pz;
      for (const o of all) {
        const talking = talkId === o.spot.id;
        const want = talking ? Math.atan2(px - o.spot.x, pz - o.spot.z) : o.spot.yaw;
        const d = wrap(want - o.facing);
        const step = TURN_RATE * dt;
        o.facing = wrap(o.facing + (Math.abs(d) <= step ? d : Math.sign(d) * step));
        o.root.rotation.y = o.facing;
        // Stage 6.6：待機時偶爾播放職業小動作（各 NPC 時間錯開；對話、轉身、暫停時不播）
        let idleName = "Idle";
        if (!talking && Math.abs(d) <= 0.3 && !o.paused) {
          if (o.actUntil > clock) idleName = "Act";
          else if (clock >= o.nextAct && actLen(o) > 0) {
            o.actUntil = clock + actLen(o);
            o.nextAct = clock + actLen(o) + rnd(12, 26);
            idleName = "Act";
          }
        } else if (o.current === "Act") {
          o.actUntil = 0;
        }
        play(o, Math.abs(d) > 0.3 ? "Turn" : talking ? "Talk" : idleName);
        // 眨眼：每 2.2～5.5 秒一次（偶爾連眨兩下），0.16 秒；遠距或暫停時不眨
        if (o.morphs.length && o.lod === 0 && !o.paused) {
          if (o.blinkAt < 0 && clock >= o.nextBlink) {
            o.blinkAt = clock;
            o.nextBlink = clock + (Math.random() < 0.18 ? 0.32 : rnd(2.2, 5.5));
          }
          let v = 0;
          if (o.blinkAt >= 0) {
            const t = (clock - o.blinkAt) / 0.16;
            if (t >= 1) o.blinkAt = -1;
            else v = Math.sin(Math.PI * Math.min(1, t * 1.15));
          }
          for (const m of o.morphs) m.influence = v;
        }
        const dist = Math.hypot(o.spot.x - cx, o.spot.z - cz);
        if (o.sets.length > 1) {
          const lv = talking || !lodOn ? 0 : lodLevel(dist, lodOpt.near, o.lod);
          if (lv !== o.lod) {
            o.lod = lv;
            for (const m of o.sets[0]!.meshes) m.isVisible = lv === 0;
            for (const m of o.sets[1]!.meshes) m.isVisible = lv === 1;
          }
        }
        if (lodOpt.animThrottle) {
          const shown = o.sets[o.lod]!.meshes[0];
          const inView = !camera || !shown || camera.isInFrustum(shown);
          setPaused(o, !talking && (dist > lodOpt.animFar || !inView));
        }
      }
    },
    state() {
      return Object.fromEntries(all.map((o) => [o.spot.id, { anim: o.current, facing: o.facing, home: o.spot.yaw, lod: o.lod, paused: o.paused }]));
    },
    setEnabled(on) {
      for (const o of all) o.root.setEnabled(on);
    },
    setLod(on) {
      lodOn = on;
    },
  };
}
