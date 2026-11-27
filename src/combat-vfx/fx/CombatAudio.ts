/**
 * 戰鬥音效：WebAudio 即時合成（不下載音檔、沒有授權問題、不用付費素材）。
 * iPhone Safari 需要使用者點一下才能發聲：第一次點擊時呼叫 unlock()。
 * 同時發聲數有上限（多人同場時不會爆音）；其他玩家的音量較小。
 */
import type { SfxKey } from "../core/skills.ts";

export class CombatAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  volume = 0.7;
  private voices = 0;
  readonly maxVoices = 14;
  played = 0;

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1.0);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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

  play(key: SfxKey, gain = 1): void {
    const c = this.ctx;
    const out = this.master;
    if (!this.enabled || !c || !out || !this.noise || c.state !== "running") return;
    if (this.voices >= this.maxVoices) return;
    this.voices++;
    this.played++;
    const t = c.currentTime + 0.005;
    const end = (s: number) => window.setTimeout(() => (this.voices = Math.max(0, this.voices - 1)), s * 1000 + 50);
    const env = (g: GainNode, a: number, peak: number, d: number) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * gain), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    };
    const noiseSrc = (f0: number, f1: number, q: number, type: BiquadFilterType, peak: number, a: number, d: number) => {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + a + d);
      const g = c.createGain();
      env(g, a, peak, d);
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random() * 0.5);
      s.stop(t + a + d + 0.05);
    };
    const tone = (type: OscillatorType, f0: number, f1: number, peak: number, a: number, d: number, delay = 0) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + delay + a + d);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * gain), t + delay + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + a + d);
      o.connect(g).connect(out);
      o.start(t + delay);
      o.stop(t + delay + a + d + 0.05);
    };
    switch (key) {
      case "swish":
        noiseSrc(900, 4200, 1.2, "bandpass", 0.5, 0.03, 0.14);
        end(0.2);
        break;
      case "swishHeavy":
        noiseSrc(500, 3000, 0.9, "bandpass", 0.7, 0.05, 0.24);
        tone("sine", 220, 110, 0.15, 0.03, 0.2);
        end(0.3);
        break;
      case "whirl":
        for (let i = 0; i < 4; i++) {
          const s = c.createBufferSource();
          s.buffer = this.noise;
          const f = c.createBiquadFilter();
          f.type = "bandpass";
          f.Q.value = 1.4;
          f.frequency.setValueAtTime(1400 + i * 200, t + i * 0.26);
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, t + i * 0.26);
          g.gain.exponentialRampToValueAtTime(0.45 * gain, t + i * 0.26 + 0.06);
          g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.26 + 0.22);
          s.connect(f).connect(g).connect(out);
          s.start(t + i * 0.26, Math.random() * 0.5);
          s.stop(t + i * 0.26 + 0.3);
        }
        end(1.2);
        break;
      case "hit":
        noiseSrc(3000, 900, 0.8, "bandpass", 0.8, 0.003, 0.09);
        tone("triangle", 1250, 900, 0.22, 0.002, 0.12);
        tone("sine", 180, 70, 0.4, 0.003, 0.1);
        end(0.2);
        break;
      case "hitHeavy":
        noiseSrc(2200, 400, 0.7, "bandpass", 1, 0.004, 0.18);
        tone("sine", 140, 45, 0.8, 0.004, 0.25);
        tone("triangle", 900, 600, 0.2, 0.002, 0.2);
        end(0.35);
        break;
      case "crit":
        tone("sine", 1568, 1568, 0.25, 0.005, 0.35);
        tone("sine", 2093, 2093, 0.18, 0.005, 0.4, 0.05);
        tone("sine", 2637, 2637, 0.14, 0.005, 0.45, 0.1);
        end(0.6);
        break;
      case "cast":
        [784, 988, 1175, 1568].forEach((f, i) => tone("sine", f, f * 1.01, 0.12, 0.02, 0.5, i * 0.07));
        noiseSrc(6000, 9000, 2, "highpass", 0.08, 0.2, 0.5);
        end(0.9);
        break;
      case "charge":
        tone("sawtooth", 110, 440, 0.08, 0.9, 0.2);
        tone("sine", 220, 880, 0.1, 0.95, 0.15);
        noiseSrc(400, 3000, 1, "bandpass", 0.18, 0.9, 0.15);
        end(1.2);
        break;
      case "release":
        tone("sine", 1200, 300, 0.25, 0.01, 0.35);
        noiseSrc(5000, 1200, 1, "bandpass", 0.3, 0.01, 0.3);
        end(0.4);
        break;
      case "bolt":
        tone("sine", 900, 1800, 0.18, 0.02, 0.25);
        noiseSrc(2000, 6000, 3, "bandpass", 0.25, 0.02, 0.3);
        end(0.35);
        break;
      case "magicHit":
        tone("sine", 1400, 500, 0.3, 0.003, 0.25);
        noiseSrc(4000, 900, 1, "bandpass", 0.5, 0.003, 0.2);
        end(0.3);
        break;
      case "explosion":
        noiseSrc(1800, 120, 0.6, "lowpass", 1.1, 0.01, 0.7);
        tone("sine", 90, 35, 0.9, 0.01, 0.6);
        tone("sine", 1800, 1800, 0.12, 0.01, 0.6, 0.05);
        end(0.8);
        break;
      case "jump":
        noiseSrc(600, 1800, 1, "bandpass", 0.3, 0.02, 0.15);
        end(0.2);
        break;
      case "land":
        tone("sine", 110, 40, 0.6, 0.004, 0.3);
        noiseSrc(800, 150, 0.7, "lowpass", 0.7, 0.004, 0.35);
        end(0.4);
        break;
    }
  }
}
