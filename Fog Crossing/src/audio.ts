// Fully procedural horror audio — zero sound files. Everything is
// synthesized: drone bed, wind, hops, thuds, train, heartbeat, the Static.
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private droneGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private hissGain!: GainNode;       // The Static's proximity hiss
  private heartGain!: GainNode;
  private heartTimer = 0;
  private heartPeriod = 1.0;
  private verb!: ConvolverNode;
  started = false;

  /** Must be called from a user gesture (iOS requirement). */
  start() {
    if (this.started) return;
    this.started = true;
    const ctx = new AudioContext();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);

    // Tiny generated impulse response — "outdoors but claustrophobic".
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.makeImpulse(1.4, 3.5);
    const verbGain = ctx.createGain(); verbGain.gain.value = 0.35;
    this.verb.connect(verbGain); verbGain.connect(this.master);

    this.noiseBuf = this.makeNoise(4);

    // ---- Drone bed: two detuned saws through a slow-breathing lowpass ----
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass'; droneFilter.frequency.value = 160; droneFilter.Q.value = 2;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.0;
    droneFilter.connect(this.droneGain); this.droneGain.connect(this.master);
    for (const f of [54, 54.6, 108.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = f > 100 ? 0.12 : 0.3;
      o.connect(g); g.connect(droneFilter); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 60;
    lfo.connect(lfoG); lfoG.connect(droneFilter.frequency); lfo.start();

    // ---- Ash wind: looped noise through a wandering bandpass ----
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf; wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 420; this.windFilter.Q.value = 1.6;
    const windGain = ctx.createGain(); windGain.gain.value = 0.05;
    wind.connect(this.windFilter); this.windFilter.connect(windGain);
    windGain.connect(this.master); windGain.connect(this.verb);
    wind.start();
    const wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.11;
    const wlfoG = ctx.createGain(); wlfoG.gain.value = 220;
    wlfo.connect(wlfoG); wlfoG.connect(this.windFilter.frequency); wlfo.start();

    // ---- The Static: white hiss, gain driven by proximity ----
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noiseBuf; hiss.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 2600;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0;
    hiss.connect(hf); hf.connect(this.hissGain); this.hissGain.connect(this.master);
    hiss.start();

    // ---- Heartbeat bus ----
    this.heartGain = ctx.createGain(); this.heartGain.gain.value = 0;
    this.heartGain.connect(this.master);
  }

  setDroneLevel(v: number) { if (this.ctx) this.droneGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5); }
  setStaticProximity(v: number) { if (this.ctx) this.hissGain.gain.setTargetAtTime(v * 0.28, this.ctx.currentTime, 0.3); }

  /** dt seconds; sanity 0..100 — heartbeat surfaces below 40. */
  tick(dt: number, sanity: number) {
    if (!this.ctx) return;
    const fear = Math.max(0, (40 - sanity) / 40);
    this.heartGain.gain.setTargetAtTime(fear * 0.7, this.ctx.currentTime, 0.4);
    this.heartPeriod = 1.05 - fear * 0.45;
    if (fear > 0.02) {
      this.heartTimer += dt;
      if (this.heartTimer >= this.heartPeriod) {
        this.heartTimer = 0;
        this.thump(0.9); setTimeout(() => this.thump(0.55), 180);
      }
    }
  }

  private thump(vel: number) {
    const ctx = this.ctx!; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(this.heartGain); o.start(t); o.stop(t + 0.2);
  }

  hop() {
    if (!this.ctx) return;
    const ctx = this.ctx; const t = ctx.currentTime;
    // soft footfall: filtered noise tick + low knock
    this.burst(900 + Math.random() * 400, 0.05, 0.16, 'highpass');
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(120 + Math.random() * 30, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); g.connect(this.master); g.connect(this.verb);
    o.start(t); o.stop(t + 0.12);
  }

  bump() {
    if (!this.ctx) return;
    const ctx = this.ctx; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(85, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.22);
  }

  nearMiss() { this.burst(500, 0.22, 0.2, 'bandpass', 0.35); }

  trainHum(on: boolean) {
    if (!this.ctx) return;
    if (on) this.humStart(); else this.humStop();
  }
  private humOsc: OscillatorNode | null = null;
  private humG: GainNode | null = null;
  private humStart() {
    if (this.humOsc) return;
    const ctx = this.ctx!; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 92;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 93.5;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 1.2);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master); g.connect(this.verb);
    o.start(); o2.start();
    this.humOsc = o; this.humG = g;
    (o as any)._pair = o2;
  }
  private humStop() {
    if (!this.humOsc || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.humG!.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    const o = this.humOsc, o2 = (o as any)._pair as OscillatorNode;
    o.stop(t + 0.35); o2.stop(t + 0.35);
    this.humOsc = null; this.humG = null;
  }

  trainPass() {
    if (!this.ctx) return;
    this.humStop();
    // roaring swept noise
    const ctx = this.ctx; const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
    f.frequency.exponentialRampToValueAtTime(150, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.85, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(f); f.connect(g); g.connect(this.master); g.connect(this.verb);
    src.start(t); src.stop(t + 1.9);
  }

  death() {
    if (!this.ctx) return;
    const ctx = this.ctx; const t = ctx.currentTime;
    // descending scream-adjacent saw cluster + crash
    for (const [f0, f1, del] of [[420, 60, 0], [640, 90, 0.05], [310, 40, 0.02]] as const) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t + del);
      o.frequency.exponentialRampToValueAtTime(f1, t + del + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + del);
      g.gain.exponentialRampToValueAtTime(0.22, t + del + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + del + 1.3);
      o.connect(g); g.connect(this.master); g.connect(this.verb);
      o.start(t + del); o.stop(t + del + 1.4);
    }
    this.burst(300, 0.9, 0.5, 'lowpass', 0.8);
  }

  sanityLow(on: boolean) {
    if (!this.ctx) return;
    // detune the world: wind filter destabilizes
    this.windFilter.Q.setTargetAtTime(on ? 6 : 1.6, this.ctx.currentTime, 1.0);
  }

  private burst(freq: number, dur: number, vol: number, type: BiquadFilterType = 'bandpass', q = 1) {
    const ctx = this.ctx!; const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); g.connect(this.verb);
    src.start(t); src.stop(t + dur + 0.05);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
