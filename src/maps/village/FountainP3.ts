import {
  type AbstractMesh,
  Color3,
  Constants,
  FresnelParameters,
  type Material,
  type Mesh,
  MeshBuilder,
  type Nullable,
  type Observer,
  PBRMaterial,
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
  halo: Mesh;
  /** 固定動畫時間（截圖用）；null＝恢復即時 */
  setTime(t: number | null): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

/** 星晶中心（噴泉本地座標，Y 向上） */
export const FOUNTAIN_CRYSTAL_CENTER_Y = 5.4;

const tex = (scene: Scene, url: string, hq: boolean): Texture => {
  const t = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  t.anisotropicFilteringLevel = hq ? 4 : 1;
  return t;
};

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
  const water = find(meshes, "water");
  const falls = find(meshes, "falls");
  const foam = find(meshes, "foam");

  // 石材：沿用 GLB 的 PBR（石紋 × 烘焙環境光遮蔽頂點色；HQ 有法線貼圖）。場景沒有環境貼圖，金屬度歸零。
  if (stone?.material instanceof PBRMaterial) {
    stone.material.metallic = 0;
    stone.material.roughness = Math.max(stone.material.roughness ?? 0.8, 0.75);
    // 白石：略提亮（貼圖 × 環境光遮蔽後偏灰）
    stone.material.albedoColor = new Color3(1.12, 1.1, 1.06);
  }

  // 金：StandardMaterial（不靠環境貼圖也有金屬感）＝暖色高光＋邊緣菲涅耳自發光（假反射）
  const goldMat = own(new StandardMaterial("VP3F_gold", scene));
  goldMat.diffuseColor = new Color3(0.8, 0.6, 0.28);
  goldMat.specularColor = new Color3(1, 0.86, 0.55);
  goldMat.specularPower = 48;
  goldMat.emissiveColor = new Color3(0.32, 0.25, 0.1);
  goldMat.emissiveFresnelParameters = fresnel(new Color3(1, 1, 1), new Color3(0.14, 0.14, 0.14), 0.1, 1.5);

  // 星晶：自發光（柔和、不過曝）；HQ 邊緣再亮一點，像光在晶體裡折射
  const crystalBase = new Color3(0.3, 0.58, 0.92);
  const crystalMat = own(new StandardMaterial("VP3F_crystal", scene));
  crystalMat.diffuseColor = new Color3(0.5, 0.76, 1);
  crystalMat.specularColor = new Color3(1, 1, 1);
  crystalMat.specularPower = 128;
  crystalMat.emissiveColor = crystalBase.clone();
  if (hq) crystalMat.emissiveFresnelParameters = fresnel(new Color3(1.15, 1.15, 1.15), new Color3(0.72, 0.72, 0.72), 0, 1.2);

  // 水面：不透明。HQ＝1024 貼圖＋低強度法線（兩個方向捲動）＋邊緣天空色；Lite＝512 貼圖捲動＋高光
  const waterMat = own(new StandardMaterial("VP3F_water", scene));
  const wTex = ownTex(tex(scene, `${opt.texBase}water_${q}.png`, hq));
  waterMat.diffuseTexture = wTex;
  waterMat.diffuseColor = new Color3(0.92, 0.97, 1);
  waterMat.specularColor = hq ? new Color3(0.55, 0.6, 0.65) : new Color3(0.42, 0.46, 0.5);
  waterMat.specularPower = hq ? 90 : 64;
  let wBump: Texture | null = null;
  if (hq) {
    wBump = ownTex(tex(scene, `${opt.texBase}water_nrm_hq.png`, true));
    wBump.level = 0.35;
    wBump.uScale = 1.6;
    wBump.vScale = 1.6;
    waterMat.bumpTexture = wBump;
    waterMat.emissiveColor = new Color3(1, 1, 1);
    waterMat.emissiveFresnelParameters = fresnel(new Color3(0.3, 0.4, 0.48), new Color3(0.06, 0.09, 0.12), 0, 2);
  } else {
    waterMat.emissiveColor = new Color3(0.08, 0.11, 0.14);
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

  // 星晶光暈：1 張看板，加法混合，柔和
  const haloMat = own(new StandardMaterial("VP3F_halo", scene));
  const hTex = ownTex(tex(scene, `${opt.texBase}fx_halo_${q}.png`, hq));
  haloMat.opacityTexture = hTex;
  haloMat.disableLighting = true;
  haloMat.diffuseColor = Color3.Black();
  haloMat.specularColor = Color3.Black();
  const haloBase = new Color3(0.36, 0.6, 0.9);
  haloMat.emissiveColor = haloBase.clone();
  haloMat.alphaMode = Constants.ALPHA_ADD;
  haloMat.disableDepthWrite = true;
  haloMat.backFaceCulling = false;
  const halo = MeshBuilder.CreatePlane("WishFountain_halo", { size: hq ? 2.9 : 2.5 }, scene);
  halo.material = haloMat;
  halo.billboardMode = 7; // BILLBOARDMODE_ALL
  halo.position.set(0, FOUNTAIN_CRYSTAL_CENTER_Y, 0);
  if (parent) halo.parent = parent;
  halo.isPickable = false;
  halo.alphaIndex = 3;

  const assign = (m: AbstractMesh | undefined, mat: Material, vertexAlpha: boolean, alphaIndex?: number): void => {
    if (!m) return;
    m.material = mat;
    m.hasVertexAlpha = vertexAlpha;
    m.isPickable = false;
    if (alphaIndex !== undefined) m.alphaIndex = alphaIndex;
  };
  if (stone) stone.hasVertexAlpha = false;
  assign(gold, goldMat, false);
  assign(crystal, crystalMat, false);
  assign(water, waterMat, false);
  assign(foam, foamMat, true, 1);
  assign(falls, fallMat, true, 2);

  // 陰影：石、金、晶投射；石與水接收（落水、泡沫、光暈不投射，省一次陰影繪製）
  let casters = 0;
  for (const m of [stone, gold, crystal]) {
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
    wTex.uOffset = tt * 0.012;
    wTex.vOffset = tt * 0.008;
    if (wBump) {
      wBump.uOffset = -tt * 0.01;
      wBump.vOffset = tt * 0.016;
    }
    fTex.vOffset = -tt * 1.1;
    mTex.vOffset = -tt * 0.35;
    const pulse = 0.93 + 0.07 * Math.sin(tt * 1.6);
    crystalMat.emissiveColor.copyFromFloats(crystalBase.r * pulse, crystalBase.g * pulse, crystalBase.b * pulse);
    const hp = 0.85 + 0.15 * Math.sin(tt * 1.6 + 0.4);
    haloMat.emissiveColor.copyFromFloats(haloBase.r * hp, haloBase.g * hp, haloBase.b * hp);
  });

  const byMesh: Record<string, number> = {};
  let tris = 0;
  for (const [k, m] of Object.entries({ stone, gold, crystal, water, falls, foam })) {
    if (!m) continue;
    byMesh[k] = Math.round(m.getTotalIndices() / 3);
    tris += byMesh[k] ?? 0;
  }
  byMesh.halo = 2;
  tris += 2;
  const all = [stone, gold, crystal, water, falls, foam].filter((m): m is AbstractMesh => !!m);
  // 貼圖尺寸要等載入完成才知道，所以每次讀取時再算
  const computeStats = (): FountainP3Stats => {
    const stoneTex = stone?.material?.getActiveTextures() ?? [];
    const allTex = [...stoneTex, ...textures];
    const texturePixels = allTex.reduce((s, x) => {
      const z = x.getSize();
      return s + z.width * z.height;
    }, 0);
    return {
      meshes: all.length + 1,
      triangles: tris,
      byMesh,
      materials: mats.length + (stone?.material ? 1 : 0),
      opaqueMeshes: [stone, gold, crystal, water].filter(Boolean).length,
      transparentMeshes: [falls, foam].filter(Boolean).length + 1,
      textures: allTex.length,
      texturePixels,
      shadowCasters: casters,
    };
  };

  return {
    get stats() {
      return computeStats();
    },
    halo,
    setTime(v) {
      fixed = v;
    },
    setEnabled(on) {
      for (const m of all) m.setEnabled(on);
      halo.setEnabled(on);
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(obs);
      halo.dispose();
      for (const m of mats) m.dispose(true, true);
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
