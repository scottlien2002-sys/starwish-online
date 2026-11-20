/**
 * 星露啵啵外觀切換（Stage 5 整合期間）。
 * 預設維持 V2（star_dew_bobo_procedural），正式遊戲畫面完全不變；
 * 網址加上 ?bobo=v38r 才改用 V3.8R（star_dew_bobo_v38r）。?bobo=v2 或其他值 = V2（回退）。
 */
export type BoboVariant = "v2" | "v38r";

export const BOBO_MODEL_IDS: Readonly<Record<BoboVariant, string>> = {
  v2: "star_dew_bobo_procedural",
  v38r: "star_dew_bobo_v38r",
};

/** 各外觀使用的動畫設定（V3.8R 有自己的時長與受擊規則；V2 維持原本） */
export const BOBO_PROFILE_IDS: Readonly<Record<BoboVariant, string>> = {
  v2: "star_dew_bobo",
  v38r: "star_dew_bobo_v38r",
};

export function boboVariantFromSearch(search: string): BoboVariant {
  const v = new URLSearchParams(search).get("bobo");
  return v === "v38r" ? "v38r" : "v2";
}

/** V3.8R 彈跳位移同步（實驗）：?hopsync=1 開啟；預設關閉 */
export function hopSyncFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("hopsync") === "1";
}
