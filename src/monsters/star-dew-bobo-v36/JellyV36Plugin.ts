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
 * 星露啵啵 V3.6 果凍材質（V3.5 的 JellyV35Plugin 保持不變，本檔為獨立版本）。
 *
 * 依設定圖重新分配顏色（V3.5 整體偏不透明的藍紫色）：
 * - 外層／邊緣：深藍、較透明；最外緣細亮的水晶反光
 * - 中央：柔和的青藍色（設定圖身體中間是亮的，不是深色）
 * - 下半部：明顯但不刺眼的亮青色內部光＋底部內側一圈折射亮帶
 * - 三層星雲：近層細小清楚的星光（較稀疏）、中層青藍星雲＋細光點、遠層較暗的紫藍星雲
 * - 羽翼：淡藍 → 淺水藍漸層、半透明、外緣柔和白色高光、細的水晶光澤
 * 取樣次數與 V3.5 相同（多數像素每層 1 次）；不使用全畫面特效。
 */
export class JellyV36Plugin extends MaterialPluginBase {
  rim = new Color3(0.78, 0.95, 1.0); // 最外緣水晶反光（青白）
  core = new Color3(0.3, 0.6, 1.0); // 中央：柔和青藍
  shell = new Color3(0.08, 0.2, 0.82); // 外層／邊緣：深藍
  top = new Color3(0.2, 0.42, 0.98);
  nebulaA = new Color3(0.3, 0.9, 1.0); // 亮青（下半部內部光、中層星雲）
  nebulaB = new Color3(0.42, 0.3, 0.95); // 遠層：較暗的紫藍
  wing = new Color3(0.5, 0.72, 1.0); // 羽翼根部：淡藍
  wingTip = new Color3(0.74, 0.96, 1.0); // 羽翼尖端：淺水藍
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
    super(material, "JellyV36Plugin", 200, { JELLY36: false });
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
    return "JellyV36Plugin";
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines["JELLY36"] = this.enabled;
  }

  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: Engine, _subMesh: SubMesh): boolean {
    return !this.enabled || this.noise.isReady();
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("j36Noise");
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
        { name: "j36Rim", size: 3, type: "vec3" },
        { name: "j36Core", size: 3, type: "vec3" },
        { name: "j36Shell", size: 3, type: "vec3" },
        { name: "j36Top", size: 3, type: "vec3" },
        { name: "j36NebA", size: 3, type: "vec3" },
        { name: "j36NebB", size: 3, type: "vec3" },
        { name: "j36Wing", size: 3, type: "vec3" },
        { name: "j36WingTip", size: 3, type: "vec3" },
        { name: "j36SkyLow", size: 3, type: "vec3" },
        { name: "j36SkyHigh", size: 3, type: "vec3" },
        { name: "j36StarC", size: 3, type: "vec3" },
        { name: "j36StarN", size: 3, type: "vec3" },
        { name: "j36Params", size: 4, type: "vec4" },
        { name: "j36Star", size: 4, type: "vec4" },
        { name: "j36InvWorld", size: 16, type: "mat4" },
      ],
      fragment: `#ifdef JELLY36
uniform vec3 j36Rim;
uniform vec3 j36Core;
uniform vec3 j36Shell;
uniform vec3 j36Top;
uniform vec3 j36NebA;
uniform vec3 j36NebB;
uniform vec3 j36Wing;
uniform vec3 j36WingTip;
uniform vec3 j36SkyLow;
uniform vec3 j36SkyHigh;
uniform vec3 j36StarC;
uniform vec3 j36StarN;
uniform vec4 j36Params;
uniform vec4 j36Star;
uniform mat4 j36InvWorld;
#endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: Engine, _subMesh: SubMesh): void {
    if (!this.enabled) return;
    uniformBuffer.updateColor3("j36Rim", this.rim);
    uniformBuffer.updateColor3("j36Core", this.core);
    uniformBuffer.updateColor3("j36Shell", this.shell);
    uniformBuffer.updateColor3("j36Top", this.top);
    uniformBuffer.updateColor3("j36NebA", this.nebulaA);
    uniformBuffer.updateColor3("j36NebB", this.nebulaB);
    uniformBuffer.updateColor3("j36Wing", this.wing);
    uniformBuffer.updateColor3("j36WingTip", this.wingTip);
    uniformBuffer.updateColor3("j36SkyLow", this.skyLow);
    uniformBuffer.updateColor3("j36SkyHigh", this.skyHigh);
    uniformBuffer.updateVector3("j36StarC", this.starCenter);
    uniformBuffer.updateVector3("j36StarN", this.starNormal);
    uniformBuffer.updateFloat4("j36Params", this.height, this.strength, this.nebula, 2.2);
    uniformBuffer.updateFloat4("j36Star", this.starOuter, this.starInner, 1.25, 0);
    uniformBuffer.updateMatrix("j36InvWorld", this.invWorld);
    uniformBuffer.setTexture("j36Noise", this.noise);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: JELLY36_FUNCS,
      CUSTOM_FRAGMENT_BEFORE_FOG: JELLY36_MAIN,
    };
  }
}

/**
 * 產生可平鋪的雜訊貼圖（256×256 RGBA，啟動時計算一次，約數十毫秒）：
 * R = 大塊星雲、G = 細一點的星雲（不同種子）、B = 稀疏星點、A = 細微星塵
 */
export function createJellyNoiseTextureV36(scene: Scene, size = 256): RawTexture {
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
  tex.name = "BoboV36_Noise";
  return tex;
}

export const JELLY36_FUNCS = `
#ifdef JELLY36
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j36Noise;
/*
 * 雙平面取樣（物件座標的 xy 面與 zy 面），依「視線在物件內的方向」混合：
 * 正面看用 xy、側面看用 zy，圖樣不會被拉長成條紋。只有在兩面交界的視角才需要取 2 次，
 * 其他時候只取 1 次（同一區域的像素走同一條分支，手機 GPU 上很便宜）。
 */
vec4 j36Tex(vec3 p, float w, float bias) {
  if (w < 0.01) return texture2D(j36Noise, p.xy, bias);
  if (w > 0.99) return texture2D(j36Noise, p.zy + vec2(0.37, 0.61), bias);
  return mix(texture2D(j36Noise, p.xy, bias), texture2D(j36Noise, p.zy + vec2(0.37, 0.61), bias), w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j36StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`;

export const JELLY36_MAIN = `
#ifdef JELLY36
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j36Params.w);
  float jS = j36Params.y;
  vec3 lp = (j36InvWorld * vec4(vPositionW, 1.0)).xyz / j36Params.x;
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j36InvWorld * vec4(rdW, 0.0)).xyz);

  // 羽翼區域（身體半寬約 0.62，羽翼在外側）；jWingT：根部 0 → 尖端 1
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.3, 0.0, 1.0);

  // 本色：邊緣深藍 → 中央柔和青藍（設定圖中間亮、邊緣深）；頂部略淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j36Shell, j36Top, smoothstep(0.45, 1.0, h) * 0.6);
  vec3 base = mix(shell, j36Core, smoothstep(0.15, 0.9, jNdV) * 0.85);
  vec3 wingCol = mix(j36Wing, j36WingTip, smoothstep(0.0, 1.0, jWingT));
  base = mix(base, wingCol, jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.1 + base * 0.88, jS * 0.94);
  // 透明度：中央 0.8（看不到背後地平線，但仍有透明感）；邊緣更透；羽翼根部 0.75 → 尖端 0.5
  float jThick = smoothstep(0.35, 0.95, jNdV) * (1.0 - jWing);
  color.a = mix(color.a, max(color.a, 0.8), jThick * jS);
  color.a = mix(color.a, color.a * 0.8, (1.0 - jNdV) * (1.0 - jWing) * jS);
  color.a = mix(color.a, mix(0.75, 0.5, jWingT), jWing * jS);

  if (j36Params.z > 0.5) {
    // 三層深度（視差）：近層細小清楚的星光、中層青藍星雲＋細光點、遠層較暗的紫藍星雲
    vec3 p1 = lp + rd * 0.05;
    vec3 p2 = lp + rd * 0.22;
    vec3 p3 = lp + rd * 0.44;
    float bw = smoothstep(0.45, 0.75, abs(rd.x));
    vec4 t1 = j36Tex(p1 * 1.15 + vec3(0.13, 0.0, 0.29), bw, 0.0);
    vec4 t2 = j36Tex(p2 * 0.7 + vec3(0.31, 0.17, 0.05), bw, 0.5);
    vec4 t3 = j36Tex(p3 * 0.42 + vec3(0.07, 0.53, 0.41), bw, 1.5);
    // 星雲邊界清楚一點（不是糊成一片的雜訊）
    float n2 = smoothstep(0.46, 0.76, t2.r);
    float n3 = smoothstep(0.42, 0.72, t3.g);
    float low = 1.0 - smoothstep(0.05, 0.75, p3.y);
    vec3 neb = j36NebA * n2 * 0.42 + j36NebB * n3 * (0.32 + 0.3 * low);
    // 星光：近層較稀疏但清楚、中層細光點、遠層暗
    float st = pow(t1.b, 4.0) * 1.1 + pow(t2.b, 2.6) * 0.45 + pow(t3.b, 2.0) * 0.2;
    float dust = smoothstep(0.7, 0.94, t2.a) * 0.12;
    float core = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.1, 0.6, p2.y));
    vec3 inner = neb + vec3(0.88, 0.96, 1.0) * (st + dust) + j36NebA * core * 0.3;
    // 羽翼與細觸角不畫星雲
    float into = (0.35 + 0.65 * jNdV) * (1.0 - jWing) * (1.0 - 0.8 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.15 * jS * into;
    color.a = clamp(color.a + (st * 0.25 + n3 * 0.06) * jS * jNdV * (1.0 - jWing), 0.0, 1.0);
  }

  // 下半部亮青色內部光（明顯但不刺眼）＋底部內側折射亮帶；低畫質也保留
  {
    float body = 1.0 - jWing;
    float cyan = (1.0 - smoothstep(0.0, 0.42, lp.y)) * smoothstep(0.8, 0.15, length(lp.xz)) * body;
    color.rgb += j36NebA * cyan * (0.34 + 0.2 * jNdV) * jS;
    float band = smoothstep(0.015, 0.06, lp.y) * (1.0 - smoothstep(0.07, 0.17, lp.y)) * (1.0 - jNdV) * body;
    color.rgb += vec3(0.6, 0.98, 1.0) * band * 0.35 * jS;
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j36StarC;
    vec3 n = j36StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j36StarDist(uv, j36Star.x, j36Star.y, j36Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j36Star.x * 0.9, length(uv));
      // V3.2：柔和金黃（邊緣暖金 → 中央奶油金），不偏橘
      vec3 gold = mix(vec3(1.0, 0.76, 0.2), vec3(1.0, 0.9, 0.5), core);
      // 輪廓內側一圈略深的暖金：五角星邊界清楚
      gold *= mix(0.84, 1.0, smoothstep(0.0, -0.012, d));
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j36Star.x + 0.5, 0.0, 1.0);
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
  color.rgb += mix(j36SkyLow, j36SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.18 * jS;
  color.rgb += j36Rim * jFres * (0.8 + 0.3 * jWing) * jS;
  // 羽翼：外緣柔和白色高光＋細的水晶光澤（沿羽瓣邊緣）
  color.rgb += vec3(0.9, 0.97, 1.0) * pow(1.0 - jNdV, 1.6) * jWing * 0.6 * jS;
  color.rgb += vec3(1.0) * pow(1.0 - jNdV, 4.0) * jWing * 0.25 * jS;
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
