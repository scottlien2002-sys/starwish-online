/**
 * 啟動：node multiplayer/server/main.ts
 * 環境變數：PORT（預設 2567）、HOST（預設 127.0.0.1；手機區網測試用 0.0.0.0）、
 *           MP_TLS_CERT / MP_TLS_KEY（設定後改用 HTTPS/WSS）、MP_DEV=1（允許測試直接出生在原野）、
 *           MP_GRACE_MS、MP_ROOM_CAPACITY、MP_MAX_PLAYERS、MP_ALLOWED_ORIGINS
 */
import { GameServer, optionsFromEnv } from "./GameServer.ts";

const server = new GameServer(optionsFromEnv(process.env));
await server.start();
const shutdown = async (): Promise<void> => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
