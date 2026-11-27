/**
 * Stage 8.2：多人模式的角色外觀（本人與其他玩家同一套美術標準）。
 * - 模型：已驗收的 C1.0-B5b 男女初心者（NoviceAvatar.load，不用 Tripo 零件）；其他玩家用 Lite
 * - 髮色：只改髮型材質（male_hair／female_hair／female_ponytail）的顏色；不另做模型
 * - 武器：C1.0-B5b 沒有武器網格 → 掛 Claude C 戰鬥特效 Stage 1 的展示武器（短劍／法杖，程式產生），
 *   掛點用 C 的 novice_combat_{male,female}.json「weaponAttach」（hand.R）。正式武器 GLB 交付後換掉即可。
 * 外觀由伺服器保存：換地圖、重新登入、斷線重連都從伺服器的 appearance 套用。
 */
import { Color3, PBRMaterial, StandardMaterial, type Scene, type TransformNode } from "@babylonjs/core";
import type { NoviceAvatar } from "../characters/NoviceAvatar.ts";
import { attachWeapon, buildStaff, buildSword, type WeaponRig } from "../combat-vfx/weapons.ts";

export interface MpAppearance {
  hair: string;
  hairColor: string | null;
  weapon: "sword" | "staff";
}

interface AttachInfo {
  bone: string;
  bladeDir: number[];
  edgeUp: number[];
}

const attachCache = new Map<string, Promise<AttachInfo | null>>();

function loadAttach(gender: "male" | "female"): Promise<AttachInfo | null> {
  let p = attachCache.get(gender);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}combat-vfx/novice_combat_${gender}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ weaponAttach?: AttachInfo }>) : {}))
      .then((j) => (j as { weaponAttach?: AttachInfo }).weaponAttach ?? null)
      .catch(() => null);
    attachCache.set(gender, p);
  }
  return p;
}

const HAIR_MAT = /hair|ponytail/i;

export interface AppliedLook {
  weapon: WeaponRig | null;
  hairTinted: number;
  dispose(): void;
}

let seq = 0;

/** 把外觀套到已載入的 C1.0-B5b 角色上。回傳的 dispose 只移除武器（角色本身由呼叫端釋放） */
export async function applyNoviceLook(scene: Scene, avatar: NoviceAvatar, gender: "male" | "female", ap: MpAppearance): Promise<AppliedLook> {
  let hairTinted = 0;
  if (ap.hairColor && /^#[0-9a-f]{6}$/i.test(ap.hairColor)) {
    const c = Color3.FromHexString(ap.hairColor);
    for (const m of avatar.meshes) {
      const mat = m.material;
      if (!mat || !HAIR_MAT.test(mat.name)) continue;
      if (mat instanceof PBRMaterial) mat.albedoColor = c;
      else if (mat instanceof StandardMaterial) mat.diffuseColor = c;
      else continue;
      hairTinted++;
    }
  }
  avatar.setWeapon(ap.weapon);
  let weapon: WeaponRig | null = null;
  const info = await loadAttach(gender);
  const skel = avatar.meshes.find((m) => !!m.skeleton)?.skeleton ?? null;
  const bone = info && skel ? skel.bones.find((b) => b.name === info.bone) : undefined;
  const node: TransformNode | null = bone?.getTransformNode() ?? null;
  if (info && node) {
    const id = `mp${++seq}`;
    weapon = ap.weapon === "staff" ? buildStaff(scene, id) : buildSword(scene, id);
    attachWeapon(weapon, node, info.bladeDir, info.edgeUp);
    for (const m of weapon.meshes) m.isPickable = false;
  }
  return {
    weapon,
    hairTinted,
    dispose: () => {
      if (!weapon) return;
      for (const m of weapon.meshes) m.dispose(false, true);
      weapon.root.dispose();
    },
  };
}
