/**
 * GitHub Pages 共用資產（/shared-assets/，Claude A 規格 claude/Starwish_Shared_Assets_Spec.md）。
 * 部署時 tools/shared-assets.mjs 把大型模型／貼圖搬進共用區（檔名＝內容 SHA-1），並寫 asset-remap.json；
 * 這裡在遊戲開機前讓 Babylon 改從共用區讀取。本機與一般建置是空清單 → 不影響任何東西。
 * （與 A 的 src/core/assetRemap.ts 相同，程式各自一份，不改 A 的分支。）
 */
export async function installAssetRemap(): Promise<number> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}asset-remap.json`, { cache: "no-cache" });
    if (!r.ok) return 0;
    const map = (await r.json()) as { files?: Record<string, string> };
    const files = map.files ?? {};
    const n = Object.keys(files).length;
    if (!n) return 0;
    const { FileTools } = await import("@babylonjs/core");
    const base = new URL(`${import.meta.env.BASE_URL}`, location.href).href;
    const prev = FileTools.PreprocessUrl;
    FileTools.PreprocessUrl = (url: string) => {
      const abs = new URL(url, location.href).href;
      if (abs.startsWith(base)) {
        const rel = decodeURIComponent(abs.slice(base.length).split("?")[0]!);
        const to = files[rel];
        if (to) return new URL(to, base).href;
      }
      return prev(url);
    };
    (window as Window & { __starwishAssetRemap?: number }).__starwishAssetRemap = n;
    return n;
  } catch {
    return 0;
  }
}
