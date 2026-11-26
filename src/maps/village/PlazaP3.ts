import { villageBanner, villageGlass, villageGold, villageLimestone, villageProps } from "./villageMaterials.ts";
import {
  type AbstractMesh,
  type BaseTexture,
  Color3,
  type Material,
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
  /** 共用貼圖資料夾（結尾含 /） */
  texBase: string;
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

  // P3-2D：全村共用材質（石灰岩、金、物件、燈罩、旗幟），與噴泉、騎士軍團一致
  const pave = by.paving;
  if (pave) pave.material = villageLimestone(scene, opt.texBase, !opt.lite);
  const gold = villageGold(scene);
  const props = villageProps(scene);
  const glass = villageGlass(scene);
  let bannerTex: BaseTexture | null = null;
  if (by.banner) {
    const banner = villageBanner(scene, opt.texBase);
    bannerTex = banner.diffuseTexture;
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
