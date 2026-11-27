/**
 * 戰鬥音效 V2（Stage 3）：WebAudio 即時合成（不下載音檔、沒有授權問題、不用付費素材）。
 *
 * 每個音效是分層合成：起音（瞬間的「喀／鏘」）＋本體（重量感）＋尾音（殘響、碎片、餘韻），
 * 加上左右聲道移動、每次 ±4% 音高變化、殘響送出（星夜競技場較長、白天草地較短）。
 * - 武器揮擊：輕劍 swish、重劍 swishHeavy、法杖 staffSwing、旋風 whirl（聲像繞圈）
 * - 命中：hit（短劍砍中）、hitHeavy（重擊）、crit（暴擊：金屬鏘聲＋上升閃光音）
 * - 魔法：cast（詠唱和聲）、charge（蓄力上升＋顫音）、release、bolt（魔法彈）、magicHit（星光爆開）
 * - 地面衝擊：groundImpact（重斬／跳斬落地）、explosion（星隕）、land、jump
 * - 職業預留：shieldBash（盾擊金屬聲）、heal（治療和弦）
 * 同一個合成函式可以在 OfflineAudioContext 算出波形（自動測試輸出 WAV、檢查有沒有破音）。
 * iPhone Safari 需要使用者點一下才能發聲：第一次點擊時呼叫 unlock()。
 * 同時發聲數有上限（多人同場時不會爆音）；其他玩家的音量較小。
 */
import type { SfxKey } from "../core/skills.ts";

export const SFX_KEYS: readonly SfxKey[] = [
  "swish", "swishHeavy", "staffSwing", "whirl", "hit", "hitHeavy", "crit", "cast", "charge", "release", "bolt", "magicHit",
  "groundImpact", "explosion", "jump", "land", "shieldBash", "heal",
];

/** 每個音效大約多長（秒；發聲數回收、離線算圖用） */
export const SFX_LENGTH: Record<SfxKey, number> = {
  swish: 0.25, swishHeavy: 0.4, staffSwing: 0.35, whirl: 1.25, hit: 0.3, hitHeavy: 0.55, crit: 0.9, cast: 1.0, charge: 1.2, release: 0.5,
  bolt: 0.45, magicHit: 0.6, groundImpact: 0.9, explosion: 1.4, jump: 0.25, land: 0.5, shieldBash: 0.8, heal: 1.1,
};

/**
 * 每個音效的音量修正（dB）：依 CI 離線算圖的短時響度（50 ms RMS）調成一致的層級——
 * 揮擊 < 命中 < 重擊／暴擊 < 地面衝擊／爆炸；跳躍最輕。
 */
export const SFX_LEVEL_DB: Record<SfxKey, number> = {
  swish: 4, staffSwing: 4, swishHeavy: -2, whirl: 0, hit: 8, hitHeavy: 1, crit: 3, magicHit: 6.5, groundImpact: 2, explosion: 0,
  land: 1, jump: 11, cast: 0, charge: -1.5, release: 0, bolt: 2, shieldBash: 4.5, heal: 3,
};

interface Bus {
  ctx: BaseAudioContext;
  dry: AudioNode;
  wet: AudioNode;
  noise: AudioBuffer;
  rnd: () => number;
}

function makeNoise(ctx: BaseAudioContext, rnd: () => number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1.5);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  return b;
}

function makeImpulse(ctx: BaseAudioContext, seconds: number, rnd: () => number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const u = i / len;
      d[i] = (rnd() * 2 - 1) * Math.pow(1 - u, 2.6) * (u < 0.01 ? u / 0.01 : 1);
    }
  }
  return b;
}

/** 建立主輸出：乾聲＋殘響 → 壓縮 → 限幅 → destination */
function makeMaster(ctx: BaseAudioContext, volume: number, reverbSec: number, wetGain: number, rnd: () => number) {
  const master = ctx.createGain();
  master.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 8;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;
  master.connect(comp).connect(limiter).connect(ctx.destination);
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx, reverbSec, rnd);
  const wet = ctx.createGain();
  wet.gain.value = wetGain;
  wet.connect(conv).connect(master);
  return { master, wet, conv, wetGain: wet };
}

/** 合成一個音效（live 與 offline 共用）。t：開始時間；gain：整體音量（其他玩家較小）；pan：左右基準 */
function voice(bus: Bus, key: SfxKey, gain: number, t: number, pan = 0): void {
  const c = bus.ctx;
  const R = bus.rnd;
  const pitch = 1 + (R() - 0.5) * 0.08;
  const panner = (c as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode }).createStereoPanner?.() ?? null;
  const out = c.createGain();
  out.gain.value = gain * Math.pow(10, (SFX_LEVEL_DB[key] ?? 0) / 20);
  if (panner) {
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(bus.dry);
  } else out.connect(bus.dry);
  const send = c.createGain();
  send.gain.value = 1;
  out.connect(send).connect(bus.wet);

  const env = (g: GainNode, at: number, a: number, peak: number, d: number, curve = "exp") => {
    g.gain.setValueAtTime(0.0001, at);
    if (curve === "lin") g.gain.linearRampToValueAtTime(peak, at + a);
    else g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
  };
  const noise = (o: { f0: number; f1: number; fMid?: number; q: number; type: BiquadFilterType; peak: number; a: number; d: number; delay?: number; panFrom?: number; panTo?: number; dest?: AudioNode }) => {
    const at = t + (o.delay ?? 0);
    const s = c.createBufferSource();
    s.buffer = bus.noise;
    s.playbackRate.value = pitch;
    const f = c.createBiquadFilter();
    f.type = o.type;
    f.Q.value = o.q;
    f.frequency.setValueAtTime(o.f0 * pitch, at);
    if (o.fMid) {
      f.frequency.exponentialRampToValueAtTime(o.fMid * pitch, at + o.a);
      f.frequency.exponentialRampToValueAtTime(o.f1 * pitch, at + o.a + o.d);
    } else f.frequency.exponentialRampToValueAtTime(o.f1 * pitch, at + o.a + o.d);
    const g = c.createGain();
    env(g, at, o.a, o.peak, o.d);
    let last: AudioNode = s.connect(f).connect(g);
    if (o.panFrom !== undefined && panner) {
      const p2 = (c as BaseAudioContext & { createStereoPanner: () => StereoPannerNode }).createStereoPanner();
      p2.pan.setValueAtTime(o.panFrom, at);
      p2.pan.linearRampToValueAtTime(o.panTo ?? 0, at + o.a + o.d);
      last = last.connect(p2);
    }
    last.connect(o.dest ?? out);
    s.start(at, R() * 0.8);
    s.stop(at + o.a + o.d + 0.05);
  };
  const tone = (o: { type: OscillatorType; f0: number; f1: number; peak: number; a: number; d: number; delay?: number; drive?: number; detune?: number }) => {
    const at = t + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f0 * pitch, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * pitch), at + o.a + o.d);
    if (o.detune) osc.detune.value = o.detune;
    const g = c.createGain();
    env(g, at, o.a, o.peak, o.d);
    let n: AudioNode = osc;
    if (o.drive) {
      const ws = c.createWaveShaper();
      const k = o.drive;
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      ws.curve = curve;
      n = n.connect(ws);
    }
    n.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + o.a + o.d + 0.05);
  };
  /** 金屬共鳴（不和諧泛音）：鏘、盾 */
  const metal = (base: number, peak: number, d: number, delay = 0) => {
    for (const [r, k] of [[1, 1], [2.76, 0.6], [5.4, 0.35], [8.93, 0.2]] as const) tone({ type: "sine", f0: base * r, f1: base * r * 0.995, peak: peak * k, a: 0.002, d: d * (1.1 - r / 12), delay });
  };
  const clicks = (n: number, span: number, peak: number) => {
    for (let i = 0; i < n; i++) noise({ f0: 3000 + R() * 4000, f1: 2000, q: 1.5, type: "bandpass", peak: peak * (0.4 + R() * 0.6), a: 0.001, d: 0.02 + R() * 0.03, delay: 0.05 + R() * span });
  };

  switch (key) {
    // ---------------------------------------------------------------- 揮擊
    case "swish":
      noise({ f0: 700, fMid: 3800, f1: 1600, q: 1.6, type: "bandpass", peak: 0.55, a: 0.045, d: 0.15, panFrom: -0.5, panTo: 0.5 });
      noise({ f0: 6000, f1: 9000, q: 0.7, type: "highpass", peak: 0.12, a: 0.03, d: 0.08 });
      tone({ type: "sine", f0: 2600, f1: 2400, peak: 0.035, a: 0.01, d: 0.12, delay: 0.02 });
      break;
    case "swishHeavy":
      noise({ f0: 320, fMid: 2400, f1: 700, q: 1.1, type: "bandpass", peak: 0.75, a: 0.08, d: 0.24, panFrom: -0.6, panTo: 0.6 });
      noise({ f0: 4000, f1: 7000, q: 0.7, type: "highpass", peak: 0.12, a: 0.05, d: 0.15 });
      tone({ type: "sine", f0: 120, f1: 60, peak: 0.22, a: 0.05, d: 0.22 });
      break;
    case "staffSwing":
      noise({ f0: 300, fMid: 1500, f1: 500, q: 1.3, type: "bandpass", peak: 0.5, a: 0.07, d: 0.2, panFrom: 0.4, panTo: -0.4 });
      tone({ type: "triangle", f0: 220, f1: 180, peak: 0.05, a: 0.02, d: 0.15 });
      break;
    case "whirl":
      for (let i = 0; i < 6; i++) {
        const side = i % 2 ? 0.7 : -0.7;
        noise({ f0: 600 + i * 90, fMid: 3200 + i * 250, f1: 1200, q: 1.5, type: "bandpass", peak: 0.42 + i * 0.03, a: 0.05, d: 0.13, delay: i * 0.18, panFrom: -side, panTo: side });
      }
      tone({ type: "sine", f0: 140, f1: 190, peak: 0.08, a: 0.4, d: 0.7 });
      break;
    // ---------------------------------------------------------------- 命中
    case "hit":
      noise({ f0: 6000, f1: 3000, q: 0.8, type: "highpass", peak: 0.55, a: 0.001, d: 0.025 });             // 起音：喀
      tone({ type: "sine", f0: 170, f1: 60, peak: 0.6, a: 0.003, d: 0.12, drive: 3 });                      // 本體：咚
      noise({ f0: 1400, f1: 450, q: 1.2, type: "bandpass", peak: 0.55, a: 0.004, d: 0.09 });               // 布料／肉的悶聲
      metal(2100, 0.05, 0.12);                                                                             // 刀刃的細微金屬聲
      break;
    case "hitHeavy":
      noise({ f0: 5000, f1: 2500, q: 0.8, type: "highpass", peak: 0.6, a: 0.001, d: 0.03 });
      tone({ type: "sine", f0: 130, f1: 42, peak: 0.95, a: 0.004, d: 0.28, drive: 4 });
      tone({ type: "sine", f0: 70, f1: 32, peak: 0.6, a: 0.008, d: 0.4 });
      noise({ f0: 1800, f1: 300, q: 0.9, type: "bandpass", peak: 0.8, a: 0.004, d: 0.2 });
      metal(1500, 0.06, 0.2);
      break;
    case "crit":
      noise({ f0: 7000, f1: 4000, q: 0.8, type: "highpass", peak: 0.45, a: 0.001, d: 0.03 });
      metal(1760, 0.16, 0.55);                                                                              // 鏘——
      tone({ type: "sine", f0: 90, f1: 36, peak: 0.6, a: 0.005, d: 0.35, drive: 3 });
      [1568, 1976, 2349, 2794, 3136].forEach((f, i) => tone({ type: "sine", f0: f, f1: f, peak: 0.07, a: 0.004, d: 0.28, delay: 0.04 + i * 0.045 }));   // 上升閃光音
      noise({ f0: 8000, f1: 12000, q: 2, type: "bandpass", peak: 0.08, a: 0.05, d: 0.4, delay: 0.05 });
      break;
    // ---------------------------------------------------------------- 魔法
    case "cast":
      for (const [f, dt] of [[392, 0], [494, 0.0], [587, 0.0], [784, 0.0]] as const) {
        tone({ type: "triangle", f0: f, f1: f * 1.004, peak: 0.06, a: 0.25, d: 0.6, delay: dt, detune: -6 });
        tone({ type: "triangle", f0: f, f1: f * 1.004, peak: 0.05, a: 0.25, d: 0.6, delay: dt, detune: 7 });
      }
      [1568, 1976, 2349, 3136].forEach((f, i) => tone({ type: "sine", f0: f, f1: f, peak: 0.05, a: 0.01, d: 0.35, delay: 0.1 + i * 0.09 }));
      noise({ f0: 6000, f1: 10000, q: 1.5, type: "bandpass", peak: 0.07, a: 0.3, d: 0.5 });
      break;
    case "charge":
      tone({ type: "sawtooth", f0: 110, f1: 330, peak: 0.07, a: 0.95, d: 0.2 });
      tone({ type: "sine", f0: 220, f1: 880, peak: 0.12, a: 1.0, d: 0.15 });
      tone({ type: "sine", f0: 223, f1: 886, peak: 0.08, a: 1.0, d: 0.15 });                               // 拍頻＝顫動
      noise({ f0: 300, f1: 4000, q: 1.2, type: "bandpass", peak: 0.22, a: 1.0, d: 0.12 });
      break;
    case "release":
      noise({ f0: 400, fMid: 5000, f1: 1500, q: 1, type: "bandpass", peak: 0.6, a: 0.04, d: 0.3, panFrom: -0.3, panTo: 0.3 });
      tone({ type: "sine", f0: 1400, f1: 350, peak: 0.25, a: 0.01, d: 0.35 });
      break;
    case "bolt":
      tone({ type: "sine", f0: 700, f1: 1900, peak: 0.2, a: 0.03, d: 0.25 });
      tone({ type: "square", f0: 1400, f1: 2600, peak: 0.03, a: 0.02, d: 0.2 });
      noise({ f0: 2000, f1: 8000, q: 2.5, type: "bandpass", peak: 0.25, a: 0.03, d: 0.3, panFrom: 0, panTo: 0.5 });
      break;
    case "magicHit":
      tone({ type: "sine", f0: 160, f1: 60, peak: 0.45, a: 0.004, d: 0.18, drive: 2 });
      noise({ f0: 5000, f1: 1500, q: 1, type: "bandpass", peak: 0.5, a: 0.003, d: 0.18 });
      for (let i = 0; i < 6; i++) { const f = 2200 + R() * 3000; tone({ type: "sine", f0: f, f1: f * 0.98, peak: 0.05, a: 0.003, d: 0.15 + R() * 0.2, delay: 0.02 + i * 0.03 }); }
      break;
    // ---------------------------------------------------------------- 地面衝擊
    case "groundImpact":
      tone({ type: "sine", f0: 105, f1: 32, peak: 1.0, a: 0.004, d: 0.45, drive: 5 });
      noise({ f0: 1500, f1: 90, q: 0.6, type: "lowpass", peak: 0.9, a: 0.006, d: 0.6 });
      noise({ f0: 4000, f1: 2000, q: 0.8, type: "highpass", peak: 0.4, a: 0.001, d: 0.04 });
      clicks(8, 0.35, 0.25);                                                                               // 碎石
      break;
    case "explosion":
      tone({ type: "sine", f0: 80, f1: 26, peak: 1.0, a: 0.01, d: 0.9, drive: 6 });
      noise({ f0: 2500, f1: 70, q: 0.5, type: "lowpass", peak: 1.0, a: 0.01, d: 1.0 });
      noise({ f0: 6000, f1: 3000, q: 0.8, type: "highpass", peak: 0.45, a: 0.002, d: 0.06 });
      [1760, 2637, 3520].forEach((f, i) => tone({ type: "sine", f0: f, f1: f, peak: 0.05, a: 0.01, d: 0.6, delay: 0.06 + i * 0.05 }));
      clicks(12, 0.6, 0.22);
      break;
    case "jump":
      noise({ f0: 500, f1: 2200, q: 1, type: "bandpass", peak: 0.35, a: 0.03, d: 0.15 });
      break;
    case "land":
      tone({ type: "sine", f0: 120, f1: 40, peak: 0.6, a: 0.004, d: 0.28, drive: 2 });
      noise({ f0: 900, f1: 150, q: 0.7, type: "lowpass", peak: 0.6, a: 0.005, d: 0.35 });
      break;
    // ---------------------------------------------------------------- 職業預留
    case "shieldBash":
      tone({ type: "sine", f0: 150, f1: 55, peak: 0.7, a: 0.003, d: 0.2, drive: 3 });
      metal(520, 0.18, 0.7);
      noise({ f0: 3000, f1: 1200, q: 1, type: "bandpass", peak: 0.4, a: 0.002, d: 0.08 });
      break;
    case "heal":
      [523, 659, 784, 1047].forEach((f, i) => tone({ type: "sine", f0: f, f1: f, peak: 0.07, a: 0.08, d: 0.8, delay: i * 0.08 }));
      noise({ f0: 7000, f1: 11000, q: 2, type: "bandpass", peak: 0.06, a: 0.3, d: 0.6 });
      break;
  }
}

/** 每次呼叫都一樣的亂數（離線算圖、測試用） */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class CombatAudio {
  private ctx: AudioContext | null = null;
  private bus: Bus | null = null;
  private master: GainNode | null = null;
  private wet: GainNode | null = null;
  enabled = true;
  volume = 0.7;
  private voices = 0;
  readonly maxVoices = 14;
  played = 0;
  private env: "dark" | "bright" = "dark";

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const m = makeMaster(this.ctx, this.volume, this.env === "dark" ? 1.4 : 0.6, this.env === "dark" ? 0.22 : 0.1, Math.random);
      this.master = m.master;
      this.wet = m.wet;
      this.bus = { ctx: this.ctx, dry: m.master, wet: m.wet, noise: makeNoise(this.ctx, Math.random), rnd: Math.random };
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** 星夜競技場（殘響長）／白天草地（戶外，殘響短） */
  setEnvironment(env: "dark" | "bright"): void {
    this.env = env;
    if (this.wet) this.wet.gain.value = env === "dark" ? 0.22 : 0.1;
  }

  /** pan：-1 左～1 右（其他玩家依畫面位置） */
  play(key: SfxKey, gain = 1, pan = 0): void {
    const c = this.ctx;
    if (!this.enabled || !c || !this.bus || c.state !== "running") return;
    if (this.voices >= this.maxVoices) return;
    this.voices++;
    this.played++;
    voice(this.bus, key, gain, c.currentTime + 0.005, pan);
    window.setTimeout(() => (this.voices = Math.max(0, this.voices - 1)), (SFX_LENGTH[key] ?? 0.5) * 1000 + 50);
  }
}

/**
 * 離線算出音效波形（自動測試輸出 WAV、檢查音量與破音）。回傳左右聲道與統計。
 */
export async function renderSfxOffline(key: SfxKey, env: "dark" | "bright" = "dark", sampleRate = 44100, seed = 7): Promise<{ left: Float32Array; right: Float32Array; peak: number; rms: number; activeSec: number }> {
  const dur = (SFX_LENGTH[key] ?? 0.5) + (env === "dark" ? 1.2 : 0.5);
  const OAC = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(sampleRate * dur), sampleRate);
  const rnd = seeded(seed);
  const m = makeMaster(ctx, 0.7, env === "dark" ? 1.4 : 0.6, env === "dark" ? 0.22 : 0.1, rnd);
  voice({ ctx, dry: m.master, wet: m.wet, noise: makeNoise(ctx, rnd), rnd }, key, 1, 0.01, 0);
  const buf = await ctx.startRendering();
  const left = buf.getChannelData(0);
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : left;
  let peak = 0;
  let sum = 0;
  let last = 0;
  for (let i = 0; i < left.length; i++) {
    const v = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
    peak = Math.max(peak, v);
    sum += left[i]! * left[i]!;
    if (v > 0.003) last = i;
  }
  return { left, right, peak, rms: Math.sqrt(sum / left.length), activeSec: last / sampleRate };
}

/** 16-bit 立體聲 WAV（自動測試輸出試聽檔用） */
export function encodeWav(left: Float32Array, right: Float32Array, sampleRate = 44100): Uint8Array {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i]!)) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i]!)) * 32767, true);
  }
  return new Uint8Array(buf);
}
