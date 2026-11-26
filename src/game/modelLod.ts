/**
 * 角色／村莊模型 LOD（HQ／Lite）。與「畫質」（渲染品質 高／中／低，?quality=）是兩件事：
 * - 模型 LOD：用哪一組模型（面數、貼圖大小）→ ?lod=lite｜hq
 * - 畫質：陰影、後製、抗鋸齒、解析度上限 → ?quality=high｜medium｜low（PerfOverlay 的「畫質」按鈕）
 * 網址參數優先；沒有時沿用上次的選擇（星芽村與星芽原野共用），預設 HQ。
 */
export type ModelLod = "hq" | "lite";
const KEY = "starwish.world.lod";

export function pickModelLod(params: URLSearchParams): ModelLod {
  const q = params.get("lod");
  let stored: string | null = null;
  try {
    if (q === "lite" || q === "hq") window.localStorage.setItem(KEY, q);
    stored = window.localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  if (q === "lite" || q === "hq") return q;
  return stored === "lite" ? "lite" : "hq";
}

export const MODEL_LOD_LABEL: Record<ModelLod, string> = { hq: "HQ", lite: "Lite" };
