import "@babylonjs/loaders/glTF";
import {
  type AbstractMesh,
  type AnimationGroup,
  type AssetContainer,
  Color3,
  Color4,
  DynamicTexture,
  type GlowLayer,
  type Material,
  ParticleSystem,
  type Scene,
  SceneLoader,
  type ShadowGenerator,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { StarDewBoboModel } from "../star-dew-bobo/StarDewBoboModel.ts";
import { BoboV38RVisual } from "../star-dew-bobo-v38r/BoboV38RVisual.ts";
import { ClipMonsterVisual, ProceduralVisual, type ClipPlayer } from "../framework/visuals.ts";
import type { MonsterRegistry } from "../framework/registry.ts";
import type { ClipMap, IMonsterVisual } from "../framework/types.ts";
import type { MonsterEffect } from "../anim/types.ts";

export interface BabylonVisualContext {
  scene: Scene;
  shadows?: ShadowGenerator;
  glow?: GlowLayer;
  /** 畫質等級（影響程式化模型細分數） */
  quality?: "high" | "medium" | "low";
}

/**
 * 在註冊表中登記所有 Babylon 視覺（modelId → 建立方式）。
 * 新增怪物模型時，在這裡加一行 addVisual。
 */
export function registerBabylonVisuals(registry: MonsterRegistry, ctx: BabylonVisualContext): MonsterRegistry {
  return registry
    .addVisual("star_dew_bobo_procedural", (def) => {
      const model = new StarDewBoboModel(ctx.scene, { height: def.height ?? 0.8, shadows: ctx.shadows, glow: ctx.glow, quality: ctx.quality });
      return new ProceduralVisual(model, (x, y, z, yaw) => {
        model.root.position.set(x, y, z);
        model.root.rotation.y = yaw;
      });
    })
    // V3.8R（Stage 5 整合中）：預設不使用；以 SpawnOptions.modelId 指定時才會建立（V2 仍為預設、可隨時切回）
    .addVisual("star_dew_bobo_v38r", () => new BoboV38RVisual({ scene: ctx.scene, baseUrl: `${import.meta.env.BASE_URL}models/`, lod: ctx.quality ?? "medium" }))
    .addVisual("test_dummy_glb", (def, profile) =>
      createGltfVisual(ctx, `${import.meta.env.BASE_URL}models/test-dummy.glb`, profile.clips!, def.height ?? 0.8, 0.7),
    );
}

/**
 * 通用 GLB 怪物視覺：載入模型 → 以 AnimationGroup 播放骨骼/節點動畫。
 * 不做程式化變形；閃白與淡出透過材質處理。
 * @param modelHeight GLB 原始高度（用來縮放到 targetHeight）
 */
export function createGltfVisual(ctx: BabylonVisualContext, url: string, clips: ClipMap, targetHeight: number, modelHeight: number): IMonsterVisual {
  const scene = ctx.scene;
  const root = new TransformNode("gltfMonster", scene);
  const groups = new Map<string, AnimationGroup>();
  let container: AssetContainer | null = null;
  let meshes: AbstractMesh[] = [];
  let materials: Material[] = [];
  let lastFlash = -1;
  let lastOpacity = -1;
  let lastVisible: boolean | null = null;
  const effects = createBurstEffects(scene);

  const player: ClipPlayer = {
    play(name, loop, speed) {
      const g = groups.get(name);
      if (g) g.start(loop, speed, g.from, g.to, false);
    },
    stopAll() {
      groups.forEach((g) => g.stop());
    },
    has: (name) => groups.has(name),
  };

  return new ClipMonsterVisual(player, clips, {
    async load() {
      const slash = url.lastIndexOf("/");
      container = await SceneLoader.LoadAssetContainerAsync(url.slice(0, slash + 1), url.slice(slash + 1), scene);
      container.addAllToScene();
      const scaled = new TransformNode("gltfMonsterScaled", scene);
      scaled.parent = root;
      scaled.scaling.setAll(targetHeight / modelHeight);
      for (const m of container.meshes) {
        if (!m.parent) m.parent = scaled;
        m.isPickable = false;
        if (ctx.shadows && m.getTotalVertices() > 0) ctx.shadows.addShadowCaster(m, false);
      }
      meshes = container.meshes.filter((m) => m.getTotalVertices() > 0);
      materials = container.materials;
      for (const g of container.animationGroups) {
        g.stop();
        groups.set(g.name, g);
      }
    },
    setTransform(x, y, z, yaw) {
      root.position.set(x, y, z);
      root.rotation.y = yaw;
    },
    setMaterialState(flash, opacity, visible) {
      if (visible !== lastVisible) {
        root.setEnabled(visible);
        lastVisible = visible;
      }
      if (Math.abs(opacity - lastOpacity) > 0.005) {
        for (const m of meshes) m.visibility = opacity;
        lastOpacity = opacity;
      }
      if (Math.abs(flash - lastFlash) > 0.005) {
        for (const mat of materials) {
          const withEmissive = mat as Material & { emissiveColor?: Color3 };
          if (withEmissive.emissiveColor) withEmissive.emissiveColor.set(flash * 0.8, flash * 0.8, flash * 0.8);
        }
        lastFlash = flash;
      }
    },
    playEffect(effect) {
      effects.play(effect, root.getAbsolutePosition(), targetHeight);
    },
    dispose() {
      effects.dispose();
      container?.dispose();
      root.dispose();
    },
  });
}

/** 通用星光爆散特效（GLB 怪物用；星露啵啵有自己的特效） */
function createBurstEffects(scene: Scene): { play(e: MonsterEffect, at: Vector3, height: number): void; dispose(): void } {
  const S = 32;
  const tex = new DynamicTexture("burstTex", { width: S, height: S }, scene, false);
  const c = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  tex.hasAlpha = true;
  tex.update();
  const ps = new ParticleSystem("burst", 60, scene);
  ps.particleTexture = tex;
  ps.emitRate = 0;
  ps.minSize = 0.04;
  ps.maxSize = 0.1;
  ps.minLifeTime = 0.4;
  ps.maxLifeTime = 0.9;
  ps.color1 = new Color4(1, 0.85, 0.6, 1);
  ps.color2 = new Color4(1, 1, 1, 1);
  ps.colorDead = new Color4(1, 0.7, 0.4, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.createSphereEmitter(0.3, 1);
  ps.minEmitPower = 0.4;
  ps.maxEmitPower = 1;
  ps.gravity = new Vector3(0, 0.5, 0);
  ps.emitter = new Vector3();
  const counts: Record<MonsterEffect, number> = { attackImpact: 10, deathBurst: 40, respawnStart: 20, respawnPop: 20 };
  return {
    play(e, at, height) {
      ps.emitter = new Vector3(at.x, at.y + height * 0.5, at.z);
      ps.manualEmitCount = counts[e];
      if (!ps.isStarted()) ps.start();
    },
    dispose() {
      ps.dispose();
      tex.dispose();
    },
  };
}
