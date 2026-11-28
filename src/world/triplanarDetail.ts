/**
 * 世界場景共用：程序化建築／機械的「世界座標三平面細節」材質外掛（StandardMaterial 用）。
 *
 * 為什麼：垃圾場的程序化建築、輸送帶、階梯、垃圾堆都是頂點色方塊，UV 是每一面 0～1，
 * 大面牆會變成平塗色塊，和 Tripo 地標（有鉚釘、鏽痕、髒污）的質感差距很大。
 * 這個外掛不需要改任何網格或 UV：依世界座標在三個平面取樣同一張可無縫重複的「舊金屬板」細節貼圖
 * （板縫、鉚釘、鏽水痕、髒污），乘到原本的顏色上，再做少量飽和度與明暗分級，讓整體色調接近地標。
 *
 * - 不增加 Draw Call、不增加網格；每個像素多 3 次貼圖取樣（低畫質不使用）。
 * - 貼圖 256²（R＝明暗、G＝鏽色量），所有材質共用 1 張。
 */
import { type Material, MaterialPluginBase, RawTexture, type Scene, Texture, type UniformBuffer } from "@babylonjs/core";

export interface TriDetailOptions {
  /** 每公尺重複次數（0.5＝2 m 一個循環） */
  scale: number;
  /** 細節強度 0～1 */
  strength: number;
  /** 飽和度倍率（1＝不變） */
  saturation: number;
}

class TriDetailPlugin extends MaterialPluginBase {
  private readonly tex: Texture;
  private readonly o: TriDetailOptions;
  constructor(material: Material, tex: Texture, o: TriDetailOptions) {
    super(material, "TriDetail", 200, { TRIDETAIL: false });
    this.tex = tex;
    this.o = o;
    this._enable(true);
  }
  override prepareDefines(defines: Record<string, unknown>): void {
    defines["TRIDETAIL"] = true;
  }
  override getClassName(): string {
    return "TriDetailPlugin";
  }
  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [{ name: "triDetailParams", size: 4, type: "vec4" }],
      fragment: "#ifdef TRIDETAIL\nuniform vec4 triDetailParams;\n#endif",
    };
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("triDetailSampler");
  }
  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat4("triDetailParams", this.o.scale, this.o.strength, this.o.saturation, 0);
    ubo.setTexture("triDetailSampler", this.tex);
  }
  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: "#ifdef TRIDETAIL\nuniform sampler2D triDetailSampler;\n#endif",
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
#ifdef TRIDETAIL
{
  vec3 tdN = abs(normalW);
  tdN = pow(tdN, vec3(4.0));
  tdN /= max(tdN.x + tdN.y + tdN.z, 1e-4);
  vec3 tdP = vPositionW * triDetailParams.x;
  vec2 tdA = texture2D(triDetailSampler, tdP.zy).rg;
  vec2 tdB = texture2D(triDetailSampler, tdP.xz).rg;
  vec2 tdC = texture2D(triDetailSampler, tdP.xy).rg;
  vec2 tdS = tdA * tdN.x + tdB * tdN.y + tdC * tdN.z;
  float tdK = triDetailParams.y;
  baseColor.rgb *= 1.0 + (tdS.r - 0.55) * 1.6 * tdK;
  baseColor.rgb = mix(baseColor.rgb, baseColor.rgb * vec3(1.08, 0.74, 0.5), tdS.g * 0.75 * tdK);
  float tdL = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
  baseColor.rgb = mix(vec3(tdL), baseColor.rgb, triDetailParams.z);
}
#endif
`,
    };
  }
}

/** 可無縫重複的舊金屬板細節貼圖（R＝明暗、G＝鏽色量） */
export function makeWornPanelTexture(scene: Scene, N = 256): Texture {
  const data = new Uint8Array(N * N * 4);
  // 週期值雜訊（可無縫重複）
  const lattice = (p: number, seed: number): Float32Array => {
    const out = new Float32Array(p * p);
    let s = seed >>> 0;
    for (let i = 0; i < p * p; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = (s >>> 8) / 16777216;
    }
    return out;
  };
  const noise = (L: Float32Array, p: number, u: number, v: number): number => {
    const x = u * p;
    const y = v * p;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (a: number, b: number): number => L[(((b % p) + p) % p) * p + (((a % p) + p) % p)]!;
    const a = g(i, j) + (g(i + 1, j) - g(i, j)) * sx;
    const b = g(i, j + 1) + (g(i + 1, j + 1) - g(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
  const L1 = lattice(4, 11);
  const L2 = lattice(16, 23);
  const L3 = lattice(64, 37);
  const LR = lattice(8, 51);
  // 板：2 列 × 2 行（錯縫），一個循環＝貼圖寬
  const rows = 2;
  const cols = 2;
  const rust = new Float32Array(N * N);
  // 鏽水痕：從板縫上的鉚釘往下流（v 增加＝往下）
  const streak = (cx: number, cy: number, w: number, len: number, k: number): void => {
    for (let dy = 0; dy < len; dy++) {
      const fall = 1 - dy / len;
      const wob = Math.sin((cy + dy) * 0.21 + cx) * 0.8;
      for (let dx = -w; dx <= w; dx++) {
        const x = (((Math.round(cx + dx + wob) % N) + N) % N);
        const y = (((cy + dy) % N) + N) % N;
        const e = 1 - Math.abs(dx) / (w + 1);
        rust[y * N + x] = Math.max(rust[y * N + x]!, e * fall * k);
      }
    }
  };
  let s = 7;
  const rnd = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) / 16777216;
  };
  const ph = N / rows;
  const pw = N / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * pw + (r % 2 ? pw / 2 : 0);
      const y0 = r * ph;
      for (let i = 0; i < 4; i++) if (rnd() < 0.6) streak(x0 + pw * (0.12 + rnd() * 0.76), y0 + 8, 1 + Math.floor(rnd() * 2), Math.floor(ph * (0.3 + rnd() * 0.6)), 0.5 + rnd() * 0.5);
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      // 每塊板的明暗不同
      const r = Math.floor(y / ph);
      const xo = (x - (r % 2 ? pw / 2 : 0) + N) % N;
      const c = Math.floor(xo / pw);
      const plate = ((r * 7 + c * 13) % 5) / 5;
      // 板縫（暗線＋上緣亮邊）與鉚釘
      const sy = y % ph;
      const sx = xo % pw;
      const seam = Math.min(sy, ph - sy, sx, pw - sx);
      let lum = 0.55 + (plate - 0.4) * 0.12;
      lum += (noise(L1, 4, u, v) - 0.5) * 0.22 + (noise(L2, 16, u, v) - 0.5) * 0.14 + (noise(L3, 64, u, v) - 0.5) * 0.1;
      if (seam < 1.5) lum -= 0.3;
      else if (seam < 3) lum += 0.06;
      const rv = sy < ph / 2 ? sy : ph - sy;
      const rh = sx < pw / 2 ? sx : pw - sx;
      const rivetY = Math.abs(rv - 6) < 3 && rh % 16 > 4 && rh % 16 < 10;
      const rivetX = Math.abs(rh - 6) < 3 && rv % 16 > 4 && rv % 16 < 10;
      if (rivetY || rivetX) lum += 0.16;
      // 下緣髒污（每塊板的下方較暗）
      lum -= Math.max(0, (sy / ph - 0.7) / 0.3) * 0.08;
      const rs = Math.min(1, rust[y * N + x]! * 0.9 + Math.max(0, noise(LR, 8, u, v) - 0.62) * 1.6);
      lum -= rs * 0.12;
      const i = (y * N + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(lum * 255)));
      data[i + 1] = Math.round(rs * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const t = RawTexture.CreateRGBATexture(data, N, N, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = "world_wornPanel";
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 4;
  return t;
}

/** 對材質加上三平面細節（同一張貼圖可給多個材質共用） */
export function addTriplanarDetail(material: Material, tex: Texture, o: TriDetailOptions): void {
  new TriDetailPlugin(material, tex, o);
}
