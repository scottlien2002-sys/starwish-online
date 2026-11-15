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

  constructor(scene: Scene, initialTarget: Vector3) {
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

  update(dt: number, follow: Vector3, rotate: { yaw: number; pitch: number; zoom: number }): void {
    const c = TUNING.camera;
    const cam = this.camera;

    cam.alpha -= rotate.yaw;
    cam.beta = clamp(cam.beta - rotate.pitch, c.minBeta, c.maxBeta);
    this.desiredRadius = clamp(this.desiredRadius + rotate.zoom, c.minDistance, c.maxDistance);
    cam.radius += (this.desiredRadius - cam.radius) * damp(12, dt);

    const k = damp(c.followSharpness, dt);
    this.smoothTarget.x += (follow.x - this.smoothTarget.x) * k;
    this.smoothTarget.y += (follow.y + c.targetHeight - this.smoothTarget.y) * k;
    this.smoothTarget.z += (follow.z - this.smoothTarget.z) * k;
    cam.target.copyFrom(this.smoothTarget);

    // 不讓攝影機鑽進地面：必要時抬高俯角
    const camX = cam.target.x + cam.radius * Math.cos(cam.alpha) * Math.sin(cam.beta);
    const camZ = cam.target.z + cam.radius * Math.sin(cam.alpha) * Math.sin(cam.beta);
    const minY = heightAt(camX, camZ) + 0.6;
    const camY = cam.target.y + cam.radius * Math.cos(cam.beta);
    if (camY < minY) {
      const cosB = clamp((minY - cam.target.y) / cam.radius, -1, 1);
      cam.beta = clamp(Math.acos(cosB), c.minBeta, c.maxBeta);
    }
  }
}
