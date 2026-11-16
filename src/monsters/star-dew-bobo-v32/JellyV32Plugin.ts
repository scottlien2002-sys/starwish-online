import {
  type AbstractMesh,
  type BaseTexture,
  Color3,
  Constants,
  type Engine,
  type Material,
  type MaterialDefines,
  MaterialPluginBase,
  Matrix,
  RawTexture,
  type Scene,
  type SubMesh,
  Texture,
  type UniformBuffer,
  Vector3,
} from "@babylonjs/core";

/**
 * 星露啵啵 V3.1 果凍材質（單層透明，取代 V3 的 JellyV3Plugin；V3 保持不變供對照）。
 *
 * 與 V3 的差別：
 * - 星雲改用「預先算好的雜訊貼圖」（啟動時以程式產生 256×256，不需額外下載），
 *   每層只取 2 次貼圖，取代 V3 每個像素即時計算的 3D 雜訊（較省效能，層次反而更多）。
 * - 中央較深的藍紫（厚度感）→ 邊緣較亮、較透的水晶輪廓光。
 * - 腹部星星直接在果凍著色器裡畫：沿折射後的視線找到身體內部的星星平面，
 *   所以星星真的「在果凍裡」，表面的高光與邊緣光蓋在它上面；不需要額外的模型或繪製次數。
 * - 翅膀區域：更透、更亮的果凍薄翼，根部到尖端有漸層。
 * - 低畫質：關閉內部星雲（nebula = 0），但腹部星星、漸層、邊緣光仍保留。
 */
export class JellyV32Plugin extends MaterialPluginBase {
  rim = new Color3(0.62, 0.85, 1.0);
  core = new Color3(0.16, 0.12, 0.62); // 中央深處
  shell = new Color3(0.36, 0.5, 1.0); // 外層
  top = new Color3(0.5, 0.66, 1.0);
  nebulaA = new Color3(0.25, 0.75, 1.0); // 青藍星雲
  nebulaB = new Color3(0.62, 0.36, 1.0); // 紫色星雲
  wing = new Color3(0.56, 0.66, 1.0);
  skyLow = new Color3(0.95, 0.88, 0.98);
  skyHigh = new Color3(0.55, 0.78, 1.0);
  /**
   * 腹部星星（物件座標，Blender 尺寸、glTF→Babylon 座標）。
   * 位置取自 Blender 建模輸出 bobo_v31_info.json 的 belly_star_babylon（身體表面往內 0.045）
   */
  // 高度比建模位置略高（設定圖：星星在嘴下方、身體下半部中央；從上往下看時折射會讓它偏低）
  // V3.2：尺寸為 V3.1 的 75%、位置略上移、水平正中央
  starCenter = new Vector3(0, 0.248, 0.545);
  // V3.2：星星平面較正對前方（V3.1 跟著腹部曲面往下傾，從正面看被壓扁）
  starNormal = new Vector3(0, -0.22, 0.975).normalize();
  starOuter = 0.084;
  starInner = 0.042;
  height = 1;
  strength = 1;
  nebula = 1;
  readonly invWorld = Matrix.Identity();
  private enabled = false;
  private readonly noise: BaseTexture;

  constructor(material: Material, noise: BaseTexture) {
    super(material, "JellyV32Plugin", 200, { JELLY32: false });
    this.noise = noise;
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
    return "JellyV32Plugin";
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines["JELLY32"] = this.enabled;
  }

  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: Engine, _subMesh: SubMesh): boolean {
    return !this.enabled || this.noise.isReady();
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("j32Noise");
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    activeTextures.push(this.noise);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.noise;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "j32Rim", size: 3, type: "vec3" },
        { name: "j32Core", size: 3, type: "vec3" },
        { name: "j32Shell", size: 3, type: "vec3" },
        { name: "j32Top", size: 3, type: "vec3" },
        { name: "j32NebA", size: 3, type: "vec3" },
        { name: "j32NebB", size: 3, type: "vec3" },
        { name: "j32Wing", size: 3, type: "vec3" },
        { name: "j32SkyLow", size: 3, type: "vec3" },
        { name: "j32SkyHigh", size: 3, type: "vec3" },
        { name: "j32StarC", size: 3, type: "vec3" },
        { name: "j32StarN", size: 3, type: "vec3" },
        { name: "j32Params", size: 4, type: "vec4" },
        { name: "j32Star", size: 4, type: "vec4" },
        { name: "j32InvWorld", size: 16, type: "mat4" },
      ],
      fragment: `#ifdef JELLY32
uniform vec3 j32Rim;
uniform vec3 j32Core;
uniform vec3 j32Shell;
uniform vec3 j32Top;
uniform vec3 j32NebA;
uniform vec3 j32NebB;
uniform vec3 j32Wing;
uniform vec3 j32SkyLow;
uniform vec3 j32SkyHigh;
uniform vec3 j32StarC;
uniform vec3 j32StarN;
uniform vec4 j32Params;
uniform vec4 j32Star;
uniform mat4 j32InvWorld;
#endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: Engine, _subMesh: SubMesh): void {
    if (!this.enabled) return;
    uniformBuffer.updateColor3("j32Rim", this.rim);
    uniformBuffer.updateColor3("j32Core", this.core);
    uniformBuffer.updateColor3("j32Shell", this.shell);
    uniformBuffer.updateColor3("j32Top", this.top);
    uniformBuffer.updateColor3("j32NebA", this.nebulaA);
    uniformBuffer.updateColor3("j32NebB", this.nebulaB);
    uniformBuffer.updateColor3("j32Wing", this.wing);
    uniformBuffer.updateColor3("j32SkyLow", this.skyLow);
    uniformBuffer.updateColor3("j32SkyHigh", this.skyHigh);
    uniformBuffer.updateVector3("j32StarC", this.starCenter);
    uniformBuffer.updateVector3("j32StarN", this.starNormal);
    uniformBuffer.updateFloat4("j32Params", this.height, this.strength, this.nebula, 2.2);
    uniformBuffer.updateFloat4("j32Star", this.starOuter, this.starInner, 1.25, 0);
    uniformBuffer.updateMatrix("j32InvWorld", this.invWorld);
    uniformBuffer.setTexture("j32Noise", this.noise);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: JELLY32_FUNCS,
      CUSTOM_FRAGMENT_BEFORE_FOG: JELLY32_MAIN,
    };
  }
}

/**
 * 產生可平鋪的雜訊貼圖（256×256 RGBA，啟動時計算一次，約數十毫秒）：
 * R = 大塊星雲、G = 細一點的星雲（不同種子）、B = 稀疏星點、A = 細微星塵
 */
export function createJellyNoiseTextureV32(scene: Scene, size = 256): RawTexture {
  const data = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number, seed: number): number => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
  // 週期性值雜訊（格子數 period 必須整除 size → 可無縫平鋪）
  const vnoise = (x: number, y: number, period: number, seed: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (i: number, j: number): number => hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
    const a = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * sx;
    const b = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
  const fbm = (u: number, v: number, base: number, seed: number, oct: number): number => {
    let s = 0;
    let amp = 0.55;
    let norm = 0;
    let p = base;
    for (let o = 0; o < oct; o++) {
      s += amp * vnoise(u * p, v * p, p, seed + o * 17);
      norm += amp;
      amp *= 0.5;
      p *= 2;
    }
    return s / norm;
  };
  // 星點：每格最多一顆，位置隨機、亮度隨機，邊緣柔和（可平鋪）
  const starCells = 22;
  const stars = new Float32Array(size * size);
  for (let cy = 0; cy < starCells; cy++) {
    for (let cx = 0; cx < starCells; cx++) {
      if (hash(cx, cy, 91) > 0.55) continue;
      const px = ((cx + 0.15 + 0.7 * hash(cx, cy, 92)) / starCells) * size;
      const py = ((cy + 0.15 + 0.7 * hash(cx, cy, 93)) / starCells) * size;
      const bright = 0.45 + 0.55 * hash(cx, cy, 94);
      const rad = 1.1 + 1.6 * hash(cx, cy, 95);
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = (Math.round(px) + dx + size) % size;
          const y = (Math.round(py) + dy + size) % size;
          const d = Math.hypot(Math.round(px) + dx - px, Math.round(py) + dy - py);
          const v = bright * Math.exp(-(d * d) / (rad * rad));
          if (v > stars[y * size + x]!) stars[y * size + x] = v;
        }
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      data[i] = Math.round(fbm(u, v, 4, 1, 4) * 255);
      data[i + 1] = Math.round(fbm(u, v, 8, 7, 3) * 255);
      data[i + 2] = Math.round(Math.min(1, stars[y * size + x]!) * 255);
      data[i + 3] = Math.round(fbm(u, v, 32, 3, 2) * 255);
    }
  }
  const tex = new RawTexture(data, size, size, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.name = "BoboV32_Noise";
  return tex;
}

export const JELLY32_FUNCS = `
#ifdef JELLY32
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j32Noise;
/* 雙平面投影取樣（物件座標的 xy 與 zy 平面混合）：便宜的 3D 星雲 */
vec4 j32Tex(vec3 p, vec3 n) {
  vec4 a = texture2D(j32Noise, p.xy);
  vec4 b = texture2D(j32Noise, p.zy + vec2(0.37, 0.61));
  float w = clamp(abs(n.x) * 1.4 - 0.2, 0.0, 1.0);
  return mix(a, b, w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j32StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`;

export const JELLY32_MAIN = `
#ifdef JELLY32
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j32Params.w);
  float jS = j32Params.y;
  vec3 lp = (j32InvWorld * vec4(vPositionW, 1.0)).xyz / j32Params.x;
  vec3 lnrm = normalize((j32InvWorld * vec4(jN, 0.0)).xyz);
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j32InvWorld * vec4(rdW, 0.0)).xyz);

  // 翅膀區域（身體半寬約 0.62，翅膀在外側）
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.22, 0.0, 1.0);

  // 本色：中央（正對鏡頭、最厚）較深的藍紫 → 外層亮藍 → 上方偏淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j32Shell, j32Top, smoothstep(0.35, 1.0, h));
  vec3 base = mix(shell, j32Core, smoothstep(0.25, 0.95, jNdV) * 0.55);
  base = mix(base, j32Wing * (0.85 + 0.25 * jWingT), jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.25 + base * 0.8, jS * 0.85);
  // 翅膀更透
  color.a = mix(color.a, color.a * 0.82, jWing);

  if (j32Params.z > 0.5) {
    // 兩層深度（視差）：近層 0.1、遠層 0.3
    vec3 p1 = lp + rd * 0.1;
    vec3 p2 = lp + rd * 0.3;
    vec4 t1 = j32Tex(p1 * 0.9, lnrm);
    vec4 t2 = j32Tex(p2 * 0.55 + 0.21, lnrm);
    float n1 = smoothstep(0.42, 0.78, t1.r);
    float n2 = smoothstep(0.38, 0.72, t2.g);
    float low = 1.0 - smoothstep(0.1, 0.8, p2.y);
    vec3 neb = j32NebA * n1 * 0.55 + j32NebB * n2 * (0.35 + 0.45 * low);
    // 星光：近層細小、遠層較大較暗；星塵讓星雲有顆粒感
    float st = pow(t1.b, 1.5) * 1.3 + pow(t2.b, 2.0) * 0.6;
    float dust = smoothstep(0.62, 0.9, t1.a) * 0.25;
    // 柔和內部發光（中下方）
    float glow = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.0, 0.5, p2.y));
    vec3 inner = neb + vec3(0.88, 0.96, 1.0) * (st + dust) + j32NebA * glow * 0.45;
    // 翅膀與細觸角上的星雲淡一點（太細的地方星點會變成雜訊）
    float into = (0.3 + 0.7 * jNdV) * (1.0 - 0.7 * jWing) * (1.0 - 0.75 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.25 * jS * into;
    color.a = clamp(color.a + (st * 0.4 + n2 * 0.1) * jS * jNdV, 0.0, 1.0);
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j32StarC;
    vec3 n = j32StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j32StarDist(uv, j32Star.x, j32Star.y, j32Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j32Star.x * 0.9, length(uv));
      // V3.2：柔和金黃（邊緣暖金 → 中央奶油金），不偏橘
      vec3 gold = mix(vec3(1.0, 0.76, 0.2), vec3(1.0, 0.9, 0.5), core);
      // 輪廓內側一圈略深的暖金：五角星邊界清楚
      gold *= mix(0.84, 1.0, smoothstep(0.0, -0.012, d));
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j32Star.x + 0.5, 0.0, 1.0);
      // 光暈兩層：貼著輪廓的細緻亮邊＋往外暈開的柔光（在果凍內部擴散的感覺）
      float dd = max(d, 0.0);
      float halo = (exp(-dd / 0.01) * 0.5 + exp(-dd / 0.045) * 0.26) * (1.0 - fill) * face;
      // 星星隔著一層果凍：保留一點果凍本色，內部星光仍疊在上面
      color.rgb = mix(color.rgb, gold * vec3(0.96, 0.96, 1.0), fill * 0.92);
      color.rgb += vec3(1.0, 0.78, 0.3) * halo * 0.55;
      color.a = max(color.a, fill * 0.94);
      color.a = clamp(color.a + halo * 0.14, 0.0, 1.0);
    }
  }

  // 表面：天空反射、水晶邊緣透光（邊緣亮而透）
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j32SkyLow, j32SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.18 * jS;
  color.rgb += j32Rim * jFres * (0.85 + 0.4 * jWing) * jS;
  color.a = clamp(color.a + jFres * 0.28 * jS, 0.0, 1.0);

  // 高光：一片柔和大光澤＋兩個日系硬邊高光
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float soft = pow(clamp(dot(jN, normalize(jL1 + jV)), 0.0, 1.0), 40.0) * 0.22;
  float jHL = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV))) * 0.85 + smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV))) * 0.6;
  color.rgb += vec3(0.9, 0.95, 1.0) * soft * jS;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL * jS, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9 * jS);
}
#endif
`;
