// 最小型別宣告（本機無法從 npm 安裝 @types/ws；CI 或正式安裝時可改用 @types/ws）
declare module "ws" {
  import type { IncomingMessage, Server as HttpServer } from "node:http";
  import type { Server as HttpsServer } from "node:https";
  import { EventEmitter } from "node:events";
  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    readonly bufferedAmount: number;
    constructor(address: string, options?: Record<string, unknown>);
    send(data: string | Buffer, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }
  export interface ServerOptions {
    server?: HttpServer | HttpsServer;
    port?: number;
    path?: string;
    maxPayload?: number;
    perMessageDeflate?: boolean;
    verifyClient?: (info: { origin?: string; req: IncomingMessage; secure: boolean }) => boolean;
  }
  export class WebSocketServer extends EventEmitter {
    constructor(options: ServerOptions, cb?: () => void);
    close(cb?: (err?: Error) => void): void;
    address(): { port: number } | string;
  }
  export default WebSocket;
}
