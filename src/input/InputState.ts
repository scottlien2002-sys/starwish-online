/** 每一幀的輸入快照。輸入裝置寫入，遊戲迴圈讀取。 */
export class InputState {
  /** 移動向量，x 右、y 前，長度 0~1 */
  moveX = 0;
  moveY = 0;
  /** 累積的攝影機旋轉與縮放量（讀取後清零） */
  private yawDelta = 0;
  private pitchDelta = 0;
  private zoomDelta = 0;

  /** 測試用：覆寫移動輸入（null = 不覆寫） */
  moveOverride: { x: number; y: number } | null = null;

  addCameraRotate(yaw: number, pitch: number): void {
    this.yawDelta += yaw;
    this.pitchDelta += pitch;
  }

  addZoom(delta: number): void {
    this.zoomDelta += delta;
  }

  getMove(): { x: number; y: number } {
    return this.moveOverride ?? { x: this.moveX, y: this.moveY };
  }

  consumeCamera(): { yaw: number; pitch: number; zoom: number } {
    const out = { yaw: this.yawDelta, pitch: this.pitchDelta, zoom: this.zoomDelta };
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.zoomDelta = 0;
    return out;
  }
}
