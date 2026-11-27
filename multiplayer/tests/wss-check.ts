// WSS（TLS 加密連線）實測：自簽憑證啟動 HTTPS/WSS 伺服器，兩個 NetClient 以 wss:// 連線並互相看見。
// 執行：bash multiplayer/tests/wss-check.sh
import { GameServer } from "../server/GameServer.ts";
import { NetClient } from "../client/NetClient.ts";
import { readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2]!;
const srv = new GameServer({ port: 0, host: "127.0.0.1", tls: { cert: readFileSync(`${dir}/cert.pem`, "utf8"), key: readFileSync(`${dir}/key.pem`, "utf8") }, dev: false, graceMs: 3000, roomCapacity: 50, maxPlayers: 10, allowedOrigins: [] });
await srv.start();
const url = `wss://localhost:${srv.port}/ws`;
const mk = (name: string) => {
  const c = new NetClient({ url, name });
  const t = setInterval(() => c.update(1 / 60, name === "a" ? 1 : 0, 0), 1000 / 60);
  c.connect();
  return { c, t };
};
const a = mk("a");
const b = mk("b");
const t0 = Date.now();
while (Date.now() - t0 < 5000 && !(b.c.remotes().some((r) => r.id === a.c.pid && r.anim === 1))) await new Promise((r) => setTimeout(r, 20));
const ok = a.c.state === "online" && b.c.state === "online" && b.c.remotes().some((r) => r.id === a.c.pid && r.anim === 1);
const health = await (await fetch(`https://localhost:${srv.port}/health`)).json();
const res = { url, bothOnline: a.c.state === "online" && b.c.state === "online", bSeesARunning: ok, httpsHealth: health, rttMs: a.c.stats.rttMs };
console.log(JSON.stringify(res));
writeFileSync(new URL("../reports/wss-results.json", import.meta.url), JSON.stringify(res, null, 2));
clearInterval(a.t);
clearInterval(b.t);
a.c.close();
b.c.close();
await srv.stop();
process.exit(ok ? 0 : 1);
