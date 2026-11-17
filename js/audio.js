'use strict';

// All sounds are synthesized with WebAudio - no audio files needed.
const Sound = (() => {
  let ctx = null, master, sfx, boomBus, musicGain, noiseBuf, brownBuf, shaper, reverb;
  let musicWanted = false, musicTimer = null, nextTime = 0, step = 0, tempo = 132;
  const last = {};

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    // master -> compressor (keeps chain reactions loud but clean) -> speakers
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(comp);
    sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
    // explosions get their own, quieter bus
    boomBus = ctx.createGain(); boomBus.gain.value = 0.15; boomBus.connect(sfx);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // brown noise (deep rumble)
    brownBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const bd = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    // soft-clipping distortion for a gritty blast
    shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.5); }
    shaper.curve = curve; shaper.oversample = '2x';
    shaper.connect(boomBus);
    // generated room reverb for explosions
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 1.8;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverb.buffer = ir;
    const revGain = ctx.createGain(); revGain.gain.value = 0.35;
    reverb.connect(revGain).connect(boomBus);
    if (musicWanted) startMusic();
  }

  function tone(o) {
    const t = (o.at !== undefined ? o.at : ctx.currentTime) + (o.when || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const vol = o.vol || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g).connect(o.dest || sfx);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  function noise(o) {
    const t = (o.at !== undefined ? o.at : ctx.currentTime) + (o.when || 0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.filter || 'lowpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.3, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(o.dest || sfx);
    src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.05);
  }

  const lib = {
    place() { tone({ type: 'sine', f0: 220, f1: 90, dur: 0.12, vol: 0.35 }); noise({ f0: 2500, dur: 0.03, vol: 0.08, filter: 'highpass' }); },
    // Layered explosion: crack + distorted blast + sub-bass drop + rumble tail + room reverb.
    explode(range) {
      const big = Math.min(1, ((range || 2) - 1) / 6);   // 0 = small blast, 1 = huge
      const t = ctx.currentTime;
      const pitch = 0.9 + Math.random() * 0.2;
      const env = (g, peak, attack, dur) => {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      };
      const src = (buf, dur) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.1); return s; };

      // 1) crack: very short bright transient
      {
        const s = src(noiseBuf, 0.1), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'highpass'; f.frequency.value = 1500;
        env(g, 0.45, 0.001, 0.09);
        s.connect(f).connect(g).connect(boomBus);
      }
      // 2) body: noise blast swept from bright to dull, through distortion
      const bodyDur = 1.0 + big * 0.6;
      {
        const s = src(noiseBuf, bodyDur), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'lowpass'; f.Q.value = 0.7;
        f.frequency.setValueAtTime(4500 * pitch, t);
        f.frequency.exponentialRampToValueAtTime(700, t + 0.12);
        f.frequency.exponentialRampToValueAtTime(90, t + bodyDur);
        env(g, 0.9, 0.004, bodyDur);
        s.connect(f).connect(g);
        g.connect(shaper);
        g.connect(reverb);
      }
      // 3) sub-bass drop: the "boom" you feel
      {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(95 * pitch, t);
        o.frequency.exponentialRampToValueAtTime(25, t + 0.7 + big * 0.4);
        env(g, 1.0, 0.006, 0.8 + big * 0.5);
        o.connect(g).connect(shaper);
        o.start(t); o.stop(t + 1.5);
      }
      // 4) rumble tail
      {
        const dur = 1.6 + big * 0.9;
        const s = src(brownBuf, dur), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'lowpass'; f.frequency.value = 220;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.7 + big * 0.3, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(boomBus);
        g.connect(reverb);
      }
      // 5) a few debris crackles
      for (let i = 0; i < 4; i++) {
        noise({ f0: 2500 + Math.random() * 2500, dur: 0.04, vol: 0.08, filter: 'bandpass', q: 4, when: 0.08 + Math.random() * 0.4 });
      }
    },
    kick() { tone({ type: 'sine', f0: 300, f1: 80, dur: 0.1, vol: 0.35 }); noise({ f0: 1200, dur: 0.06, vol: 0.15 }); },
    punch() { noise({ f0: 400, f1: 3000, dur: 0.25, vol: 0.2, filter: 'bandpass', q: 3 }); tone({ type: 'sine', f0: 180, f1: 90, dur: 0.08, vol: 0.3 }); },
    land() { tone({ type: 'sine', f0: 160, f1: 60, dur: 0.12, vol: 0.3 }); },
    bonk() { tone({ type: 'square', f0: 900, f1: 300, dur: 0.15, vol: 0.12 }); tone({ type: 'sine', f0: 120, f1: 60, dur: 0.12, vol: 0.3 }); },
    pickup() { [660, 880, 1320].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.08, vol: 0.1, when: i * 0.055 })); },
    skull() {
      tone({ type: 'sawtooth', f0: 300, f1: 90, dur: 0.6, vol: 0.12 });
      tone({ type: 'sawtooth', f0: 310, f1: 95, dur: 0.6, vol: 0.1 });
    },
    egg() { [520, 780, 1040, 1560].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.1, vol: 0.18, when: i * 0.05 })); },
    die() {
      tone({ type: 'square', f0: 700, f1: 80, dur: 0.7, vol: 0.14 });
      tone({ type: 'triangle', f0: 350, f1: 50, dur: 0.7, vol: 0.2 });
    },
    mountLost() { tone({ type: 'square', f0: 1200, f1: 400, dur: 0.25, vol: 0.12 }); tone({ type: 'square', f0: 900, f1: 300, dur: 0.25, vol: 0.1, when: 0.12 }); },
    beep() { tone({ type: 'square', f0: 520, dur: 0.15, vol: 0.15 }); },
    go() { tone({ type: 'square', f0: 1040, dur: 0.35, vol: 0.18 }); tone({ type: 'square', f0: 1560, dur: 0.35, vol: 0.1 }); },
    hurry() {
      for (let i = 0; i < 4; i++) {
        tone({ type: 'sawtooth', f0: 600, f1: 900, dur: 0.22, vol: 0.12, when: i * 0.25 });
      }
    },
    thud() { tone({ type: 'sine', f0: 140, f1: 40, dur: 0.2, vol: 0.4 }); noise({ f0: 600, f1: 100, dur: 0.15, vol: 0.2 }); },
    warp() { tone({ type: 'sine', f0: 300, f1: 1800, dur: 0.25, vol: 0.15 }); },
    click() { tone({ type: 'square', f0: 1500, dur: 0.04, vol: 0.12 }); },
    tick() { tone({ type: 'square', f0: 880, dur: 0.04, vol: 0.06 }); },
    select() { tone({ type: 'square', f0: 660, dur: 0.06, vol: 0.1 }); tone({ type: 'square', f0: 990, dur: 0.08, vol: 0.1, when: 0.06 }); },
    win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.16, vol: 0.12, when: i * 0.12 })); },
    draw() { [440, 415, 392, 330].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.2, vol: 0.18, when: i * 0.16 })); },
    jump() { tone({ type: 'square', f0: 300, f1: 1200, dur: 0.22, vol: 0.12 }); },
    dash() { noise({ f0: 600, f1: 4000, dur: 0.3, vol: 0.2, filter: 'bandpass', q: 2 }); tone({ type: 'sawtooth', f0: 200, f1: 600, dur: 0.2, vol: 0.08 }); },
    ghost() { tone({ type: 'sine', f0: 500, f1: 900, dur: 0.4, vol: 0.12 }); tone({ type: 'sine', f0: 505, f1: 905, dur: 0.4, vol: 0.1, when: 0.05 }); },
    cured() { tone({ type: 'sine', f0: 600, f1: 1200, dur: 0.2, vol: 0.12 }); },
  };

  function play(name, arg) {
    if (!ctx || !lib[name]) return;
    const now = ctx.currentTime;
    // chain reactions: don't stack dozens of identical booms in the same instant
    const gap = name === 'explode' ? 0.15 : 0.04;
    if (last[name] && now - last[name] < gap) return;
    last[name] = now;
    try { lib[name](arg); } catch (e) { console.warn('sound', name, e); }
  }

  // ---------- simple procedural music loop ----------
  // A minor / F / C / G with bass, drums and an arpeggio.
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  function scheduleStep(s, t) {
    const bar = Math.floor(s / 16) % 4, i = s % 16;
    const ch = CHORDS[bar];
    const sixteenth = 60 / tempo / 4;
    // drums
    if (i % 4 === 0) tone({ type: 'sine', f0: 150, f1: 40, dur: 0.18, vol: 0.9, at: t, dest: musicGain });
    if (i === 4 || i === 12) noise({ f0: 1800, dur: 0.12, vol: 0.35, filter: 'bandpass', q: 0.8, at: t, dest: musicGain });
    if (i % 2 === 1) noise({ f0: 7000, dur: 0.04, vol: 0.15, filter: 'highpass', at: t, dest: musicGain });
    // bass
    if (i % 2 === 0) {
      const n = ch[0] - 24 + (i % 8 === 6 ? 12 : 0);
      tone({ type: 'triangle', f0: midi(n), dur: sixteenth * 1.8, vol: 0.55, at: t, dest: musicGain });
    }
    // arpeggio
    if (i % 2 === 0) {
      const n = ch[(i / 2) % 3] + 12;
      tone({ type: 'square', f0: midi(n), dur: sixteenth * 0.9, vol: 0.06, at: t, dest: musicGain });
    }
  }

  function startMusic() {
    if (!ctx || musicTimer) return;
    nextTime = ctx.currentTime + 0.1; step = 0;
    musicTimer = setInterval(() => {
      while (nextTime < ctx.currentTime + 0.15) {
        scheduleStep(step, nextTime);
        nextTime += 60 / tempo / 4;
        step++;
      }
    }, 30);
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

  return {
    init, play,
    setMusic(on) { musicWanted = on; if (on) startMusic(); else stopMusic(); },
    setTempo(bpm) { tempo = bpm; },
  };
})();
