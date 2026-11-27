/**
 * 啟動：node multiplayer/server/main.ts
 * 環境變數：PORT（預設 2567）、HOST（預設 127.0.0.1；Render 上自動 0.0.0.0；手機區網測試用 0.0.0.0）、
 *           DATABASE_URL（設定後使用 PostgreSQL；沒有 → 記憶體，重開即清空）、MP_REALM（test／prod，預設 test）、MP_PG_SSL（disable／prefer／require）
 *           MP_TLS_CERT / MP_TLS_KEY（自備憑證時改用 HTTPS/WSS；Render 由平台提供 HTTPS/WSS，不需要）、MP_DEV=1（允許測試直接出生在原野）、
 *           MP_GRACE_MS、MP_ROOM_CAPACITY、MP_MAX_PLAYERS、MP_ALLOWED_ORIGINS
 */
import { GameServer, optionsFromEnv } from "./GameServer.ts";
import { MemoryStore, type CharacterStore } from "./persistence/Store.ts";

const realm = process.env.MP_REALM === "prod" ? "prod" : "test";
if (realm === "prod" && process.env.MP_ALLOW_PROD !== "1") {
  console.error("MP_REALM=prod 需要另外設定 MP_ALLOW_PROD=1（正式資料區尚未開放）");
  process.exit(1);
}
let store: CharacterStore;
if (process.env.DATABASE_URL) {
  const { PgStore } = await import("./persistence/PgStore.ts");
  store = await PgStore.open({ url: process.env.DATABASE_URL, realm, ssl: (process.env.MP_PG_SSL as "disable" | "prefer" | "require" | undefined) ?? "prefer" });
  console.log(`[db] PostgreSQL connected, realm=${realm}`);
} else {
  store = new MemoryStore(realm);
  console.log(`[db] DATABASE_URL not set → in-memory store (data is lost on restart), realm=${realm}`);
}
const server = new GameServer(optionsFromEnv(process.env, store));
await server.start();
const shutdown = async (): Promise<void> => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
