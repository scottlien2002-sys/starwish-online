import { villageGold, villageLimestone } from "./villageMaterials.ts";
import { villageTexture } from "./villageTextures.ts";
import {
  type AbstractMesh,
  Color3,
  Constants,
  FresnelParameters,
  type Material,
  type Nullable,
  type Observer,
  type Scene,
  type ShadowGenerator,
  StandardMaterial,
  Texture,
  type TransformNode,
} from "@babylonjs/core";

/**
 * Stage 6 P3-1B 星願之泉：水面、落水、泡沫、星晶發光的輕量材質與動畫。
 * （P3-1B 只在獨立預覽頁使用；尚未接進村莊或遊戲，整合要等確認後的 P3-2。）
 *
 * 手機效能原則：
 * - 水面不透明（不需排序、不會因透明排序閃爍），用捲動貼圖做流動感；HQ 加低強度法線與邊緣菲涅耳（假天空反射）
 * - 落水、泡沫、光暈各 1 個網格、各 1 次繪製；不寫入深度，避免互相遮成破洞
 * - 星晶發光＝自發光材質＋1 張加法混合光暈看板，不開 GlowLayer（不多一次全畫面繪製）
 * - 沒有粒子、沒有即時反射、沒有額外渲染目標
 */

export interface FountainP3Options {
  lite: boolean;
  /** 水與特效貼圖所在資料夾（結尾含 /） */
  texBase: string;
  shadows?: ShadowGenerator | null;
}

export interface FountainP3Stats {
  meshes: number;
  /** 噴泉本體（GLB）三角面＋光暈 2 面 */
  triangles: number;
  byMesh: Record<string, number>;
  materials: number;
  /** 不透明網格數（石、金、晶、水） */
  opaqueMeshes: number;
  /** 半透明網格數（落水、泡沫、光暈） */
  transparentMeshes: number;
  textures: number;
  /** 所有貼圖像素總數（估算顯示記憶體用；含 mipmap 約 ×1.33，RGBA 4 bytes） */
  texturePixels: number;
  shadowCasters: number;
}

export interface FountainP3 {
  stats: FountainP3Stats;
  /** P3-2E：每幀會動的網格（星晶）——不可 freezeWorldMatrix、也不投射陰影 */
  animated: AbstractMesh[];
  /** 固定動畫時間（截圖用）；null＝恢復即時 */
  setTime(t: number | null): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

/** 星晶中心（噴泉本地座標，Y 向上） */
export const FOUNTAIN_CRYSTAL_CENTER_Y = 5.4;

// P3-2D：貼圖一律走全村共用快取（同一張只載一次）
const tex = (scene: Scene, url: string, hq: boolean): Texture => villageTexture(scene, url, hq);

const find = (meshes: AbstractMesh[], key: string): AbstractMesh | undefined =>
  meshes.find((m) => m.name.startsWith(`WishFountain_${key}`) && m.getTotalIndices() > 0);

export function setupFountainP3(scene: Scene, meshes: AbstractMesh[], parent: TransformNode | null, opt: FountainP3Options): FountainP3 {
  const hq = !opt.lite;
  const q = hq ? "hq" : "lite";
  const mats: Material[] = [];
  const textures: Texture[] = [];
  const own = <T extends Material>(m: T): T => {
    mats.push(m);
    return m;
  };
  const ownTex = (t: Texture): Texture => {
    textures.push(t);
    return t;
  };

  const stone = find(meshes, "stone");
  const gold = find(meshes, "gold");
  const crystal = find(meshes, "crystal");
  const fxMesh = find(meshes, "fx");
  // glTF 載入時節點帶有四元數旋轉，改用尤拉角才能每幀設定 rotation.y
  if (crystal) crystal.rotationQuaternion = null;
  const water = find(meshes, "water");
  const falls = find(meshes, "falls");
  const foam = find(meshes, "foam");

  // 石材（P3-2D）：與廣場石板相同的暖白石灰岩（共用材質、共用貼圖）× 烘焙環境光遮蔽頂點色
  if (stone) stone.material = villageLimestone(scene, opt.texBase, hq);

  // 金：全村共用金色材質
  const goldMat = villageGold(scene);

  // 星晶：自發光（柔和、不過曝）；HQ 邊緣再亮一點，像光在晶體裡折射
  // P3-2E 漂浮星晶：外殼半透明（頂點 Alpha 0.58）、內核不透明最亮；顏色＝頂點色 ×（漫射＋自發光）
  // 邊緣菲涅耳讓切面輪廓發亮（HQ／Lite 都有，成本只是幾行著色器）；不投射陰影，所以轉動不增加陰影成本
  const crystalBase = new Color3(0.36, 0.58, 0.86);
  const crystalMat = own(new StandardMaterial("VP3F_crystal", scene));
  crystalMat.diffuseColor = new Color3(0.75, 0.85, 1);
  crystalMat.specularColor = new Color3(1, 1, 1);
  crystalMat.specularPower = 160;
  crystalMat.emissiveColor = crystalBase.clone();
  crystalMat.emissiveFresnelParameters = fresnel(new Color3(1.55, 1.55, 1.55), new Color3(0.75, 0.75, 0.75), 0, 1.6);
  crystalMat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;

  // 水面（P3-2D）：仍是不透明（不閃爍），用「看穿清水」的方式畫：
  // 池底馬賽克（靜止）× 頂點色深淺（中央藍、池緣青綠）＋ 水底光紋（自發光、緩慢流動）＋ HQ 柔和水波法線與邊緣天空色
  const waterMat = own(new StandardMaterial("VP3F_water", scene));
  const wTex = ownTex(tex(scene, `${opt.texBase}pool_${q}.png`, hq));
  waterMat.diffuseTexture = wTex;
  waterMat.diffuseColor = new Color3(0.98, 1, 1);
  const cTex = ownTex(tex(scene, `${opt.texBase}caustic_star_${q}.png`, hq));  // P3-2E：光紋中帶細緻星光
  cTex.uScale = 0.75;
  cTex.vScale = 0.75;
  cTex.level = hq ? 0.55 : 0.45;
  waterMat.emissiveTexture = cTex;
  waterMat.emissiveColor = new Color3(0.07, 0.1, 0.12);
  waterMat.specularColor = hq ? new Color3(0.6, 0.65, 0.7) : new Color3(0.42, 0.46, 0.5);
  waterMat.specularPower = hq ? 96 : 64;
  let wBump: Texture | null = null;
  if (hq) {
    wBump = ownTex(tex(scene, `${opt.texBase}water_nrm_512.png`, true));
    wBump.level = 0.3;
    wBump.uScale = 1.6;
    wBump.vScale = 1.6;
    waterMat.bumpTexture = wBump;
    // 斜看時（水面邊緣）較亮，像反射天空；正看保持清澈
    waterMat.emissiveFresnelParameters = fresnel(new Color3(2.4, 2.4, 2.4), new Color3(1, 1, 1), 0, 2);
  }

  // 落水：半透明條紋捲動（往下流）；頂點透明度讓入水處淡出
  const fallMat = own(new StandardMaterial("VP3F_falls", scene));
  const fTex = ownTex(tex(scene, `${opt.texBase}fx_fall_${q}.png`, hq));
  fTex.hasAlpha = true;
  fallMat.diffuseTexture = fTex;
  fallMat.useAlphaFromDiffuseTexture = true;
  fallMat.diffuseColor = new Color3(0.78, 0.9, 1);
  fallMat.emissiveColor = new Color3(0.4, 0.5, 0.58);
  fallMat.specularColor = new Color3(0.4, 0.45, 0.5);
  fallMat.specularPower = 32;
  fallMat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  fallMat.disableDepthWrite = true;

  // 泡沫：入水點一圈往外擴散的漣漪（高於水面 1.5 cm＋zOffset，不會和水面互搶深度）
  const foamMat = own(new StandardMaterial("VP3F_foam", scene));
  const mTex = ownTex(tex(scene, `${opt.texBase}fx_foam_${q}.png`, hq));
  foamMat.opacityTexture = mTex;
  foamMat.diffuseColor = new Color3(0.95, 0.98, 1);
  foamMat.emissiveColor = new Color3(0.45, 0.5, 0.55);
  foamMat.specularColor = Color3.Black();
  foamMat.zOffset = -2;
  foamMat.disableDepthWrite = true;
  foamMat.alpha = 0.6;

  // P3-2E 魔法特效（取代原本的光暈看板）：上層水面發光魔法陣＋落水點小星光，同一網格、加法混合、1 次繪製
  const fxMat = own(new StandardMaterial("VP3F_magic", scene));
  const mgTex = ownTex(tex(scene, `${opt.texBase}fx_magic_${q}.png`, hq));
  fxMat.opacityTexture = mgTex;
  fxMat.disableLighting = true;
  fxMat.diffuseColor = Color3.Black();
  fxMat.specularColor = Color3.Black();
  const fxBase = new Color3(0.5, 0.74, 1.0);
  fxMat.emissiveColor = fxBase.clone();
  fxMat.alphaMode = Constants.ALPHA_ADD;
  fxMat.disableDepthWrite = true;
  fxMat.backFaceCulling = false;
  fxMat.zOffset = -2;

  const assign = (m: AbstractMesh | undefined, mat: Material, vertexAlpha: boolean, alphaIndex?: number): void => {
    if (!m) return;
    m.material = mat;
    m.hasVertexAlpha = vertexAlpha;
    m.isPickable = false;
    if (alphaIndex !== undefined) m.alphaIndex = alphaIndex;
  };
  if (stone) stone.hasVertexAlpha = false;
  assign(gold, goldMat, false);
  assign(crystal, crystalMat, true, 3);
  assign(fxMesh, fxMat, false, 4);
  assign(water, waterMat, false);
  assign(foam, foamMat, true, 1);
  assign(falls, fallMat, true, 2);

  // 陰影：石、金、晶投射；石與水接收（落水、泡沫、光暈不投射，省一次陰影繪製）
  let casters = 0;
  for (const m of [stone, gold]) {
    if (!m) continue;
    m.receiveShadows = true;
    if (opt.shadows) {
      opt.shadows.addShadowCaster(m, false);
      casters++;
    }
  }
  if (water) water.receiveShadows = true;

  // 動畫：只改貼圖位移與兩個顏色（每幀幾個 uniform，CPU 幾乎沒有負擔）
  let t = 0;
  let fixed: number | null = null;
  const obs: Nullable<Observer<Scene>> = scene.onBeforeRenderObservable.add(() => {
    if (fixed === null) t += Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1);
    const tt = fixed ?? t;
    cTex.uOffset = tt * 0.018 + Math.sin(tt * 0.5) * 0.02;
    cTex.vOffset = tt * 0.012 + Math.cos(tt * 0.43) * 0.02;
    if (wBump) {
      wBump.uOffset = -tt * 0.01;
      wBump.vOffset = tt * 0.016;
    }
    fTex.vOffset = -tt * 1.1;
    mTex.vOffset = -tt * 0.35;
    const pulse = 0.92 + 0.08 * Math.sin(tt * 1.6);
    crystalMat.emissiveColor.copyFromFloats(crystalBase.r * pulse, crystalBase.g * pulse, crystalBase.b * pulse);
    // 星晶：繞柱軸慢轉（約 18 秒一圈）＋上下浮動 ±6 cm（只更新這一個網格的世界矩陣）
    if (crystal) {
      crystal.rotation.y = tt * 0.35;
      crystal.position.y = 0.06 * Math.sin(tt * 1.1);
    }
    const fp = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(tt * 2.4));
    fxMat.emissiveColor.copyFromFloats(fxBase.r * fp, fxBase.g * fp, fxBase.b * fp);
  });

  const byMesh: Record<string, number> = {};
  let tris = 0;
  for (const [k, m] of Object.entries({ stone, gold, crystal, water, falls, foam, fx: fxMesh })) {
    if (!m) continue;
    byMesh[k] = Math.round(m.getTotalIndices() / 3);
    tris += byMesh[k] ?? 0;
  }

  const all = [stone, gold, crystal, water, falls, foam, fxMesh].filter((m): m is AbstractMesh => !!m);
  // 貼圖尺寸要等載入完成才知道，所以每次讀取時再算
  const computeStats = (): FountainP3Stats => {
    const stoneTex = stone?.material?.getActiveTextures() ?? [];
    const allTex = [...stoneTex, ...textures];
    const texturePixels = allTex.reduce((s, x) => {
      const z = x.getSize();
      return s + z.width * z.height;
    }, 0);
    return {
      meshes: all.length,
      triangles: tris,
      byMesh,
      materials: mats.length + (stone?.material ? 1 : 0),
      opaqueMeshes: [stone, gold, water].filter(Boolean).length,
      transparentMeshes: [falls, foam, crystal, fxMesh].filter(Boolean).length,
      textures: allTex.length,
      texturePixels,
      shadowCasters: casters,
    };
  };

  return {
    get stats() {
      return computeStats();
    },
    animated: crystal ? [crystal] : [],
    setTime(v) {
      fixed = v;
    },
    setEnabled(on) {
      for (const m of all) m.setEnabled(on);

    },
    dispose() {
      scene.onBeforeRenderObservable.remove(obs);

      for (const m of mats) m.dispose(false, false);
    },
  };
}

function fresnel(left: Color3, right: Color3, bias: number, power: number): FresnelParameters {
  const f = new FresnelParameters();
  f.leftColor = left;
  f.rightColor = right;
  f.bias = bias;
  f.power = power;
  return f;
}
