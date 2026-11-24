import { type AbstractMesh, type AnimationGroup, Color3, type Material, type Node, type Scene, type ShadowGenerator, StandardMaterial, type Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { PetMerchantPatrolClock, petMerchantPose, type PetMerchantPose } from "./petMerchant.ts";

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
  readonly stats: { meshes: number; triangles: number; bones: number; animations: string[]; shadowCasters: number };
  /** now：秒；回傳目前姿勢與動作 */
  update(now: number, dt?: number): PetMerchantPose & { anim: string; facing: number };
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
  opt: { lite: boolean; shadows?: ShadowGenerator | null; shared?: boolean },
): PetMerchantV2 {
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
    m.alwaysSelectAsActiveMesh = true; // 骨架角色的包圍盒會隨動作改變，避免被錯誤裁切
    tris += m.getTotalIndices() / 3;
    pick.push(m);
    if (m.name.startsWith("PetPal_")) {
      m.setParent(pal);
      continue;
    }
    m.receiveShadows = true;
    if (opt.shadows && !m.name.includes("stone")) {
      opt.shadows.addShadowCaster(m, false);
      casters++;
    }
  }
  const anims = new Map(loaded.animationGroups.map((g) => [g.name, g]));
  for (const g of loaded.animationGroups) {
    g.stop();
    for (const ta of g.targetedAnimations) {
      ta.animation.enableBlending = true;
      ta.animation.blendingSpeed = 0.08;
    }
  }
  const head = loaded.transformNodes.find((n) => n.name === "head") ?? null;
  const clock = new PetMerchantPatrolClock({ shared: !!opt.shared });
  let current = "";
  let facing: number | null = null;
  let lastNow: number | null = null;
  const play = (name: string, speed = 1): void => {
    const g = anims.get(name);
    if (!g) return;
    g.speedRatio = speed;
    if (current === name) return;
    for (const [n, o] of anims) if (n !== name && o.isPlaying) o.stop();
    g.start(true, speed);
    current = name;
  };
  const headPos = new Vector3();
  return {
    root,
    clock,
    pickMeshes: pick,
    stats: { meshes: pick.length, triangles: Math.round(tris), bones: loaded.transformNodes.length, animations: [...anims.keys()], shadowCasters: casters },
    update(now, dtIn) {
      const dt = dtIn ?? (lastNow === null ? 0 : Math.min(0.1, Math.max(0, now - lastNow)));
      lastNow = now;
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
      if (head) head.getAbsolutePosition().copyTo(headPos);
      else headPos.set(p.x, 1.0 * SCALE, p.z);
      const c = Math.cos(facing);
      const s = Math.sin(facing);
      const ox = PAL_OFF.x * Math.cos(now * 0.7) * 0.15 + PAL_OFF.x;
      const oz = PAL_OFF.z + 0.04 * Math.sin(now * 0.7);
      // 角色面向 yaw（0＝+Z）：右手方向＝(cos, −sin)、前方＝(sin, cos)
      pal.position.set(headPos.x + ox * c + oz * s, headPos.y + PAL_OFF.y + 0.035 * Math.sin(now * 2.1), headPos.z - ox * s + oz * c);
      pal.rotation.y = facing + 0.25 * Math.sin(now * 0.8);
      return { ...p, anim, facing };
    },
    setEnabled(on) {
      root.setEnabled(on);
      pal.setEnabled(on);
    },
  };
}
