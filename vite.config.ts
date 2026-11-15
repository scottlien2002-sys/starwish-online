import { defineConfig } from "vite";

// base: "./" 讓建置結果可放在任何子路徑（例如 GitHub Pages 的 /starwish-online/）
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 6000,
  },
  server: {
    host: true,
  },
});
