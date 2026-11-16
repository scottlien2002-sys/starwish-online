import {
  Color3,
  type Engine,
  type Material,
  MaterialPluginBase,
  type MaterialDefines,
  Matrix,
  type AbstractMesh,
  type Scene,
  type SubMesh,
  type UniformBuffer,
} from "@babylonjs/core";

/**
 * 星露啵啵 V3 果凍材質（單層透明）。
 *
 * V2 用「外層＋星空內層＋星點殼」三層透明疊出內部，造成過度繪製、深度也有限。
 * V3 只有一層身體，在像素著色器內沿「折射後的視線」往身體內部取兩個深度的 3D 星雲與星點：
 * 鏡頭移動時，近層與遠層會以不同速度位移（視差），因此看起來真的「看得進去」。
 * 星雲以物件座標計算（隨模型移動、轉向，不會像貼在螢幕上）。
 *
 * 其餘：藍紫邊緣光、上淡下深的漸層、天空反射、兩個日系硬邊高光。
 * 低畫質不使用本外掛；著色器編譯失敗時由呼叫端停用（回到基本材質）。
 */
export class JellyV3Plugin extends MaterialPluginBase {
  // V3.1：更飽和的藍紫、亮青色邊緣（設定圖的水晶輪廓光）
  rim = new Color3(0.55, 0.8, 1.0);
  deep = new Color3(0.2, 0.14, 0.78);
  top = new Color3(0.3, 0.55, 1.0);
  nebulaA = new Color3(0.2, 0.85, 1.0);
  nebulaB = new Color3(0.6, 0.38, 1.0);
  skyLow = new Color3(0.95, 0.88, 0.98);
  skyHigh = new Color3(0.55, 0.78, 1.0);
  /** 模型高度（公尺，用來把世界座標換成以身高為 1 的物件座標） */
  height = 0.8;
  strength = 1;
  /** 世界 → 物件座標（每幀由模型更新） */
  readonly invWorld = Matrix.Identity();
  /** 0 = 只做邊緣光與漸層（省效能）、1 = 加上體內星雲與星點 */
  nebula = 1;
  private enabled = false;

  constructor(material: Material) {
    super(material, "JellyV3Plugin", 200, { JELLY3: false });
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
    return "JellyV3Plugin";
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines["JELLY3"] = this.enabled;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "j3Rim", size: 3, type: "vec3" },
        { name: "j3Deep", size: 3, type: "vec3" },
        { name: "j3Top", size: 3, type: "vec3" },
        { name: "j3NebA", size: 3, type: "vec3" },
        { name: "j3NebB", size: 3, type: "vec3" },
        { name: "j3SkyLow", size: 3, type: "vec3" },
        { name: "j3SkyHigh", size: 3, type: "vec3" },
        { name: "j3Params", size: 4, type: "vec4" },
        { name: "j3InvWorld", size: 16, type: "mat4" },
      ],
      fragment: `#ifdef JELLY3
uniform vec3 j3Rim;
uniform vec3 j3Deep;
uniform vec3 j3Top;
uniform vec3 j3NebA;
uniform vec3 j3NebB;
uniform vec3 j3SkyLow;
uniform vec3 j3SkyHigh;
uniform vec4 j3Params;
uniform mat4 j3InvWorld;
#endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: Engine, _subMesh: SubMesh): void {
    if (!this.enabled) return;
    uniformBuffer.updateColor3("j3Rim", this.rim);
    uniformBuffer.updateColor3("j3Deep", this.deep);
    uniformBuffer.updateColor3("j3Top", this.top);
    uniformBuffer.updateColor3("j3NebA", this.nebulaA);
    uniformBuffer.updateColor3("j3NebB", this.nebulaB);
    uniformBuffer.updateColor3("j3SkyLow", this.skyLow);
    uniformBuffer.updateColor3("j3SkyHigh", this.skyHigh);
    uniformBuffer.updateFloat4("j3Params", this.height, this.strength, this.nebula, 2.4);
    uniformBuffer.updateMatrix("j3InvWorld", this.invWorld);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: JELLY3_FUNCS,
      CUSTOM_FRAGMENT_BEFORE_FOG: JELLY3_MAIN,
    };
  }
}

/** 雜訊函式（值雜訊＋三層 fbm、星點格子） */
export const JELLY3_FUNCS = `
#ifdef JELLY3
float j3Hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float j3Noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(j3Hash(i + vec3(0, 0, 0)), j3Hash(i + vec3(1, 0, 0)), f.x),
                 mix(j3Hash(i + vec3(0, 1, 0)), j3Hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(j3Hash(i + vec3(0, 0, 1)), j3Hash(i + vec3(1, 0, 1)), f.x),
                 mix(j3Hash(i + vec3(0, 1, 1)), j3Hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float j3Fbm(vec3 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    v += a * j3Noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return v;
}
/* 星點：每個格子一顆，亮度隨距離快速衰減 */
float j3Stars(vec3 p, float density) {
  vec3 c = floor(p * density);
  vec3 f = fract(p * density) - 0.5;
  vec3 o = vec3(j3Hash(c), j3Hash(c + 7.1), j3Hash(c + 3.7)) - 0.5;
  float keep = step(0.62, j3Hash(c + 1.9));
  float d = length(f - o * 0.7);
  return keep * smoothstep(0.16, 0.0, d);
}
#endif
`;

export const JELLY3_MAIN = `
#ifdef JELLY3
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j3Params.w);
  float jS = j3Params.y;

  // 物件座標（以身高為 1）：星雲跟著模型走
  vec3 lp = (j3InvWorld * vec4(vPositionW, 1.0)).xyz / j3Params.x;
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 body = mix(j3Deep, j3Top, smoothstep(0.05, 0.95, h));
  // V3.1：以藍紫本色為主（壓低受光造成的發白），邊緣更深、更透
  color.rgb = mix(color.rgb, color.rgb * 0.35 + body * 0.7, jS * (0.55 + 0.3 * (1.0 - jNdV)));

  if (j3Params.z > 0.5) {
    // 沿折射後視線往內取兩個深度（視差 → 內部深度）
    vec3 rdW = refract(-jV, jN, 0.75);
    vec3 rd = normalize((j3InvWorld * vec4(rdW, 0.0)).xyz);
    vec3 p1 = lp + rd * 0.12;
    vec3 p2 = lp + rd * 0.34;
    float low1 = 1.0 - smoothstep(0.15, 0.75, p1.y);
    float low2 = 1.0 - smoothstep(0.1, 0.7, p2.y);
    float n1 = smoothstep(0.4, 0.82, j3Fbm(p1 * 3.2 + vec3(0.0, 1.3, 0.0)));
    float n2 = smoothstep(0.36, 0.78, j3Fbm(p2 * 2.3 + vec3(4.1, 0.0, 2.2)));
    vec3 neb = j3NebA * n1 * (0.35 + 0.65 * low1) * 0.7 + j3NebB * n2 * (0.3 + 0.7 * low2) * 0.6;
    // 細碎星光：近層細密、遠層較大（三種密度）
    float st = j3Stars(p1, 16.0) * 0.8 + j3Stars(p1 + 1.7, 9.0) * 0.9 + j3Stars(p2 + 3.3, 6.0) * 0.6;
    // 底部光池（設定圖：底部中央青色發亮）
    float pool = smoothstep(0.45, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.0, 0.35, p2.y));
    vec3 inner = neb + vec3(0.85, 0.95, 1.0) * st + j3NebA * pool * 0.85;
    // 正面看進去最多、邊緣少（邊緣是表面反光）
    color.rgb += inner * 1.6 * jS * (0.35 + 0.65 * jNdV);
    color.a = clamp(color.a + (st * 0.35 + n1 * 0.12) * jS * jNdV, 0.0, 1.0);
  }

  // 天空反射＋藍紫邊緣光
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j3SkyLow, j3SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.12 * jS;
  color.rgb += j3Rim * jFres * 0.95 * jS;
  color.a = clamp(color.a + jFres * 0.32 * jS, 0.0, 1.0);

  // 日系硬邊高光：正面看左上大、右上小（世界方向）
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float jHL = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV))) * 0.85 + smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV))) * 0.6;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL * jS, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9 * jS);
}
#endif
`;
