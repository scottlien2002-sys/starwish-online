// 零依賴靜態檔案伺服器（測試用）
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
};

export function serve(rootDir, port = 0) {
  const root = resolve(rootDir);
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      let file = normalize(join(root, urlPath));
      if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      const s = await stat(file).catch(() => null);
      if (s?.isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => {
    server.listen(port, "127.0.0.1", () => {
      const { port: p } = server.address();
      ok({ url: `http://127.0.0.1:${p}`, close: () => new Promise((d) => server.close(d)) });
    });
  });
}

export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const fallback = process.env.PLAYWRIGHT_MODULE;
    if (!fallback) throw new Error("找不到 playwright。請先 npm install，或設定 PLAYWRIGHT_MODULE。");
    return await import(fallback);
  }
}

/** iPhone 測試尺寸（CSS 像素）與模擬安全區 */
export const IPHONE_VIEWPORTS = [
  { name: "iPhone SE 橫向", width: 667, height: 375, safe: { top: 0, right: 0, bottom: 0, left: 0 } },
  { name: "iPhone 15 橫向", width: 852, height: 393, safe: { top: 0, right: 59, bottom: 21, left: 59 } },
  { name: "iPhone 15 Pro Max 橫向", width: 932, height: 430, safe: { top: 0, right: 59, bottom: 21, left: 59 } },
  { name: "iPhone 15 直向", width: 393, height: 852, safe: { top: 59, right: 0, bottom: 34, left: 0 } },
  { name: "iPhone SE 直向", width: 375, height: 667, safe: { top: 20, right: 0, bottom: 0, left: 0 } },
];

/** 在不支援 env(safe-area-inset) 的測試瀏覽器中，注入模擬安全區 */
export function safeAreaCss(safe) {
  return `:root{--safe-top:${safe.top}px;--safe-right:${safe.right}px;--safe-bottom:${safe.bottom}px;--safe-left:${safe.left}px;}`;
}
