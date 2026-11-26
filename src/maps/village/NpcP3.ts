import { type AbstractMesh, type AnimationGroup, Color3, type Material, type Mesh, type Node, type Scene, type ShadowGenerator, StandardMaterial, type Texture, TransformNode } from "@babylonjs/core";
import { NPC_SPOTS, type NpcSpot } from "./layout.ts";

/**
 * Stage 6.2 星芽村八位正式 NPC（取代粉紅色佔位人形）。
 * - 位置與面向沿用 layout.ts 的 NPC_SPOTS（不新增碰撞、不改站位）
 * - 每位 NPC 一個 GLB（HQ／Lite），骨架動作 Idle／Talk／Turn；整個角色 1 個網格、1 個材質（臉部貼圖＋頂點色）
 * - 玩家對話時：轉身面向玩家（Turn）→ 對話（Talk）；對話結束後轉回原本的面向 → 待機（Idle）
 * - 只有畫面：NPC 的實際功能（轉職、強化、倉庫、商店…）由各系統透過 VillageInteract 提供
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
  readonly stats: Record<string, { triangles: number; meshes: number; animations: string[] }>;
  /** talkId：正在對話的 NPC（spot id），null＝沒有；px/pz：玩家位置 */
  update(now: number, dt: number, talkId: string | null, px: number, pz: number): void;
  state(): Record<string, { anim: string; facing: number; home: number }>;
  setEnabled(on: boolean): void;
}

interface Loaded {
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  transformNodes: TransformNode[];
  rootNodes: Node[];
}

const SCALE = 1.06; // 成年村民：比初心者略高（與洛恩相同）
const TURN_RATE = 3.6; // rad/s

function toStandard(scene: Scene, m: Material, cache: Map<Material, StandardMaterial>): StandardMaterial {
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

const wrap = (a: number): number => {
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

export function setupVillageNpcs(scene: Scene, loaded: Map<string, Loaded>, opt: { lite: boolean; shadows?: ShadowGenerator | null }): VillageNpcs {
  const cache = new Map<Material, StandardMaterial>();
  const stats: VillageNpcs["stats"] = {};
  interface One {
    spot: NpcSpot;
    root: TransformNode;
    anims: Map<string, AnimationGroup>;
    current: string;
    facing: number;
    meshes: AbstractMesh[];
  }
  const all: One[] = [];
  let k = 0;
  for (const prof of NPC_PROFILES) {
    const spot = NPC_SPOTS.find((n) => n.id === prof.spot);
    const r = loaded.get(prof.key);
    if (!spot || !r) continue;
    const root = new TransformNode(`npc_${prof.key}`, scene);
    root.scaling.setAll(SCALE);
    root.position.set(spot.x, spot.floor + 0.02, spot.z);
    root.rotation.y = spot.yaw;
    for (const n of r.rootNodes) n.parent = root;
    let tris = 0;
    const meshes: AbstractMesh[] = [];
    for (const m of r.meshes) {
      if (m.getTotalIndices() === 0) continue;
      if (m.material) m.material = toStandard(scene, m.material, cache);
      m.isPickable = false;
      m.receiveShadows = true;
      // 骨架角色：動作幅度小（原地待機／轉身／對話）→ 用綁骨後的包圍盒＋餘量，保留視錐裁切（看不到的 NPC 不繪製）
      (m as Mesh).refreshBoundingInfo({ applySkeleton: true, applyMorph: false });
      m.getBoundingInfo().scale(1.35);
      tris += m.getTotalIndices() / 3;
      meshes.push(m);
      if (opt.shadows && !opt.lite) opt.shadows.addShadowCaster(m, false);
    }
    const anims = new Map(r.animationGroups.map((g) => [g.name, g]));
    for (const g of r.animationGroups) {
      g.stop();
      for (const ta of g.targetedAnimations) {
        ta.animation.enableBlending = true;
        ta.animation.blendingSpeed = 0.08;
      }
    }
    const one: One = { spot, root, anims, current: "", facing: spot.yaw, meshes };
    // 待機錯開起點：八位不會同時呼吸
    const idle = anims.get("Idle");
    if (idle) {
      idle.start(true, 0.92 + 0.04 * (k % 4));
      idle.goToFrame(idle.from + ((idle.to - idle.from) * k) / 8);
      one.current = "Idle";
    }
    all.push(one);
    stats[prof.spot] = { triangles: Math.round(tris), meshes: meshes.length, animations: [...anims.keys()] };
    k++;
  }

  const play = (o: One, name: string): void => {
    if (o.current === name) return;
    const g = o.anims.get(name);
    if (!g) return;
    for (const [n, a] of o.anims) if (n !== name && a.isPlaying) a.stop();
    g.start(true, 1);
    o.current = name;
  };

  return {
    ids: all.map((o) => o.spot.id),
    stats,
    update(_now, dtIn, talkId, px, pz) {
      const dt = Math.min(0.1, Math.max(0, dtIn));
      for (const o of all) {
        const talking = talkId === o.spot.id;
        const want = talking ? Math.atan2(px - o.spot.x, pz - o.spot.z) : o.spot.yaw;
        const d = wrap(want - o.facing);
        const step = TURN_RATE * dt;
        o.facing = wrap(o.facing + (Math.abs(d) <= step ? d : Math.sign(d) * step));
        o.root.rotation.y = o.facing;
        play(o, Math.abs(d) > 0.3 ? "Turn" : talking ? "Talk" : "Idle");
      }
    },
    state() {
      return Object.fromEntries(all.map((o) => [o.spot.id, { anim: o.current, facing: o.facing, home: o.spot.yaw }]));
    },
    setEnabled(on) {
      for (const o of all) o.root.setEnabled(on);
    },
  };
}
