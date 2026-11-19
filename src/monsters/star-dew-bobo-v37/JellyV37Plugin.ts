import {
  type AbstractMesh,
  DynamicTexture,
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
 * 星露啵啵 V3.7 果凍材質：玻璃果凍質感（V3.6 的 JellyV36Plugin 保持不變，本檔為獨立版本）。
 *
 * 材質基準：原始設定圖的主視覺大圖（晶瑩剔透、大片白色反光、整圈邊緣光、粉紫虹彩、底部亮青光）。
 * 與 V3.6 的差別：
 * - 烘焙反射貼圖（matcap，256×256，啟動時以程式繪製，不需下載）：大片弧形白反光、窗格高光、底部青色反光。
 *   依「視角空間法線」取樣，每個像素多 1 次貼圖取樣；取代 V3.6 的兩個小橢圓高光
 * - 整圈明亮的白色邊緣光、邊緣粉紫／青色虹彩（只用運算）
 * - 顏色：中央較亮的長春花藍（主視覺）、邊緣中深藍（三視圖）、上方較淡
 * - 底部內部光源：亮青白、往上擴散；星光中較亮的星有十字閃光（畫在雜訊貼圖裡，不多取樣）
 * - 透明度：中央 0.74（比 V3.6 透），由反射與邊緣光表現「晶瑩」；深度預先繪製保留，不會排序閃爍
 * - 低畫質：關閉內部星雲（nebula = 0），反射、邊緣光、虹彩、底部亮青仍保留（成本低）
 */
export class JellyV37Plugin extends MaterialPluginBase {
  rim = new Color3(0.86, 0.96, 1.0); // 整圈邊緣光（白帶一點青）
  core = new Color3(0.44, 0.62, 1.0); // 中央：較亮的長春花藍（主視覺）
  shell = new Color3(0.12, 0.26, 0.86); // 邊緣：中深藍（三視圖）
  top = new Color3(0.4, 0.56, 1.0);
  nebulaA = new Color3(0.34, 0.92, 1.0); // 亮青（底部光源、中層星雲）
  nebulaB = new Color3(0.5, 0.4, 0.98); // 遠層：淡紫藍
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
  /** 反射貼圖強度、邊緣光、虹彩、底部光源（可在測試頁調整；低畫質不變） */
  reflect = 1;
  rimStrength = 1;
  iridescence = 1;
  baseGlow = 1;
  readonly invWorld = Matrix.Identity();
  /** 視角矩陣（每幀由頁面寫入；用來算反射貼圖的取樣座標） */
  readonly view = Matrix.Identity();
  private enabled = false;
  private readonly noise: BaseTexture;
  private readonly matcap: BaseTexture;

  constructor(material: Material, noise: BaseTexture, matcap: BaseTexture) {
    super(material, "JellyV37Plugin", 200, { JELLY37: false });
    this.noise = noise;
    this.matcap = matcap;
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
    return "JellyV37Plugin";
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines["JELLY37"] = this.enabled;
  }

  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: Engine, _subMesh: SubMesh): boolean {
    return !this.enabled || (this.noise.isReady() && this.matcap.isReady());
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("j37Noise", "j37Matcap");
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    activeTextures.push(this.noise, this.matcap);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.noise || texture === this.matcap;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "j37Rim", size: 3, type: "vec3" },
        { name: "j37Core", size: 3, type: "vec3" },
        { name: "j37Shell", size: 3, type: "vec3" },
        { name: "j37Top", size: 3, type: "vec3" },
        { name: "j37NebA", size: 3, type: "vec3" },
        { name: "j37NebB", size: 3, type: "vec3" },
        { name: "j37Wing", size: 3, type: "vec3" },
        { name: "j37WingTip", size: 3, type: "vec3" },
        { name: "j37SkyLow", size: 3, type: "vec3" },
        { name: "j37SkyHigh", size: 3, type: "vec3" },
        { name: "j37StarC", size: 3, type: "vec3" },
        { name: "j37StarN", size: 3, type: "vec3" },
        { name: "j37Params", size: 4, type: "vec4" },
        { name: "j37Star", size: 4, type: "vec4" },
        { name: "j37InvWorld", size: 16, type: "mat4" },
        { name: "j37View", size: 16, type: "mat4" },
        { name: "j37Glass", size: 4, type: "vec4" },
      ],
      fragment: `#ifdef JELLY37
uniform vec3 j37Rim;
uniform vec3 j37Core;
uniform vec3 j37Shell;
uniform vec3 j37Top;
uniform vec3 j37NebA;
uniform vec3 j37NebB;
uniform vec3 j37Wing;
uniform vec3 j37WingTip;
uniform vec3 j37SkyLow;
uniform vec3 j37SkyHigh;
uniform vec3 j37StarC;
uniform vec3 j37StarN;
uniform vec4 j37Params;
uniform vec4 j37Star;
uniform mat4 j37InvWorld;
uniform mat4 j37View;
uniform vec4 j37Glass;
#endif`,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: Engine, _subMesh: SubMesh): void {
    if (!this.enabled) return;
    uniformBuffer.updateColor3("j37Rim", this.rim);
    uniformBuffer.updateColor3("j37Core", this.core);
    uniformBuffer.updateColor3("j37Shell", this.shell);
    uniformBuffer.updateColor3("j37Top", this.top);
    uniformBuffer.updateColor3("j37NebA", this.nebulaA);
    uniformBuffer.updateColor3("j37NebB", this.nebulaB);
    uniformBuffer.updateColor3("j37Wing", this.wing);
    uniformBuffer.updateColor3("j37WingTip", this.wingTip);
    uniformBuffer.updateColor3("j37SkyLow", this.skyLow);
    uniformBuffer.updateColor3("j37SkyHigh", this.skyHigh);
    uniformBuffer.updateVector3("j37StarC", this.starCenter);
    uniformBuffer.updateVector3("j37StarN", this.starNormal);
    uniformBuffer.updateFloat4("j37Params", this.height, this.strength, this.nebula, 2.2);
    uniformBuffer.updateFloat4("j37Star", this.starOuter, this.starInner, 1.25, 0);
    uniformBuffer.updateMatrix("j37InvWorld", this.invWorld);
    uniformBuffer.updateMatrix("j37View", this.view);
    uniformBuffer.updateFloat4("j37Glass", this.reflect, this.rimStrength, this.iridescence, this.baseGlow);
    uniformBuffer.setTexture("j37Noise", this.noise);
    uniformBuffer.setTexture("j37Matcap", this.matcap);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: JELLY37_FUNCS,
      CUSTOM_FRAGMENT_BEFORE_FOG: JELLY37_MAIN,
    };
  }
}

/**
 * 產生可平鋪的雜訊貼圖（256×256 RGBA，啟動時計算一次，約數十毫秒）：
 * R = 大塊星雲、G = 細一點的星雲（不同種子）、B = 稀疏星點、A = 細微星塵
 */
export function createJellyNoiseTextureV37(scene: Scene, size = 256): RawTexture {
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
      // V3.7：較亮的星加十字閃光（設定圖的四角星光）
      if (bright > 0.82) {
        for (let k = -7; k <= 7; k++) {
          const fall = bright * 0.85 * Math.exp(-(k * k) / 10);
          for (const [ax, ay] of [
            [k, 0],
            [0, k],
          ] as const) {
            const x = (Math.round(px) + ax + size) % size;
            const y = (Math.round(py) + ay + size) % size;
            if (fall > stars[y * size + x]!) stars[y * size + x] = fall;
          }
        }
      }
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
  tex.name = "BoboV37_Noise";
  return tex;
}

/**
 * 烘焙反射貼圖（matcap，依設定圖主視覺繪製）：黑底 = 不加光；亮的地方會疊加到果凍表面。
 * 貼圖座標 = 視角空間法線（左上 = 朝左上的表面）。
 * - 左上：大片弧形白反光＋兩塊窗格高光（主視覺左上的玻璃反光）
 * - 右上：小一點的柔和反光
 * - 底部邊緣：青色反光（底部亮青光照到表面）
 * - 左右兩側：淡淡粉紫（虹彩的底色）
 */
export function createGlassMatcapV37(scene: Scene, size = 256): DynamicTexture {
  const tex = new DynamicTexture("BoboV37_Matcap", { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const S = size;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "lighter";
  // 柔化邊緣：用 shadowBlur（iPhone Safari 支援；canvas filter 在 Safari 不可靠）
  const soften = (px: number, col: string): void => {
    ctx.shadowColor = col;
    ctx.shadowBlur = px;
  };
  const radial = (x: number, y: number, r: number, stops: [number, string][]): void => {
    ctx.shadowBlur = 0;
    const g = ctx.createRadialGradient(x * S, y * S, 0, x * S, y * S, r * S);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  };
  // 左上大片弧形反光（沿球體邊緣的月牙）
  ctx.save();
  ctx.beginPath();
  ctx.arc(0.5 * S, 0.5 * S, 0.475 * S, Math.PI * 1.05, Math.PI * 1.6);
  ctx.arc(0.515 * S, 0.515 * S, 0.43 * S, Math.PI * 1.58, Math.PI * 1.07, true);
  ctx.closePath();
  const arcG = ctx.createLinearGradient(0.1 * S, 0.15 * S, 0.45 * S, 0.45 * S);
  arcG.addColorStop(0, "rgba(255,255,255,0.9)");
  arcG.addColorStop(1, "rgba(220,235,255,0.25)");
  ctx.fillStyle = arcG;
  soften(S * 0.012, "rgba(255,255,255,0.8)");
  ctx.fill();
  ctx.restore();
  // 窗格高光（兩塊圓角矩形）
  ctx.save();
  soften(S * 0.012, "rgba(255,255,255,0.7)");
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  const pane = (x: number, y: number, w: number, h: number): void => {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x * S, y * S, w * S, h * S, 0.02 * S);
    else ctx.rect(x * S, y * S, w * S, h * S);
    ctx.fill();
  };
  pane(0.29, 0.25, 0.045, 0.06);
  pane(0.345, 0.25, 0.045, 0.06);
  ctx.restore();
  // 右上柔和反光、頂部微光
  radial(0.72, 0.3, 0.1, [
    [0, "rgba(255,255,255,0.6)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  radial(0.5, 0.12, 0.22, [
    [0, "rgba(200,225,255,0.25)"],
    [1, "rgba(200,225,255,0)"],
  ]);
  // 底部邊緣青色反光
  ctx.save();
  ctx.beginPath();
  ctx.arc(0.5 * S, 0.5 * S, 0.49 * S, Math.PI * 0.2, Math.PI * 0.8);
  ctx.arc(0.5 * S, 0.44 * S, 0.43 * S, Math.PI * 0.78, Math.PI * 0.22, true);
  ctx.closePath();
  soften(S * 0.02, "rgba(70,230,255,0.8)");
  ctx.fillStyle = "rgba(70,230,255,0.8)";
  ctx.fill();
  ctx.restore();
  // 左右兩側淡粉紫
  radial(0.08, 0.55, 0.22, [
    [0, "rgba(200,150,255,0.35)"],
    [1, "rgba(200,150,255,0)"],
  ]);
  radial(0.92, 0.55, 0.22, [
    [0, "rgba(255,170,230,0.3)"],
    [1, "rgba(255,170,230,0)"],
  ]);
  ctx.globalCompositeOperation = "source-over";
  tex.update(false);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

export const JELLY37_FUNCS = `
#ifdef JELLY37
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j37Noise;
uniform sampler2D j37Matcap;
/*
 * 雙平面取樣（物件座標的 xy 面與 zy 面），依「視線在物件內的方向」混合：
 * 正面看用 xy、側面看用 zy，圖樣不會被拉長成條紋。只有在兩面交界的視角才需要取 2 次，
 * 其他時候只取 1 次（同一區域的像素走同一條分支，手機 GPU 上很便宜）。
 */
vec4 j37Tex(vec3 p, float w, float bias) {
  if (w < 0.01) return texture2D(j37Noise, p.xy, bias);
  if (w > 0.99) return texture2D(j37Noise, p.zy + vec2(0.37, 0.61), bias);
  return mix(texture2D(j37Noise, p.xy, bias), texture2D(j37Noise, p.zy + vec2(0.37, 0.61), bias), w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j37StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`;

export const JELLY37_MAIN = `
#ifdef JELLY37
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j37Params.w);
  float jS = j37Params.y;
  vec3 lp = (j37InvWorld * vec4(vPositionW, 1.0)).xyz / j37Params.x;
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j37InvWorld * vec4(rdW, 0.0)).xyz);

  // 羽翼區域（身體半寬約 0.62，羽翼在外側）；jWingT：根部 0 → 尖端 1
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.3, 0.0, 1.0);

  // 本色：邊緣中深藍（三視圖）→ 中央較亮的長春花藍（主視覺）；頂部略淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j37Shell, j37Top, smoothstep(0.45, 1.0, h) * 0.5);
  vec3 base = mix(shell, j37Core, smoothstep(0.25, 0.92, jNdV) * 0.85);
  vec3 wingCol = mix(j37Wing, j37WingTip, smoothstep(0.0, 1.0, jWingT));
  base = mix(base, wingCol, jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.08 + base * 0.86, jS * 0.95);
  // 透明度：中央 0.74（晶瑩，但不會看穿成一條條背景線）；邊緣由邊緣光補上不透明度
  float jThick = smoothstep(0.35, 0.95, jNdV) * (1.0 - jWing);
  color.a = mix(color.a, 0.74, jThick * jS);
  color.a = mix(color.a, color.a * 0.82, (1.0 - jNdV) * (1.0 - jWing) * jS);
  color.a = mix(color.a, mix(0.75, 0.5, jWingT), jWing * jS);

  if (j37Params.z > 0.5) {
    // 三層深度（視差）：近層細小清楚的星光、中層青藍星雲＋細光點、遠層較暗的紫藍星雲
    vec3 p1 = lp + rd * 0.05;
    vec3 p2 = lp + rd * 0.22;
    vec3 p3 = lp + rd * 0.44;
    float bw = smoothstep(0.45, 0.75, abs(rd.x));
    vec4 t1 = j37Tex(p1 * 1.15 + vec3(0.13, 0.0, 0.29), bw, 0.0);
    vec4 t2 = j37Tex(p2 * 0.7 + vec3(0.31, 0.17, 0.05), bw, 0.5);
    vec4 t3 = j37Tex(p3 * 0.42 + vec3(0.07, 0.53, 0.41), bw, 1.5);
    // 星雲邊界清楚一點（不是糊成一片的雜訊）
    float n2 = smoothstep(0.46, 0.76, t2.r);
    float n3 = smoothstep(0.42, 0.72, t3.g);
    float low = 1.0 - smoothstep(0.05, 0.75, p3.y);
    vec3 neb = j37NebA * n2 * 0.45 + j37NebB * n3 * (0.26 + 0.24 * low);
    // 星光：近層較稀疏但清楚、中層細光點、遠層暗
    // 星光：越往下越多（設定圖星塵集中在下半部）；十字閃光已畫在貼圖裡
    float stW = 0.55 + 0.75 * (1.0 - smoothstep(0.1, 0.7, lp.y));
    float st = (pow(t1.b, 3.0) * 1.5 + pow(t2.b, 2.4) * 0.6 + pow(t3.b, 2.0) * 0.24) * stW;
    float dust = smoothstep(0.7, 0.94, t2.a) * 0.12;
    float core = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.1, 0.6, p2.y));
    vec3 inner = neb + vec3(0.88, 0.96, 1.0) * (st + dust) + j37NebA * core * 0.3;
    // 羽翼與細觸角不畫星雲
    float into = (0.35 + 0.65 * jNdV) * (1.0 - jWing) * (1.0 - 0.8 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.15 * jS * into;
    color.a = clamp(color.a + (st * 0.25 + n3 * 0.06) * jS * jNdV * (1.0 - jWing), 0.0, 1.0);
  }

  // 底部內部光源（主視覺：底部中央很亮的青白光往上擴散）＋底部內側折射亮帶；低畫質也保留
  {
    float body = 1.0 - jWing;
    vec3 src = vec3(0.0, 0.08, 0.05);
    vec3 q = lp + rd * 0.25;
    float d2 = dot((q - src) * vec3(1.0, 1.6, 1.0), (q - src) * vec3(1.0, 1.6, 1.0));
    float srcGlow = exp(-d2 / 0.09) * body;
    float lower = (1.0 - smoothstep(0.0, 0.45, lp.y)) * smoothstep(0.8, 0.15, length(lp.xz)) * body;
    vec3 glowCol = mix(j37NebA, vec3(0.85, 1.0, 1.0), srcGlow * 0.6);
    color.rgb += glowCol * (srcGlow * 1.15 + lower * 0.4) * j37Glass.w * jS;
    color.a = max(color.a, srcGlow * 0.85 * j37Glass.w * jS);
    float band = smoothstep(0.015, 0.06, lp.y) * (1.0 - smoothstep(0.07, 0.17, lp.y)) * (1.0 - jNdV) * body;
    color.rgb += vec3(0.6, 0.98, 1.0) * band * 0.5 * j37Glass.w * jS;
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j37StarC;
    vec3 n = j37StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j37StarDist(uv, j37Star.x, j37Star.y, j37Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j37Star.x * 0.9, length(uv));
      // V3.2：柔和金黃（邊緣暖金 → 中央奶油金），不偏橘
      vec3 gold = mix(vec3(1.0, 0.76, 0.2), vec3(1.0, 0.9, 0.5), core);
      // 輪廓內側一圈略深的暖金：五角星邊界清楚
      gold *= mix(0.84, 1.0, smoothstep(0.0, -0.012, d));
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j37Star.x + 0.5, 0.0, 1.0);
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

  // 表面：烘焙反射（matcap）＋整圈邊緣光＋虹彩
  vec3 nV = normalize((j37View * vec4(jN, 0.0)).xyz);
  vec2 mcUV = vec2(nV.x * 0.48 + 0.5, 0.5 - nV.y * 0.48);
  vec3 mc = texture2D(j37Matcap, mcUV).rgb;
  float mcL = max(mc.r, max(mc.g, mc.b));
  color.rgb += mc * 1.05 * j37Glass.x * jS;
  color.a = clamp(color.a + mcL * 0.55 * j37Glass.x * jS, 0.0, 1.0);
  // 整圈明亮的邊緣光（主視覺的白色輪廓）
  float rimW = smoothstep(0.42, 0.0, jNdV);
  // 上半部白色邊緣光、下半部偏青（設定圖底部是亮青光，不是奶白）
  float rimLow = 1.0 - smoothstep(-0.55, 0.1, nV.y);
  vec3 rimCol = mix(j37Rim, vec3(0.35, 0.9, 1.0), rimLow * 0.8);
  color.rgb += rimCol * (rimW * mix(0.62, 0.42, rimLow) + jFres * 0.22) * j37Glass.y * jS;
  color.a = clamp(color.a + rimW * 0.3 * j37Glass.y * jS, 0.0, 1.0);
  // 虹彩：邊緣附近粉紫 → 青色的薄膜色帶（隨角度變化）
  float irB = smoothstep(0.65, 0.2, jNdV) * smoothstep(0.0, 0.12, jNdV);
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + jNdV * 1.6 + nV.y * 0.25 + 0.55));
  irid = mix(irid, vec3(0.85, 0.7, 1.0), 0.35);
  color.rgb += irid * irB * 0.22 * j37Glass.z * jS;
  // 羽翼：外緣柔和白色高光＋細的水晶光澤
  color.rgb += vec3(0.9, 0.97, 1.0) * pow(1.0 - jNdV, 1.6) * jWing * 0.5 * jS;
  // 天空反射（很淡，讓上半部有一點環境色）
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j37SkyLow, j37SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.1 * jS;
}
#endif
`;
