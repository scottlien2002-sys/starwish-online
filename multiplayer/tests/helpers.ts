import { GameServer, type ServerOptions } from "../server/GameServer.ts";
import { NetClient, type NetClientOptions, type NetEvent } from "../client/NetClient.ts";

export async function startServer(o: Partial<ServerOptions> = {}): Promise<GameServer> {
  const s = new GameServer({ port: 0, host: "127.0.0.1", dev: true, graceMs: 3000, roomCapacity: 50, maxPlayers: 200, allowedOrigins: [], ...o });
  await s.start();
  return s;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 測試機器人：真正使用 NetClient（與瀏覽器同一套預測／插值／重連程式），以 60 fps 驅動 */
export class Bot {
  readonly c: NetClient;
  readonly events: NetEvent[] = [];
  dir = { x: 0, z: 0 };
  private timer: ReturnType<typeof setInterval>;
  private last = performance.now();
  constructor(server: GameServer, o: Partial<NetClientOptions> = {}) {
    this.c = new NetClient({ url: `ws://127.0.0.1:${server.port}/ws`, ...o, onEvent: (e) => this.events.push(e) });
    this.timer = setInterval(() => {
      const t = performance.now();
      this.c.update((t - this.last) / 1000, this.dir.x, this.dir.z);
      this.last = t;
    }, 1000 / 60);
    this.c.connect();
  }
  async until(pred: () => boolean, ms = 5000, what = "condition"): Promise<void> {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
      await sleep(10);
    }
  }
  online(): Promise<void> {
    return this.until(() => this.c.state === "online", 5000, "online");
  }
  remote(pid: number) {
    return this.c.remotes().find((r) => r.id === pid);
  }
  stop(): void {
    clearInterval(this.timer);
    this.c.close();
  }
}
