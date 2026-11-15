import {
  Color3,
  type Engine,
  type Material,
  MaterialPluginBase,
  type MaterialDefines,
  type AbstractMesh,
  type Scene,
  type SubMesh,
  type UniformBuffer,
} from "@babylonjs/core";

/**
 * 星露啵啵 V2 果凍材質外掛（掛在 StandardMaterial 上，於 CUSTOM_FRAGMENT_BEFORE_FOG 注入）：
 * - 藍紫色 Fresnel 邊緣光（輪廓較實、較亮）
 * - 依高度的內部深度漸層（底部深藍紫、上方青藍），正面中央透出內部光
 * - 假折射：以 refract() 方向估算光線在體內走的路徑長，讓下緣與厚處較濃
 * - 天空漸層反射（只在邊緣）
 * - 兩個日系動畫風格的硬邊高光點
 * 低畫質不啟用；若著色器編譯失敗，模型會自動停用本外掛（回到 V1.2 材質）。
 */
export class JellyMaterialPlugin extends MaterialPluginBase {
  /** 邊緣光顏色（藍紫） */
  rim = new Color3(0.55, 0.5, 1.0);
  /** 下方內部顏色（深藍紫） */
  deep = new Color3(0.24, 0.18, 0.82);
  /** 上方內部顏色（青藍） */
  top = new Color3(0.32, 0.78, 1.0);
  /** 天空反射顏色：低處／高處 */
  skyLow = new Color3(0.95, 0.88, 0.98);
  skyHigh = new Color3(0.55, 0.78, 1.0);
  /** 模型底部世界 y 與高度（每幀由模型更新） */
  baseY = 0;
  height = 0.8;
  /** 整體強度 0..1 */
  strength = 1;
  private enabled = false;

  constructor(material: Material) {
    super(material, "JellyMaterialPlugin", 200, { JELLY: false });
    this._enable(true);
    this.enabled = true;
  }

  get jellyEnabled(): boolean {
    return this.enabled;
  }

  set jellyEnabled(v: boolean) {
    if (this.enabled === v) return;
    this.enabled = v;
    this.markAllDefinesAsDirty();
  }

  override getClassName(): string {
    return "JellyMaterialPlugin";
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines["JELLY"] = this.enabled;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "jellyRim", size: 3, type: "vec3" },
        { name: "jellyDeep", size: 3, type: "vec3" },
        { name: "jellyTop", size: 3, type: "vec3" },
        { name: "jellySkyLow", size: 3, type: "vec3" },
        { name: "jellySkyHigh", size: 3, type: "vec3" },
        { name: "jellyParams", size: 4, type: "vec4" },
      ],
      fragment: `#ifdef JELLY
uniform vec3 jellyRim;
uniform vec3 jellyDeep;
uniform vec3 jellyTop;
uniform vec3 jellySkyLow;
uniform vec3 jellySkyHigh;
uniform vec4 jellyParams;
#endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: Engine, _subMesh: SubMesh): void {
    if (!this.enabled) return;
    uniformBuffer.updateColor3("jellyRim", this.rim);
    uniformBuffer.updateColor3("jellyDeep", this.deep);
    uniformBuffer.updateColor3("jellyTop", this.top);
    uniformBuffer.updateColor3("jellySkyLow", this.skyLow);
    uniformBuffer.updateColor3("jellySkyHigh", this.skyHigh);
    uniformBuffer.updateFloat4("jellyParams", this.baseY, this.height, 2.4, this.strength);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: JELLY_GLSL,
    };
  }
}

/** 注入片段（GLSL；WebGL2 與 WebGL1 皆相容的語法） */
export const JELLY_GLSL = `
#ifdef JELLY
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, jellyParams.z);
  float jH = clamp((vPositionW.y - jellyParams.x) / max(0.001, jellyParams.y), 0.0, 1.0);
  float jS = jellyParams.w;

  // 內部深度：依高度由深藍紫漸變到青藍；正面中央（視線穿過最厚處）透出最多
  vec3 jInner = mix(jellyDeep, jellyTop, smoothstep(0.05, 0.95, jH));
  // 假折射：折射方向越往下，光在體內走得越遠 → 顏色越濃（下緣較深、上方較清透）
  vec3 jT = refract(-jV, jN, 0.75);
  float jPath = clamp(0.55 - jT.y * 0.6, 0.0, 1.0);
  vec3 jBody = mix(jInner, jellyDeep, jPath * 0.35);
  color.rgb = mix(color.rgb, color.rgb * 0.6 + jBody * 0.5, jS * (0.25 + 0.3 * jNdV));

  // 天空漸層反射（只在輪廓附近）
  vec3 jR = reflect(-jV, jN);
  vec3 jSky = mix(jellySkyLow, jellySkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0));
  color.rgb += jSky * jFres * 0.22 * jS;

  // 藍紫邊緣光：輪廓較亮、較不透明
  color.rgb += jellyRim * jFres * 0.75 * jS;
  color.a = clamp(color.a + jFres * 0.3 * jS, 0.0, 1.0);

  // 日系硬邊高光：主高光（正面看左上，較大）＋ 副高光（右上小點）。
  // 怪物面向 +z、正面看時 +x 在畫面左側，所以「畫面左上」是 +x。
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float jHL1 = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV)));
  float jHL2 = smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV)));
  float jHL = (jHL1 * 0.85 + jHL2 * 0.6) * jS;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9);
}
#endif
`;
