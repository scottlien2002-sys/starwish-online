import { type BaseTexture, Color3, type PBRMaterial, type Scene, StandardMaterial, Texture } from "@babylonjs/core";
import { createGlassMatcapV38R, createJellyNoiseTextureV38R, JellyV38RPlugin } from "./JellyV38RPlugin.ts";

/**
 * 星露啵啵 V3.8R 材質（正式遊戲整合用）。
 * 內容與測試頁（src/lab/BoboV3Lab.ts 的 createMaterialsV31(..., "v38r")）的 V3.8R 分支逐項相同；
 * 測試頁維持原樣不改（避免影響已驗收的預覽頁），此處只複製 V3.8R 用到的部分。
 *
 * - 共用（每個場景一份）：眼睛、嘴、腮紅、頭頂星星、雜訊貼圖、玻璃 matcap
 * - 每隻一份：身體材質＋果凍外掛（腹部星星、動畫參數、矩陣各自獨立）
 * GLB 內原本的 PBR 材質只用來取貼圖，不會被修改。
 */
export interface BoboV38RSharedMaterials {
  eyes: StandardMaterial;
  mouth: StandardMaterial;
  blush: StandardMaterial;
  stars: StandardMaterial;
  noise: BaseTexture;
  matcap: BaseTexture;
  /** 建立一隻的身體材質（呼叫端負責 dispose，貼圖為共用、不可一併釋放） */
  body(name: string): { material: StandardMaterial; jelly: JellyV38RPlugin };
  dispose(): void;
}

export function createBoboV38RMaterials(scene: Scene, gltfMats: readonly PBRMaterial[], fullJelly: boolean): BoboV38RSharedMaterials {
  const tex = (name: string): BaseTexture | null => gltfMats.find((m) => m.name === name)?.albedoTexture ?? null;
  const eyeTex = tex("Bobo_Eyes");
  const faceTex = tex("Bobo_Face");
  if (eyeTex instanceof Texture) eyeTex.anisotropicFilteringLevel = 4;

  const eyes = new StandardMaterial("BoboV38RGame_Eyes", scene);
  eyes.diffuseTexture = eyeTex;
  if (eyes.diffuseTexture) eyes.diffuseTexture.hasAlpha = true;
  eyes.useAlphaFromDiffuseTexture = true;
  eyes.transparencyMode = 2; // ALPHABLEND
  eyes.emissiveColor = new Color3(0.8, 0.8, 0.84);
  eyes.diffuseColor = new Color3(0.3, 0.3, 0.33);
  eyes.specularColor = new Color3(1, 1, 1);
  eyes.specularPower = 160;
  eyes.zOffset = -1;

  const decal = (name: string): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.diffuseTexture = faceTex;
    if (m.diffuseTexture) m.diffuseTexture.hasAlpha = true;
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.emissiveColor = new Color3(0.95, 0.95, 0.95);
    m.backFaceCulling = true;
    m.zOffset = -2;
    return m;
  };
  const mouth = decal("BoboV38RGame_Mouth");
  const blush = decal("BoboV38RGame_Blush");

  const stars = new StandardMaterial("BoboV38RGame_Stars", scene);
  stars.disableLighting = false;
  stars.emissiveColor = new Color3(0.98, 1.02, 0.82);
  stars.diffuseColor = new Color3(0.14, 0.14, 0.12);
  stars.specularColor = new Color3(0.75, 0.75, 0.68);
  stars.specularPower = 28;
  stars.backFaceCulling = false;

  const matcap = createGlassMatcapV38R(scene);
  const noise = createJellyNoiseTextureV38R(scene);

  return {
    eyes,
    mouth,
    blush,
    stars,
    noise,
    matcap,
    body(name) {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = new Color3(0.45, 0.64, 1.0);
      m.emissiveColor = new Color3(0.08, 0.16, 0.42);
      m.specularColor = new Color3(0.04, 0.04, 0.05);
      m.specularPower = 64;
      m.alpha = 0.64;
      m.useSpecularOverAlpha = false;
      m.backFaceCulling = true;
      const jelly = new JellyV38RPlugin(m, noise, matcap);
      jelly.height = 1;
      jelly.nebula = fullJelly ? 1 : 0;
      m.onError = () => {
        if (jelly.jellyEnabled) {
          console.warn("[bobo38r] jelly shader failed, fallback");
          jelly.jellyEnabled = false;
        }
      };
      return { material: m, jelly };
    },
    dispose() {
      for (const m of [eyes, mouth, blush, stars]) m.dispose(false, false);
      matcap.dispose();
      noise.dispose();
    },
  };
}
