// 模擬 GitHub Pages 的靜態伺服器（測試用）：記錄每一個請求的路徑與狀態碼，給 tools/mp-pages-c-migration.mjs audit 檢查。
//   node tests/e2e/pages-log-server.mjs <root> <port> <log.json>
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const [rootArg, portArg, logFile] = process.argv.slice(2);
const root = resolve(rootArg);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".wasm": "application/wasm", ".ktx2": "image/ktx2", ".env": "application/octet-stream", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav" };
const log = [];
const flush = () => writeFileSync(logFile, JSON.stringify(log));
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  let status = 200;
  let bytes = 0;
  try {
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) throw Object.assign(new Error("forbidden"), { code: 403 });
    const s = await stat(file).catch(() => null);
    if (s?.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    bytes = body.length;
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (e) {
    status = e?.code === 403 ? 403 : 404;
    res.writeHead(status).end("not found");
  }
  log.push({ path, status, bytes });
});
server.listen(Number(portArg), "127.0.0.1", () => console.log(`pages-log-server ${root} :${portArg}`));
setInterval(flush, 1000).unref();
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => (flush(), process.exit(0)));
