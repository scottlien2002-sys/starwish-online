import {
  type AbstractMesh,
  type BaseTexture,
  Color3,
  FresnelParameters,
  type Material,
  PBRMaterial,
  type Scene,
  type ShadowGenerator,
  StandardMaterial,
} from "@babylonjs/core";

/**
 * Stage 6 P3-2A 星芽村中央廣場：材質設定（只在獨立預覽頁使用；尚未接進村莊，整合等 P3-3）。
 *
 * 網格（GLB，依材質合併，每個 1 次繪製）：
 * - paving：石板、羅盤、道路（PBR：暖白石紋 × 頂點色；HQ 有法線貼圖）
 * - gold：嵌條、羅盤金星、燈具金件（HQ；Lite 的金色畫在頂點色裡）
 * - props：長椅、燈柱、水晶燈座、花圃、吊籃、鴿子（頂點色＋烘焙環境光遮蔽，無貼圖）
 * - glass：燈籠玻璃與水晶（不受光，像自己在發光；不開 GlowLayer）
 * - banner：旗幟（HQ 貼圖、雙面）；Lite 的旗幟在 props 裡
 * - contact：Lite 接地陰影（Lite 沒有即時陰影）
 */

export interface PlazaP3Options {
  lite: boolean;
  shadows?: ShadowGenerator | null;
}

export interface PlazaP3Stats {
  meshes: number;
  triangles: number;
  byMesh: Record<string, number>;
  materials: number;
  transparentMeshes: number;
  textures: number;
  texturePixels: number;
  shadowCasters: number;
}

export interface PlazaP3 {
  readonly stats: PlazaP3Stats;
  setEnabled(on: boolean): void;
  dispose(): void;
}

const KEYS = ["paving", "gold", "props", "glass", "banner", "contact"] as const;

export function setupPlazaP3(scene: Scene, meshes: AbstractMesh[], opt: PlazaP3Options): PlazaP3 {
  const by: Partial<Record<(typeof KEYS)[number], AbstractMesh>> = {};
  for (const k of KEYS) {
    const m = meshes.find((x) => x.name.startsWith(`Plaza_${k}`) && x.getTotalIndices() > 0);
    if (m) by[k] = m;
  }
  const mats: Material[] = [];

  // 石板：沿用 GLB 的 PBR；暖白、霧面
  const pave = by.paving;
  if (pave?.material instanceof PBRMaterial) {
    pave.material.metallic = 0;
    pave.material.roughness = 0.88;
    pave.material.albedoColor = new Color3(1.12, 1.1, 1.07);
  }

  // 金：與星願之泉同色系，但自發光較弱（地面嵌條斜看時不會變成螢光黃）
  const gold = new StandardMaterial("VP3P_gold", scene);
  gold.diffuseColor = new Color3(0.74, 0.57, 0.28);
  gold.specularColor = new Color3(0.9, 0.78, 0.5);
  gold.specularPower = 40;
  gold.emissiveColor = new Color3(0.2, 0.15, 0.06);
  const gf = new FresnelParameters();
  gf.leftColor = new Color3(0.7, 0.7, 0.7);
  gf.rightColor = new Color3(0.12, 0.12, 0.12);
  gf.bias = 0.1;
  gf.power = 1.5;
  gold.emissiveFresnelParameters = gf;
  mats.push(gold);

  // 物件：頂點色（含烘焙環境光遮蔽），低高光
  const props = new StandardMaterial("VP3P_props", scene);
  props.diffuseColor = new Color3(1, 1, 1);
  props.specularColor = new Color3(0.1, 0.1, 0.1);
  props.specularPower = 24;
  props.emissiveColor = new Color3(0.05, 0.045, 0.04);
  mats.push(props);

  // 燈罩與水晶：不受光（自發光白 × 頂點色＝頂點色），白天看起來像亮著
  // 注意：StandardMaterial 的 disableLighting 會讓頂點色失效（變黑），所以用「漫射黑＋自發光白」
  const glass = new StandardMaterial("VP3P_glass", scene);
  glass.diffuseColor = Color3.Black();
  glass.emissiveColor = new Color3(1, 1, 1);
  glass.specularColor = Color3.Black();
  mats.push(glass);

  // 旗幟（HQ）：沿用 GLB 內的旗幟貼圖，雙面
  let bannerTex: BaseTexture | null = null;
  if (by.banner) {
    const src = by.banner.material;
    bannerTex = src instanceof PBRMaterial ? src.albedoTexture : null;
    const banner = new StandardMaterial("VP3P_banner", scene);
    if (bannerTex) banner.diffuseTexture = bannerTex;
    banner.backFaceCulling = false;
    banner.twoSidedLighting = true;
    banner.specularColor = new Color3(0.08, 0.08, 0.1);
    banner.emissiveColor = new Color3(0.08, 0.08, 0.1);
    mats.push(banner);
    by.banner.material = banner;
  }

  // Lite 接地陰影：黑色、頂點透明度，不寫深度，往鏡頭偏移一點避免和地面搶深度
  if (by.contact) {
    const c = new StandardMaterial("VP3P_contact", scene);
    c.disableLighting = true;
    c.diffuseColor = Color3.Black();
    c.emissiveColor = Color3.Black();
    c.specularColor = Color3.Black();
    c.disableDepthWrite = true;
    c.zOffset = -1;
    mats.push(c);
    by.contact.material = c;
    by.contact.hasVertexAlpha = true;
    by.contact.alphaIndex = 0;
  }

  for (const [k, m] of Object.entries(by) as [string, AbstractMesh][]) {
    m.isPickable = false;
    if (k !== "contact") m.hasVertexAlpha = false;
    if (k === "gold") m.material = gold;
    if (k === "props") m.material = props;
    if (k === "glass") m.material = glass;
  }

  // 陰影：石板、物件接收；物件與金件投射（石板不投射，省陰影繪製）
  let casters = 0;
  if (pave) pave.receiveShadows = true;
  if (by.props) by.props.receiveShadows = true;
  for (const m of [by.props, by.gold, by.banner]) {
    if (m && opt.shadows) {
      opt.shadows.addShadowCaster(m, false);
      casters++;
    }
  }

  const all = Object.values(by).filter((m): m is AbstractMesh => !!m);
  const byMesh: Record<string, number> = {};
  for (const [k, m] of Object.entries(by) as [string, AbstractMesh][]) byMesh[k] = Math.round(m.getTotalIndices() / 3);

  return {
    get stats(): PlazaP3Stats {
      const tex = [...(pave?.material?.getActiveTextures() ?? []), ...(bannerTex ? [bannerTex] : [])];
      return {
        meshes: all.length,
        triangles: Object.values(byMesh).reduce((a, b) => a + b, 0),
        byMesh,
        materials: mats.length + (pave?.material ? 1 : 0),
        transparentMeshes: by.contact ? 1 : 0,
        textures: tex.length,
        texturePixels: tex.reduce((s, t) => {
          const z = t.getSize();
          return s + z.width * z.height;
        }, 0),
        shadowCasters: casters,
      };
    },
    setEnabled(on) {
      for (const m of all) m.setEnabled(on);
    },
    dispose() {
      for (const m of mats) m.dispose(false, false);
    },
  };
}
