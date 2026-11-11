// Shattermoon Vanguard — all sounds generated live with WebAudio (no audio files).
let ctx = null, master = null, sfxBus = null, noiseBuf = null, muted = false, ambient = null;
const lastPlay = {};

export function initAudio() {
  if (ctx) { if (ctx.state !== 'running') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(comp);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startAmbient();
}
export function setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.05); }
export const isMuted = () => muted;

function throttle(key, ms) { const n = performance.now(); if (lastPlay[key] && n - lastPlay[key] < ms) return true; lastPlay[key] = n; return false; }
function env(g, t, a, peak, dec) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function noise(t, { dur = 0.2, type = 'lowpass', f = 2000, f2 = null, q = 1, peak = 0.5, a = 0.002 } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
  const g = ctx.createGain(); env(g, t, a, peak, dur);
  s.connect(fl); fl.connect(g); g.connect(sfxBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function tone(t, { type = 'sine', f = 440, f2 = null, dur = 0.2, peak = 0.3, a = 0.004 } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak, dur); o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + a + dur + 0.05);
}
function startAmbient() {
  const t = ctx.currentTime; const g = ctx.createGain(); g.gain.value = 0.05; g.connect(master);
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 420; fl.connect(g);
  [55, 82.4, 110.2].forEach((f, i) => { const o = ctx.createOscillator(); o.type = i === 1 ? 'triangle' : 'sawtooth'; o.frequency.value = f; o.detune.value = (i - 1) * 7; o.connect(fl); o.start(t); });
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(fl.frequency); lfo.start(t);
  ambient = g;
}
const ok = () => ctx && !muted && ctx.state === 'running';

export const sfx = {
  shot(arch) {
    if (!ok()) return; const t = ctx.currentTime;
    switch (arch) {
      case 'auto': noise(t, { dur: 0.09, f: 3200, f2: 600, peak: 0.35 }); tone(t, { type: 'square', f: 160, f2: 60, dur: 0.06, peak: 0.18 }); break;
      case 'pulse': noise(t, { dur: 0.07, type: 'bandpass', f: 2600, q: 2, peak: 0.45 }); tone(t, { type: 'sawtooth', f: 520, f2: 180, dur: 0.06, peak: 0.12 }); break;
      case 'hand': noise(t, { dur: 0.32, f: 2400, f2: 200, peak: 0.7 }); tone(t, { type: 'sine', f: 110, f2: 40, dur: 0.25, peak: 0.5 }); break;
      case 'scout': noise(t, { dur: 0.18, type: 'bandpass', f: 1800, f2: 500, q: 1.4, peak: 0.6 }); tone(t, { type: 'triangle', f: 300, f2: 90, dur: 0.12, peak: 0.25 }); break;
      case 'rocket': noise(t, { dur: 0.6, f: 900, f2: 200, peak: 0.6, a: 0.02 }); tone(t, { type: 'sawtooth', f: 90, f2: 50, dur: 0.4, peak: 0.25 }); break;
      case 'mg': noise(t, { dur: 0.1, f: 2200, f2: 400, peak: 0.45 }); tone(t, { type: 'square', f: 120, f2: 50, dur: 0.08, peak: 0.22 }); break;
      default: noise(t, { dur: 0.1, f: 2000, peak: 0.4 });
    }
  },
  hit(crit) { if (!ok() || throttle('hit', 35)) return; const t = ctx.currentTime; tone(t, { type: 'triangle', f: crit ? 1800 : 1100, dur: 0.05, peak: crit ? 0.22 : 0.12 }); if (crit) tone(t + 0.03, { type: 'sine', f: 2600, dur: 0.06, peak: 0.12 }); },
  kill() { if (!ok()) return; const t = ctx.currentTime; tone(t, { type: 'square', f: 700, f2: 300, dur: 0.12, peak: 0.12 }); noise(t, { dur: 0.25, type: 'highpass', f: 3000, peak: 0.15 }); },
  explode(big = false) { if (!ok() || throttle('ex', 40)) return; const t = ctx.currentTime; noise(t, { dur: big ? 1.4 : 0.8, f: 1400, f2: 80, peak: big ? 0.9 : 0.7, a: 0.005 }); tone(t, { type: 'sine', f: 90, f2: 28, dur: big ? 1.0 : 0.6, peak: 0.6 }); },
  enemyShot() { if (!ok() || throttle('es', 50)) return; const t = ctx.currentTime; tone(t, { type: 'sawtooth', f: 900, f2: 240, dur: 0.14, peak: 0.08 }); },
  telegraph() { if (!ok() || throttle('tg', 120)) return; const t = ctx.currentTime; tone(t, { type: 'sine', f: 300, f2: 900, dur: 0.35, peak: 0.07 }); },
  hurt() { if (!ok() || throttle('hurt', 120)) return; const t = ctx.currentTime; noise(t, { dur: 0.18, f: 600, peak: 0.35 }); tone(t, { type: 'sine', f: 140, f2: 70, dur: 0.15, peak: 0.25 }); },
  shieldBreak() { if (!ok()) return; const t = ctx.currentTime; noise(t, { dur: 0.5, type: 'highpass', f: 2500, peak: 0.4 }); tone(t, { type: 'triangle', f: 1400, f2: 300, dur: 0.4, peak: 0.2 }); },
  pickup(r) { if (!ok()) return; const t = ctx.currentTime; const base = [520, 620, 700, 784][r] || 520; [1, 1.25, 1.5, 2].slice(0, 2 + r).forEach((m, i) => tone(t + i * 0.07, { type: 'triangle', f: base * m, dur: 0.25, peak: 0.16 })); },
  reload() { if (!ok()) return; const t = ctx.currentTime; noise(t, { dur: 0.05, type: 'bandpass', f: 3000, q: 4, peak: 0.25 }); noise(t + 0.25, { dur: 0.06, type: 'bandpass', f: 2200, q: 4, peak: 0.3 }); },
  dry() { if (!ok() || throttle('dry', 200)) return; tone(ctx.currentTime, { type: 'square', f: 1600, dur: 0.02, peak: 0.08 }); },
  jump() { if (!ok()) return; noise(ctx.currentTime, { dur: 0.12, f: 800, peak: 0.12 }); },
  grenade() { if (!ok()) return; const t = ctx.currentTime; tone(t, { type: 'sine', f: 400, f2: 1200, dur: 0.18, peak: 0.15 }); },
  melee() { if (!ok()) return; const t = ctx.currentTime; noise(t, { dur: 0.15, f: 1200, f2: 300, peak: 0.5 }); tone(t, { type: 'sine', f: 120, f2: 60, dur: 0.12, peak: 0.4 }); },
  zap() { if (!ok() || throttle('zap', 60)) return; const t = ctx.currentTime; noise(t, { dur: 0.12, type: 'bandpass', f: 4000, q: 3, peak: 0.3 }); tone(t, { type: 'sawtooth', f: 1200, f2: 2400, dur: 0.08, peak: 0.08 }); },
  superCast() { if (!ok()) return; const t = ctx.currentTime; tone(t, { type: 'sawtooth', f: 110, f2: 880, dur: 0.8, peak: 0.25, a: 0.05 }); noise(t, { dur: 1.0, f: 300, f2: 4000, peak: 0.35, a: 0.1 }); tone(t + 0.1, { type: 'triangle', f: 440, f2: 1320, dur: 0.7, peak: 0.15 }); },
  wave() { if (!ok()) return; const t = ctx.currentTime; [220, 277, 330].forEach((f, i) => tone(t + i * 0.12, { type: 'sawtooth', f, dur: 0.9, peak: 0.08, a: 0.05 })); },
  boss() { if (!ok()) return; const t = ctx.currentTime; tone(t, { type: 'sawtooth', f: 55, dur: 2.2, peak: 0.3, a: 0.2 }); tone(t, { type: 'sawtooth', f: 58.3, dur: 2.2, peak: 0.25, a: 0.2 }); noise(t, { dur: 2, f: 200, f2: 1200, peak: 0.25, a: 0.5 }); },
  victory() { if (!ok()) return; const t = ctx.currentTime; [392, 494, 587, 784].forEach((f, i) => tone(t + i * 0.15, { type: 'triangle', f, dur: 0.8, peak: 0.18 })); },
  click() { if (!ok()) return; tone(ctx.currentTime, { type: 'triangle', f: 900, dur: 0.04, peak: 0.1 }); },
};
