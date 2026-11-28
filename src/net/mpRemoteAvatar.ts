/**
 * Stage 8.4：其他玩家的模型（Claude C Combat VFX Stage 3 的合併渲染＋遠距離 LOD）。
 *
 * - 模型：`novice_c10b5b_{male,female}_remote.glb`（C1.0-B5b Lite 合併為 2 個網格；遠距離版頭髮減面）→ 每人 2 個 draw call
 *   ＋簡化武器 1 個＋腳下陰影 1 個（共用材質）。外觀與 Lite 相同（C 交付時已驗證），沒有重新製作角色。
 * - 遠近切換：鏡頭距離 14 m（1 m 遲滯），只換畫面；伺服器、同步、戰鬥結果完全不受影響。
 * - 髮色：合併模型的頭髮是頂點色，用 tools/mp-remote-hairmask.py 產生的頭髮頂點區間，把那些頂點的顏色乘上髮色
 *   （與 Lite 髮型材質 albedoColor 相乘的效果相同）。
 * - 遠距離（> 45 m）：整個角色不繪製、動畫暫停（名牌也不顯示）；回到範圍內恢復。
 * - 技能：可以播 Claude C 的技能動作片段（由伺服器的施放事件驅動時間），一般移動只用 Idle／Run／Attack／Hurt／Death。
 * 介面與 NoviceAvatar.update() 相同，MpWorld 可以用 `&remote=lite` 回到 Stage 8.2 的 Lite 模型（回退）。
 */
import { Color3, Mesh, VertexBuffer, type AbstractMesh, type Scene } from "@babylonjs/core";
import { CombatAvatar } from "../combat-vfx/CombatAvatar.ts";

export interface RemoteAnimInput {
  speed: number;
  attack: boolean;
  hurt: boolean;
  die: boolean;
  revive: boolean;
}

export const REMOTE_LOD = Object.freeze({ farM: 14, nearM: 13, cullM: 45, cullBackM: 43 });

const hairCache = new Map<string, Promise<Record<string, [number, number][]> | null>>();
function hairRanges(baseUrl: string, g: "male" | "female"): Promise<Record<string, [number, number][]> | null> {
  let p = hairCache.get(g);
  if (!p) {
    p = fetch(`${baseUrl}models/novice_c10b5b_${g}_remote_hair.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, [number, number][]>>) : null))
      .catch(() => null);
    hairCache.set(g, p);
  }
  return p;
}

export class RemoteCombatAvatar {
  readonly av: CombatAvatar;
  readonly file: string;
  readonly hasDeathClip = true;
  hairTinted = 0;
  culled = false;
  private lock = 0;
  private dead = false;
  private skill = false;

  private constructor(av: CombatAvatar, file: string) {
    this.av = av;
    this.file = file;
  }

  static async load(scene: Scene, baseUrl: string, gender: "male" | "female", ap: { hairColor: string | null; weapon: "sword" | "staff" }): Promise<RemoteCombatAvatar> {
    const av = await CombatAvatar.create(scene, baseUrl, gender, "remote");
    const r = new RemoteCombatAvatar(av, `novice_c10b5b_${gender}_remote.glb`);
    av.setWeapon(ap.weapon);
    if (ap.hairColor && /^#[0-9a-f]{6}$/i.test(ap.hairColor)) r.hairTinted = await r.tintHair(baseUrl, gender, Color3.FromHexString(ap.hairColor));
    return r;
  }

  get root() {
    return this.av.root;
  }
  get state(): string {
    return this.skill ? "Skill" : this.av.baseState || "Idle";
  }
  get far(): boolean {
    return this.av.far;
  }
  get triangles(): number {
    return this.av.triangles;
  }
  meshes(): AbstractMesh[] {
    return this.av.root.getChildMeshes(false);
  }

  /** 只改這個角色自己的頂點色（先把共用的幾何資料複製一份） */
  private async tintHair(baseUrl: string, g: "male" | "female", c: Color3): Promise<number> {
    const ranges = await hairRanges(baseUrl, g);
    if (!ranges) return 0;
    let n = 0;
    for (const m of this.av.meshes) {
      const nm = m.name.split("#")[0] ?? m.name;
      const rs = ranges[nm];
      if (!rs || !(m instanceof Mesh)) continue;
      m.makeGeometryUnique();
      const col = m.getVerticesData(VertexBuffer.ColorKind);
      if (!col) continue;
      const stride = col.length / m.getTotalVertices();
      for (const [a, b] of rs) {
        for (let i = a; i < b; i++) {
          col[i * stride] = col[i * stride]! * c.r;
          col[i * stride + 1] = col[i * stride + 1]! * c.g;
          col[i * stride + 2] = col[i * stride + 2]! * c.b;
        }
        n += b - a;
      }
      m.setVerticesData(VertexBuffer.ColorKind, col, false, stride);
    }
    return n;
  }

  /** 與 NoviceAvatar.update 相同的輸入；回傳腳底高度偏移（合併模型為 0） */
  update(dt: number, i: RemoteAnimInput, _groundY: number): number {
    const av = this.av;
    if (this.culled) return 0;
    if (i.die && !this.dead) {
      this.dead = true;
      this.skill = false;
      av.play("Death", false, 0.1);
    } else if (i.revive && this.dead) {
      this.dead = false;
      av.play("Idle", true, 0.15);
    }
    this.lock = Math.max(0, this.lock - dt);
    if (!this.dead && !this.skill) {
      if (i.attack) {
        av.play("Attack", false, 0.06);
        this.lock = 0.5;
      } else if (i.hurt && this.lock <= 0 && i.speed < 0.3) {
        av.play("Hurt", false, 0.06);
        this.lock = 0.4;
      } else if (this.lock <= 0) {
        if (i.speed > 0.3) av.play("Run", true, 0.15, Math.max(0.7, Math.min(1.4, i.speed / 5)));
        else av.play("Idle", true, 0.2);
      }
    }
    av.yaw = av.root.rotation.y;
    av.update(dt);
    return 0;
  }

  /** 伺服器施放事件驅動的技能動作（t＝技能時間軸秒數）。片段不存在時回傳 false（改播普通攻擊） */
  skillTime(clip: string, t: number): boolean {
    if (this.dead || this.culled) return false;
    if (!this.skill) {
      if (!this.av.startSkill(clip)) return false;
      this.skill = true;
    }
    this.av.setSkillTime(t);
    return true;
  }

  skillEnd(): void {
    if (!this.skill) return;
    this.skill = false;
    this.lock = 0;
    this.av.play("Idle", true, 0.15);
  }

  /** 鏡頭距離 → 遠近版與遠距離停畫（只影響畫面） */
  setCameraDistance(d: number): void {
    const av = this.av;
    if (!av.far && d > REMOTE_LOD.farM) av.setFar(true);
    else if (av.far && d < REMOTE_LOD.nearM) av.setFar(false);
    const cull = this.culled ? d > REMOTE_LOD.cullBackM : d > REMOTE_LOD.cullM;
    if (cull !== this.culled) {
      this.culled = cull;
      av.root.setEnabled(!cull);
      av.freeze(cull);
    }
  }

  dispose(): void {
    this.av.dispose();
  }
}
