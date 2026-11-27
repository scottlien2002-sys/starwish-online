/**
 * Stage 8.1 整合用介面：把 NetClient 的遠端玩家套到遊戲裡的 3D 角色上。
 * 這個檔案不依賴 Babylon；Claude A 在遊戲本體實作 RemoteAvatarView（例如包一個 PlayerAvatar），
 * 每幀呼叫 sync() 即可。建立／移除角色、套位置、切 Idle／Run 動畫都在這裡處理。
 */
import { ANIM_NAME, type Gender } from "../shared/protocol.ts";
import type { MapAuthority } from "../shared/maps.ts";
import type { RemotePlayer } from "./NetClient.ts";

export interface RemoteAvatarView {
  setPose(x: number, y: number, z: number, yaw: number): void;
  /** "Idle" | "Run"（之後加 Attack／Hurt／Death） */
  playAnim(name: string, speed: number): void;
  /** 斷線中的玩家（半透明或顯示圖示） */
  setConnected(connected: boolean): void;
  dispose(): void;
}

export type AvatarFactory = (p: { id: number; name: string; gender: Gender }) => RemoteAvatarView;

export class AvatarSync {
  private readonly views = new Map<number, { v: RemoteAvatarView; anim: string; link: number }>();
  private readonly factory: AvatarFactory;

  constructor(factory: AvatarFactory) {
    this.factory = factory;
  }

  sync(remotes: readonly RemotePlayer[], map: MapAuthority | null): void {
    const seen = new Set<number>();
    for (const r of remotes) {
      seen.add(r.id);
      let e = this.views.get(r.id);
      if (!e) {
        e = { v: this.factory({ id: r.id, name: r.name, gender: r.gender }), anim: "", link: -1 };
        this.views.set(r.id, e);
      }
      e.v.setPose(r.x, map ? map.ground(r.x, r.z) : 0, r.z, r.yaw);
      const anim = ANIM_NAME[r.anim] ?? "Idle";
      if (anim !== e.anim) {
        e.v.playAnim(anim, r.speed);
        e.anim = anim;
      }
      if (r.link !== e.link) {
        e.v.setConnected(r.link === 1);
        e.link = r.link;
      }
    }
    for (const [id, e] of this.views) {
      if (!seen.has(id)) {
        e.v.dispose();
        this.views.delete(id);
      }
    }
  }

  get count(): number {
    return this.views.size;
  }

  clear(): void {
    for (const e of this.views.values()) e.v.dispose();
    this.views.clear();
  }
}
