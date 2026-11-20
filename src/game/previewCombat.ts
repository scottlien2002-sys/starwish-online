/**
 * 預覽版「測試用」戰鬥（只在 V2 預覽分支，用於在新手草原驗收星露啵啵）。
 *
 * ⚠ 這不是正式戰鬥系統：正式的傷害公式、攻速（上限 160）、鎖定規則、經驗值、掉落、
 *   玩家死亡規則都屬於 W2/W3，尚未由企劃定案。以下數值僅為測試，經使用者同意（2026-11-15）：
 *   - 玩家攻擊：打 2.5 公尺內最近的存活怪物，每下固定 20，間隔 1 秒（沿用 ?lab=field 測試按鈕的值）
 *   - 怪物攻擊：撞擊瞬間若玩家仍在攻擊範圍內，扣玩家 HP = 怪物定義的 attack（星露啵啵暫定 8）
 *   - 玩家 HP 歸零：倒地 2 秒後回出生點、HP 全滿
 *   - 不給經驗值、不掉寶
 * 本檔不依賴 Babylon，可單元測試。怪物數值（MonsterDefinition）完全不修改。
 */

export const PREVIEW_COMBAT = Object.freeze({
  playerMaxHp: 100,
  playerAttackDamage: 20,
  playerAttackInterval: 1.0,
  playerAttackRange: 2.5,
  /** 怪物撞擊判定：攻擊範圍再加上這個寬容值（玩家半徑＋怪物半徑） */
  impactSlack: 0.6,
  downSeconds: 2,
});

/** 戰鬥需要的怪物最小介面（MonsterInstance 已符合） */
export interface CombatMonster {
  readonly instanceId: string;
  readonly isAlive: boolean;
  readonly currentPosition: { x: number; z: number };
  readonly definition: { attack: number; attackRange: number; name: string };
  /** now：遊戲時間；kind：受擊種類（普通攻擊 = normal：不擊退、不硬直） */
  receiveDamage(amount: number, now?: number, kind?: "normal" | "control"): { applied: boolean; killed: boolean };
}

export type PlayerAttackResult =
  | { ok: true; targetId: string; killed: boolean; damage: number }
  | { ok: false; reason: "cooldown" | "no-target" | "down" | "miss" };

/** 按下攻擊鍵的結果：成功時傷害會在 hitAt（動畫揮中的時間）結算 */
export type AttackStartResult =
  | { ok: true; targetId: string; hitAt: number }
  | { ok: false; reason: "cooldown" | "no-target" | "down" };

export class PreviewCombat {
  hp: number = PREVIEW_COMBAT.playerMaxHp;
  private nextAttackAt = 0;
  private downUntil: number | null = null;
  /** 目前鎖定的怪物 id */
  lockedId: string | null = null;
  /** 已出手、等待揮中的攻擊 */
  private pending: { targetId: string; hitAt: number } | null = null;
  /**
   * 玩家普通攻擊的受擊種類：正式規則為 normal（不擊退、不硬直）。
   * control（擊退＋硬直＋連續受擊抗性）保留給未來特殊技能，只有測試會改這個值。
   */
  attackHitKind: "normal" | "control" = "normal";
  /** 累計：玩家受到的攻擊次數（測試用） */
  hitsTaken = 0;

  get isDown(): boolean {
    return this.downUntil !== null;
  }

  /** 找出攻擊範圍內最近的存活怪物 */
  nearestTarget<T extends CombatMonster>(px: number, pz: number, monsters: readonly T[]): T | null {
    let best: T | null = null;
    let bestD: number = PREVIEW_COMBAT.playerAttackRange;
    for (const m of monsters) {
      if (!m.isAlive) continue;
      const d = Math.hypot(m.currentPosition.x - px, m.currentPosition.z - pz);
      if (d <= bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  /**
   * 目前鎖定的目標：已鎖定的怪物只要還活著且在攻擊範圍內就維持鎖定（不會因為別隻靠得更近而換目標），
   * 否則改鎖範圍內最近的一隻。
   */
  lockTarget<T extends CombatMonster>(px: number, pz: number, monsters: readonly T[]): T | null {
    if (this.isDown) {
      this.lockedId = null;
      return null;
    }
    const cur = this.lockedId ? monsters.find((m) => m.instanceId === this.lockedId) : undefined;
    if (cur && cur.isAlive && Math.hypot(cur.currentPosition.x - px, cur.currentPosition.z - pz) <= PREVIEW_COMBAT.playerAttackRange) return cur;
    const next = this.nearestTarget(px, pz, monsters);
    this.lockedId = next?.instanceId ?? null;
    return next;
  }

  get pendingAttack(): { targetId: string; hitAt: number } | null {
    return this.pending;
  }

  /**
   * 按下攻擊鍵：檢查冷卻與目標、開始冷卻計時（攻擊間隔不變）。
   * 傷害不在此時結算，而是在 hitDelay 秒後（攻擊動作揮中的瞬間）由 resolvePending 結算。
   */
  startAttack(now: number, px: number, pz: number, monsters: readonly CombatMonster[], hitDelay: number): AttackStartResult {
    if (this.isDown) return { ok: false, reason: "down" };
    if (now < this.nextAttackAt) return { ok: false, reason: "cooldown" };
    const target = this.lockTarget(px, pz, monsters);
    if (!target) return { ok: false, reason: "no-target" };
    this.nextAttackAt = now + PREVIEW_COMBAT.playerAttackInterval;
    this.pending = { targetId: target.instanceId, hitAt: now + hitDelay };
    return { ok: true, targetId: target.instanceId, hitAt: this.pending.hitAt };
  }

  /**
   * 每幀呼叫：到了揮中時間就結算傷害（數值不變）。目標若已死亡或已離開範圍（含 0.6 公尺寬容）則落空。
   * 沒有要結算的攻擊時回傳 null。
   */
  resolvePending(now: number, px: number, pz: number, monsters: readonly CombatMonster[]): PlayerAttackResult | null {
    const p = this.pending;
    if (!p || now < p.hitAt) return null;
    this.pending = null;
    if (this.isDown) return { ok: false, reason: "down" };
    const target = monsters.find((m) => m.instanceId === p.targetId);
    if (!target || !target.isAlive) return { ok: false, reason: "miss" };
    const d = Math.hypot(target.currentPosition.x - px, target.currentPosition.z - pz);
    if (d > PREVIEW_COMBAT.playerAttackRange + 0.6) return { ok: false, reason: "miss" };
    const r = target.receiveDamage(PREVIEW_COMBAT.playerAttackDamage, now, this.attackHitKind);
    return { ok: true, targetId: target.instanceId, killed: r.killed, damage: PREVIEW_COMBAT.playerAttackDamage };
  }

  /** 按下攻擊並立即結算（不經過動畫；單元測試與純邏輯使用） */
  playerAttack(now: number, px: number, pz: number, monsters: readonly CombatMonster[]): PlayerAttackResult {
    const s = this.startAttack(now, px, pz, monsters, 0);
    if (!s.ok) return s;
    return this.resolvePending(now, px, pz, monsters)!;
  }

  /**
   * 怪物攻擊動畫的撞擊瞬間（attackImpact 特效事件）呼叫。
   * 回傳實際扣的 HP（0 = 沒打中／玩家已倒地），並在 HP 歸零時讓玩家倒地。
   */
  monsterImpact(now: number, monster: CombatMonster, px: number, pz: number): number {
    if (this.isDown || !monster.isAlive) return 0;
    const d = Math.hypot(monster.currentPosition.x - px, monster.currentPosition.z - pz);
    if (d > monster.definition.attackRange + PREVIEW_COMBAT.impactSlack) return 0;
    const dmg = Math.max(0, Math.floor(monster.definition.attack));
    this.hp = Math.max(0, this.hp - dmg);
    this.hitsTaken++;
    if (this.hp === 0) {
      this.downUntil = now + PREVIEW_COMBAT.downSeconds;
      this.pending = null;
    }
    return dmg;
  }

  /** 測試用（?debug=1 的「重設測試」）：玩家 HP 全滿、解除倒地、清除冷卻、未揮中的攻擊與鎖定。數值不變 */
  resetForTest(): void {
    this.hp = PREVIEW_COMBAT.playerMaxHp;
    this.downUntil = null;
    this.nextAttackAt = 0;
    this.pending = null;
    this.lockedId = null;
    this.hitsTaken = 0;
  }

  /** 測試用：直接讓玩家倒地（E2E 驗證倒地與復活流程） */
  debugKnockDown(now: number): void {
    this.pending = null;
    this.hp = 0;
    this.downUntil = now + PREVIEW_COMBAT.downSeconds;
  }

  /** 每幀呼叫；回傳 true 表示本幀玩家復活（呼叫端把玩家送回出生點） */
  update(now: number): boolean {
    if (this.downUntil !== null && now >= this.downUntil) {
      this.downUntil = null;
      this.hp = PREVIEW_COMBAT.playerMaxHp;
      return true;
    }
    return false;
  }
}

/** 出生點前方 6–9 公尺的三個測試生成點（forwardYaw 為攝影機看向的水平角，前方 = (sin, cos)） */
export function previewSpawnPoints(originX: number, originZ: number, forwardYaw: number): { x: number; z: number }[] {
  const pts: [number, number][] = [
    [6.2, -1.6], // 前方略偏左約 6.4 公尺（避免一進場被玩家角色擋住）
    [8, -3.2], // 左前約 8.6 公尺
    [8.6, 2.4], // 右前約 8.9 公尺
  ];
  const fx = Math.sin(forwardYaw), fz = Math.cos(forwardYaw);
  // 右方向（左手座標、y 向上）：(cos, -sin)
  const rx = fz, rz = -fx;
  return pts.map(([f, r]) => ({ x: originX + fx * f + rx * r, z: originZ + fz * f + rz * r }));
}

/**
 * 預覽草原：讓存活怪物彼此保持間距、也不擠進玩家身體（每幀在 AI 移動之後套用）。
 * 只調整位置，不改 AI 決策、狀態機或數值。points 會被原地修改。
 */
export function separate(
  points: { x: number; z: number }[],
  minDist: number,
  player?: { x: number; z: number; minDist: number },
  iterations = 2,
): void {
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!, b = points[j]!;
        let dx = b.x - a.x, dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d >= minDist) continue;
        if (d < 1e-6) {
          // 完全重疊：依索引給固定方向，避免隨機
          const ang = (i * 2.399 + j) % (Math.PI * 2);
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          d = 1;
        } else {
          dx /= d;
          dz /= d;
        }
        const push = (minDist - Math.min(d, minDist)) / 2;
        a.x -= dx * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.z += dz * push;
      }
      if (player) {
        const a = points[i]!;
        const dx = a.x - player.x, dz = a.z - player.z;
        const d = Math.hypot(dx, dz);
        if (d < player.minDist) {
          const ux = d > 1e-6 ? dx / d : 0, uz = d > 1e-6 ? dz / d : 1;
          a.x = player.x + ux * player.minDist;
          a.z = player.z + uz * player.minDist;
        }
      }
    }
  }
}
