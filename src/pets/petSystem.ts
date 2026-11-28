/**
 * 星靈寵物系統（核心邏輯，不含畫面）。
 *
 * - 寵物來源：種子、孵化蛋、鳥蛋（打怪掉落）；取得後放在背包，「孵化」後成為寵物（階段 0 = 蛋／種子）。
 * - 培育：經過時間增加經驗、餵食（怪物材料、商店飼料）增加經驗；經驗與餵食次數達到條件後可以進化到下一階段。
 * - 鑑定：每隻寵物鑑定出 0～4 條詞條（攻擊力、攻速、防禦力、生命值，同一種最多一條；可正可負）。
 * - 加成：詞條數值 × 培育倍率（依階段、階段內進度逐步提高）；角色最終攻速不超過 160。
 *
 * 機率、孵化時間、成長、進化、掉落、加成倍率都由設定檔決定。正式設定尚未定案（null），
 * 這時只能用 `preview` 暫定數值（只給測試頁用），正式模式會拋出 PetConfigPendingError，不自行假設。
 * 這個檔案不匯入 JSON，設定由呼叫端傳入（單元測試直接讀檔）。
 */
import { CORE_RULES, clampAttackSpeed } from "../core/rules.ts";
import type { Rng } from "../core/rng.ts";

export type PetSourceId = "seed" | "egg" | "birdEgg";
export type FeedId = "monsterMaterial" | "shopFeed";
export type ItemId = PetSourceId | FeedId;
export type PetStat = "attack" | "attackSpeed" | "defense" | "maxHp";
export const PET_STATS: readonly PetStat[] = Object.freeze(["attack", "attackSpeed", "defense", "maxHp"]);
export const ITEM_IDS: readonly ItemId[] = Object.freeze(["seed", "egg", "birdEgg", "monsterMaterial", "shopFeed"]);

export interface PetStatEntry {
  stat: PetStat;
  label: string;
  unit: "flat" | "percent";
  values: number[];
  valueWeights: number[] | null;
  statWeight: number | null;
}

export interface PetTuning {
  affixCountWeights: number[] | null; // 0～4 條各自的權重（長度 5）
  statWeights: Record<PetStat, number> | null;
  valueWeights: Partial<Record<PetStat, number[]>> | null; // null = 各數值等機率（只在 preview 允許）
  hatchSeconds: number | null;
  expPerSecond: number | null;
  stageExp: number[] | null; // 每個階段需要的累計經驗（stageExp[s] = 進入階段 s 所需）
  evolveRequiresFeedCount: number[] | null; // 進入階段 s 需要的累計餵食次數
  bonusScaleByStage: number[] | null; // 各階段的加成倍率（0～1）
  feedExp: Record<FeedId, number> | null;
  drops: Record<ItemId, number> | null; // 每次擊倒怪物各物品的掉落機率
  appraisalFee: number | null; // 寵物商人鑑定費用（金幣）
  feedPrice: Record<"shopFeed", number> | null; // 商店飼料價格
  care: PetCare | null; // 飽食度、死亡、靈魂復活（方案 B）
}

/** 飽食度與死亡（方案 B：靈魂復活型）。細節未確認的部分全部是可配置值 */
export interface PetCare {
  satietyMax: number;
  satietyLossPerHour: number;
  feedSatiety: Record<FeedId, number>;
  /** 飽食度歸零後經過多久變成靈魂（分鐘） */
  starveDeathMinutes: number;
  /** 飽食度歸零時是否停止時間成長 */
  growthStopsWhenHungry: boolean;
  /** 靈魂復活費用（金幣） */
  reviveFee: number;
  /** 復活後的飽食度（相對上限的比例） */
  reviveSatietyRatio: number;
}

type CareJson = { [K in keyof PetCare]: K extends "feedSatiety" ? Record<FeedId, number | null> : PetCare[K] | null };

export interface PetConfig {
  schemaVersion: number;
  status: Record<string, string>;
  sources: { id: PetSourceId; label: string; species: string }[];
  species: { id: string; label: string; motion: "float" | "fly"; stages: { id: string; label: string }[] }[];
  appraisal: { maxAffixes: number; oneAffixPerStat: boolean; allowNegative: boolean; stats: PetStatEntry[]; affixCountWeights: number[] | null };
  growth: { hatchSeconds: number | null; expPerSecond: number | null; stageExp: number[] | null; evolveRequiresFeedCount: number[] | null; bonusScaleByStage: number[] | null };
  feed: { id: FeedId; label: string; exp: number | null }[];
  drops: { default: Record<ItemId, number | null> };
  preview: {
    note: string;
    affixCountWeights: number[];
    statWeights: Record<PetStat, number>;
    valueWeights: Partial<Record<PetStat, number[]>> | null;
    hatchSeconds: number;
    expPerSecond: number;
    stageExp: number[];
    evolveRequiresFeedCount: number[];
    bonusScaleByStage: number[];
    feedExp: Record<FeedId, number>;
    drops: Record<ItemId, number>;
    services?: { appraisalFee: number; feedPrice: Record<"shopFeed", number> };
    care?: PetCare;
  };
  services?: { appraisalFee: number | null; feedPrice: Record<"shopFeed", number | null> };
  care?: CareJson;
  visual?: { stageSize: number[] };
}

function officialCare(cfg: PetConfig): PetCare | null {
  const c = cfg.care;
  if (!c) return null;
  const fs = c.feedSatiety;
  if (fs.monsterMaterial === null || fs.shopFeed === null) return null;
  for (const k of ["satietyMax", "satietyLossPerHour", "starveDeathMinutes", "growthStopsWhenHungry", "reviveFee", "reviveSatietyRatio"] as const) if (c[k] === null || c[k] === undefined) return null;
  return { ...(c as unknown as PetCare), feedSatiety: { monsterMaterial: fs.monsterMaterial, shopFeed: fs.shopFeed } };
}

/** 正式設定尚未定案時拋出（不得自行假設機率或數值） */
export class PetConfigPendingError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`寵物設定「${field}」尚未定案（null）；正式模式不能使用。測試頁請用 preview 模式。`);
    this.field = field;
  }
}

/** mode = "official"：只用正式欄位（null 就拋錯）；"preview"：用 preview 暫定數值（測試頁） */
export function resolveTuning(cfg: PetConfig, mode: "official" | "preview"): PetTuning {
  if (mode === "preview") {
    const p = cfg.preview;
    return {
      affixCountWeights: p.affixCountWeights,
      statWeights: p.statWeights,
      valueWeights: p.valueWeights,
      hatchSeconds: p.hatchSeconds,
      expPerSecond: p.expPerSecond,
      stageExp: p.stageExp,
      evolveRequiresFeedCount: p.evolveRequiresFeedCount,
      bonusScaleByStage: p.bonusScaleByStage,
      feedExp: p.feedExp,
      drops: p.drops,
      appraisalFee: p.services?.appraisalFee ?? 0,
      feedPrice: p.services?.feedPrice ?? { shopFeed: 0 },
      care: p.care ?? null,
    };
  }
  const statW = cfg.appraisal.stats.every((s) => s.statWeight !== null)
    ? (Object.fromEntries(cfg.appraisal.stats.map((s) => [s.stat, s.statWeight as number])) as Record<PetStat, number>)
    : null;
  const valW = cfg.appraisal.stats.every((s) => s.valueWeights !== null)
    ? (Object.fromEntries(cfg.appraisal.stats.map((s) => [s.stat, s.valueWeights as number[]])) as Record<PetStat, number[]>)
    : null;
  const feedExp = cfg.feed.every((f) => f.exp !== null) ? (Object.fromEntries(cfg.feed.map((f) => [f.id, f.exp as number])) as Record<FeedId, number>) : null;
  const d = cfg.drops.default;
  const drops = ITEM_IDS.every((k) => d[k] !== null) ? (d as Record<ItemId, number>) : null;
  return {
    affixCountWeights: cfg.appraisal.affixCountWeights,
    statWeights: statW,
    valueWeights: valW,
    hatchSeconds: cfg.growth.hatchSeconds,
    expPerSecond: cfg.growth.expPerSecond,
    stageExp: cfg.growth.stageExp,
    evolveRequiresFeedCount: cfg.growth.evolveRequiresFeedCount,
    bonusScaleByStage: cfg.growth.bonusScaleByStage,
    feedExp,
    drops,
    appraisalFee: cfg.services?.appraisalFee ?? null,
    feedPrice: shopFeedPrice(cfg),
    care: officialCare(cfg),
  };
}

function shopFeedPrice(cfg: PetConfig): Record<"shopFeed", number> | null {
  const v = cfg.services ? cfg.services.feedPrice.shopFeed : null;
  return v === null || v === undefined ? null : { shopFeed: v };
}

/**
 * 正式設定還缺哪些數值（空陣列 = 可以啟用寵物系統）。
 * preview（測試設定）允許各數值等機率（valueWeights = null）。
 * 遊戲用這個結果決定是否啟用寵物功能：缺值時停用寵物、顯示提示，但遊戲照常進入。
 */
export function missingTuning(t: PetTuning, mode: "official" | "preview"): string[] {
  const label: [keyof PetTuning, string][] = [
    ["affixCountWeights", "鑑定條數機率"],
    ["statWeights", "鑑定屬性機率"],
    ["valueWeights", "鑑定數值機率"],
    ["hatchSeconds", "孵化時間"],
    ["expPerSecond", "時間成長經驗"],
    ["stageExp", "各階段經驗"],
    ["evolveRequiresFeedCount", "進化餵食次數"],
    ["bonusScaleByStage", "各階段加成倍率"],
    ["feedExp", "飼料經驗"],
    ["drops", "掉落率"],
    ["appraisalFee", "鑑定費用"],
    ["feedPrice", "飼料價格"],
    ["care", "飽食度與死亡復活規則"],
  ];
  return label.filter(([k]) => t[k] === null && !(mode === "preview" && k === "valueWeights")).map(([, l]) => l);
}

function need<T>(v: T | null, field: string): T {
  if (v === null) throw new PetConfigPendingError(field);
  return v;
}

// ---------------------------------------------------------------- 設定驗證

/** 企劃確認的鑑定數值（不可改；改了驗證會失敗） */
export const CONFIRMED_PET_VALUES: Readonly<Record<PetStat, readonly number[]>> = Object.freeze({
  attack: [-10, -5, 10, 15, 20, 25],
  attackSpeed: [-4, -2, 2, 4, 6, 8, 10],
  defense: [-10, -5, 10, 15, 20, 25],
  maxHp: [-10, -5, 10, 15, 20],
});

export function validatePetConfig(cfg: PetConfig): string[] {
  const e: string[] = [];
  const stats = cfg.appraisal.stats.map((s) => s.stat);
  if (stats.length !== 4 || !PET_STATS.every((s) => stats.includes(s))) e.push(`appraisal.stats 必須正好是 ${PET_STATS.join("、")}`);
  if (cfg.appraisal.maxAffixes !== 4) e.push("appraisal.maxAffixes 必須是 4");
  if (!cfg.appraisal.oneAffixPerStat) e.push("同一種屬性最多一條（oneAffixPerStat 必須為 true）");
  if (!cfg.appraisal.allowNegative) e.push("不得排除負屬性（allowNegative 必須為 true）");
  for (const s of cfg.appraisal.stats) {
    const want = CONFIRMED_PET_VALUES[s.stat];
    if (!want || want.length !== s.values.length || want.some((v, i) => v !== s.values[i])) e.push(`appraisal.${s.stat}: 數值必須是企劃確認值 [${want?.join(", ")}]`);
    if (s.stat === "attackSpeed" && Math.max(...s.values) > CORE_RULES.maxAttackSpeed) e.push("攻速詞條超過上限");
    if (s.valueWeights !== null && (s.valueWeights.length !== s.values.length || s.valueWeights.some((w) => !(w >= 0)))) e.push(`appraisal.${s.stat}.valueWeights 長度或數值錯誤`);
  }
  const cw = cfg.appraisal.affixCountWeights;
  if (cw !== null && (cw.length !== 5 || cw.some((w) => !(w >= 0)) || cw.every((w) => w === 0))) e.push("affixCountWeights 必須是 5 個非負數（0～4 條），且不能全為 0");
  const nStages = cfg.species.map((s) => s.stages.length);
  if (new Set(nStages).size !== 1) e.push("所有寵物種類的階段數必須相同");
  const S = nStages[0] ?? 0;
  const p = cfg.preview;
  for (const [k, arr] of [["stageExp", p.stageExp], ["evolveRequiresFeedCount", p.evolveRequiresFeedCount], ["bonusScaleByStage", p.bonusScaleByStage]] as const) {
    if (arr.length !== S) e.push(`preview.${k} 長度必須等於階段數 ${S}`);
    for (let i = 1; i < arr.length; i++) if (arr[i]! < arr[i - 1]!) e.push(`preview.${k} 必須遞增`);
  }
  for (const [k, arr] of [["stageExp", cfg.growth.stageExp], ["evolveRequiresFeedCount", cfg.growth.evolveRequiresFeedCount], ["bonusScaleByStage", cfg.growth.bonusScaleByStage]] as const) {
    if (arr !== null && arr.length !== S) e.push(`growth.${k} 長度必須等於階段數 ${S}`);
  }
  if (p.affixCountWeights.length !== 5) e.push("preview.affixCountWeights 長度必須是 5");
  for (const src of cfg.sources) if (!cfg.species.some((sp) => sp.id === src.species)) e.push(`來源 ${src.id} 的種類 ${src.species} 不存在`);
  return e;
}

// ---------------------------------------------------------------- 資料

export interface PetAffix {
  stat: PetStat;
  value: number; // percent 為百分比數字（10 = +10%），flat 為點數
}

export interface Pet {
  id: number;
  source: PetSourceId;
  species: string;
  stage: number; // 0 = 蛋／種子（未孵化）
  exp: number; // 累計經驗
  feedCount: number; // 累計餵食次數
  obtainedAt: number; // 毫秒
  lastTickAt: number;
  affixes: PetAffix[] | null; // null = 尚未鑑定
  appraisedAt?: number;
  /** 飽食度（孵化後才有） */
  satiety?: number;
  /** 飽食度歸零的時間（毫秒）；有東西吃就清除 */
  starvedSince?: number | null;
  /** alive = 活著；soul = 靈魂（方案 B：資料與詞條保留，可以復活） */
  life?: "alive" | "soul";
  /** 掛賣中：暫停飽食度消耗與成長（交易系統鎖定） */
  frozen?: boolean;
}

export const isSoul = (p: Pet): boolean => p.life === "soul";

/**
 * 背包裡的一顆種子／孵化蛋／鳥蛋（每一顆都是獨立個體，不能只有數量）。
 * 可以在孵化前到寵物商人鑑定；詞條跟著個體走，孵化後成為寵物的詞條（方案 A：一次固定）。
 */
export interface PetItem {
  id: string; // "item:<流水號>"，存檔後不變、不重複使用
  kind: PetSourceId;
  obtainedAt: number;
  affixes: PetAffix[] | null;
  appraisedAt?: number;
  /** 交易系統鎖定（掛賣中）：不能孵化、鑑定、出售、再掛賣 */
  locked?: boolean;
}

export interface PetSave {
  version: 1;
  nextId: number;
  items: Record<ItemId, number>; // 種子／蛋／鳥蛋的數量＝bag 裡同種個體的數量（顯示用）
  pets: Pet[];
  equippedId: number | null;
  /** 種子／孵化蛋／鳥蛋個體（舊存檔沒有 → 讀檔時依數量補上） */
  bag?: PetItem[];
  nextItemId?: number;
  /** 寵物商人鑑定紀錄（requestId 冪等：同一個請求只處理一次） */
  appraisalLog?: { requestId: string; itemId: string; charged: number | null }[];
}

const SOURCE_KINDS: readonly PetSourceId[] = ["seed", "egg", "birdEgg"];

/** 讓 bag 與數量一致：數量比個體多 → 補未鑑定個體；比個體少 → 數量改成個體數 */
export function syncBag(save: PetSave, now = 0): PetItem[] {
  if (!save.bag) save.bag = [];
  if (!save.nextItemId) save.nextItemId = 1;
  for (const k of SOURCE_KINDS) {
    const have = save.bag.filter((b) => b.kind === k).length;
    for (let i = have; i < save.items[k]; i++) save.bag.push({ id: `item:${save.nextItemId++}`, kind: k, obtainedAt: now, affixes: null });
    save.items[k] = save.bag.filter((b) => b.kind === k).length;
  }
  return save.bag;
}

export function newSave(): PetSave {
  return { version: 1, nextId: 1, items: { seed: 0, egg: 0, birdEgg: 0, monsterMaterial: 0, shopFeed: 0 }, pets: [], equippedId: null, bag: [], nextItemId: 1, appraisalLog: [] };
}

export function parseSave(json: string | null): PetSave {
  if (!json) return newSave();
  try {
    const v = JSON.parse(json) as Partial<PetSave>;
    if (v.version !== 1 || !Array.isArray(v.pets) || typeof v.nextId !== "number" || !v.items) return newSave();
    const items = { ...newSave().items };
    for (const k of ITEM_IDS) items[k] = Math.max(0, Math.floor(Number(v.items[k]) || 0));
    const pets = v.pets.filter((p): p is Pet => !!p && typeof p.id === "number" && typeof p.species === "string");
    const equippedId = pets.some((p) => p.id === v.equippedId) ? (v.equippedId as number) : null;
    const bag = Array.isArray(v.bag) ? v.bag.filter((b): b is PetItem => !!b && typeof b.id === "string" && SOURCE_KINDS.includes(b.kind)) : [];
    const nextItemId = Math.max(Number(v.nextItemId) || 1, ...bag.map((b) => Number(b.id.replace(/^item:/, "")) + 1 || 1));
    const appraisalLog = Array.isArray(v.appraisalLog) ? v.appraisalLog.slice(-100) : [];
    const save: PetSave = { version: 1, nextId: v.nextId, items, pets, equippedId, bag, nextItemId, appraisalLog };
    syncBag(save);
    return save;
  } catch {
    return newSave();
  }
}

// ---------------------------------------------------------------- 掉落、取得、孵化

/** 擊倒一隻怪物時的掉落（每種物品各自判定一次） */
export function rollDrops(rng: Rng, t: PetTuning): ItemId[] {
  const rates = need(t.drops, "drops");
  return ITEM_IDS.filter((k) => rng.next() < (rates[k] ?? 0));
}

export function addItems(save: PetSave, items: readonly ItemId[], now = 0): void {
  syncBag(save, now);
  for (const k of items) {
    save.items[k] += 1;
    if ((SOURCE_KINDS as readonly string[]).includes(k)) save.bag!.push({ id: `item:${save.nextItemId!++}`, kind: k as PetSourceId, obtainedAt: now, affixes: null });
  }
}

/** 用背包裡的種子／蛋／鳥蛋開始孵化（成為階段 0 的寵物） */
export function startHatch(save: PetSave, cfg: PetConfig, source: PetSourceId, now: number, itemId?: string): Pet | null {
  const bag = syncBag(save, now);
  const idx = itemId ? bag.findIndex((b) => b.id === itemId && b.kind === source && !b.locked) : bag.findIndex((b) => b.kind === source && !b.locked);
  if (idx < 0) return null;
  const src = cfg.sources.find((s) => s.id === source);
  if (!src) return null;
  const [item] = bag.splice(idx, 1);
  save.items[source] -= 1;
  // 孵化前鑑定過的詞條跟著個體進入寵物（方案 A：不重抽、不改變）
  const pet: Pet = { id: save.nextId++, source, species: src.species, stage: 0, exp: 0, feedCount: 0, obtainedAt: now, lastTickAt: now, affixes: item!.affixes };
  if (item!.appraisedAt !== undefined) pet.appraisedAt = item!.appraisedAt;
  save.pets.push(pet);
  return pet;
}

export function stageCount(cfg: PetConfig, pet: Pet): number {
  return cfg.species.find((s) => s.id === pet.species)?.stages.length ?? 1;
}

/** 時間前進：未孵化的蛋到時間就孵化（階段 1）；已孵化的寵物依時間增加經驗 */
export function tickPet(pet: Pet, t: PetTuning, now: number): { hatched: boolean; died?: boolean } {
  const dt = Math.max(0, (now - pet.lastTickAt) / 1000);
  pet.lastTickAt = now;
  // 掛賣中（交易系統鎖定）或靈魂：不消耗飽食度、不成長
  if (pet.frozen || isSoul(pet)) return { hatched: false };
  if (pet.stage === 0) {
    if ((now - pet.obtainedAt) / 1000 >= need(t.hatchSeconds, "growth.hatchSeconds")) {
      pet.stage = 1;
      if (t.care) {
        pet.satiety = t.care.satietyMax;
        pet.starvedSince = null;
      }
      pet.life = "alive";
      return { hatched: true };
    }
    return { hatched: false };
  }
  const care = t.care;
  if (!care) {
    pet.exp += dt * need(t.expPerSecond, "growth.expPerSecond");
    return { hatched: false };
  }
  // 飽食度：先算到歸零的那一刻，之後的時間不成長（若設定為飢餓停止成長）
  const before = pet.satiety ?? care.satietyMax;
  const loss = (dt * care.satietyLossPerHour) / 3600;
  const fedSeconds = loss > 0 ? Math.min(dt, (before / care.satietyLossPerHour) * 3600) : dt;
  pet.satiety = Math.max(0, before - loss);
  const growSeconds = care.growthStopsWhenHungry ? fedSeconds : dt;
  pet.exp += growSeconds * need(t.expPerSecond, "growth.expPerSecond");
  if (pet.satiety <= 0) {
    const zeroAt = now - (dt - fedSeconds) * 1000;
    if (pet.starvedSince === null || pet.starvedSince === undefined) pet.starvedSince = zeroAt;
    if (now - pet.starvedSince >= care.starveDeathMinutes * 60_000) {
      pet.life = "soul";
      return { hatched: false, died: true };
    }
  }
  return { hatched: false };
}

/** 方案 B：靈魂復活（費用由呼叫端用金幣扣款）；詞條、階段、經驗都保留 */
export function revivePet(pet: Pet, t: PetTuning): boolean {
  if (!isSoul(pet) || !t.care) return false;
  pet.life = "alive";
  pet.satiety = t.care.satietyMax * t.care.reviveSatietyRatio;
  pet.starvedSince = null;
  return true;
}

export function feedPet(save: PetSave, pet: Pet, food: FeedId, t: PetTuning): boolean {
  if (pet.stage === 0 || save.items[food] <= 0 || isSoul(pet) || pet.frozen) return false;
  const exp = need(t.feedExp, "feed.exp")[food];
  save.items[food] -= 1;
  pet.exp += exp;
  pet.feedCount += 1;
  if (t.care) {
    pet.satiety = Math.min(t.care.satietyMax, (pet.satiety ?? t.care.satietyMax) + t.care.feedSatiety[food]);
    pet.starvedSince = null;
  }
  return true;
}

export function canEvolve(cfg: PetConfig, pet: Pet, t: PetTuning): boolean {
  const next = pet.stage + 1;
  if (pet.stage === 0 || next >= stageCount(cfg, pet)) return false;
  const se = need(t.stageExp, "growth.stageExp");
  const fe = need(t.evolveRequiresFeedCount, "growth.evolveRequiresFeedCount");
  return pet.exp >= (se[next] ?? Infinity) && pet.feedCount >= (fe[next] ?? Infinity);
}

export function evolve(cfg: PetConfig, pet: Pet, t: PetTuning): boolean {
  if (isSoul(pet) || pet.frozen || !canEvolve(cfg, pet, t)) return false;
  pet.stage += 1;
  return true;
}

/** 階段內進度 0～1（最後階段固定 1） */
export function stageProgress(cfg: PetConfig, pet: Pet, t: PetTuning): number {
  const se = need(t.stageExp, "growth.stageExp");
  const next = pet.stage + 1;
  if (pet.stage === 0) return 0;
  if (next >= stageCount(cfg, pet)) return 1;
  const a = se[pet.stage] ?? 0;
  const b = se[next] ?? a + 1;
  return Math.max(0, Math.min(1, (pet.exp - a) / Math.max(1e-9, b - a)));
}

/**
 * 加成倍率：目前階段的倍率，往下一階段的倍率前進一半（階段內進度 × 0.5），所以進化仍有提升；
 * 最後階段＝最後倍率。蛋（階段 0）沒有加成。
 */
export function bonusScale(cfg: PetConfig, pet: Pet, t: PetTuning): number {
  const sc = need(t.bonusScaleByStage, "growth.bonusScaleByStage");
  if (pet.stage === 0) return 0;
  const cur = sc[pet.stage] ?? 0;
  const nxt = sc[pet.stage + 1];
  if (nxt === undefined) return cur;
  return cur + (nxt - cur) * 0.5 * stageProgress(cfg, pet, t);
}

// ---------------------------------------------------------------- 鑑定

function pickWeighted(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(total > 0)) throw new Error("權重總和必須大於 0");
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]!);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * 鑑定：先決定條數（0～4），再不重複地抽屬性，最後抽數值（正負都可能）。
 * valueWeights 為 null 時各數值等機率（只在 preview 會這樣；正式模式 resolveTuning 會給 null 而在此拋錯）。
 */
export function appraise(cfg: PetConfig, t: PetTuning, rng: Rng, mode: "official" | "preview" = "official"): PetAffix[] {
  const countW = need(t.affixCountWeights, "appraisal.affixCountWeights");
  const statW = need(t.statWeights, "appraisal.statWeight");
  if (mode === "official") need(t.valueWeights, "appraisal.valueWeights");
  const n = Math.min(cfg.appraisal.maxAffixes, pickWeighted(rng, countW));
  const pool = cfg.appraisal.stats.map((s) => s.stat);
  const out: PetAffix[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    const k = pickWeighted(rng, pool.map((s) => statW[s] ?? 0));
    const stat = pool.splice(k, 1)[0]!;
    const entry = cfg.appraisal.stats.find((s) => s.stat === stat)!;
    const vw = t.valueWeights?.[stat] ?? entry.values.map(() => 1);
    out.push({ stat, value: entry.values[pickWeighted(rng, vw)]! });
  }
  return out;
}

export type AppraiseResult = { ok: true; affixes: PetAffix[] } | { ok: false; reason: "egg" | "already-appraised" | "not-found" };

/**
 * 方案 A：首次鑑定一次定案。詞條種類與原始數值永久保存在 pet.affixes，
 * 之後再次鑑定一律拒絕（不重抽），進化／存讀檔也不會改動；進化只改變 bonusScale（發揮比例）。
 * 正負詞條使用同一個發揮比例。
 */
export function appraisePet(save: PetSave, cfg: PetConfig, t: PetTuning, rng: Rng, petId: number, mode: "official" | "preview" = "official"): AppraiseResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "not-found" };
  // 孵化中（階段 0）也可以鑑定：與「在寵物商人鑑定種子／蛋本身」同一套規則
  if (pet.affixes !== null) return { ok: false, reason: "already-appraised" };
  pet.affixes = appraise(cfg, t, rng, mode);
  return { ok: true, affixes: pet.affixes };
}

/** 鑑定背包裡的種子／孵化蛋／鳥蛋個體（方案 A：一次固定；不新增、不刪除、不改數量） */
export function appraiseItem(save: PetSave, cfg: PetConfig, t: PetTuning, rng: Rng, itemId: string, mode: "official" | "preview" = "official", now = 0): AppraiseResult {
  const item = syncBag(save).find((b) => b.id === itemId);
  if (!item || item.locked) return { ok: false, reason: "not-found" };
  if (item.affixes !== null) return { ok: false, reason: "already-appraised" };
  item.affixes = appraise(cfg, t, rng, mode);
  item.appraisedAt = now;
  return { ok: true, affixes: item.affixes };
}

/** 詞條是否符合正式規格（0～4 條、同種最多一條、數值在確認清單內）；空陣列＝符合 */
export function validateAffixes(cfg: PetConfig, affixes: readonly PetAffix[]): string[] {
  const e: string[] = [];
  if (affixes.length > cfg.appraisal.maxAffixes) e.push("超過 4 條");
  if (new Set(affixes.map((a) => a.stat)).size !== affixes.length) e.push("同一種屬性重複");
  for (const a of affixes) {
    const entry = cfg.appraisal.stats.find((s) => s.stat === a.stat);
    if (!entry) e.push(`未知屬性 ${a.stat}`);
    else if (!entry.values.includes(a.value)) e.push(`${a.stat} 數值 ${a.value} 不在確認清單內`);
  }
  return e;
}

// ---------------------------------------------------------------- 套用到角色

export interface CharacterStats {
  attack: number;
  attackSpeed: number;
  defense: number;
  maxHp: number;
}

/** 寵物對角色的實際加成（詞條 × 培育倍率）。未鑑定、蛋階段 = 無加成。攻速最終不超過 160。 */
export function applyPetBonus(base: CharacterStats, cfg: PetConfig, pet: Pet | null, t: PetTuning): { stats: CharacterStats; scale: number; effective: PetAffix[] } {
  if (!pet || !pet.affixes || pet.stage === 0 || isSoul(pet)) return { stats: { ...base, attackSpeed: clampAttackSpeed(base.attackSpeed) }, scale: 0, effective: [] };
  const scale = bonusScale(cfg, pet, t);
  const s = { ...base };
  const effective: PetAffix[] = [];
  for (const a of pet.affixes) {
    const entry = cfg.appraisal.stats.find((x) => x.stat === a.stat);
    if (!entry) continue;
    const v = a.value * scale;
    effective.push({ stat: a.stat, value: Math.round(v * 100) / 100 });
    if (entry.unit === "percent") s[a.stat] = s[a.stat] * (1 + v / 100);
    else s[a.stat] = s[a.stat] + v;
  }
  s.attack = Math.round(s.attack);
  s.defense = Math.round(s.defense);
  s.maxHp = Math.round(s.maxHp);
  s.attackSpeed = clampAttackSpeed(Math.round(s.attackSpeed * 10) / 10);
  return { stats: s, scale, effective };
}

export function equip(save: PetSave, petId: number | null): boolean {
  if (petId === null) {
    save.equippedId = null;
    return true;
  }
  const p = save.pets.find((x) => x.id === petId);
  if (!p || p.frozen) return false;
  save.equippedId = petId;
  return true;
}

export function equippedPet(save: PetSave): Pet | null {
  return save.pets.find((p) => p.id === save.equippedId) ?? null;
}

export function affixText(cfg: PetConfig, a: PetAffix): string {
  const e = cfg.appraisal.stats.find((s) => s.stat === a.stat);
  const sign = a.value > 0 ? "+" : "";
  return `${e?.label ?? a.stat} ${sign}${a.value}${e?.unit === "percent" ? "%" : ""}`;
}
