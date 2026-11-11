// Ambiance NUÉE — WebAudio procédural : drone, vent, signal, appels des créatures
import { clamp } from './noise.js';

export class Ambience {
  constructor() {
    this.ctx = null;
    this.started = false;
  }

  init() {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    // montée en douceur
    this.master.gain.linearRampToValueAtTime(0.75, ctx.currentTime + 3);

    // — retard global, respiration de l'espace —
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.31;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.delay.connect(fb); fb.connect(this.delay);
    this.delay.connect(wet); wet.connect(this.master);

    // — drone : deux voix désaccordées + quinte lente —
    this.droneLP = ctx.createBiquadFilter();
    this.droneLP.type = 'lowpass';
    this.droneLP.frequency.value = 420;
    const droneG = ctx.createGain(); droneG.gain.value = 0.16;
    this.droneLP.connect(droneG); droneG.connect(this.master);
    const mk = (type, freq, g) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og); og.connect(this.droneLP); o.start();
      return { o, og };
    };
    mk('sine', 55, 0.5);
    mk('triangle', 110.4, 0.22);
    this.fifth = mk('sine', 164.8, 0.0);
    // LFO sur le filtre
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.02;
    const lfoG = ctx.createGain(); lfoG.gain.value = 180;
    lfo.connect(lfoG); lfoG.connect(this.droneLP.frequency); lfo.start();

    // — vent : bruit filtré, gain lié à la vitesse —
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.03 * w) / 1.03; // brownien léger
      d[i] = last * 3;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    this.windBP = ctx.createBiquadFilter();
    this.windBP.type = 'bandpass';
    this.windBP.frequency.value = 480;
    this.windBP.Q.value = 0.5;
    this.windG = ctx.createGain(); this.windG.gain.value = 0.0;
    noise.connect(this.windBP); this.windBP.connect(this.windG);
    this.windG.connect(this.master);
    noise.start();

    this.nightTimer = 8;
  }

  update(dt, speed, night) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // vent proportionnel à la vitesse
    const wind = clamp(speed / 90, 0, 1);
    this.windG.gain.setTargetAtTime(0.02 + wind * 0.16, t, 0.4);
    this.windBP.frequency.setTargetAtTime(380 + wind * 640, t, 0.6);
    // la quinte s'ouvre la nuit
    this.fifth.og.gain.setTargetAtTime(night * 0.12, t, 2);

    // cloches éparses la nuit
    if (night > 0.5) {
      this.nightTimer -= dt;
      if (this.nightTimer <= 0) {
        this.nightTimer = 14 + Math.random() * 22;
        const notes = [440, 554.4, 659.3, 830.6];
        this.bell(notes[(Math.random() * notes.length) | 0], 0.035);
      }
    }
  }

  bell(freq, gain = 0.05, when = 0) {
    if (!this.started) return;
    const ctx = this.ctx, t0 = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.76;
    const g = ctx.createGain(); const g2 = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + 3.2);
    g2.gain.setValueAtTime(0, t0);
    g2.gain.linearRampToValueAtTime(gain * 0.3, t0 + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.9);
    o.connect(g); o2.connect(g2);
    g.connect(this.master); g.connect(this.delay);
    g2.connect(this.master);
    o.start(t0); o2.start(t0);
    o.stop(t0 + 3.4); o2.stop(t0 + 1);
  }

  // signal du joueur : accord pentatonique égrené
  ping() {
    if (!this.started) return;
    const notes = [277.2, 329.6, 415.3];
    notes.forEach((f, i) => this.bell(f, 0.055, i * 0.07));
  }

  // relevé enregistré : double note brève
  confirm() {
    if (!this.started) return;
    this.bell(523.3, 0.045, 0);
    this.bell(784.0, 0.04, 0.12);
  }

  // réponses des créatures
  answer(type, delay) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    if (type === 'walker') {
      // corne grave, glissando lent
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(46, t0);
      o.frequency.linearRampToValueAtTime(58, t0 + 1.6);
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 27.5;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.22, t0 + 0.5);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 3.4);
      o.connect(lp); sub.connect(lp); lp.connect(g);
      g.connect(this.master); g.connect(this.delay);
      o.start(t0); sub.start(t0); o.stop(t0 + 3.6); sub.stop(t0 + 3.6);
    } else if (type === 'manta') {
      // raie : arpège bref, presque un pépiement
      [660, 880, 1108.7].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const g = ctx.createGain();
        const tt = t0 + i * 0.09;
        g.gain.setValueAtTime(0, tt);
        g.gain.linearRampToValueAtTime(0.035, tt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.7);
        o.connect(g); g.connect(this.master); g.connect(this.delay);
        o.start(tt); o.stop(tt + 0.8);
      });
    } else {
      // méduse : cloche FM haute
      const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = 528;
      const mod = ctx.createOscillator(); mod.frequency.value = 132;
      const mg = ctx.createGain(); mg.gain.setValueAtTime(320, t0);
      mg.gain.exponentialRampToValueAtTime(4, t0 + 1.8);
      mod.connect(mg); mg.connect(car.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.06, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0006, t0 + 2.6);
      car.connect(g); g.connect(this.master); g.connect(this.delay);
      car.start(t0); mod.start(t0);
      car.stop(t0 + 2.8); mod.stop(t0 + 2.8);
    }
  }
}
