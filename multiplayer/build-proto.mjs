// 打包本機雙人測試頁：node multiplayer/build-proto.mjs（使用 esbuild）
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
await build({ entryPoints: [join(here, "proto/main.ts")], bundle: true, format: "esm", target: "safari15", outfile: join(here, "proto/dist/proto.js"), sourcemap: false, minify: false, logLevel: "info" });
