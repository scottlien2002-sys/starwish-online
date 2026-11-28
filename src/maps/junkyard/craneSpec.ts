/** 吊車三件式組裝的實測接合點與參數型別（純資料；說明見 craneRig.ts） */
export const TOWER = { bottom: -0.489, top: 0.49, baseHalf: 0.192 } as const;
export const BOOM = { pivot: [0, -0.172, 0.294] as const, pulley: [0, -0.055, -0.435] as const, turretR: 0.12 } as const;
export const GRAB = { top: 0.49, bottom: -0.49, halfW: 0.44 } as const;

export interface CraneRigSpec {
  id: string;
  /** 公尺／模型單位 */
  towerUnit: number;
  boomUnit: number;
  grabUnit: number;
  /** 吊臂底座往下嵌入塔頂的深度（公尺；消除縫隙） */
  seat: number;
  /** 吊臂來回旋轉：中心角、幅度（弧度）、角速度、相位 */
  swingCenter: number;
  swingAmp: number;
  swingSpeed: number;
  phase: number;
  /** 抓斗升降週期（秒） */
  liftPeriod: number;
  /** 地面到塔底的高度差（通常 0） */
  groundClear: number;
}

