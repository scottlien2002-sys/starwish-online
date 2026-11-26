import { type AbstractMesh, type Scene, type ShadowGenerator, ReflectionProbe, RenderTargetTexture, type TransformNode, Vector3 } from "@babylonjs/core";
import { NoviceAvatar, type NoviceGender, type NoviceLod } from "../../characters/NoviceAvatar.ts";
import { PetFollower, type PetLook } from "../../pets/PetFollower.ts";

/**
 * Stage 6.5：星芽村玩家角色＝Claude A 正式初心者 C1.0-B5b＋正式寵物跟隨（PetFollower）。
 * A 的檔案唯讀複製、未修改（見 src/characters/CLAUDE_A_SOURCES.json）；這裡只是 B 的村莊端接線：
 * - 高畫質＝HQ 角色、中／低畫質＝Lite 角色
 * - 動作：待機／跑步（依實際速度）＋攻擊、受傷、死亡、復活；跳躍只保留給技能（不提供一般移動的跳躍按鈕）
 * - 角色陰影：與 A 的 Stage 7 村莊相同，預設柔和腳底陰影（&charshadow=realtime 才加入即時陰影貼圖）
 * - 金屬反射：與 A 的 Stage 7 村莊相同（天空球反射探針，只渲染一次）
 * - 寵物與角色的間距檢查（B 端保護）：寵物與頭部（球）、身體（膠囊）表面保持 2 cm 以上（沿水平方向往外推）；
 *   若 A 的跟隨平滑在快速轉身時把寵物帶進頭部，會把它推回外側並記錄次數（報告列出，回報給 A）
 */
export const NOVICE_VERSION_B65 = "c10b5b";
export const A_SOURCE_COMMIT = "1c858d10";

export type CharAction = "attack" | "hurt" | "die" | "revive" | "jump";

export interface PetPreset {
  id: string;
  label: string;
  look: PetLook | null;
}

/** 測試寵物（尚未接角色存檔；正式由 A 的寵物系統提供 species／stage） */
export const PET_PRESETS: readonly PetPreset[] = [
  { id: "bird4", label: "鳥・完成體", look: { species: "bird", stage: 4, motion: "fly" } },
  { id: "sprout2", label: "種子・幼年期", look: { species: "sprout", stage: 2, motion: "float" } },
  { id: "wisp3", label: "精靈・成長期", look: { species: "wisp", stage: 3, motion: "float" } },
  { id: "bird1", label: "鳥・初始", look: { species: "bird", stage: 1, motion: "fly" } },
  { id: "soul", label: "靈魂（鳥・完成體）", look: { species: "bird", stage: 4, motion: "fly", soul: true } },
  { id: "none", label: "不帶寵物", look: null },
];

const HEAD_R = 0.24;
const BODY_R = 0.17;
const MARGIN = 0.02;

export class VillageCharacter {
  readonly avatar: NoviceAvatar;
  readonly follower: PetFollower;
  readonly gender: NoviceGender;
  readonly lod: NoviceLod;
  readonly shadowMode: "realtime" | "blob";
  readonly loadMs: number;
  petId = "bird4";
  /** 寵物與角色的間距（m）：寵物表面到頭部／身體表面的最小距離（修正前、修正後） */
  minRawGap = Infinity;
  minGap = Infinity;
  corrections = 0;
  private pending: { attack?: boolean; hurt?: boolean; die?: boolean; revive?: boolean; jump?: boolean } = {};
  private readonly ear = new Vector3();
  private readonly head = new Vector3();
  private readonly tmp = new Vector3();

  private constructor(avatar: NoviceAvatar, follower: PetFollower, gender: NoviceGender, lod: NoviceLod, shadowMode: "realtime" | "blob", loadMs: number) {
    this.avatar = avatar;
    this.follower = follower;
    this.gender = gender;
    this.lod = lod;
    this.shadowMode = shadowMode;
    this.loadMs = loadMs;
  }

  static async create(scene: Scene, opts: { gender: NoviceGender; lod: NoviceLod; baseUrl: string; shadows: ShadowGenerator | null; shadowMode: "blob" | "realtime"; petId?: string }): Promise<VillageCharacter> {
    const t0 = performance.now();
    const avatar = await NoviceAvatar.load(scene, { gender: opts.gender, lod: opts.lod, baseUrl: opts.baseUrl, version: NOVICE_VERSION_B65 });
    // 角色陰影：預設與 A 的 Stage 7 村莊相同＝柔和腳底陰影（角色不進陰影貼圖，不必每幀重畫角色的陰影）；
    // &charshadow=realtime 才把角色加入即時陰影貼圖（對照用）
    const shadowMode = opts.shadowMode === "realtime" && opts.shadows ? "realtime" : "blob";
    avatar.setupShadow(shadowMode, scene, opts.shadows);
    const sky = scene.getMeshByName("PH_skyDome");
    if (sky) {
      const probe = new ReflectionProbe("villageCharEnv", 128, scene, true, true);
      probe.position = new Vector3(0, 0.8, 0);
      probe.renderList!.push(sky);
      probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      avatar.setMetalReflection(probe.cubeTexture);
    }
    const c = new VillageCharacter(avatar, new PetFollower(scene), opts.gender, opts.lod, shadowMode, performance.now() - t0);
    c.setPet(opts.petId ?? "bird4");
    return c;
  }

  setPet(id: string): void {
    const p = PET_PRESETS.find((x) => x.id === id) ?? PET_PRESETS[0]!;
    this.petId = p.id;
    this.follower.setLook(p.look);
    this.minRawGap = Infinity;
    this.minGap = Infinity;
    this.corrections = 0;
  }

  /** 動作測試（村莊是安全區，沒有戰鬥；這些按鈕只用來確認正式動作接上） */
  action(a: CharAction): void {
    this.pending[a] = true;
  }

  get dead(): boolean {
    return this.avatar.state === "Death";
  }

  /** 每幀：speed＝實際水平速度（m/s）；回傳離地高度（跳躍技能用） */
  update(dt: number, pos: Vector3, yaw: number, speed: number): number {
    const a = this.avatar;
    const p = this.pending;
    this.pending = {};
    const h = a.update(dt, { speed: this.dead ? 0 : speed, attack: p.attack, hurt: p.hurt, die: p.die, revive: p.revive, jump: p.jump }, pos.y);
    a.root.position.set(pos.x, pos.y + h, pos.z);
    a.root.rotation.y = yaw;
    a.earAnchor(this.ear);
    this.follower.update(dt, this.ear, yaw);
    this.keepPetClear(yaw);
    return h;
  }

  /** 寵物不貼住、不穿透角色：頭部球＋身體膠囊外保持間距（B 端保護，不修改 A 的 PetFollower） */
  private keepPetClear(yaw: number): void {
    if (!this.follower.visible) return;
    const petR = this.follower.size * 0.5;
    const pp = this.follower.position;
    // 頭部中心：頭頂錨點（頭骨起點＋0.55 m）往下 0.33 m
    this.avatar.headAnchor(this.head);
    this.head.y -= 0.33;
    const base = this.avatar.root.position;
    const shapes = (): { gap: number; dir: Vector3; need: number; center: Vector3 }[] => {
      const dh = pp.subtract(this.head);
      const by = Math.min(Math.max(pp.y, base.y + 0.1), base.y + 0.62);
      const cb = new Vector3(base.x, by, base.z);
      const db = pp.subtract(cb);
      return [
        { gap: dh.length() - HEAD_R - petR, dir: dh, need: HEAD_R + petR + MARGIN, center: this.head.clone() },
        { gap: db.length() - BODY_R - petR, dir: db, need: BODY_R + petR + MARGIN, center: cb },
      ];
    };
    const minGap = (): number => Math.min(...shapes().map((x) => x.gap));
    this.minRawGap = Math.min(this.minRawGap, minGap());
    let moved = false;
    if (minGap() < MARGIN - 1e-4) {
      // 沿「角色中心軸 → 寵物」的水平方向往外推，二分搜尋最小距離，讓頭部與身體同時保持間距（不會在脖子交界來回推）
      let hx = pp.x - base.x;
      let hz = pp.z - base.z;
      let r0 = Math.hypot(hx, hz);
      if (r0 < 1e-4) {
        hx = Math.cos(yaw);
        hz = -Math.sin(yaw);
        r0 = 0;
      } else {
        hx /= r0;
        hz /= r0;
      }
      const y = pp.y;
      const at = (r: number): void => {
        pp.set(base.x + hx * r, y, base.z + hz * r);
      };
      let lo = r0;
      let hi = r0 + 1.2;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        at(mid);
        if (minGap() >= MARGIN) hi = mid;
        else lo = mid;
      }
      at(hi);
      moved = true;
    }
    if (moved) {
      const parts = (this.follower as unknown as { parts: { root: TransformNode } | null }).parts;
      if (parts) parts.root.position.copyFrom(pp);
      this.corrections++;
    }
    this.minGap = Math.min(this.minGap, minGap());
  }

  petMeshes(): AbstractMesh[] {
    const parts = (this.follower as unknown as { parts: { root: TransformNode } | null }).parts;
    return parts ? parts.root.getChildMeshes(false) : [];
  }

  stats(): {
    model: string;
    version: string;
    source: string;
    gender: NoviceGender;
    lod: NoviceLod;
    triangles: number;
    meshes: number;
    drawMeshes: number;
    skinnedMeshes: number;
    bones: number;
    animations: string[];
    state: string;
    shadow: string;
    loadMs: number;
    pet: { id: string; label: string; size: number; triangles: number; meshes: number; minRawGapCm: number | null; minGapCm: number | null; corrections: number; model: string };
  } {
    const a = this.avatar;
    const pm = this.petMeshes().filter((m) => m.getTotalIndices() > 0);
    const preset = PET_PRESETS.find((x) => x.id === this.petId);
    const cm = (v: number): number | null => (Number.isFinite(v) ? Math.round(v * 1000) / 10 : null);
    return {
      model: a.file,
      version: `C1.0-B5b（${NOVICE_VERSION_B65}）`,
      source: `Claude A feature/render-stage7-world@${A_SOURCE_COMMIT}／art-novice-c10b5b（唯讀，未修改）`,
      gender: this.gender,
      lod: this.lod,
      triangles: a.triangles,
      meshes: a.meshes.length,
      drawMeshes: a.meshes.filter((m) => m.getTotalIndices() > 0).length,
      skinnedMeshes: a.skinnedMeshes,
      bones: a.bones,
      animations: [...a.groups.keys()],
      state: a.state,
      shadow: this.shadowMode === "realtime" ? "即時陰影（陰影貼圖）" : "柔和腳底陰影（A 預設）",
      loadMs: Math.round(this.loadMs),
      pet: {
        id: this.petId,
        label: preset?.label ?? this.petId,
        size: this.follower.size,
        triangles: Math.round(pm.reduce((s, m) => s + m.getTotalIndices() / 3, 0)),
        meshes: pm.length,
        minRawGapCm: cm(this.minRawGap),
        minGapCm: cm(this.minGap),
        corrections: this.corrections,
        model: "A 的 PetFollower 程式預留外觀（正式寵物模型尚未提供）",
      },
    };
  }
}
