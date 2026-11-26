import { type Scene, Texture } from "@babylonjs/core";

/**
 * 星芽村正式美術共用貼圖（P3-2B 起）：同一張貼圖只載入一次，所有建築共用（省下載與顯示記憶體）。
 * 建築 GLB 不內嵌這些貼圖，由遊戲端依畫質載入。
 */
const caches = new WeakMap<Scene, Map<string, Texture>>();

export function villageTexture(scene: Scene, url: string, hq: boolean): Texture {
  let m = caches.get(scene);
  if (!m) {
    m = new Map();
    caches.set(scene, m);
  }
  const hit = m.get(url);
  if (hit) return hit;
  const t = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  t.anisotropicFilteringLevel = hq ? 4 : 1;
  m.set(url, t);
  return t;
}

/** 目前已載入的共用貼圖（統計用） */
export function villageTextures(scene: Scene): Texture[] {
  return [...(caches.get(scene)?.values() ?? [])];
}
