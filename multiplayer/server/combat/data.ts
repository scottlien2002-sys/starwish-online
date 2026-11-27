/**
 * 伺服器戰鬥用的資料（只讀取，不修改任何設定檔）：
 * - 怪物：Claude A 的怪物框架（不建立模型）＋已交付清單 public/models/monsters/manifest.json
 * - 掉落：A 的寵物設定 pets.json（測試設定）→ rollDrops；金幣：economy.json（測試設定）→ rollGold
 * - 技能時間：Claude C 的 novice_combat_{male,female}.json（片段長度與命中標記）
 */
import { readFileSync } from "node:fs";
import { resolveTuning, type PetConfig, type PetTuning } from "../../../src/pets/petSystem.ts";
import { resolveEconomy, type Economy, type RawEconomy } from "../../../src/economy/economyConfig.ts";
import type { ClipTiming } from "../../../src/combat-vfx/core/timeline.ts";

const root = new URL("../../../", import.meta.url);
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;

export interface CombatData {
  petTuning: PetTuning;
  economy: Economy;
  /** 已交付的怪物模型檔（決定哪些骨骼動畫怪物會出現；與客戶端同一份清單） */
  deliveredModels: Set<string>;
  /** 技能片段時間：gender → clip → timing */
  clips: Record<"male" | "female", Record<string, ClipTiming>>;
}

let cached: CombatData | null = null;

export function loadCombatData(): CombatData {
  if (cached) return cached;
  const pets = readJson<PetConfig>("src/config/pets.json");
  const eco = readJson<RawEconomy>("src/config/economy.json");
  const manifest = readJson<{ files?: string[] }>("public/models/monsters/manifest.json");
  const clipsOf = (g: "male" | "female"): Record<string, ClipTiming> => {
    const j = readJson<{ clips: Record<string, ClipTiming> }>(`public/combat-vfx/novice_combat_${g}.json`);
    const out: Record<string, ClipTiming> = {};
    for (const [k, c] of Object.entries(j.clips)) out[k] = { duration: c.duration, marks: c.marks, ...(c.times ? { times: c.times } : {}), ...(c.rootMotion ? { rootMotion: c.rootMotion } : {}) };
    return out;
  };
  cached = {
    petTuning: resolveTuning(pets, "preview"),
    economy: resolveEconomy("test", eco),
    deliveredModels: new Set(manifest.files ?? []),
    clips: { male: clipsOf("male"), female: clipsOf("female") },
  };
  return cached;
}
