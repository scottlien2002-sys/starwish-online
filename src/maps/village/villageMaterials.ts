import { Color3, FresnelParameters, type Material, PBRMaterial, type Scene, StandardMaterial } from "@babylonjs/core";
import { villageTexture } from "./villageTextures.ts";

/**
 * 星芽村正式美術共用材質（P3-2D 起）：噴泉、廣場、騎士軍團（及之後的建築）用同一組石材、金屬、物件材質，
 * 讓整村的石材質感、金屬光澤、色彩一致；每種材質每個場景只建立一次。
 * 全部是手機友善的設定：不用環境貼圖、不用即時反射、不開 GlowLayer。
 */
const caches = new WeakMap<Scene, Map<string, Material>>();

/**
 * Stage 6.6 美術升級的石材設定（載入模型前由村莊頁設定）：
 * - liteNormals：中畫質（Lite 模型）也使用石材法線貼圖（低畫質不用）
 * - stoneAlbedo：石材整體亮度（6.5 以前 1.08～1.12 偏亮，造成過曝與塑膠感）
 * - stoneRough：石材粗糙度
 */
export const VILLAGE_LOOK = { liteNormals: false, stoneAlbedo: 1, stoneRough: 0.85, slateRough: 0.45 };

function once<T extends Material>(scene: Scene, key: string, make: () => T): T {
  let m = caches.get(scene);
  if (!m) {
    m = new Map();
    caches.set(scene, m);
  }
  const hit = m.get(key);
  if (hit) return hit as T;
  const v = make();
  m.set(key, v);
  return v;
}

function fresnel(left: number, right: number, bias: number, power: number): FresnelParameters {
  const f = new FresnelParameters();
  f.leftColor = new Color3(left, left, left);
  f.rightColor = new Color3(right, right, right);
  f.bias = bias;
  f.power = power;
  return f;
}

/** 金：暖色高光＋邊緣菲涅耳（不靠環境貼圖的金屬感）；地面嵌條斜看也不會變螢光黃 */
export function villageGold(scene: Scene): StandardMaterial {
  return once(scene, "gold", () => {
    const m = new StandardMaterial("VP3_gold", scene);
    m.diffuseColor = new Color3(0.74, 0.57, 0.27);
    m.specularColor = new Color3(0.95, 0.82, 0.52);
    m.specularPower = 48;
    m.emissiveColor = new Color3(0.17, 0.13, 0.05);
    m.emissiveFresnelParameters = fresnel(0.75, 0.14, 0.1, 1.5);
    return m;
  });
}

/** 物件（長椅、燈具、門、旗、雕像、花草）：顏色＝頂點色（含烘焙環境光遮蔽） */
export function villageProps(scene: Scene): StandardMaterial {
  return once(scene, "props", () => {
    const m = new StandardMaterial("VP3_props", scene);
    m.diffuseColor = new Color3(1, 1, 1);
    m.specularColor = new Color3(0.13, 0.13, 0.15);
    m.specularPower = 28;
    m.emissiveColor = new Color3(0.05, 0.048, 0.045);
    return m;
  });
}

/** 燈罩與水晶：不受光（漫射黑＋自發光白 × 頂點色） */
export function villageGlass(scene: Scene): StandardMaterial {
  return once(scene, "glass", () => {
    const m = new StandardMaterial("VP3_glass", scene);
    m.diffuseColor = Color3.Black();
    m.emissiveColor = new Color3(1, 1, 1);
    m.specularColor = Color3.Black();
    return m;
  });
}

function stonePbr(scene: Scene, name: string, tex: string, nrm: string | null, level: number, albedo: Color3, rough: number, hq: boolean): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoTexture = villageTexture(scene, tex, hq);
  m.albedoColor = albedo.scale(VILLAGE_LOOK.stoneAlbedo);
  m.metallic = 0;
  m.roughness = rough;
  if (nrm) {
    const n = villageTexture(scene, nrm, hq);
    n.level = level;
    m.bumpTexture = n;
  }
  return m;
}

/** 暖白石灰岩（廣場石板、噴泉雕刻）：無接縫細紋；石板分割由模型負責 */
export function villageLimestone(scene: Scene, texBase: string, hq: boolean): PBRMaterial {
  return once(scene, `limestone:${hq}`, () =>
    stonePbr(scene, "VP3_limestone", `${texBase}slab_${hq ? "hq" : "lite"}.png`, hq || VILLAGE_LOOK.liteNormals ? `${texBase}slab_nrm_hq.png` : null, 0.5, new Color3(1.12, 1.1, 1.06), VILLAGE_LOOK.stoneRough, hq),
  );
}

/** 城牆砌石（騎士軍團及之後的建築）：錯縫大石塊、倒角、淺色灰縫 */
export function villageAshlar(scene: Scene, texBase: string, hq: boolean): PBRMaterial {
  return once(scene, `ashlar:${hq}`, () =>
    stonePbr(scene, "VP3_ashlar", `${texBase}ashlar_${hq ? "hq" : "lite"}.png`, hq || VILLAGE_LOOK.liteNormals ? `${texBase}ashlar_nrm_512.png` : null, 0.85, new Color3(1.1, 1.08, 1.03), VILLAGE_LOOK.stoneRough, hq),
  );
}

/** 魚鱗瓦屋頂（顏色＝頂點色深藍），略有光澤 */
export function villageSlate(scene: Scene, texBase: string, hq: boolean): PBRMaterial {
  return once(scene, `slate:${hq}`, () =>
    stonePbr(scene, "VP3_slate", `${texBase}slate_${hq ? "hq" : "lite"}.png`, hq || VILLAGE_LOOK.liteNormals ? `${texBase}slate_nrm_512.png` : null, 0.9, new Color3(1.08, 1.08, 1.12), VILLAGE_LOOK.slateRough, hq),
  );
}

/** 旗幟（HQ 貼圖、雙面） */
export function villageBanner(scene: Scene, texBase: string): StandardMaterial {
  return once(scene, "banner", () => {
    const m = new StandardMaterial("VP3_banner", scene);
    m.diffuseTexture = villageTexture(scene, `${texBase}banner2_hq.png`, true);
    m.backFaceCulling = false;
    m.twoSidedLighting = true;
    m.specularColor = new Color3(0.08, 0.08, 0.1);
    m.emissiveColor = new Color3(0.08, 0.08, 0.1);
    return m;
  });
}
