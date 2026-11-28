/**
 * Stage 7 完整遊戲使用的初心者模型版本。
 * C1.0-B5b（B5 外觀＋B5a 動作修正＋新的死亡動作）的 GLB 由 Blender CI 產生；已放進 public/models（art-novice-c10b5b）。
 * 沒有死亡動作的版本，倒地時用整個角色往後倒代替（舊行為）。
 */
export const NOVICE_VERSION: "c10b5a" | "c10b5b" = "c10b5b";

/**
 * Stage 7.5：新版男性初心者（Tripo 模型＋蒙皮修正＋重定向動作）＝「n75」。女性維持 C1.0-B5b，待男性實機驗收後再做。
 * 網址 &nv=c10b5b 可切回舊版男性（比較用）。
 */
export const NOVICE_MALE_N75 = "n75";
export function noviceVersionFor(gender: "male" | "female", params: URLSearchParams = new URLSearchParams()): string {
  if (gender === "male" && params.get("nv") !== "c10b5b") return NOVICE_MALE_N75;
  return NOVICE_VERSION;
}
