/**
 * 傳送陣「踩入自動傳送」判定（Stage 7.1）。
 * - 玩家進入觸發半徑 → 觸發一次（之後鎖住，等頁面切換）。
 * - 防止兩張地圖無限往返：載入時如果已經站在傳送陣裡（例如存檔位置在陣內），要先走出「解鎖半徑」才會啟用。
 *   正常抵達點都在傳送陣外側，所以一般情況一進場就是啟用狀態。
 * - 未開放的傳送陣（open = false）永遠不觸發。
 */
export interface PortalSpec {
  id: string;
  x: number;
  z: number;
  /** 進入這個半徑內觸發（公尺） */
  triggerR: number;
  /** 載入時在陣內 → 要離開到這個半徑外才啟用（預設 triggerR + 1） */
  armR?: number;
  open: boolean;
}

export class PortalTrigger {
  readonly spec: PortalSpec;
  private armed: boolean | null = null;
  private fired = false;

  constructor(spec: PortalSpec) {
    this.spec = spec;
  }

  get isArmed(): boolean {
    return this.armed === true && !this.fired;
  }

  get hasFired(): boolean {
    return this.fired;
  }

  distance(px: number, pz: number): number {
    return Math.hypot(px - this.spec.x, pz - this.spec.z);
  }

  /** 每格呼叫；回傳 true = 這一格要傳送（只會回傳一次） */
  update(px: number, pz: number): boolean {
    if (!this.spec.open || this.fired) return false;
    const d = this.distance(px, pz);
    if (this.armed === null) this.armed = d > this.spec.triggerR; // 第一次判定：在陣外出生 → 直接啟用
    if (!this.armed) {
      if (d > (this.spec.armR ?? this.spec.triggerR + 1)) this.armed = true;
      return false;
    }
    if (d <= this.spec.triggerR) {
      this.fired = true;
      return true;
    }
    return false;
  }

  /** 傳送沒有成功（例如存檔失敗）時重新允許 */
  reset(): void {
    this.fired = false;
  }
}
