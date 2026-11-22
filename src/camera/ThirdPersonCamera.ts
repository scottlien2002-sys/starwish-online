import { ArcRotateCamera, Scene, Vector3 } from "@babylonjs/core";
import { clamp, damp } from "../core/math.ts";
import { TUNING } from "../config/tuning.ts";
import { heightAt } from "../world/terrain.ts";

/**
 * 第三人稱可旋轉攝影機。不使用 Babylon 內建控制，改由 InputState 驅動，
 * 以避免與虛擬搖桿、技能按鈕搶觸控事件。
 */
export class ThirdPersonCamera {
  readonly camera: ArcRotateCamera;
  private readonly smoothTarget = new Vector3();
  private desiredRadius: number = TUNING.camera.distance;
  /** 地面高度（防止鏡頭鑽進地面）；預設為新手草原，其他地圖傳入自己的高度函式 */
  private readonly groundHeight: (x: number, z: number) => number;
  /**
   * 保留玩家調整的俯角（選用；預設關閉＝與原本行為相同）：
   * 地面太高時只「暫時」抬高鏡頭，地面不擋了就平順回到玩家原本的俯角，不會突然跳動
   */
  private readonly keepPitch: boolean;
  private userBeta: number = TUNING.camera.defaultBeta;

  constructor(scene: Scene, initialTarget: Vector3, groundHeight: (x: number, z: number) => number = heightAt, opts: { keepPitch?: boolean } = {}) {
    this.groundHeight = groundHeight;
    this.keepPitch = opts.keepPitch ?? false;
    const c = TUNING.camera;
    this.smoothTarget.copyFrom(initialTarget).addInPlaceFromFloats(0, c.targetHeight, 0);
    this.camera = new ArcRotateCamera("mainCamera", -Math.PI / 2, c.defaultBeta, c.distance, this.smoothTarget.clone(), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 400;
    this.camera.fov = 0.9;
  }

  /** 攝影機看向的水平方向角（與 movement.inputToWorld 相同定義） */
  get forwardYaw(): number {
    const a = this.camera.alpha;
    return Math.atan2(-Math.cos(a), -Math.sin(a));
  }

  /** 測試截圖用：立刻把鏡頭放到指定位置（不平滑），之後的 update 會從這裡繼續 */
  snap(follow: Vector3, alpha: number, beta: number, radius: number): void {
    const c = TUNING.camera;
    this.smoothTarget.copyFrom(follow).addInPlaceFromFloats(0, c.targetHeight, 0);
    this.camera.target.copyFrom(this.smoothTarget);
    this.camera.alpha = alpha;
    this.camera.beta = beta;
    this.camera.radius = radius;
    this.desiredRadius = radius;
    this.userBeta = beta;
  }

  update(dt: number, follow: Vector3, rotate: { yaw: number; pitch: number; zoom: number }): void {
    const c = TUNING.camera;
    const cam = this.camera;

    cam.alpha -= rotate.yaw;
    if (this.keepPitch) this.userBeta = clamp(this.userBeta - rotate.pitch, c.minBeta, c.maxBeta);
    else cam.beta = clamp(cam.beta - rotate.pitch, c.minBeta, c.maxBeta);
    this.desiredRadius = clamp(this.desiredRadius + rotate.zoom, c.minDistance, c.maxDistance);
    cam.radius += (this.desiredRadius - cam.radius) * damp(12, dt);

    const k = damp(c.followSharpness, dt);
    this.smoothTarget.x += (follow.x - this.smoothTarget.x) * k;
    this.smoothTarget.y += (follow.y + c.targetHeight - this.smoothTarget.y) * k;
    this.smoothTarget.z += (follow.z - this.smoothTarget.z) * k;
    cam.target.copyFrom(this.smoothTarget);

    if (this.keepPitch) {
      // 依玩家俯角算出鏡頭位置；若會鑽進地面，求出「剛好在地面上方」的俯角（只取較高的那個），再平順移過去
      let beta = this.userBeta;
      for (let i = 0; i < 2; i++) {
        const camX = cam.target.x + cam.radius * Math.cos(cam.alpha) * Math.sin(beta);
        const camZ = cam.target.z + cam.radius * Math.sin(cam.alpha) * Math.sin(beta);
        const minY = this.groundHeight(camX, camZ) + 0.6;
        const camY = cam.target.y + cam.radius * Math.cos(beta);
        if (camY >= minY) break;
        beta = clamp(Math.acos(clamp((minY - cam.target.y) / cam.radius, -1, 1)), c.minBeta, c.maxBeta);
      }
      // 往上避開地面、或玩家正在拖曳時要跟手；地面不擋後回到玩家俯角則慢一點（避免跳動）
      const fast = beta < cam.beta || rotate.pitch !== 0;
      cam.beta += (beta - cam.beta) * damp(fast ? 18 : 5, dt);
      return;
    }
    // 不讓攝影機鑽進地面：必要時抬高俯角
    const camX = cam.target.x + cam.radius * Math.cos(cam.alpha) * Math.sin(cam.beta);
    const camZ = cam.target.z + cam.radius * Math.sin(cam.alpha) * Math.sin(cam.beta);
    const minY = this.groundHeight(camX, camZ) + 0.6;
    const camY = cam.target.y + cam.radius * Math.cos(cam.beta);
    if (camY < minY) {
      const cosB = clamp((minY - cam.target.y) / cam.radius, -1, 1);
      cam.beta = clamp(Math.acos(cosB), c.minBeta, c.maxBeta);
    }
  }
}
