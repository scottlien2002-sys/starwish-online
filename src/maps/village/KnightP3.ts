import { type AbstractMesh, Color3, FresnelParameters, type Material, PBRMaterial, type Scene, type ShadowGenerator, StandardMaterial } from "@babylonjs/core";
import { villageTexture } from "./villageTextures.ts";

/**
 * Stage 6 P3-2B 騎士軍團：材質設定（只在獨立預覽頁使用；尚未接進村莊，整合等確認後）。
 *
 * 網格（GLB，依材質合併，每個 1 次繪製）：
 * - stone：暖白石牆（共用石紋貼圖 × 頂點色＋烘焙環境光遮蔽；HQ 加 512 法線）
 * - roof：深藍屋瓦（共用屋瓦貼圖 × 頂點色；HQ 加 512 法線，略有光澤）
 * - gold：騎士團徽、金尖頂、門飾（HQ；Lite 畫在頂點色裡）
 * - props：大門、窗玻璃、旗幟、雕像（頂點色）
 * 不使用全畫面後製、不開 GlowLayer、無即時反射；石牆與屋頂貼圖全村共用（見 villageTextures.ts）。
 */

export interface KnightP3Options {
  lite: boolean;
  /** 共用貼圖資料夾（結尾含 /） */
  texBase: string;
  shadows?: ShadowGenerator | null;
}

export interface KnightP3 {
  readonly stats: { meshes: number; triangles: number; byMesh: Record<string, number>; materials: number; shadowCasters: number; textureUrls: string[] };
  setEnabled(on: boolean): void;
  dispose(): void;
}

const KEYS = ["stone", "roof", "gold", "props"] as const;

export function setupKnightP3(scene: Scene, meshes: AbstractMesh[], opt: KnightP3Options): KnightP3 {
  const hq = !opt.lite;
  const by: Partial<Record<(typeof KEYS)[number], AbstractMesh>> = {};
  for (const k of KEYS) {
    const m = meshes.find((x) => x.name.startsWith(`Knight_${k}`) && x.getTotalIndices() > 0);
    if (m) by[k] = m;
  }
  const mats: Material[] = [];
  const urls: string[] = [];
  const tex = (file: string) => {
    const u = `${opt.texBase}${file}`;
    urls.push(u);
    return villageTexture(scene, u, hq);
  };

  const stone = new PBRMaterial("VP3K_stone", scene);
  stone.albedoTexture = tex(hq ? "stone_hq.png" : "stone_lite.png");
  // 暖白石牆：石紋貼圖偏灰，提亮並略帶暖色（只影響建築，星願之泉材質不變）
  stone.albedoColor = new Color3(1.26, 1.22, 1.14);
  stone.metallic = 0;
  stone.roughness = 0.85;
  if (hq) {
    const nrm = tex("stone_nrm_512.png");
    nrm.level = 0.6;
    stone.bumpTexture = nrm;
  }
  mats.push(stone);

  const roof = new PBRMaterial("VP3K_roof", scene);
  roof.albedoTexture = tex(hq ? "roof_512.png" : "roof_256.png");
  roof.albedoColor = new Color3(1.05, 1.05, 1.08);
  roof.metallic = 0;
  roof.roughness = 0.5;
  if (hq) {
    const nrm = tex("roof_nrm_512.png");
    nrm.level = 0.7;
    roof.bumpTexture = nrm;
  }
  mats.push(roof);

  const gold = new StandardMaterial("VP3K_gold", scene);
  gold.diffuseColor = new Color3(0.78, 0.6, 0.28);
  gold.specularColor = new Color3(1, 0.86, 0.55);
  gold.specularPower = 48;
  gold.emissiveColor = new Color3(0.26, 0.2, 0.08);
  const gf = new FresnelParameters();
  gf.leftColor = new Color3(0.9, 0.9, 0.9);
  gf.rightColor = new Color3(0.14, 0.14, 0.14);
  gf.bias = 0.1;
  gf.power = 1.5;
  gold.emissiveFresnelParameters = gf;
  mats.push(gold);

  const props = new StandardMaterial("VP3K_props", scene);
  props.diffuseColor = new Color3(1, 1, 1);
  props.specularColor = new Color3(0.14, 0.14, 0.16);
  props.specularPower = 32;
  props.emissiveColor = new Color3(0.05, 0.05, 0.06);
  mats.push(props);

  const assign: Record<string, Material> = { stone, roof, gold, props };
  let casters = 0;
  for (const [k, m] of Object.entries(by) as [string, AbstractMesh][]) {
    const mat = assign[k];
    if (mat) m.material = mat;
    m.hasVertexAlpha = false;
    m.isPickable = false;
    m.receiveShadows = true;
    if (opt.shadows) {
      opt.shadows.addShadowCaster(m, false);
      casters++;
    }
  }
  const all = Object.values(by).filter((m): m is AbstractMesh => !!m);
  const byMesh: Record<string, number> = {};
  for (const [k, m] of Object.entries(by) as [string, AbstractMesh][]) byMesh[k] = Math.round(m.getTotalIndices() / 3);
  return {
    stats: {
      meshes: all.length,
      triangles: Object.values(byMesh).reduce((a, b) => a + b, 0),
      byMesh,
      materials: mats.length,
      shadowCasters: casters,
      textureUrls: urls,
    },
    setEnabled(on) {
      for (const m of all) m.setEnabled(on);
    },
    dispose() {
      for (const m of mats) m.dispose(false, false);
    },
  };
}
