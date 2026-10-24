/* 取经小英雄 · 声音引擎：西游中国风 8-bit
   全部用 Web Audio 实时合成：掌机方波/三角波 + 模拟笛子、古筝、木鱼、锣、钹。
   曲谱用简谱写：1-7 是音，' 升八度，, 降八度，- 延长，0 休止。 */
(function(){
'use strict';
const SEMI = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

const AU = {
  ctx: null, master: null, musicBus: null, duckBus: null, sfxBus: null,
  vol: { music: .45, sfx: .8 }, muted: false,
  _waves: {}, _noise: null, cur: null, curName: '', timer: null,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 1;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.musicBus = c.createGain(); this.duckBus = c.createGain(); this.sfxBus = c.createGain();
    this.musicBus.connect(this.duckBus); this.duckBus.connect(this.master); this.sfxBus.connect(this.master);
    this.setVol(this.vol.music, this.vol.sfx);
    const n = c.sampleRate * 1.5, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this._noise = b;
    // iOS：先播一个无声的 buffer 解锁
    const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0);
    return c;
  },
  setVol(m, s) {
    if (m != null) this.vol.music = m; if (s != null) this.vol.sfx = s;
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.vol.music * .85, t, .05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, .05);
  },
  setMuted(v) { this.muted = v; if (this.master) this.master.gain.setTargetAtTime(v ? 0 : 1, this.ctx.currentTime, .05); },
  // 出题时把音乐压低一点
  duck(on) { if (!this.ctx) return; this.duckBus.gain.setTargetAtTime(on ? .45 : 1, this.ctx.currentTime, .25); },

  // ---------- 基础音色 ----------
  wave(duty) {
    if (this._waves[duty]) return this._waves[duty];
    const N = 64, re = new Float32Array(N), im = new Float32Array(N);
    for (let k = 1; k < N; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return (this._waves[duty] = this.ctx.createPeriodicWave(re, im));
  },
  env(g, t, v, a, d, hold = 0) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); if (hold) g.gain.setValueAtTime(v, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d); },
  osc(type, f, t, dur, v, dest, o = {}) {
    const c = this.ctx, os = c.createOscillator(), g = c.createGain();
    if (type === 'pulse') os.setPeriodicWave(this.wave(o.duty || .25)); else os.type = type;
    os.frequency.setValueAtTime(f, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || dur));
    if (o.from) { os.frequency.setValueAtTime(o.from, t); os.frequency.exponentialRampToValueAtTime(f, t + (o.glide || .05)); }
    if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * (o.vibDepth || .012), t + Math.min(dur, .25)); l.connect(lg); lg.connect(os.frequency); l.start(t); l.stop(t + dur + .3); }
    let out = g;
    if (o.lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(o.lp, t); if (o.lpTo) fl.frequency.exponentialRampToValueAtTime(o.lpTo, t + dur); g.connect(fl); out = fl; }
    this.env(g, t, v, o.a || .005, o.d != null ? o.d : dur, o.hold || 0);
    os.connect(g); out.connect(dest || this.sfxBus);
    os.start(t); os.stop(t + (o.a || .005) + (o.hold || 0) + (o.d != null ? o.d : dur) + .05);
    return os;
  },
  noise(t, dur, v, dest, o = {}) {
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    s.buffer = this._noise; s.loop = true; f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f || 2000, t); f.Q.value = o.q || 1;
    if (o.fTo) f.frequency.exponentialRampToValueAtTime(o.fTo, t + dur);
    this.env(g, t, v, o.a || .003, dur, o.hold || 0);
    s.connect(f); f.connect(g); g.connect(dest || this.sfxBus); s.start(t, Math.random()); s.stop(t + dur + (o.a || .003) + (o.hold || 0) + .05);
  },

  // ---------- 乐器 ----------
  I: {
    // 掌机方波主旋律
    lead(A, t, f, d, v, dest) { A.osc('pulse', f, t, d, v * .55, dest, { duty: .25, a: .008, d: d * .9, hold: d * .1, vib: 5.5, vibDepth: .006 }); },
    lead50(A, t, f, d, v, dest) { A.osc('pulse', f, t, d, v * .45, dest, { duty: .5, a: .006, d: d * .85, hold: d * .1 }); },
    // 笛子：柔和的正弦 + 一点泛音 + 气声 + 慢慢起来的颤音
    dizi(A, t, f, d, v, dest) {
      A.osc('sine', f, t, d, v * .7, dest, { a: .04, d: d * .6, hold: d * .45, vib: 5.2, vibDepth: .014 });
      A.osc('triangle', f * 2, t, d, v * .12, dest, { a: .05, d: d * .5, hold: d * .4 });
      A.noise(t, .09, v * .12, dest, { f: f * 3, q: 2, a: .01 });
    },
    // 古筝：拨弦，音头从上面滑下来一点，迅速衰减
    zheng(A, t, f, d, v, dest) {
      A.osc('triangle', f, t, d, v * .7, dest, { from: f * 1.03, glide: .04, a: .002, d: Math.max(.35, d * 1.6), lp: 3200, lpTo: 900 });
      A.osc('pulse', f * 2, t, d, v * .12, dest, { duty: .125, a: .002, d: .18 });
    },
    // 低音：三角波
    bass(A, t, f, d, v, dest) { A.osc('triangle', f, t, d, v * .9, dest, { a: .004, d: d * .7, hold: d * .2 }); },
    // 琶音小方波（伴奏）
    arp(A, t, f, d, v, dest) { A.osc('pulse', f, t, d, v * .25, dest, { duty: .125, a: .002, d: Math.min(.16, d) }); },
    // 钟 / 编钟
    bell(A, t, f, d, v, dest) { A.osc('sine', f, t, d, v * .5, dest, { a: .002, d: 1.4 }); A.osc('sine', f * 2.76, t, d, v * .15, dest, { a: .002, d: .5 }); A.osc('sine', f * 5.4, t, d, v * .06, dest, { a: .002, d: .25 }); },
  },
  // 打击乐
  P: {
    k(A, t, v, dest) { A.osc('sine', 150, t, .18, v * .9, dest, { to: 45, glide: .14, d: .2 }); },
    s(A, t, v, dest) { A.noise(t, .12, v * .45, dest, { f: 1800, q: .7 }); A.osc('triangle', 220, t, .08, v * .3, dest, { to: 140, d: .09 }); },
    h(A, t, v, dest) { A.noise(t, .035, v * .18, dest, { type: 'highpass', f: 7000 }); },
    w(A, t, v, dest) { A.osc('sine', 880, t, .06, v * .5, dest, { to: 820, d: .07 }); A.osc('sine', 1760, t, .03, v * .15, dest, { d: .03 }); },   // 木鱼
    W(A, t, v, dest) { A.osc('sine', 620, t, .06, v * .5, dest, { to: 580, d: .08 }); },                                                    // 低木鱼
    g(A, t, v, dest) { A.osc('sine', 110, t, 1.6, v * .5, dest, { to: 92, glide: 1.2, d: 1.8 }); A.osc('sine', 247, t, 1, v * .18, dest, { to: 225, d: 1.1 }); A.noise(t, .4, v * .12, dest, { f: 600, q: 1.5 }); }, // 锣
    c(A, t, v, dest) { A.noise(t, .45, v * .22, dest, { type: 'highpass', f: 5000 }); },                                               // 钹
    x(A, t, v, dest) { A.noise(t, .06, v * .3, dest, { f: 3200, q: 3 }); },                                                              // 板
  },

  // ---------- 简谱 ----------
  parse(str) {
    const out = []; let last = null; (str.replace(/\|/g, ' ').trim().split(/\s+/)).forEach(tok => {
      if (tok === '-') { if (last) last.len++; out.push(null); return; }
      if (tok === '0') { last = null; out.push({ rest: true, len: 1 }); return; }
      const m = tok.match(/^([b#]?)([1-7])(['’]*)([,，]*)$/); if (!m) { out.push({ rest: true, len: 1 }); return; }
      const semi = SEMI[m[2]] + (m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0) + 12 * m[3].length - 12 * m[4].length;
      last = { semi, len: 1 }; out.push(last);
    });
    return out;
  },
  play(name, songs) {
    const song = (songs || this.SONGS)[name]; if (!song || !this.init()) return;
    if (this.curName === name && this.cur) return;
    this.stop(.4);
    const c = this.ctx, bus = c.createGain(); bus.gain.value = 0.0001; bus.connect(this.musicBus);
    bus.gain.exponentialRampToValueAtTime(1, c.currentTime + .3);
    const st = { song, bus, step: 0, t: c.currentTime + .08, voices: song.voices.map(v => Object.assign({}, v, { seq: v.drum ? v.pat.replace(/\|/g, ' ').trim().split(/\s+/) : this.parse(v.pat) })) };
    const total = Math.max(...st.voices.map(v => v.seq.length));
    st.total = total;
    this.cur = st; this.curName = name;
    const spb = 60 / song.bpm / (song.div || 2);
    const tick = () => {
      if (this.cur !== st) return;
      while (st.t < c.currentTime + .15) {
        if (!song.loop && st.step >= total) { const s2 = st; setTimeout(() => { if (this.cur === s2) { this.cur = null; this.curName = ''; } }, 2500); return; }
        st.voices.forEach(v => {
          const i = st.step % v.seq.length, ev = v.seq[i];
          if (v.drum) { if (ev && ev !== '.') [...ev].forEach(ch => this.P[ch] && this.P[ch](this, st.t, v.vol || .6, bus)); return; }
          if (!ev || ev.rest) return;
          const f = mtof(song.key + (v.oct || 0) * 12 + ev.semi);
          this.I[v.inst](this, st.t + (v.delay || 0) * spb, f, ev.len * spb * (v.legato || .95), v.vol || .6, bus);
        });
        st.step++; st.t += spb * (song.swing && st.step % 2 ? 1 + song.swing : song.swing && !(st.step % 2) ? 1 - song.swing : 1);
      }
    };
    tick(); clearInterval(this.timer); this.timer = setInterval(tick, 30);
  },
  stop(fade = .3) {
    const st = this.cur; this.cur = null; this.curName = ''; clearInterval(this.timer);
    if (st && this.ctx) { const t = this.ctx.currentTime; st.bus.gain.cancelScheduledValues(t); st.bus.gain.setValueAtTime(st.bus.gain.value, t); st.bus.gain.exponentialRampToValueAtTime(0.0001, t + fade); setTimeout(() => st.bus.disconnect(), (fade + 2.5) * 1000); }
  },
};

// ================= 曲子（全部原创，五声音阶） =================
const D = (pat, vol = .6) => ({ drum: true, pat, vol });
AU.SONGS = {
  // 花果山：悠闲轻快，笛子主奏，古筝分解和弦
  home: { name: '花果山', bpm: 96, key: 65, div: 2, loop: true, voices: [
    { inst: 'dizi', oct: 1, vol: .55, pat: '5 - 6 1\' 6 - 5 3 | 2 - 3 5 3 - - - | 5 - 6 1\' 2\' - 1\' 6 | 5 - - - 0 0 0 0 | 6 - 1\' 6 5 - 3 5 | 6 5 3 2 1 - - - | 2 3 5 6 5 3 2 3 | 1 - - - 0 0 0 0' },
    { inst: 'zheng', oct: 0, vol: .32, pat: '1 5 1\' 5 3 5 1\' 5 | 5, 2 5 2 7, 2 5 2 | 6, 3 6 3 1 3 6 3 | 5, 2 5 2 5 2 5 2 | 4, 1 4 1 6 1 4 1 | 1 5 1\' 5 3 5 1\' 5 | 2, 6, 2 6, 5, 2 5 2 | 1 5 1\' 5 1 5 1\' 5' },
    { inst: 'bass', oct: -1, vol: .45, pat: '1 - - - 5, - - - | 5, - - - 2 - - - | 6, - - - 3 - - - | 5, - - - 5, - - - | 4, - - - 1 - - - | 1 - - - 6, - - - | 2 - - - 5, - - - | 1 - - - 1 - - -' },
    D('w . . . W . . . w . . . W . . . w . . . W . . . w . . . W . w .', .35),
  ] },
  // 取经路：有往前走的节奏
  map: { name: '取经路', bpm: 112, key: 67, div: 2, loop: true, voices: [
    { inst: 'lead', oct: 1, vol: .5, pat: '1 1 2 3 5 - 3 - | 6 5 3 2 3 - - - | 1 1 2 3 5 - 6 1\' | 6 5 6 1\' 2\' - - - | 3\' 2\' 1\' 6 5 - 6 - | 1\' 6 5 3 2 - - - | 3 5 6 1\' 6 5 3 2 | 1 - 0 1 1 - - -' },
    { inst: 'dizi', oct: 0, vol: .25, pat: '0 0 0 0 0 0 0 0 | 0 0 0 0 0 0 0 0 | 0 0 0 0 0 0 0 0 | 0 0 0 0 0 0 0 0 | 3\' 2\' 1\' 6 5 - 6 - | 1\' 6 5 3 2 - - - | 3 5 6 1\' 6 5 3 2 | 1 - 0 0 0 0 0 0' },
    { inst: 'bass', oct: -1, vol: .5, pat: '1 0 5, 0 1 0 5, 0 | 6, 0 3 0 6, 0 3 0 | 1 0 5, 0 1 0 5, 0 | 2 0 6, 0 2 0 5, 0 | 6, 0 3 0 6, 0 3 0 | 4, 0 1 0 5, 0 2 0 | 1 0 5, 0 6, 0 5, 0 | 1 0 5, 0 1 0 0 0' },
    D('k h x h k h x h | k h x h k h x h | k h x h k h x h | k h x h k h x c | k h x h k h x h | k h x h k h x h | k h x h k h x h | k h x h k . c .', .5),
  ] },
  // 打小怪：羽调式（以 6 为主音），节奏稳，旋律稀
  battle: { name: '拦路小妖', bpm: 126, key: 62, div: 2, loop: true, voices: [
    { inst: 'lead', oct: 1, vol: .42, pat: '6 - 1\' 6 5 - 3 - | 5 6 5 3 2 - - - | 3 - 5 3 2 - 1 2 | 3 - - - 0 0 0 0 | 6 - 1\' 2\' 3\' - 2\' 1\' | 6 - 5 6 1\' - - - | 2\' 1\' 6 5 3 5 6 1\' | 6 - - - 0 0 0 0' },
    { inst: 'arp', oct: 0, vol: .5, pat: '6, 3 6 3 6, 3 6 3 | 5, 2 5 2 5, 2 5 2 | 1 5 1\' 5 1 5 1\' 5 | 6, 3 6 3 6, 3 6 3 | 4, 1 4 1 4, 1 4 1 | 6, 3 6 3 6, 3 6 3 | 2 6 2\' 6 5, 2 5 2 | 6, 3 6 3 6, 3 6 3' },
    { inst: 'bass', oct: -1, vol: .5, pat: '6, 6, 0 6, 3 0 6, 0 | 5, 5, 0 5, 2 0 5, 0 | 1 1 0 1 5, 0 1 0 | 6, 6, 0 6, 3 0 6, 0 | 4, 4, 0 4, 1 0 4, 0 | 6, 6, 0 6, 3 0 6, 0 | 2 2 0 2 5, 0 5, 0 | 6, 6, 0 6, 3 0 6, 0' },
    D('k . h . s . h . | k . h k s . h . | k . h . s . h . | k . h k s . c . | k . h . s . h . | k . h k s . h . | k . h . s . h . | k . h k s x s x', .45),
  ] },
  // 头目战：更紧张，开头一声锣
  boss: { name: '大王来了', bpm: 140, key: 62, div: 2, loop: true, voices: [
    { inst: 'lead50', oct: 1, vol: .45, pat: '6 0 6 0 1\' 6 5 3 | 6 - - 3 5 - 6 - | 1\' 0 1\' 0 2\' 1\' 6 5 | 3 - - 5 6 - - - | 2\' - 1\' 6 5 - 3 5 | 6 - 5 3 2 - 1 2 | 3 3 5 6 1\' 6 5 3 | 6 - - - 6 0 0 0' },
    { inst: 'dizi', oct: 2, vol: .18, pat: '0 0 0 0 0 0 0 0 | 0 0 0 0 0 0 0 0 | 0 0 0 0 0 0 0 0 | 0 0 0 0 0 0 0 0 | 2\' - 1\' 6 5 - 3 5 | 6 - 5 3 2 - 1 2 | 3 3 5 6 1\' 6 5 3 | 6 - - - 0 0 0 0' },
    { inst: 'bass', oct: -1, vol: .55, pat: '6, 6, 6, 6, 6, 6, 6, 6, | 4, 4, 4, 4, 4, 4, 4, 4, | 6, 6, 6, 6, 6, 6, 6, 6, | 3, 3, 3, 3, 5, 5, 5, 5, | 2 2 2 2 2 2 2 2 | 6, 6, 6, 6, 5, 5, 5, 5, | 1 1 1 1 3 3 3 3 | 6, 6, 6, 6, 6, 0 0 0' },
    D('gk . h k s . h . | k . h k s . h k | k . h k s . h . | k . h k s . c . | k . h k s . h . | k . h k s . h k | k . h k s . h . | k k s s k x c .', .5),
  ] },
  // 土地庙小铺 / 宝箱：俏皮，古筝 + 木鱼
  shop: { name: '土地庙小铺', bpm: 100, key: 69, div: 2, loop: true, voices: [
    { inst: 'zheng', oct: 1, vol: .5, pat: '3 5 6 5 3 2 1 2 | 3 - 5 - 6 - - - | 1\' 6 5 6 5 3 2 3 | 1 - - - - - 0 0 | 5 5 6 1\' 6 5 3 5 | 6 - 5 - 3 - - - | 2 3 5 3 2 1 6, 1 | 1 - - - - - 0 0' },
    { inst: 'bass', oct: -1, vol: .4, pat: '1 0 5, 0 1 0 5, 0 | 6, 0 3 0 6, 0 3 0 | 4, 0 1 0 5, 0 2 0 | 1 0 5, 0 1 0 0 0 | 1 0 5, 0 4, 0 1 0 | 6, 0 3 0 6, 0 3 0 | 2 0 6, 0 5, 0 2 0 | 1 0 5, 0 1 0 0 0' },
    D('w . W . w w W . | w . W . w w W . | w . W . w w W . | w . W . w . . . | w . W . w w W . | w . W . w w W . | w . W . w w W . | w . W . w . c .', .45),
  ] },
  // 筋斗云竞速：快
  race: { name: '筋斗云', bpm: 158, key: 64, div: 2, loop: true, voices: [
    { inst: 'lead', oct: 1, vol: .45, pat: '1 2 3 5 6 5 3 2 | 1\' 6 5 3 5 - - - | 6 1\' 2\' 1\' 6 5 3 5 | 6 - 1\' - 2\' - - - | 3\' 2\' 1\' 6 2\' 1\' 6 5 | 1\' 6 5 3 6 5 3 2 | 3 5 6 1\' 2\' 1\' 6 5 | 1\' - - - 1\' 0 0 0' },
    { inst: 'arp', oct: 0, vol: .45, pat: '1 3 5 1\' 1 3 5 1\' | 6, 1 3 6 6, 1 3 6 | 4, 6, 1 4 4, 6, 1 4 | 5, 7, 2 5 5, 7, 2 5 | 6, 1 3 6 4, 6, 1 4 | 1 3 5 1\' 6, 1 3 6 | 4, 6, 1 4 5, 7, 2 5 | 1 3 5 1\' 1 0 0 0' },
    { inst: 'bass', oct: -1, vol: .5, pat: '1 1 5, 5, 1 1 5, 5, | 6, 6, 3 3 6, 6, 3 3 | 4, 4, 1 1 4, 4, 1 1 | 5, 5, 2 2 5, 5, 2 2 | 6, 6, 3 3 4, 4, 1 1 | 1 1 5, 5, 6, 6, 3 3 | 4, 4, 1 1 5, 5, 2 2 | 1 1 5, 5, 1 0 0 0' },
    D('kh h sh h kh h sh h | kh h sh h kh h sh h | kh h sh h kh h sh h | kh h sh h kh h sh c | kh h sh h kh h sh h | kh h sh h kh h sh h | kh h sh h kh h sh h | kh s s s kc . . .', .45),
  ] },
  // 擂台：对抗感（爸爸 vs 孩子）
  duel: { name: '擂台斗法', bpm: 120, key: 60, div: 2, loop: true, voices: [
    { inst: 'lead50', oct: 1, vol: .42, pat: '6 0 3 0 6 0 1\' 0 | 6 5 3 5 6 - - - | 5 0 2 0 5 0 6 0 | 5 3 2 3 5 - - - | 1\' - 6 - 1\' 2\' 3\' - | 2\' 1\' 6 5 6 - - - | 3 5 6 1\' 2\' 1\' 6 5 | 6 - - - 6 0 0 0' },
    { inst: 'zheng', oct: 0, vol: .35, pat: '6, 0 6, 0 3 0 6, 0 | 6, 0 6, 0 3 0 6, 0 | 5, 0 5, 0 2 0 5, 0 | 5, 0 5, 0 2 0 5, 0 | 4, 0 4, 0 1 0 4, 0 | 5, 0 5, 0 2 0 5, 0 | 1 0 1 0 5, 0 5, 0 | 6, 0 6, 0 6, 0 0 0' },
    { inst: 'bass', oct: -1, vol: .5, pat: '6, - - 6, 3 - 6, - | 6, - - 6, 3 - 6, - | 5, - - 5, 2 - 5, - | 5, - - 5, 2 - 5, - | 4, - - 4, 1 - 4, - | 5, - - 5, 2 - 5, - | 1 - - 1 5, - 5, - | 6, - - 6, 6, 0 0 0' },
    D('k . x . k k x . | k . x . k k x . | k . x . k k x . | k . x . k k x c | k . x . k k x . | k . x . k k x . | k . x . k k x . | k x x x g . . .', .5),
  ] },
  // 一次性的短曲
  win: { name: '胜利', bpm: 150, key: 67, div: 4, loop: false, voices: [
    { inst: 'lead50', oct: 1, vol: .55, pat: '5 0 5 0 5 0 1\' - - - 3\' - 2\' 1\' 2\' - 5\' - - - - - - - 0 0 0 0' },
    { inst: 'dizi', oct: 1, vol: .3, pat: '0 0 0 0 0 0 5 - - - 1\' - 6 5 6 - 1\' - - - - - - - 0 0 0 0' },
    { inst: 'bass', oct: -1, vol: .5, pat: '1 0 1 0 1 0 1 - - - 6, - 5, - 5, - 1 - - - - - - - 0 0 0 0' },
    D('k . k . k . kc . . . . . x . x . kg . . . . . . . . . . .', .55),
  ] },
  lose: { name: '再接再厉', bpm: 80, key: 62, div: 2, loop: false, voices: [
    { inst: 'dizi', oct: 1, vol: .45, pat: '3 2 1 6, - - - 0 0 0' },
    { inst: 'bass', oct: -1, vol: .35, pat: '1 - 6, - 4, - - 0 0 0' },
  ] },
  chest: { name: '开宝箱', bpm: 160, key: 72, div: 4, loop: false, voices: [
    { inst: 'zheng', oct: 0, vol: .55, pat: '1 3 5 1\' 3 5 1\' 3\' 5\' - - - 0 0 0 0' },
    { inst: 'bell', oct: 1, vol: .35, pat: '0 0 0 0 0 0 0 0 1\' - - - 0 0 0 0' },
  ] },
};

// ================= 音效 =================
const S = {
  click(A, t) { A.osc('pulse', 1320, t, .03, .18, null, { duty: .25, d: .04 }); },
  tap(A, t) { A.P.w(A, t, .55, A.sfxBus); },
  // 答对：上行“叮—咚”，连对越多越高（五声音阶往上走）
  correct(A, t, combo = 0) {
    const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24], k = Math.min(combo, steps.length - 3), base = 72 + steps[k];
    A.I.zheng(A, t, mtof(base), .12, .7, A.sfxBus); A.I.zheng(A, t + .09, mtof(base + (steps[k + 2] - steps[k])), .2, .75, A.sfxBus);
    A.osc('pulse', mtof(base + 24), t + .09, .08, .08, null, { duty: .125, d: .12 });
  },
  wrong(A, t) { A.osc('triangle', 330, t, .26, .4, null, { to: 196, glide: .22, d: .28 }); A.osc('sine', 165, t + .02, .2, .2, null, { to: 110, d: .22 }); },
  swing(A, t) { A.noise(t, .16, .35, null, { f: 500, fTo: 3000, q: 1.2, a: .02 }); },
  hit(A, t) { A.osc('sine', 180, t, .14, .7, null, { to: 60, d: .16 }); A.noise(t, .07, .45, null, { f: 1400, q: .8 }); },
  normal(A, t) { S.swing(A, t); S.hit(A, t + .14); },
  crit(A, t) { S.swing(A, t); S.hit(A, t + .14); A.I.bell(A, t + .15, mtof(88), .3, .5, A.sfxBus); A.I.bell(A, t + .2, mtof(95), .3, .35, A.sfxBus); },
  charge(A, t) { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => A.osc('pulse', mtof(60 + s), t + i * .05, .06, .14, null, { duty: .25, d: .07 })); A.noise(t, .4, .2, null, { f: 300, fTo: 4000, q: 2, a: .3 }); },
  // 重棍：蓄力（越来越高的哨音）→ 跳起挥棍 → 金属“锵！”+ 砸地
  heavy(A, t) {
    S.charge(A, t);
    A.osc('pulse', mtof(72), t + .1, .4, .14, null, { duty: .125, to: mtof(96), glide: .38, d: .4 });
    A.noise(t + .45, .16, .45, null, { f: 900, fTo: 6000, q: 1.5 });
    const h = t + .62;
    [1, 2.76, 4.1, 5.4].forEach((r, i) => A.osc(i ? 'square' : 'triangle', 620 * r, h, .5, [.32, .06, .04, .025][i], null, { a: .001, d: .5 - i * .08, lp: 7000 }));
    A.noise(h, .08, .5, null, { type: 'highpass', f: 3500 });
    A.osc('sine', 160, h, .3, .7, null, { to: 45, glide: .25, d: .3 });
    A.noise(h + .02, .35, .3, null, { f: 1800, fTo: 500, q: .7 });
    for (let i = 0; i < 5; i++) A.noise(h + .06 + i * .04, .05, .2, null, { f: 1200 + i * 300, q: 3 });
  },
  // 大！大！大！
  // 如意金箍棒·变！：分身嗖嗖嗖 → “大！大！大！”三声和弦一声比一声高 → 金箍棒从天而降的长哨 → 轰！→ 胜利小琶音
  finish(A, t) {
    [0, .1, .2].forEach((d, i) => { A.noise(t + d, .12, .3, null, { f: 800, fTo: 4000, q: 2 }); A.osc('pulse', mtof(84 + i * 3), t + d, .05, .12, null, { duty: .25, d: .06 }); });
    const chords = [[60, 64, 67], [65, 69, 72], [70, 74, 77]];
    chords.forEach((ch, i) => { const d = t + .4 + i * .36;
      ch.forEach(m => { A.osc('pulse', mtof(m), d, .26, .14 + i * .04, null, { duty: .5, d: .28, vib: 7, vibDepth: .01 }); A.osc('pulse', mtof(m + 12), d, .26, .06 + i * .02, null, { duty: .25, d: .26 }); });
      A.P.x(A, d, .7, A.sfxBus); A.P.k(A, d, .5 + i * .15, A.sfxBus); A.I.bell(A, d, mtof(84 + i * 5), .3, .25, A.sfxBus);
    });
    const dive = t + 1.5;
    A.osc('pulse', 2400, dive, .42, .2, null, { duty: .25, to: 160, glide: .42, d: .42 });
    A.noise(dive, .42, .35, null, { f: 6000, fTo: 400, q: 1.5 });
    const hit = dive + .42;
    A.P.k(A, hit, .9, A.sfxBus); A.P.g(A, hit, .8, A.sfxBus);
    A.noise(hit, .9, .35, null, { type: 'highpass', f: 4000 });
    A.noise(hit, .5, .3, null, { type: 'lowpass', f: 600 });
    [1, 2.76, 5.4].forEach((r, i) => A.osc('triangle', 330 * r, hit, 1, [.4, .14, .07][i], null, { a: .001, d: 1.1 - i * .2 }));
    [0, 4, 7, 12, 16, 19, 24].forEach((s2, i) => A.I.zheng(A, hit + .35 + i * .05, mtof(72 + s2), .2, .45, A.sfxBus));
    A.I.bell(A, hit + .75, mtof(96), .5, .35, A.sfxBus);
  },
  fire(A, t) { A.noise(t, .7, .35, null, { type: 'lowpass', f: 1200, fTo: 400, a: .08 }); for (let i = 0; i < 8; i++) A.noise(t + Math.random() * .6, .02, .25, null, { f: 3000 + Math.random() * 3000, q: 4 }); A.osc('sine', 80, t, .6, .3, null, { a: .1, d: .6 }); },
  water(A, t) { for (let i = 0; i < 7; i++) { const f = 300 + Math.random() * 500; A.osc('sine', f, t + i * .07, .06, .3, null, { to: f * 2.2, glide: .05, d: .07 }); } },
  // 雷：两道“滋啦”电光 + 噼噼啪啪 + 远处轰隆
  thunder(A, t) {
    [0, .16].forEach((d, i) => { A.osc('square', 3200 - i * 600, t + d, .14, .3, null, { to: 180, glide: .14, d: .15, lp: 6000 }); A.osc('square', 4100 - i * 600, t + d + .01, .12, .15, null, { to: 240, glide: .12, d: .13 }); });
    for (let i = 0; i < 12; i++) A.noise(t + .02 + i * .028 + Math.random() * .01, .018, .55 + Math.random() * .3, null, { f: 2500 + Math.random() * 5000, q: 4 });
    A.noise(t + .32, 1.1, .5, null, { type: 'lowpass', f: 500, fTo: 140, a: .06 });
    A.osc('sine', 70, t + .32, 1, .22, null, { a: .08, d: 1, to: 50 });
  },
  // 风：两阵“呼——”，带一点口哨般的风啸
  wind(A, t) {
    [0, .55].forEach((d, i) => {
      A.noise(t + d, .7, 1.4, null, { f: 350, fTo: 1400, q: 3, a: .22 });
      A.noise(t + d, .7, .9, null, { f: 900, fTo: 2600, q: 5, a: .25 });
      A.osc('sine', 700 + i * 150, t + d + .05, .65, .2, null, { a: .2, d: .65, to: 1300 + i * 200, vib: 6, vibDepth: .03 });
    });
  },
  poison(A, t) { for (let i = 0; i < 6; i++) A.noise(t + i * .09, .05, .25, null, { f: 5000, q: 8 }); A.osc('pulse', 220, t, .5, .1, null, { duty: .125, vib: 18, vibDepth: .08, d: .5 }); },
  sonic(A, t) { A.osc('pulse', 440, t, .7, .18, null, { duty: .5, vib: 14, vibDepth: .15, d: .7 }); A.osc('pulse', 660, t + .1, .6, .1, null, { duty: .25, vib: 11, vibDepth: .12, d: .6 }); },
  capture(A, t) { A.osc('sine', 220, t, .6, .4, null, { to: 1800, glide: .55, d: .6 }); A.noise(t, .5, .2, null, { f: 800, fTo: 5000, q: 2 }); A.osc('pulse', mtof(84), t + .62, .06, .25, null, { duty: .25, d: .1 }); A.osc('pulse', mtof(91), t + .7, .1, .25, null, { duty: .25, d: .2 }); },
  god(A, t) { [72, 76, 79, 84, 88].forEach((m, i) => A.I.bell(A, t + i * .09, mtof(m), .5, .45, A.sfxBus)); A.osc('sine', mtof(60), t, 1.2, .15, null, { a: .3, d: 1.2 }); A.osc('sine', mtof(67), t, 1.2, .12, null, { a: .3, d: 1.2 }); },
  drop(A, t) { [79, 84, 88, 91].forEach((m, i) => A.osc('pulse', mtof(m), t + i * .06, .07, .2, null, { duty: .125, d: .12 })); A.I.bell(A, t + .26, mtof(96), .4, .3, A.sfxBus); },
  coin(A, t) { A.osc('pulse', mtof(83), t, .07, .22, null, { duty: .5, d: .06 }); A.osc('pulse', mtof(88), t + .07, .3, .22, null, { duty: .5, d: .3 }); },
  crack(A, t, lv = 1) { A.noise(t, .05, .5, null, { f: 2000 + lv * 600, q: 3 }); A.osc('square', 900 + lv * 150, t, .03, .15, null, { to: 300, d: .05 }); A.P.w(A, t + .04, .4, A.sfxBus); },
  shatter(A, t) { for (let i = 0; i < 10; i++) A.noise(t + i * .025, .04, .4, null, { f: 3000 + Math.random() * 4000, q: 5 }); A.P.k(A, t, .7, A.sfxBus); },
  heal(A, t) { [72, 76, 79, 84].forEach((m, i) => A.osc('sine', mtof(m), t + i * .08, .25, .25, null, { a: .02, d: .3 })); },
  focus(A, t) { A.osc('pulse', mtof(84), t, .06, .15, null, { duty: .25, d: .08 }); A.osc('pulse', mtof(91), t + .06, .12, .15, null, { duty: .25, d: .15 }); },
  ready(A, t) { A.I.bell(A, t, mtof(84), .4, .4, A.sfxBus); A.I.bell(A, t + .1, mtof(91), .4, .4, A.sfxBus); A.noise(t, .3, .15, null, { type: 'highpass', f: 6000 }); },
  ding(A, t) { A.I.bell(A, t, mtof(79), .6, .5, A.sfxBus); A.osc('sine', 300, t, .8, .2, null, { a: .01, d: .8, vib: 3, vibDepth: .03 }); },
  // 连对里程碑：一声锣 + 越来越长的古筝上行 + 钟，等级越高越热闹
  streak(A, t, tier = 1) {
    A.P.g(A, t, .35 + tier * .08, A.sfxBus); A.P.c(A, t, .3 + tier * .06, A.sfxBus);
    const run = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24].slice(0, 4 + tier * 1.5 | 0);
    run.forEach((s2, i) => A.I.zheng(A, t + .05 + i * .045, mtof(67 + s2), .15, .5, A.sfxBus));
    const end = t + .05 + run.length * .045;
    [0, 4, 7].forEach(s2 => A.osc('pulse', mtof(67 + run[run.length - 1] - 12 + s2), end, .4, .1 + tier * .02, null, { duty: .5, d: .45, vib: 6, vibDepth: .01 }));
    A.I.bell(A, end, mtof(84 + Math.min(tier, 4) * 2), .5, .45, A.sfxBus);
    if (tier >= 4) A.noise(t, .6, .25, null, { f: 300, fTo: 3000, q: 1.5, a: .1 });
    if (tier >= 5) [72, 76, 79, 84].forEach((m, i) => A.I.bell(A, end + .15 + i * .08, mtof(m + 12), .5, .35, A.sfxBus));
  },
  hurtMe(A, t) { A.osc('pulse', 520, t, .18, .25, null, { duty: .25, to: 260, d: .2 }); S.hit(A, t); },
};
AU.SFX = S;
AU.sfx = function (name, ...args) { if (!this.init() || !S[name]) return; S[name](this, this.ctx.currentTime + .01, ...args); };

// ================= 妖怪叫声（每只都不一样，像初代宝可梦） =================
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
AU.cry = function (key, o = {}) {
  if (!this.init()) return 0;
  const A = this, c = this.ctx, R = rng(hash(key)), t0 = c.currentTime + .02;
  const size = o.size || 'mid';
  const [lo, hi] = { big: [90, 380], mid: [200, 800], small: [420, 1500], god: [260, 700] }[size];
  const pitch = (o.pitch || 1), short = o.short ? .5 : 1;
  const duty = [.125, .25, .5][Math.floor(R() * 3)];
  const segs = (o.short ? 2 : 3) + Math.floor(R() * 3);
  const os = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
  os.setPeriodicWave(this.wave(duty)); lp.type = 'lowpass'; lp.frequency.value = size === 'big' ? 1600 : 3200;
  const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 6 + R() * 18; vg.gain.value = 0;
  vib.connect(vg); vg.connect(os.frequency);
  let t = t0, f = (lo + R() * (hi - lo)) * pitch;
  os.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(0.0001, t);
  for (let i = 0; i < segs; i++) {
    const d = (.14 + R() * .22) * short, nf = Math.max(50, Math.min(2400, (lo + R() * (hi - lo)) * pitch));
    const v = .35 + R() * .3;
    g.gain.linearRampToValueAtTime(v, t + Math.min(.03, d * .3));
    if (R() < .5) os.frequency.exponentialRampToValueAtTime(nf, t + d); else { os.frequency.setValueAtTime(nf, t + d * .2); }
    vg.gain.setValueAtTime(R() < .5 ? nf * (.02 + R() * .05) : 0, t);
    if (R() < .35 && i < segs - 1) g.gain.linearRampToValueAtTime(.05, t + d * .92);
    t += d;
  }
  g.gain.exponentialRampToValueAtTime(0.0001, t + .08);
  os.connect(lp); lp.connect(g); g.connect(o.dest || this.sfxBus);
  os.start(t0); vib.start(t0); os.stop(t + .12); vib.stop(t + .12);
  // 粗嗓门的加一点低吼噪声
  const growl = size === 'big' ? .3 + R() * .3 : R() * .2;
  if (growl > .08) this.noise(t0, t - t0, growl * .5, o.dest, { type: 'lowpass', f: 300 + R() * 600 });
  return t - t0;
};
// 挨打时的“嗷”：叫声的短版、音调更高一点
AU.hurt = function (key, size) { return this.cry(key, { size, short: true, pitch: 1.2 }); };

window.QJ_AUDIO = AU;
})();

/* 取经小英雄 · 原创Q版角色库（SVG + CSS 动画）
   每个角色 viewBox 0 0 200 220，地面 y≈212。
   分组 class：bob 呼吸起伏 / blink 眨眼 / tail 摆尾 / weapon 武器 / sway 飘动 / spin 旋转 / flick 吐信 */
(function(){
const O = '#3a2618';           // 描边
const S = `stroke="${O}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const S2 = `stroke="${O}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;

// ---------- 通用部件 ----------
const ouch = (cx, y, gap) => `<g class="ouch"><path d="M${cx-gap-6} ${y-6} L${cx-gap+6} ${y} L${cx-gap-6} ${y+6} M${cx+gap+6} ${y-6} L${cx+gap-6} ${y} L${cx+gap+6} ${y+6}" fill="none" stroke="#3a2618" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/></g>`;
function eyes(cx, y, gap, opt={}){
  const r = opt.r || 7, iris = opt.iris, pupil = opt.pupil || '#24160c';
  const one = (x) => iris
    ? `<circle cx="${x}" cy="${y}" r="${r+1}" fill="${iris}" ${S2}/><circle cx="${x}" cy="${y+0.5}" r="${r*0.55}" fill="${pupil}"/><circle cx="${x+2.2}" cy="${y-2.6}" r="${r*0.32}" fill="#fff"/>`
    : `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r*1.18}" fill="${pupil}"/><circle cx="${x+2.3}" cy="${y-3}" r="${r*0.38}" fill="#fff"/><circle cx="${x-2}" cy="${y+3}" r="${r*0.16}" fill="#fff"/>`;
  return `<g class="blink" style="transform-origin:${cx}px ${y}px">${one(cx-gap)}${one(cx+gap)}</g>${ouch(cx,y,gap)}`;
}
function slitEyes(cx, y, gap, iris){
  const one = (x)=>`<ellipse cx="${x}" cy="${y}" rx="8" ry="9" fill="${iris}" ${S2}/><ellipse cx="${x}" cy="${y}" rx="2.2" ry="7" fill="#1d140c"/><circle cx="${x+3}" cy="${y-3}" r="2" fill="#fff"/>`;
  return `<g class="blink" style="transform-origin:${cx}px ${y}px">${one(cx-gap)}${one(cx+gap)}</g>${ouch(cx,y,gap)}`;
}
function happyEyes(cx, y, gap){
  return `${ouch(cx,y,gap)}<g class="blink"><path d="M${cx-gap-7} ${y+2} Q${cx-gap} ${y-6} ${cx-gap+7} ${y+2}" fill="none" ${S}/><path d="M${cx+gap-7} ${y+2} Q${cx+gap} ${y-6} ${cx+gap+7} ${y+2}" fill="none" ${S}/></g>`;
}
const blush = (cx, y, gap, c='#f08c8c') => `<ellipse cx="${cx-gap}" cy="${y}" rx="7" ry="4" fill="${c}" opacity=".55"/><ellipse cx="${cx+gap}" cy="${y}" rx="7" ry="4" fill="${c}" opacity=".55"/>`;
const feet = (c, y=206) => `<ellipse cx="82" cy="${y}" rx="15" ry="8" fill="${c}" ${S}/><ellipse cx="118" cy="${y}" rx="15" ry="8" fill="${c}" ${S}/>`;
const shadow = (w=62) => `<ellipse class="shadow" cx="100" cy="212" rx="${w}" ry="7" fill="#000" opacity=".13"/>`;
const wrap = (inner, opt={}) => `<svg viewBox="0 0 200 220" class="char ${opt.cls||''}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${shadow(opt.sw)}<g class="actor"><g class="bob">${inner}</g></g></svg>`;

// 武器（单独可复用，绘制在 0,0 附近竖直方向，长度方向为 -y）
const W = {
  jgb: (len=190) => `<rect x="-5" y="${-len}" width="10" height="${len}" rx="5" fill="#4b4650" ${S}/><rect x="-2" y="${-len+22}" width="2.4" height="${len-44}" fill="#8a8494"/><rect x="-7" y="${-len}" width="14" height="20" rx="4" fill="#f2b632" ${S}/><rect x="-7" y="-20" width="14" height="20" rx="4" fill="#f2b632" ${S}/><path d="M-4 ${-len+7}h8M-4 ${-len+13}h8M-4 -13h8M-4 -7h8" stroke="#b8860b" stroke-width="1.6"/>`,
  rake: () => `<rect x="-4" y="-178" width="8" height="178" rx="4" fill="#a0672d" ${S}/><rect x="-30" y="-182" width="60" height="12" rx="5" fill="#cfd8dc" ${S}/>`+
     Array.from({length:9},(_,i)=>`<path d="M${-27+i*6.75} -170 l0 16" stroke="${O}" stroke-width="5.4" stroke-linecap="round"/><path d="M${-27+i*6.75} -170 l0 16" stroke="#e8eef0" stroke-width="2.6" stroke-linecap="round"/>`).join('')+
     `<circle cx="0" cy="-186" r="7" fill="#f2b632" ${S2}/>`,
  zhang: () => `<rect x="-4.5" y="-172" width="9" height="172" rx="4" fill="#d9a520" ${S}/><path d="M0 -172 C-24 -180 -22 -206 0 -202 C22 -206 24 -180 0 -172 Z" fill="#f4cf5a" ${S}/><circle cx="0" cy="-188" r="6" fill="#fff6d6" ${S2}/>`+
     `<g class="sway" style="transform-origin:0px -172px"><path d="M-14 -176 q-4 20 2 34" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="1 6" stroke-linecap="round"/><path d="M14 -176 q4 20 -2 34" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="1 6" stroke-linecap="round"/></g>`,
  xizhang: () => `<rect x="-3.5" y="-176" width="7" height="176" rx="3" fill="#d9a520" ${S}/><ellipse cx="0" cy="-192" rx="16" ry="20" fill="none" stroke="${O}" stroke-width="7"/><ellipse cx="0" cy="-192" rx="16" ry="20" fill="none" stroke="#f2c94c" stroke-width="3.5"/>`+
     [[-15,-200],[-15,-184],[15,-200],[15,-184]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="4.2" fill="none" stroke="#e0a800" stroke-width="2.4"/>`).join('')+`<path d="M0 -212 l0 -8" ${S}/><circle cx="0" cy="-222" r="4" fill="#f2c94c" ${S2}/>`,
  spear: (tassel='#d93a3a', shaft='#8a5a2b', len=184) => `<rect x="-3.5" y="${-len}" width="7" height="${len}" rx="3" fill="${shaft}" ${S}/><path d="M0 ${-len-30} L9 ${-len-6} L0 ${-len+2} L-9 ${-len-6} Z" fill="#dfe6ea" ${S}/><g class="sway" style="transform-origin:0px ${-len+2}px"><path d="M0 ${-len+2} q-12 10 -6 26 q6 -12 6 -26 q12 10 6 26 q-6 -12 -6 -26" fill="${tassel}" ${S2}/></g>`,
  sword: (blade='#7fd1c7') => `<path d="M-3 0 h6 v-20 h-6 Z" fill="#6b3f1f" ${S2}/><rect x="-14" y="-26" width="28" height="7" rx="3" fill="#f2b632" ${S2}/><path d="M-6 -26 L-6 -128 L0 -142 L6 -128 L6 -26 Z" fill="${blade}" ${S}/><path d="M0 -30 V-130" stroke="#fff" stroke-width="1.6" opacity=".7"/>`,
  saber: () => `<rect x="-3" y="-22" width="6" height="22" rx="2" fill="#5a3a20" ${S2}/><rect x="-11" y="-27" width="22" height="6" rx="3" fill="#e0a040" ${S2}/><path d="M-5 -27 C-8 -70 -2 -110 16 -124 C10 -98 8 -60 6 -27 Z" fill="#d98a4e" ${S}/><path d="M0 -32 C-1 -70 4 -100 12 -116" stroke="#ffd2a8" stroke-width="2" fill="none"/>`,
  trident: () => `<rect x="-3.5" y="-176" width="7" height="176" rx="3" fill="#5d6d7e" ${S}/><path d="M-22 -176 Q-22 -162 0 -162 Q22 -162 22 -176" fill="none" stroke="${O}" stroke-width="8"/><path d="M-22 -176 Q-22 -162 0 -162 Q22 -162 22 -176" fill="none" stroke="#cfd8dc" stroke-width="4"/>`+
     `<path d="M-22 -176 l-4 -24 l7 6 Z M22 -176 l4 -24 l-7 6 Z M0 -164 l0 -46" fill="#e8eef0" ${S}/><path d="M0 -214 l7 16 l-14 0 Z" fill="#e8eef0" ${S}/>`,
  vase: () => `<path d="M-9 0 C-16 -6 -16 -22 -6 -28 L-5 -40 L5 -40 L6 -28 C16 -22 16 -6 9 0 Z" fill="#f8fbff" ${S}/><path d="M-5 -40 h10" ${S}/><g class="sway" style="transform-origin:0px -40px"><path d="M0 -40 C4 -56 -4 -66 2 -82" fill="none" stroke="#5b8c3a" stroke-width="2.6"/><path d="M1 -52 q10 -4 12 -12 q-10 0 -12 12 M-1 -62 q-10 -4 -12 -12 q10 0 12 12 M2 -74 q9 -3 10 -11 q-9 1 -10 11" fill="#8bc34a" stroke="#4e7a2c" stroke-width="1.4"/></g>`,
  gong: () => `<circle cx="0" cy="0" r="17" fill="#e5b33c" ${S}/><circle cx="0" cy="0" r="9" fill="#f6d36b" stroke="#b88a1a" stroke-width="2"/><path d="M0 -17 v-10" ${S}/>`,
  dragonstaff: () => `<rect x="-3.5" y="-176" width="7" height="176" rx="3" fill="#b8860b" ${S}/><path d="M0 -176 C-26 -186 -24 -214 0 -214 C18 -214 22 -196 8 -192 C-2 -190 -4 -200 4 -202" fill="none" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M0 -176 C-26 -186 -24 -214 0 -214 C18 -214 22 -196 8 -192 C-2 -190 -4 -200 4 -202" fill="none" stroke="#f2c94c" stroke-width="5" stroke-linecap="round"/><circle cx="-14" cy="-206" r="2.5" fill="${O}"/>`,
  cane: () => `<path d="M0 0 C-2 -50 3 -90 0 -128 C-3 -140 8 -146 12 -138" fill="none" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M0 0 C-2 -50 3 -90 0 -128 C-3 -140 8 -146 12 -138" fill="none" stroke="#a0703c" stroke-width="5" stroke-linecap="round"/><g transform="translate(12 -124)"><circle cy="6" r="9" fill="#e7a54a" ${S2}/><circle cy="-6" r="6" fill="#e7a54a" ${S2}/></g>`,
};
const hold = (x, y, rot, weapon, origin) => `<g class="weapon" style="transform-origin:${x}px ${y}px"><g transform="translate(${x} ${y}) rotate(${rot})">${weapon}</g></g>`;

// ---------- 角色 ----------
const C = {};

// 孙悟空：火眼金睛、金箍、虎皮裙、金箍棒；可穿戴装备（每件改变外观）
// gear 槽位：head/body/arm/leg/weapon/acc，值为外观描述 look：{t:类型, c1, c2, ...}
const WK = {};
WK.staff = (L = {}) => {
  const len = L.len || 190, shaft = L.shaft || '#4b4650', hi = L.hi || '#8a8494', ends = L.ends || '#f2b632';
  let s = `<rect x="-5" y="${-len}" width="10" height="${len}" rx="5" fill="${shaft}" ${S}/><rect x="-2" y="${-len + 22}" width="2.4" height="${len - 44}" fill="${hi}"/><rect x="-7" y="${-len}" width="14" height="20" rx="4" fill="${ends}" ${S}/><rect x="-7" y="-20" width="14" height="20" rx="4" fill="${ends}" ${S}/>`;
  if (L.tassel) s += `<g class="sway" style="transform-origin:0px ${-len + 20}px"><path d="M0 ${-len + 20} q-12 10 -6 26 q6 -12 6 -26 q12 10 6 26 q-6 -12 -6 -26" fill="${L.tassel}" ${S2}/></g>`;
  if (L.tip === 'flame') s += `<path d="M0 ${-len - 2} C-12 ${-len - 14} -4 ${-len - 26} 0 ${-len - 36} C6 ${-len - 24} 14 ${-len - 16} 0 ${-len - 2} Z" fill="#ff7043" ${S2}/>`;
  if (L.tip === 'skull') s += `<path d="M-9 ${-len - 2} a9 9 0 1 1 18 0 l0 4 l-4 3 l-10 0 l-4 -3 Z" fill="#fafafa" ${S2}/><circle cx="-3" cy="${-len - 3}" r="2" fill="${O}"/><circle cx="3" cy="${-len - 3}" r="2" fill="${O}"/>`;
  if (L.tip === 'star') s += [0, 1, 2, 3, 4, 5, 6].map(i => `<circle cx="0" cy="${-len + 30 + i * 18}" r="2.4" fill="#fff59d"/>`).join('');
  if (L.tip === 'ice') s += `<path d="M0 ${-len - 2} L-8 ${-len - 18} L0 ${-len - 34} L8 ${-len - 18} Z" fill="#b3e5fc" ${S2}/>`;
  if (L.tip === 'wing') s += `<path d="M0 ${-len + 6} C-26 ${-len - 6} -30 ${-len - 26} -18 ${-len - 34} C-14 ${-len - 20} -8 ${-len - 12} 0 ${-len - 6} C8 ${-len - 12} 14 ${-len - 20} 18 ${-len - 34} C30 ${-len - 26} 26 ${-len - 6} 0 ${-len + 6} Z" fill="#ffca28" ${S2}/>`;
  if (L.tip === 'wind') s += `<g class="spin" style="transform-origin:0px ${-len - 14}px"><path d="M0 ${-len - 14} m-10 0 a10 10 0 1 1 10 10 a6 6 0 1 1 -4 -7" fill="none" stroke="#d7b46a" stroke-width="3" stroke-linecap="round"/></g>`;
  if (L.aura) s = `<g style="filter:drop-shadow(0 0 6px ${L.aura})">${s}</g><g class="spin" style="transform-origin:0px ${-len}px"><path d="M-12 ${-len} l24 0 M0 ${-len - 12} l0 24" stroke="${L.aura}" stroke-width="3" stroke-linecap="round"/></g>`;
  return s;
};
WK.head = (L, fur) => {
  if (!L) return '';
  const c1 = L.c1, c2 = L.c2 || '#f2c94c';
  switch (L.t) {
    case 'hood': return `<path d="M52 66 Q56 30 100 28 Q144 30 148 66 Q124 50 100 50 Q76 50 52 66 Z" fill="${c1}" ${S}/><path d="M146 58 q16 4 22 18 q-12 -2 -20 -8" fill="${c1}" ${S2}/><path d="M56 60 Q100 40 144 60" fill="none" stroke="${c2}" stroke-width="3" stroke-dasharray="6 4"/>`;
    case 'helm': return `<path d="M50 70 Q50 22 100 20 Q150 22 150 70 L140 66 Q100 48 60 66 Z" fill="${c1}" ${S}/><path d="M54 66 Q100 44 146 66" fill="none" stroke="${c2}" stroke-width="5"/><circle cx="100" cy="30" r="6" fill="${c2}" ${S2}/>${L.plume ? `<g class="sway" style="transform-origin:100px 26px"><path d="M100 26 C88 6 104 -4 114 -8 C108 6 116 12 100 26 Z" fill="${L.plume}" ${S2}/></g>` : ''}${L.horn === 'ox' ? `<path d="M56 50 C34 44 24 22 30 8 C38 22 48 30 64 36 Z M144 50 C166 44 176 22 170 8 C162 22 152 30 136 36 Z" fill="#fff8e1" ${S}/>` : ''}${L.horn === 'one' ? `<path d="M93 24 L100 -10 L107 24 Z" fill="${c2}" ${S}/>` : ''}${L.mane ? Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (1.05 + i * .1); return `<path d="M${100 + Math.cos(a) * 50} ${66 + Math.sin(a) * 50} l${Math.cos(a) * 16} ${Math.sin(a) * 16}" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M${100 + Math.cos(a) * 50} ${66 + Math.sin(a) * 50} l${Math.cos(a) * 16} ${Math.sin(a) * 16}" stroke="${L.mane}" stroke-width="5" stroke-linecap="round"/>`; }).join('') : ''}`;
    case 'crown': return `<g class="sway" style="transform-origin:58px 44px"><path d="M62 46 C40 40 28 22 30 8 C38 20 48 24 56 26 C46 16 44 6 48 -2 C54 14 64 24 70 34 Z" fill="${L.wing || '#b39ddb'}" ${S2}/></g><g class="sway" style="transform-origin:142px 44px;animation-delay:-1s"><path d="M138 46 C160 40 172 22 170 8 C162 20 152 24 144 26 C154 16 156 6 152 -2 C146 14 136 24 130 34 Z" fill="${L.wing || '#b39ddb'}" ${S2}/></g><path d="M66 50 Q100 26 134 50 L130 30 L116 38 L100 18 L84 38 L70 30 Z" fill="${c1}" ${S}/><path d="M70 48 Q100 30 130 48" fill="none" stroke="${c2}" stroke-width="4"/><circle cx="100" cy="30" r="5" fill="${c2}" ${S2}/>`;
    case 'bone': return `${[-36, -18, 0, 18, 36].map(dx => `<path d="M${100 + dx - 6} ${50 - Math.abs(dx) * .1} L${100 + dx} ${18 + Math.abs(dx) * .5} L${100 + dx + 6} ${50 - Math.abs(dx) * .1} Z" fill="#fafafa" ${S2}/>`).join('')}<path d="M58 60 Q100 38 142 60" fill="none" stroke="${O}" stroke-width="10" stroke-linecap="round"/><path d="M58 60 Q100 38 142 60" fill="none" stroke="#fafafa" stroke-width="6" stroke-linecap="round"/><circle cx="100" cy="44" r="5" fill="${c1}" ${S2}/>`;
    case 'flame': return `<g class="sway" style="transform-origin:100px 50px"><path d="M60 56 C52 36 64 26 72 32 C70 14 88 6 94 18 C98 0 118 4 112 22 C124 10 142 22 132 40 C144 40 146 56 138 58 Q100 40 60 56 Z" fill="${c1}" ${S}/><path d="M84 40 C82 26 92 22 96 30 C100 22 110 26 106 38" fill="${c2}"/></g>`;
    case 'lotus': return `${[-40, -20, 0, 20, 40].map(a => `<path transform="rotate(${a} 100 56)" d="M100 56 C90 40 92 22 100 14 C108 22 110 40 100 56 Z" fill="${c1}" ${S2}/>`).join('')}<path d="M62 58 Q100 42 138 58" fill="none" stroke="${c2}" stroke-width="5"/>`;
  }
  return '';
};
WK.body = (L) => {
  if (!L) return '';
  const c1 = L.c1, c2 = L.c2 || '#b8860b';
  const pauld = (c) => `<path d="M52 136 Q50 118 70 120 L76 136 Z M148 136 Q150 118 130 120 L124 136 Z" fill="${c}" ${S}/>`;
  switch (L.t) {
    case 'cloth': return `<path d="M66 128 Q100 116 134 128 L138 178 Q100 186 62 178 Z" fill="${c1}" ${S}/><path d="M80 130 L96 176 M120 130 L104 176" stroke="${c2}" stroke-width="2" stroke-dasharray="5 4"/>`;
    case 'scale': return `<path d="M66 128 Q100 114 134 128 L138 176 Q100 186 62 176 Z" fill="${c1}" ${S}/>${[0, 1, 2, 3].map(r => [0, 1, 2, 3, 4, 5].map(c => `<path d="M${70 + c * 11 + (r % 2) * 5} ${136 + r * 10} q5 6 10 0" fill="none" stroke="${c2}" stroke-width="2"/>`).join('')).join('')}${pauld(c1)}`;
    case 'fur': return `<path d="M64 128 Q100 112 136 128 L140 178 Q100 188 60 178 Z" fill="${c1}" ${S}/><path d="M60 132 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8" fill="none" stroke="${c2}" stroke-width="3"/><path d="M48 140 Q44 116 70 116 L78 138 Z M152 140 Q156 116 130 116 L122 138 Z" fill="${c1}" ${S}/><path d="M86 150 Q100 162 114 150" fill="none" stroke="#f4f1e8" stroke-width="5" stroke-linecap="round"/>`;
    case 'bone': return `<path d="M66 128 Q100 116 134 128 L138 178 Q100 186 62 178 Z" fill="${c1}" ${S}/>${[0, 1, 2, 3].map(i => `<path d="M${74 + i * 2} ${138 + i * 10} Q100 ${132 + i * 10} ${126 - i * 2} ${138 + i * 10}" fill="none" stroke="#fafafa" stroke-width="4" stroke-linecap="round"/>`).join('')}<path d="M100 130 V176" stroke="#fafafa" stroke-width="4"/>${pauld('#fafafa')}`;
    case 'plate': return `<path d="M64 128 Q100 114 136 128 L140 178 Q100 188 60 178 Z" fill="${c1}" ${S}/><path d="M68 142 Q100 154 132 142 M66 160 Q100 172 134 160" fill="none" stroke="${c2}" stroke-width="4"/><circle cx="100" cy="150" r="10" fill="${c2}" ${S2}/><circle cx="100" cy="150" r="4" fill="#fff6d6"/>${pauld(c2)}`;
    case 'robe': return `<path d="M64 128 Q100 116 136 128 L142 186 Q100 196 58 186 Z" fill="${c1}" ${S}/><path d="M64 130 L136 186" stroke="${c2}" stroke-width="7"/><path d="M64 130 L136 186" stroke="#fff59d" stroke-width="2" stroke-dasharray="4 4"/>`;
  }
  return '';
};
WK.arm = (L) => {
  if (!L) return '';
  const c1 = L.c1, c2 = L.c2 || '#f2b632';
  const pair = (inner) => `<g transform="translate(0 0)">${inner(50, 150, 66, 144, 70, 158, 54, 164)}${inner(140, 154, 158, 150, 160, 164, 142, 168)}</g>`;
  switch (L.t) {
    case 'wrap': return pair((a, b, c, d, e, f, g, h) => `<path d="M${a} ${b} L${c} ${d} L${e} ${f} L${g} ${h} Z" fill="${c1}" ${S2}/><path d="M${a + 2} ${b + 4} l${c - a - 2} ${d - b} M${a + 3} ${b + 9} l${c - a - 2} ${d - b}" stroke="${c2}" stroke-width="1.8"/>`);
    case 'bracer': return pair((a, b, c, d, e, f, g, h) => `<path d="M${a} ${b} L${c} ${d} L${e} ${f} L${g} ${h} Z" fill="${c1}" ${S2}/><path d="M${a + 3} ${b + 6} l${c - a} ${d - b}" stroke="${c2}" stroke-width="2.5"/>`);
    case 'claw': return pair((a, b, c, d, e, f, g, h) => `<path d="M${a} ${b} L${c} ${d} L${e} ${f} L${g} ${h} Z" fill="${c1}" ${S2}/><path d="M${a} ${b} l-6 -8 l8 4 M${(a + c) / 2} ${(b + d) / 2} l-2 -10 l6 6 M${c} ${d} l2 -10 l4 8" fill="${c2}" stroke="${O}" stroke-width="1.6"/>`);
    case 'bone': return pair((a, b, c, d, e, f, g, h) => `<path d="M${a} ${b} L${c} ${d} L${e} ${f} L${g} ${h} Z" fill="#fafafa" ${S2}/><circle cx="${(a + c) / 2}" cy="${(b + d) / 2 + 6}" r="3" fill="${c1}"/>`);
    case 'ring': return pair((a, b, c, d, e, f, g, h) => [0, 1, 2].map(i => `<path d="M${a + i * 5} ${b + i * 2} l${c - a - 4} ${d - b}" stroke="${O}" stroke-width="6" stroke-linecap="round"/><path d="M${a + i * 5} ${b + i * 2} l${c - a - 4} ${d - b}" stroke="${c1}" stroke-width="3.5" stroke-linecap="round"/>`).join(''));
  }
  return '';
};
WK.leg = (L) => {
  if (!L) return feet('#5a3a22');
  const c1 = L.c1, c2 = L.c2 || '#7fb3d5';
  const boot = (motif) => `<path d="M64 200 Q66 190 82 192 Q98 194 97 206 Q96 214 80 213 Q62 212 64 200 Z M136 200 Q134 190 118 192 Q102 194 103 206 Q104 214 120 213 Q138 212 136 200 Z" fill="${c1}" ${S}/>${motif}`;
  switch (L.t) {
    case 'straw': return boot(`<path d="M70 200 h22 M70 206 h22 M108 200 h22 M108 206 h22" stroke="${c2}" stroke-width="2"/>`);
    case 'boots': return boot(`<path d="M68 198 h26 M106 198 h26" stroke="${c2}" stroke-width="4"/>`);
    case 'cloud': return boot(`<path d="M70 204 q5 -5 10 0 q5 -5 10 0 M110 204 q5 -5 10 0 q5 -5 10 0" fill="none" stroke="${c2}" stroke-width="2.4"/>`);
    case 'fire': return boot(`<path d="M66 204 q-8 -10 -2 -18 q2 8 8 8 M134 204 q8 -10 2 -18 q-2 8 -8 8" fill="#ff7043" stroke="#e64a19" stroke-width="1.6"/>`);
    case 'spike': return boot(`<path d="M72 192 l4 -8 l4 8 M84 192 l4 -8 l4 8 M108 192 l4 -8 l4 8 M120 192 l4 -8 l4 8" fill="${c2}" stroke="${O}" stroke-width="1.6"/>`);
  }
  return feet('#5a3a22');
};
WK.accBack = (L) => {
  if (!L) return '';
  if (L.t === 'fan') return `<g class="sway" style="transform-origin:64px 130px"><g transform="translate(64 140) rotate(-30)">${'<rect x="-3" y="-40" width="6" height="40" rx="3" fill="#8d6e63" stroke="#3a2618" stroke-width="2.4"/><path d="M0 -38 C-30 -52 -26 -104 0 -110 C26 -104 30 -52 0 -38 Z" fill="#7cb342" stroke="#3a2618" stroke-width="3"/>'}</g></g>`;
  return '';
};
WK.accFront = (L) => {
  if (!L) return '';
  switch (L.t) {
    case 'beads': return `<g>${Array.from({ length: 11 }, (_, i) => { const a = Math.PI * (0.08 + 0.84 * i / 10); return `<circle cx="${100 - Math.cos(a) * 30}" cy="${126 + Math.sin(a) * 16}" r="4.4" fill="${L.c1}" stroke="${O}" stroke-width="1.6"/>`; }).join('')}</g>`;
    case 'gourd': return `<g class="sway" style="transform-origin:124px 172px"><path d="M124 172 v6" stroke="${O}" stroke-width="2"/><path d="M124 210 C110 208 108 192 118 188 C113 182 116 176 124 176 C132 176 135 182 130 188 C140 192 138 208 124 210 Z" fill="${L.c1}" ${S2}/><path d="M117 190 h14" stroke="#f2c94c" stroke-width="2.4"/></g>`;
    case 'bell': return `<g class="sway" style="transform-origin:78px 172px"><path d="M78 172 v6" stroke="${O}" stroke-width="2"/><path d="M70 194 Q70 180 78 180 Q86 180 86 194 Z" fill="${L.c1}" ${S2}/><circle cx="78" cy="196" r="2.6" fill="#f2c94c"/></g>`;
    case 'ring': return `<circle cx="56" cy="160" r="11" fill="none" stroke="${O}" stroke-width="8"/><circle cx="56" cy="160" r="11" fill="none" stroke="${L.c1}" stroke-width="4.5"/>`;
    case 'fruit': return `<g class="sway" style="transform-origin:124px 172px"><path d="M124 172 v8" stroke="${O}" stroke-width="2"/><circle cx="124" cy="186" r="7" fill="#fff3e0" ${S2}/><path d="M118 194 Q124 212 130 194 Z" fill="#fff3e0" ${S2}/><path d="M120 184 h2 M126 184 h2" stroke="${O}" stroke-width="2"/><path d="M124 178 q4 -8 10 -6" stroke="#7cb342" stroke-width="2.4" fill="none"/></g>`;
  }
  return '';
};
WK.accTop = (L) => {
  if (!L) return '';
  if (L.t === 'hair') return `<g class="sway" style="transform-origin:150px 70px"><path d="M148 70 C160 56 156 40 168 30 M150 72 C166 64 170 50 182 46 M150 74 C166 74 176 66 188 66" fill="none" stroke="#ffd54f" stroke-width="2.6" stroke-linecap="round" style="filter:drop-shadow(0 0 3px #fff59d)"/></g>`;
  if (L.t === 'pearl') return `<g class="spin" style="transform-origin:100px 84px;animation-duration:4s"><circle cx="166" cy="84" r="8" fill="${L.c1}" ${S2}/><circle cx="163" cy="81" r="2.6" fill="#fff"/></g>`;
  return '';
};
// 兼容旧的字符串写法
WK.legacy = { head: { crown: { t: 'crown', c1: '#9575cd', c2: '#f2c94c' } }, body: { armor: { t: 'scale', c1: '#f2c94c', c2: '#b8860b' } }, arm: { guard: { t: 'bracer', c1: '#4b4650', c2: '#f2b632' } }, leg: { boots: { t: 'cloud', c1: '#f8e1e7', c2: '#7fb3d5' } }, acc: { hair: { t: 'hair' } }, weapon: { glow: { aura: '#ffd54f', len: 200 } } };

C.wukong = (o = {}) => {
  const fur = o.fur || '#c8862e', face = o.face || '#f7d6ac', tunic = o.tunic || '#d9452b', iris = o.iris || '#f5b800';
  const g = {}; const raw = o.gear || {};
  for (const k in raw) g[k] = typeof raw[k] === 'string' ? (raw[k] ? (WK.legacy[k] || {})[raw[k]] : null) : raw[k];
  const staff = o.staff || WK.staff(g.weapon || {});
  const ears = o.six
    ? [40, 52, 64].map((y, i) => `<ellipse cx="${46 - i * 2}" cy="${y + 28}" rx="11" ry="9" fill="${face}" ${S2}/><ellipse cx="${154 + i * 2}" cy="${y + 28}" rx="11" ry="9" fill="${face}" ${S2}/>`).join('')
    : `<circle cx="47" cy="86" r="13" fill="${face}" ${S}/><circle cx="47" cy="86" r="6" fill="#e9a97f"/><circle cx="153" cy="86" r="13" fill="${face}" ${S}/><circle cx="153" cy="86" r="6" fill="#e9a97f"/>`;
  const robeBody = g.body && g.body.t === 'robe';
  return wrap(`
  ${WK.accBack(g.acc)}
  <g class="tail" style="transform-origin:128px 178px"><path d="M126 182 C166 190 182 156 164 132 C152 116 136 128 146 140" fill="none" stroke="${O}" stroke-width="11" stroke-linecap="round"/><path d="M126 182 C166 190 182 156 164 132 C152 116 136 128 146 140" fill="none" stroke="${fur}" stroke-width="6" stroke-linecap="round"/></g>
  ${hold(152, 166, 18, staff)}
  <rect x="78" y="186" width="16" height="20" rx="6" fill="${fur}" ${S}/><rect x="106" y="186" width="16" height="20" rx="6" fill="${fur}" ${S}/>
  ${WK.leg(g.leg)}
  <path d="M68 128 Q100 116 132 128 L138 178 Q100 186 62 178 Z" fill="${tunic}" ${S}/>
  <path d="M84 124 L100 146 L116 124" fill="none" stroke="#f2b632" stroke-width="4"/>
  ${robeBody ? '' : `<path d="M60 172 L140 172 L146 196 Q100 205 54 196 Z" fill="${o.skirt || '#f0a63a'}" ${S}/>${o.six ? '' : `<path d="M70 178 q4 8 0 14 M88 180 q4 9 0 16 M108 180 q4 9 0 16 M126 178 q4 8 0 14" stroke="#3a2618" stroke-width="3" fill="none"/>`}`}
  ${WK.body(g.body)}
  <rect x="62" y="166" width="76" height="9" rx="4" fill="#f2b632" ${S2}/>
  <ellipse cx="60" cy="150" rx="11" ry="15" fill="${fur}" ${S} transform="rotate(20 60 150)"/>${WK.arm(g.arm)}<circle cx="56" cy="164" r="8" fill="${face}" ${S2}/>
  <circle cx="150" cy="160" r="9" fill="${face}" ${S2}/>
  ${WK.accFront(g.acc)}
  ${ears}
  <path d="M100 30 C70 30 50 52 50 80 C50 112 74 130 100 130 C126 130 150 112 150 80 C150 52 130 30 100 30 Z" fill="${fur}" ${S}/>
  <path d="M84 36 L90 16 L99 32 L108 12 L113 34" fill="${fur}" ${S}/>
  <path d="M100 64 C88 50 62 54 62 80 C62 106 82 124 100 124 C118 124 138 106 138 80 C138 54 112 50 100 64 Z" fill="${face}" ${S2}/>
  <path d="M54 60 Q100 36 146 60" fill="none" stroke="${O}" stroke-width="10" stroke-linecap="round"/><path d="M54 60 Q100 36 146 60" fill="none" stroke="#f2c230" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M146 60 q8 2 6 10 q-6 -1 -4 -5" fill="none" stroke="#f2c230" stroke-width="3"/><path d="M54 60 q-8 2 -6 10 q6 -1 4 -5" fill="none" stroke="#f2c230" stroke-width="3"/>
  ${WK.head(g.head, fur)}
  <path d="M74 70 q8 -5 16 -1 M110 69 q8 -4 16 1" stroke="#b5651d" stroke-width="3.4" fill="none" stroke-linecap="round"/>
  ${eyes(100, 84, 17, { iris, r: 7 })}
  ${blush(100, 100, 28)}
  <ellipse cx="100" cy="100" rx="4" ry="3" fill="#9b5b3a"/>
  <path d="M89 107 Q100 116 111 107" fill="${o.six ? 'none' : '#c0392b'}" ${S2}/>
  ${o.six ? '<path d="M92 108 l3 5 l3 -5" fill="#fff" stroke="#3a2618" stroke-width="1.5"/>' : ''}
  ${WK.accTop(g.acc)}
  `, { cls: 'wukong' });
};
// 单件装备图标（只画这一件，取景到对应部位）
C.gearIcon = (slot, L) => {
  let inner = '', vb = '0 0 200 220';
  if (slot === 'head') { inner = `<path d="M100 30 C70 30 50 52 50 80 C50 112 74 130 100 130 C126 130 150 112 150 80 C150 52 130 30 100 30 Z" fill="#e8dccb" opacity=".6"/>` + WK.head(L); vb = '20 -14 160 100'; }
  if (slot === 'body') { inner = WK.body(L) || WK.body({ t: 'cloth', c1: '#d9452b' }); vb = '40 106 120 90'; }
  if (slot === 'arm') { inner = `<ellipse cx="60" cy="150" rx="11" ry="15" fill="#e8dccb" opacity=".6"/>` + WK.arm(L); vb = '36 130 136 48'; }
  if (slot === 'leg') { inner = WK.leg(L); vb = '56 180 88 40'; }
  if (slot === 'weapon') { inner = `<g transform="translate(100 214) rotate(35)">${WK.staff(L)}</g>`; vb = '-10 0 230 230'; }
  if (slot === 'acc') {
    if (L.t === 'hair') { inner = WK.accTop(L).replace('class="sway"', ''); vb = '140 20 56 60'; }
    else if (L.t === 'pearl') { inner = `<circle cx="100" cy="100" r="22" fill="${L.c1}" ${S}/><circle cx="92" cy="92" r="7" fill="#fff"/>`; vb = '70 70 60 60'; }
    else if (L.t === 'fan') { inner = WK.accBack(L).replace('class="sway"', ''); vb = '-10 20 110 130'; }
    else if (L.t === 'beads') { inner = WK.accFront(L); vb = '64 120 72 46'; }
    else if (L.t === 'ring') { inner = WK.accFront(L); vb = '38 142 36 36'; }
    else { inner = WK.accFront(L).replace(/class="sway"/g, ''); vb = L.t === 'bell' ? '62 168 32 34' : '104 168 40 46'; }
  }
  return `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" overflow="visible">${inner}</svg>`;
};

C.liuer = () => C.wukong({fur:'#5d5560', face:'#d8c7cf', tunic:'#6b3f8f', iris:'#e53935', skirt:'#8e8a92', six:true,
  staff: W.jgb().replace(/#4b4650/g,'#24222a').replace(/#8a8494/g,'#55505f').replace(/#f2b632/g,'#b0b6bd')});

// 唐僧：五佛冠、锦襕袈裟、九环锡杖
C.tangseng = () => wrap(`
  ${hold(150,168,8, W.xizhang())}
  ${feet('#8d6e63')}
  <path d="M64 130 Q100 118 136 130 L146 200 Q100 210 54 200 Z" fill="#f4c542" ${S}/>
  <path d="M60 136 L132 128 L148 196 Q120 204 92 204 L70 150 Z" fill="#d84332" ${S}/>
  <path d="M74 148 L138 140 M80 164 L142 156 M86 180 L145 172 M100 136 L114 202 M120 132 L132 198" stroke="#f6d36b" stroke-width="2.6" fill="none"/>
  <circle cx="122" cy="146" r="6" fill="#f6d36b" ${S2}/>
  <g>${Array.from({length:9},(_,i)=>{const a=Math.PI*(0.15+0.7*i/8);return `<circle cx="${100-Math.cos(a)*30}" cy="${126+Math.sin(a)*14}" r="4.2" fill="#8d5524" stroke="${O}" stroke-width="1.6"/>`}).join('')}</g>
  <ellipse cx="58" cy="160" rx="11" ry="16" fill="#f4c542" ${S} transform="rotate(14 58 160)"/><circle cx="56" cy="174" r="8" fill="#f8dcc0" ${S2}/>
  <circle cx="150" cy="164" r="9" fill="#f8dcc0" ${S2}/>
  <ellipse cx="52" cy="88" rx="9" ry="14" fill="#f8dcc0" ${S2}/><ellipse cx="148" cy="88" rx="9" ry="14" fill="#f8dcc0" ${S2}/>
  <circle cx="100" cy="82" r="48" fill="#f8dcc0" ${S}/>
  <path d="M56 62 Q100 44 144 62 L142 72 Q100 56 58 72 Z" fill="#d84332" ${S2}/>
  ${[-36,-18,0,18,36].map(dx=>`<path d="M${100+dx-9} ${60-Math.abs(dx)*0.12} Q${100+dx} ${26+Math.abs(dx)*0.35} ${100+dx+9} ${60-Math.abs(dx)*0.12} Z" fill="#f4c542" ${S2}/><circle cx="${100+dx}" cy="${48+Math.abs(dx)*0.28}" r="3" fill="#d84332"/>`).join('')}
  ${happyEyes(100,86,17)}
  ${blush(100,100,26)}
  <circle cx="100" cy="72" r="2.4" fill="#d84332"/>
  <path d="M92 106 Q100 112 108 106" fill="none" ${S2}/>
`);

// 猪八戒：大耳、长嘴、黑直裰、九齿钉耙
C.bajie = () => wrap(`
  ${hold(154,168,10, W.rake())}
  ${feet('#3a3a40')}
  <path d="M60 130 Q100 116 140 130 L150 198 Q100 210 50 198 Z" fill="#2f3542" ${S}/>
  <ellipse cx="100" cy="172" rx="32" ry="24" fill="#f6b8c2" ${S2}/>
  <circle cx="100" cy="174" r="2.6" fill="#c97a88"/>
  <path d="M60 140 Q100 152 140 140" stroke="#f2b632" stroke-width="5" fill="none"/>
  <ellipse cx="56" cy="160" rx="12" ry="16" fill="#2f3542" ${S}/><circle cx="54" cy="174" r="9" fill="#f6b8c2" ${S2}/>
  <circle cx="154" cy="164" r="10" fill="#f6b8c2" ${S2}/>
  <g class="tail" style="transform-origin:58px 54px"><path d="M62 52 C34 40 22 64 30 96 C46 92 60 74 66 62 Z" fill="#f6b8c2" ${S}/><path d="M56 60 C42 58 36 72 38 86" stroke="#e48a9a" stroke-width="3" fill="none"/></g>
  <g class="tail" style="transform-origin:142px 54px;animation-delay:-.8s"><path d="M138 52 C166 40 178 64 170 96 C154 92 140 74 134 62 Z" fill="#f6b8c2" ${S}/><path d="M144 60 C158 58 164 72 162 86" stroke="#e48a9a" stroke-width="3" fill="none"/></g>
  <ellipse cx="100" cy="82" rx="54" ry="48" fill="#f6b8c2" ${S}/>
  <path d="M84 38 q6 -10 12 0 q6 -10 12 0" fill="none" stroke="#e48a9a" stroke-width="3"/>
  ${eyes(100,74,22,{r:6})}
  <ellipse cx="100" cy="100" rx="24" ry="17" fill="#f39aab" ${S}/>
  <ellipse cx="92" cy="100" rx="4" ry="6" fill="#7a3b48"/><ellipse cx="108" cy="100" rx="4" ry="6" fill="#7a3b48"/>
  ${blush(100,96,38)}
  <path d="M82 118 Q100 128 118 118" fill="none" ${S2}/>
`, {sw:70});

// 沙悟净：红发、络腮短须、佛珠、降妖宝杖
C.shaseng = () => wrap(`
  ${hold(152,166,6, W.zhang())}
  ${feet('#4e342e')}
  <path d="M64 130 Q100 118 136 130 L144 198 Q100 208 56 198 Z" fill="#6d5b3b" ${S}/>
  <path d="M100 124 L100 200" stroke="#4e3e26" stroke-width="3"/>
  <rect x="62" y="166" width="78" height="9" rx="4" fill="#c49a45" ${S2}/>
  <g>${Array.from({length:9},(_,i)=>{const a=Math.PI*(0.1+0.8*i/8);const x=100-Math.cos(a)*38,y=124+Math.sin(a)*24;return `<path d="M${x-6} ${y} a6 6 0 1 1 12 0 l0 3 l-3 2 l-6 0 l-3 -2 Z" fill="#f4efe2" stroke="${O}" stroke-width="1.8"/><circle cx="${x-2.3}" cy="${y}" r="1.6" fill="${O}"/><circle cx="${x+2.3}" cy="${y}" r="1.6" fill="${O}"/>`}).join('')}</g>
  <ellipse cx="58" cy="156" rx="11" ry="16" fill="#6d5b3b" ${S}/><circle cx="56" cy="170" r="8" fill="#9fb4b8" ${S2}/>
  <circle cx="152" cy="162" r="9" fill="#9fb4b8" ${S2}/>
  <g class="sway" style="transform-origin:100px 40px"><path d="M52 70 L40 50 L60 54 L56 30 L76 44 L84 20 L100 40 L116 20 L124 44 L144 30 L140 54 L160 50 L148 70 Z" fill="#e2552f" ${S}/></g>
  <circle cx="100" cy="82" r="47" fill="#9fb4b8" ${S}/>
  <path d="M60 66 Q100 50 140 66 Q130 58 100 56 Q70 58 60 66 Z" fill="#e2552f" ${S2}/>
  <path d="M72 70 l14 4 M128 70 l-14 4" stroke="${O}" stroke-width="4" stroke-linecap="round"/>
  ${eyes(100,84,18,{r:6.5})}
  <path d="M64 100 C68 128 86 136 100 136 C114 136 132 128 136 100 C126 112 112 116 100 116 C88 116 74 112 64 100 Z" fill="#e2552f" ${S2}/>
  <path d="M90 108 Q100 116 110 108" fill="none" ${S2}/>
  <ellipse cx="100" cy="98" rx="5" ry="3.5" fill="#6f8a8f"/>
`);

// 小白龙：白身、金角、蓝鬣、长须、龙珠
C.bailong = () => `<svg viewBox="0 0 200 220" class="char bailong" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${shadow(56)}<g class="actor"><g class="bob">
  <g class="tail" style="transform-origin:96px 150px">
    <path d="M100 118 C40 128 40 176 92 184 C140 192 160 210 186 196" fill="none" stroke="${O}" stroke-width="34" stroke-linecap="round"/>
    <path d="M100 118 C40 128 40 176 92 184 C140 192 160 210 186 196" fill="none" stroke="#f4f8fb" stroke-width="27" stroke-linecap="round"/>
    <path d="M98 128 C56 136 54 170 94 176 C136 182 156 198 180 190" fill="none" stroke="#f3dca0" stroke-width="9" stroke-dasharray="7 4" stroke-linecap="round"/>
    <path d="M64 136 l-8 -12 l12 4 M58 162 l-12 -6 l12 -4 M118 188 l2 -14 l8 10 M150 196 l4 -14 l7 12" fill="#8fd3f4" ${S2}/>
    <path d="M182 196 l14 -16 l-2 22 l-14 6 Z" fill="#8fd3f4" ${S2}/>
  </g>
  <path d="M60 150 l-10 8 m10 -8 l-4 12 m4 -12 l6 10" stroke="${O}" stroke-width="3" fill="none"/>
  <g class="weapon" style="transform-origin:142px 150px"><circle cx="148" cy="150" r="13" fill="#bfe9ff" ${S}/><circle cx="144" cy="145" r="4" fill="#fff"/><path d="M134 160 q4 -10 10 -6 M160 160 q-4 -10 -10 -6" stroke="${O}" stroke-width="3" fill="none"/></g>
  <g class="sway" style="transform-origin:100px 60px"><path d="M58 70 L40 64 L52 56 L38 44 L58 46 L54 28 L72 40 L82 24 L90 44" fill="#8fd3f4" ${S}/></g>
  <path d="M74 44 C66 26 72 14 64 4 M70 26 l-12 -4 M110 42 C118 24 112 12 120 2 M114 24 l12 -6" fill="none" stroke="${O}" stroke-width="8" stroke-linecap="round"/>
  <path d="M74 44 C66 26 72 14 64 4 M70 26 l-12 -4 M110 42 C118 24 112 12 120 2 M114 24 l12 -6" fill="none" stroke="#f2c94c" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M100 36 C64 36 52 60 54 86 C56 112 76 126 100 124 C122 122 132 114 150 112 C170 110 176 92 168 80 C160 68 146 70 136 66 C130 46 118 36 100 36 Z" fill="#f4f8fb" ${S}/>
  <path d="M138 84 C150 82 162 86 166 94" fill="none" stroke="#c9d6df" stroke-width="2.4"/>
  <circle cx="156" cy="88" r="3" fill="#6b8597"/>
  <g class="sway" style="transform-origin:150px 104px"><path d="M150 104 C170 114 168 134 186 140" fill="none" stroke="#e7b84a" stroke-width="3.2" stroke-linecap="round"/><path d="M146 108 C150 128 140 140 148 156" fill="none" stroke="#e7b84a" stroke-width="3.2" stroke-linecap="round"/></g>
  ${eyes(100,78,16,{r:7, iris:'#4fb3e8'})}
  ${blush(96,98,24,'#9fd4f5')}
  <path d="M120 104 Q132 112 146 106" fill="none" ${S2}/>
</g></g></svg>`;

// 斑斓虎（五行山教学关）
C.tiger = (o={}) => wrap(`
  <g class="tail" style="transform-origin:136px 180px"><path d="M134 184 C170 186 178 150 160 136" fill="none" stroke="${O}" stroke-width="13" stroke-linecap="round"/><path d="M134 184 C170 186 178 150 160 136" fill="none" stroke="#f08a24" stroke-width="8" stroke-linecap="round"/><path d="M152 182 l6 -8 M166 166 l8 -2 M166 150 l7 4" stroke="${O}" stroke-width="3.4"/></g>
  <ellipse cx="100" cy="174" rx="44" ry="32" fill="#f08a24" ${S}/>
  <ellipse cx="100" cy="182" rx="24" ry="20" fill="#fff4e0" ${S2}/>
  <path d="M60 168 l12 4 M58 182 l12 0 M140 168 l-12 4 M142 182 l-12 0" stroke="${O}" stroke-width="3.4"/>
  <ellipse cx="78" cy="204" rx="15" ry="9" fill="#f08a24" ${S}/><ellipse cx="122" cy="204" rx="15" ry="9" fill="#f08a24" ${S}/>
  <path d="M72 204 v5 M78 204 v5 M116 204 v5 M122 204 v5" stroke="${O}" stroke-width="2"/>
  <circle cx="58" cy="50" r="15" fill="#f08a24" ${S}/><circle cx="58" cy="50" r="7" fill="#fff4e0"/><circle cx="142" cy="50" r="15" fill="#f08a24" ${S}/><circle cx="142" cy="50" r="7" fill="#fff4e0"/>
  <ellipse cx="100" cy="88" rx="56" ry="50" fill="#f08a24" ${S}/>
  <path d="M86 48 h28 M90 58 h20 M100 46 v14" stroke="${O}" stroke-width="4" stroke-linecap="round"/>
  <path d="M46 84 l14 2 M46 98 l14 -2 M154 84 l-14 2 M154 98 l-14 -2" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M68 104 C68 128 88 134 100 134 C112 134 132 128 132 104 C120 96 80 96 68 104 Z" fill="#fff4e0" ${S2}/>
  ${o.angry? slitEyes(100,82,20,'#f5d33d') : eyes(100,82,20,{r:7.5})}
  <path d="M92 104 L108 104 L100 112 Z" fill="#3a2618"/>
  <path d="M100 112 v6 M88 120 Q94 126 100 118 Q106 126 112 120" fill="none" ${S2}/>
`, {sw:64});

// 虾兵（鹰愁涧）
C.xia = () => wrap(`
  ${hold(150,164,4, W.spear('#3a7bd5','#8a5a2b',170))}
  <g class="tail" style="transform-origin:100px 170px"><path d="M100 176 C116 190 108 206 90 210 L70 214 L84 200 L64 198 L86 190 Z" fill="#ef6c4a" ${S}/></g>
  ${[0,1,2].map(i=>`<ellipse cx="100" cy="${140+i*14}" rx="${34-i*6}" ry="11" fill="#f2805e" ${S}/>`).join('')}
  <path d="M76 150 l-10 10 M80 162 l-10 8 M124 150 l10 10" stroke="${O}" stroke-width="3"/>
  <circle cx="150" cy="158" r="8" fill="#f2805e" ${S2}/>
  <g class="sway" style="transform-origin:96px 40px"><path d="M90 42 C70 4 30 10 14 30 M108 42 C120 6 160 -4 190 14" fill="none" stroke="${O}" stroke-width="3.2"/></g>
  <path d="M84 52 l-8 -16 M116 52 l8 -16" stroke="${O}" stroke-width="4"/>
  <circle cx="76" cy="34" r="9" fill="#24160c"/><circle cx="79" cy="31" r="3" fill="#fff"/><circle cx="124" cy="34" r="9" fill="#24160c"/><circle cx="127" cy="31" r="3" fill="#fff"/>
  <path d="M60 86 C60 56 80 46 100 46 C120 46 140 56 140 86 C140 112 120 126 100 126 C80 126 60 112 60 86 Z" fill="#f2805e" ${S}/>
  <path d="M62 74 Q100 48 138 74 L138 64 Q100 38 62 64 Z" fill="#5c6bc0" ${S2}/><circle cx="100" cy="50" r="6" fill="#f2b632" ${S2}/>
  ${eyes(100,90,16,{r:6})}
  ${blush(100,104,26)}
  <path d="M90 110 Q100 116 110 110" fill="none" ${S2}/>
`);

// 凌虚子（苍狼精）：道冠、青锋剑
C.langjing = () => wrap(`
  ${hold(148,164,12, W.sword())}
  ${feet('#3e4752')}
  <path d="M64 130 Q100 118 136 130 L146 200 Q100 210 54 200 Z" fill="#7d8fa6" ${S}/>
  <path d="M100 122 L84 200 M100 122 L116 200" stroke="#5b6c82" stroke-width="3" fill="none"/>
  <rect x="64" y="160" width="72" height="8" rx="4" fill="#3e4752" ${S2}/>
  <ellipse cx="58" cy="154" rx="11" ry="16" fill="#7d8fa6" ${S}/><circle cx="56" cy="168" r="8" fill="#9aa5b1" ${S2}/>
  <circle cx="148" cy="160" r="9" fill="#9aa5b1" ${S2}/>
  <path d="M58 64 L56 18 L86 44 Z M142 64 L144 18 L114 44 Z" fill="#7a8794" ${S}/><path d="M62 52 L62 32 L76 44 Z M138 52 L138 32 L124 44 Z" fill="#e7c9d0"/>
  <path d="M100 36 C66 36 50 58 50 84 C50 104 62 114 76 118 L100 136 L124 118 C138 114 150 104 150 84 C150 58 134 36 100 36 Z" fill="#9aa5b1" ${S}/>
  <path d="M74 98 C80 120 94 132 100 136 C106 132 120 120 126 98 C116 92 84 92 74 98 Z" fill="#e8ecef" ${S2}/>
  <path d="M86 36 L90 20 L110 20 L114 36 Z" fill="#3e4752" ${S2}/><rect x="96" y="12" width="8" height="10" rx="2" fill="#f2b632" ${S2}/>
  <path d="M70 70 l18 6 M130 70 l-18 6" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/>
  ${slitEyes(100,84,18,'#f5d33d')}
  <ellipse cx="100" cy="104" rx="7" ry="5" fill="#2b2b2b"/>
  <path d="M92 116 Q100 122 108 116" fill="none" ${S2}/>
`);

// 白衣秀士（白花蛇精）：方巾、白袍、花枪
C.shejing = () => wrap(`
  ${hold(150,166,6, W.spear('#d93a3a','#e9e1d0'))}
  ${feet('#cfd8dc')}
  <path d="M64 130 Q100 118 136 130 L148 202 Q100 212 52 202 Z" fill="#f7f7f2" ${S}/>
  <path d="M100 124 L100 204" stroke="#8bc34a" stroke-width="3"/><path d="M52 202 Q100 212 148 202" fill="none" stroke="#8bc34a" stroke-width="4"/>
  <path d="M84 124 L100 140 L116 124" fill="none" stroke="#8bc34a" stroke-width="4"/>
  <ellipse cx="58" cy="156" rx="11" ry="16" fill="#f7f7f2" ${S}/><circle cx="56" cy="170" r="8" fill="#dcefd8" ${S2}/>
  <circle cx="150" cy="162" r="9" fill="#dcefd8" ${S2}/>
  <ellipse cx="100" cy="84" rx="46" ry="48" fill="#dcefd8" ${S}/>
  <path d="M66 96 q6 -4 12 0 q-6 4 -12 0 M122 96 q6 -4 12 0 q-6 4 -12 0 M70 108 q5 -3 10 0 M120 108 q5 -3 10 0" fill="#a5d6a7" stroke="#7cb342" stroke-width="1.4"/>
  <path d="M54 66 Q54 30 100 30 Q146 30 146 66 L134 58 Q100 48 66 58 Z" fill="#37474f" ${S}/><path d="M142 50 C160 48 166 60 160 72" fill="none" stroke="#37474f" stroke-width="6" stroke-linecap="round"/>
  <path d="M74 72 q8 -4 14 0 M112 72 q8 -4 14 0" stroke="${O}" stroke-width="3" fill="none"/>
  ${slitEyes(100,86,18,'#c6e04c')}
  <g class="flick" style="transform-origin:100px 114px"><path d="M100 112 L100 128 L94 134 M100 128 L106 134" fill="none" stroke="#e53935" stroke-width="3" stroke-linecap="round"/></g>
  <path d="M90 110 Q100 116 110 110" fill="none" ${S2}/>
`);

// 黑熊精：黑缨长枪、金甲
C.heixiong = () => wrap(`
  ${hold(158,166,10, W.spear('#222','#5a3a22',190))}
  <ellipse cx="80" cy="206" rx="18" ry="9" fill="#2a2627" ${S}/><ellipse cx="120" cy="206" rx="18" ry="9" fill="#2a2627" ${S}/>
  <path d="M54 130 Q100 112 146 130 L156 200 Q100 214 44 200 Z" fill="#3a3436" ${S}/>
  <path d="M70 128 Q100 160 130 128 L126 176 Q100 186 74 176 Z" fill="#b8892e" ${S2}/>
  <path d="M84 144 Q100 158 116 144" fill="none" stroke="#f4f1e8" stroke-width="7" stroke-linecap="round"/>
  <path d="M44 132 Q30 120 40 106 L62 124 Z M156 132 Q170 120 160 106 L138 124 Z" fill="#b8892e" ${S}/>
  <rect x="56" y="174" width="88" height="10" rx="5" fill="#8d2c1f" ${S2}/>
  <ellipse cx="50" cy="158" rx="14" ry="18" fill="#3a3436" ${S}/><circle cx="48" cy="174" r="10" fill="#3a3436" ${S2}/>
  <circle cx="158" cy="162" r="11" fill="#3a3436" ${S2}/>
  <circle cx="52" cy="40" r="17" fill="#3a3436" ${S}/><circle cx="52" cy="40" r="8" fill="#6d5a4a"/><circle cx="148" cy="40" r="17" fill="#3a3436" ${S}/><circle cx="148" cy="40" r="8" fill="#6d5a4a"/>
  <ellipse cx="100" cy="80" rx="58" ry="52" fill="#3a3436" ${S}/>
  <ellipse cx="100" cy="102" rx="28" ry="20" fill="#b58d6a" ${S2}/>
  <ellipse cx="100" cy="94" rx="10" ry="7" fill="#1e1a1b"/>
  <path d="M100 101 v6 M90 112 Q100 118 110 112" fill="none" ${S2}/>
  <path d="M68 62 l20 8 M132 62 l-20 8" stroke="#b58d6a" stroke-width="4" stroke-linecap="round"/>
  ${eyes(100,76,22,{r:7, iris:'#f0a020'})}
`, {sw:72, cls:'big'});

// 虎先锋：红缨盔、铠甲、两口赤铜刀
C.hufeng = () => wrap(`
  ${hold(152,166,14, W.saber())}
  ${hold(48,166,-14, W.saber())}
  ${feet('#4a2c1a')}
  <path d="M60 130 Q100 116 140 130 L148 198 Q100 210 52 198 Z" fill="#8d3a22" ${S}/>
  ${[0,1,2].map(i=>`<path d="M66 ${146+i*14} Q100 ${154+i*14} 134 ${146+i*14}" fill="none" stroke="#e0a040" stroke-width="4"/>`).join('')}
  <path d="M52 132 Q40 118 54 106 L70 124 Z M148 132 Q160 118 146 106 L130 124 Z" fill="#e0a040" ${S}/>
  <circle cx="50" cy="162" r="9" fill="#f08a24" ${S2}/><circle cx="150" cy="162" r="9" fill="#f08a24" ${S2}/>
  <circle cx="60" cy="54" r="13" fill="#f08a24" ${S}/><circle cx="140" cy="54" r="13" fill="#f08a24" ${S}/>
  <ellipse cx="100" cy="88" rx="52" ry="46" fill="#f08a24" ${S}/>
  <path d="M54 68 Q100 22 146 68 L140 74 Q100 46 60 74 Z" fill="#a33b22" ${S}/>
  <g class="sway" style="transform-origin:100px 34px"><path d="M100 36 C90 10 104 2 112 -2 C108 10 116 18 100 36 Z" fill="#e53935" ${S2}/></g>
  <circle cx="100" cy="40" r="6" fill="#f2b632" ${S2}/>
  <path d="M48 90 l14 2 M48 104 l14 -2 M152 90 l-14 2 M152 104 l-14 -2" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M70 106 C70 128 88 132 100 132 C112 132 130 128 130 106 C118 98 82 98 70 106 Z" fill="#fff4e0" ${S2}/>
  <path d="M74 74 l18 6 M126 74 l-18 6" stroke="${O}" stroke-width="4" stroke-linecap="round"/>
  ${slitEyes(100,88,19,'#f5d33d')}
  <path d="M93 106 L107 106 L100 113 Z" fill="${O}"/>
  <path d="M88 120 Q94 126 100 118 Q106 126 112 120" fill="none" ${S2}/><path d="M92 121 l2 5 l2 -4 M104 121 l2 4 l2 -5" fill="#fff" stroke="${O}" stroke-width="1.2"/>
`);

// 黄风怪（黄毛貂鼠）：金甲、红披风、三股钢叉、三昧神风
C.huangfeng = () => wrap(`
  <g class="sway" style="transform-origin:100px 130px"><path d="M58 130 C30 160 34 196 52 210 L148 210 C166 196 170 160 142 130 Z" fill="#c0392b" ${S}/></g>
  ${hold(154,168,8, W.trident())}
  ${feet('#6d4c1f')}
  <path d="M64 130 Q100 118 136 130 L144 198 Q100 208 56 198 Z" fill="#e6b325" ${S}/>
  <path d="M70 140 h60 M68 156 h64 M66 172 h68" stroke="#a87b12" stroke-width="3"/>
  <circle cx="100" cy="150" r="10" fill="#c0392b" ${S2}/>
  <ellipse cx="58" cy="156" rx="11" ry="16" fill="#e6b325" ${S}/><circle cx="56" cy="170" r="8" fill="#f2c94c" ${S2}/>
  <circle cx="154" cy="164" r="9" fill="#f2c94c" ${S2}/>
  <circle cx="64" cy="46" r="13" fill="#f2c94c" ${S}/><circle cx="64" cy="46" r="6" fill="#fbe7a6"/><circle cx="136" cy="46" r="13" fill="#f2c94c" ${S}/><circle cx="136" cy="46" r="6" fill="#fbe7a6"/>
  <path d="M100 36 C68 36 52 58 52 82 C52 102 66 112 80 116 L100 134 L120 116 C134 112 148 102 148 82 C148 58 132 36 100 36 Z" fill="#f2c94c" ${S}/>
  <path d="M100 52 C92 64 92 76 100 84 C108 76 108 64 100 52 Z" fill="#fbe7a6"/>
  <path d="M76 100 C82 120 94 130 100 134 C106 130 118 120 124 100 C114 94 86 94 76 100 Z" fill="#fff6d8" ${S2}/>
  ${eyes(100,82,18,{r:7.5, iris:'#8d5524'})}
  <ellipse cx="100" cy="106" rx="5" ry="4" fill="#5d3a1a"/>
  <path d="M60 104 l-16 -2 M60 110 l-16 4 M140 104 l16 -2 M140 110 l16 4" stroke="${O}" stroke-width="1.8"/>
  <path d="M94 116 Q100 120 106 116" fill="none" ${S2}/><ellipse class="mopen" cx="100" cy="118" rx="7" ry="6" fill="#5d1a1a" ${S2}/>
  <g class="spin" style="transform-origin:34px 120px" opacity=".85"><path d="M34 120 m-14 0 a14 14 0 1 1 14 14 a8 8 0 1 1 -6 -10" fill="none" stroke="#d7b46a" stroke-width="3.5" stroke-linecap="round"/></g>
  <g class="spin rev" style="transform-origin:170px 90px" opacity=".85"><path d="M170 90 m-10 0 a10 10 0 1 1 10 10 a6 6 0 1 1 -4 -7" fill="none" stroke="#d7b46a" stroke-width="3" stroke-linecap="round"/></g>
`);

// 错题小妖：小钻风（巡山铜锣）
C.xiaozuanfeng = () => wrap(`
  ${feet('#37474f')}
  <path d="M68 132 Q100 122 132 132 L138 198 Q100 206 62 198 Z" fill="#455a64" ${S}/>
  <rect x="100" y="172" width="26" height="20" rx="4" fill="#f6e3b4" ${S2}/><text x="113" y="187" font-size="12" text-anchor="middle" font-weight="700" fill="${O}" font-family="sans-serif">巡</text>
  <g class="weapon" style="transform-origin:66px 138px"><path d="M66 138 L80 145" stroke="${O}" stroke-width="2.5"/><circle cx="84" cy="160" r="17" fill="#e5b33c" ${S}/><circle cx="84" cy="160" r="9" fill="#f6d36b" stroke="#b88a1a" stroke-width="2"/></g>
  <circle cx="62" cy="136" r="8" fill="#7ec8e3" ${S2}/>
  ${hold(140,156,0, `<path d="M0 0 L0 -46" stroke="${O}" stroke-width="6" stroke-linecap="round"/><path d="M0 0 L0 -46" stroke="#a0703c" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="-48" r="6.5" fill="#e53935" ${S2}/>`)}
  <circle cx="140" cy="158" r="8" fill="#7ec8e3" ${S2}/>
  <circle cx="100" cy="86" r="44" fill="#7ec8e3" ${S}/>
  <path d="M62 66 L100 4 L138 66 Q100 54 62 66 Z" fill="#e53935" ${S}/><circle cx="100" cy="6" r="6" fill="#f2b632" ${S2}/>
  <path d="M56 84 l-14 -6 l12 16 Z M144 84 l14 -6 l-12 16 Z" fill="#7ec8e3" ${S2}/>
  ${eyes(100,88,16,{r:7})}
  ${blush(100,104,26)}
  <path d="M86 110 Q100 122 114 110 Z" fill="#c0392b" ${S2}/><path d="M106 111 l3 6 l3 -5" fill="#fff" stroke="${O}" stroke-width="1.2"/>
  <ellipse class="mopen" cx="100" cy="114" rx="13" ry="10" fill="#7a1f1f" ${S2}/>
`);

// 奔波儿灞（鲇鱼精）
C.benbo = () => wrap(`
  ${hold(150,164,4, W.spear('#f2b632','#8a5a2b',160))}
  ${feet('#5d4037')}
  <path d="M68 132 Q100 122 132 132 L138 198 Q100 206 62 198 Z" fill="#8d6e63" ${S}/>
  <path d="M74 140 L126 140 L122 180 L78 180 Z" fill="#c62828" ${S2}/>
  <circle cx="56" cy="158" r="8" fill="#a1887f" ${S2}/><circle cx="150" cy="160" r="8" fill="#a1887f" ${S2}/>
  <path d="M100 30 L92 14 L108 14 Z" fill="#6d4c41" ${S2}/>
  <ellipse cx="100" cy="82" rx="54" ry="44" fill="#a1887f" ${S}/>
  <path d="M60 100 Q100 124 140 100 Q100 112 60 100 Z" fill="#6d4c41" ${S2}/>
  <ellipse class="mopen" cx="100" cy="108" rx="22" ry="13" fill="#5d1a1a" ${S2}/><ellipse class="mopen" cx="100" cy="113" rx="10" ry="5" fill="#e57373"/>
  <g class="sway" style="transform-origin:70px 100px"><path d="M68 100 C46 110 40 132 24 136" fill="none" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/><path d="M132 100 C154 110 160 132 176 136" fill="none" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/></g>
  ${eyes(100,74,24,{r:6.5})}
`);

// 灞波儿奔（黑鱼精）
C.babo = () => wrap(`
  ${hold(150,164,4, W.spear('#7ec8e3','#8a5a2b',160))}
  ${feet('#263238')}
  <path d="M68 132 Q100 122 132 132 L138 198 Q100 206 62 198 Z" fill="#37474f" ${S}/>
  <path d="M74 140 L126 140 L122 180 L78 180 Z" fill="#1565c0" ${S2}/>
  <circle cx="56" cy="158" r="8" fill="#546e7a" ${S2}/><circle cx="150" cy="160" r="8" fill="#546e7a" ${S2}/>
  <g class="sway" style="transform-origin:100px 40px"><path d="M70 46 L80 18 L92 38 L100 12 L110 38 L122 18 L130 46 Z" fill="#263238" ${S}/></g>
  <path d="M100 38 C62 38 46 62 48 84 C50 108 72 122 100 122 C128 122 150 108 152 84 C154 62 138 38 100 38 Z" fill="#546e7a" ${S}/>
  <path d="M58 92 C66 106 82 112 100 112" fill="none" stroke="#b0bec5" stroke-width="3"/>
  <path d="M152 84 l18 -10 l-4 14 l4 14 l-18 -8" fill="#263238" ${S2}/>
  ${eyes(100,80,20,{r:7, iris:'#ffd54f'})}
  <path d="M84 102 Q100 110 116 102" fill="none" ${S2}/>
  <ellipse class="mopen" cx="100" cy="106" rx="15" ry="11" fill="#1a1a1a" ${S2}/>
`);

// 观音菩萨：白衣、圆光、净瓶杨柳
C.guanyin = () => wrap(`
  <g class="spin slow" style="transform-origin:100px 82px"><circle cx="100" cy="82" r="72" fill="none" stroke="#f6d36b" stroke-width="3" stroke-dasharray="4 10" opacity=".9"/></g>
  <circle cx="100" cy="82" r="62" fill="#fff4c2" opacity=".55"/>
  ${hold(152,168,0, W.vase())}
  <path d="M60 128 Q100 112 140 128 L156 208 Q100 216 44 208 Z" fill="#fbfbff" ${S}/>
  <path d="M74 132 Q100 150 126 132" fill="none" stroke="#9ccbe8" stroke-width="4"/>
  <path d="M60 128 L44 208 M140 128 L156 208" stroke="#9ccbe8" stroke-width="3"/>
  <circle cx="148" cy="170" r="8" fill="#fbe3d0" ${S2}/>
  <circle cx="64" cy="164" r="8" fill="#fbe3d0" ${S2}/>
  <path d="M52 92 C48 48 70 30 100 30 C130 30 152 48 148 92 L150 140 Q100 120 50 140 Z" fill="#fbfbff" ${S}/>
  <circle cx="100" cy="84" r="38" fill="#fbe3d0" ${S}/>
  <path d="M64 74 Q72 46 100 44 Q128 46 136 74 Q120 60 100 60 Q80 60 64 74 Z" fill="#2b2b33" ${S2}/>
  <path d="M86 40 Q100 20 114 40 Z" fill="#2b2b33" ${S2}/><circle cx="100" cy="42" r="5" fill="#f2b632"/>
  ${happyEyes(100,88,14)}
  <circle cx="100" cy="74" r="2.6" fill="#e53935"/>
  <path d="M94 104 Q100 108 106 104" fill="none" ${S2}/>
  ${blush(100,98,22,'#f7a8a8')}
`, {sw:58});

// 灵吉菩萨：金袍、圆光、飞龙宝杖
C.lingji = () => wrap(`
  <g class="spin slow" style="transform-origin:100px 82px"><circle cx="100" cy="82" r="70" fill="none" stroke="#f6d36b" stroke-width="3" stroke-dasharray="4 10"/></g>
  <circle cx="100" cy="82" r="60" fill="#fff4c2" opacity=".5"/>
  ${hold(152,168,6, W.dragonstaff())}
  ${feet('#8d6e63')}
  <path d="M60 128 Q100 114 140 128 L150 204 Q100 214 50 204 Z" fill="#f2b632" ${S}/>
  <path d="M60 140 L140 132 M58 160 L144 150" stroke="#c0392b" stroke-width="4"/>
  <circle cx="58" cy="160" r="8" fill="#f8dcc0" ${S2}/><circle cx="152" cy="166" r="8" fill="#f8dcc0" ${S2}/>
  <circle cx="100" cy="84" r="44" fill="#f8dcc0" ${S}/>
  <path d="M58 70 Q100 30 142 70 Q120 54 100 54 Q80 54 58 70 Z" fill="#c0392b" ${S2}/>
  ${happyEyes(100,88,16)}
  <path d="M84 104 Q100 124 116 104 Q108 112 100 112 Q92 112 84 104 Z" fill="#fff" ${S2}/>
  <circle cx="100" cy="74" r="2.6" fill="#e53935"/>
`);

// 土地公（向导）
C.tudi = () => wrap(`
  ${hold(146,190,4, W.cane())}
  ${feet('#5d4037')}
  <path d="M68 138 Q100 128 132 138 L138 200 Q100 208 62 200 Z" fill="#a1563a" ${S}/>
  <circle cx="58" cy="168" r="8" fill="#f8dcc0" ${S2}/><circle cx="146" cy="176" r="8" fill="#f8dcc0" ${S2}/>
  <circle cx="100" cy="92" r="40" fill="#f8dcc0" ${S}/>
  <path d="M60 80 Q60 44 100 44 Q140 44 140 80 L132 74 Q100 62 68 74 Z" fill="#6d4c41" ${S}/>
  <path d="M64 100 C64 150 88 170 100 176 C112 170 136 150 136 100 C126 116 112 112 100 112 C88 112 74 116 64 100 Z" fill="#fafafa" ${S}/>
  <path d="M76 82 q8 -6 14 0 M110 82 q8 -6 14 0" stroke="#fafafa" stroke-width="5" stroke-linecap="round" fill="none"/>
  ${happyEyes(100,92,14)}
  <ellipse cx="100" cy="104" rx="6" ry="5" fill="#f0a98c" ${S2}/>
`);

// ---------- 原形（收服后显现） ----------
const beast = (inner) => `<svg viewBox="0 0 200 220" class="char beast" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${shadow(54)}<g class="actor"><g class="bob">${inner}</g></g></svg>`;
C.yx_lang = () => beast(`
  <g class="tail" style="transform-origin:150px 150px"><path d="M148 150 C176 140 186 120 178 100 C170 120 158 128 140 132 Z" fill="#9aa5b1" ${S}/></g>
  <ellipse cx="112" cy="160" rx="44" ry="26" fill="#9aa5b1" ${S}/>
  <rect x="80" y="170" width="14" height="36" rx="6" fill="#9aa5b1" ${S}/><rect x="126" y="170" width="14" height="36" rx="6" fill="#9aa5b1" ${S}/>
  <path d="M58 132 L56 96 L76 116 Z M86 120 L92 88 L102 118 Z" fill="#7a8794" ${S}/>
  <path d="M50 140 C50 116 70 110 88 116 C104 122 104 146 94 158 L56 170 L32 162 C30 152 40 146 50 140 Z" fill="#9aa5b1" ${S}/>
  <ellipse cx="32" cy="160" rx="6" ry="5" fill="#2b2b2b"/>
  ${eyes(70,136,0.01,{r:6})}
`);
C.yx_she = () => beast(`
  <g class="tail" style="transform-origin:100px 180px"><ellipse cx="100" cy="186" rx="60" ry="20" fill="#f7f7f2" ${S}/><ellipse cx="100" cy="168" rx="44" ry="16" fill="#f7f7f2" ${S}/>
  <path d="M60 186 h10 M84 190 h10 M110 190 h10 M134 186 h10 M76 168 h10 M108 170 h10" stroke="#8bc34a" stroke-width="4" stroke-linecap="round"/></g>
  <path d="M100 160 C96 130 110 110 120 96" fill="none" stroke="${O}" stroke-width="22" stroke-linecap="round"/><path d="M100 160 C96 130 110 110 120 96" fill="none" stroke="#f7f7f2" stroke-width="16" stroke-linecap="round"/>
  <ellipse cx="124" cy="88" rx="22" ry="16" fill="#f7f7f2" ${S}/>
  ${slitEyes(124,84,9,'#c6e04c')}
  <g class="flick" style="transform-origin:146px 92px"><path d="M146 92 l14 0 l5 -4 m-5 4 l5 4" fill="none" stroke="#e53935" stroke-width="2.6" stroke-linecap="round"/></g>
`);
C.yx_xiong = () => beast(`
  <ellipse cx="100" cy="166" rx="54" ry="40" fill="#3a3436" ${S}/>
  <ellipse cx="74" cy="204" rx="16" ry="9" fill="#3a3436" ${S}/><ellipse cx="126" cy="204" rx="16" ry="9" fill="#3a3436" ${S}/>
  <path d="M84 150 Q100 162 116 150" fill="none" stroke="#f4f1e8" stroke-width="6" stroke-linecap="round"/>
  <circle cx="66" cy="74" r="14" fill="#3a3436" ${S}/><circle cx="134" cy="74" r="14" fill="#3a3436" ${S}/>
  <circle cx="100" cy="104" r="44" fill="#3a3436" ${S}/>
  <ellipse cx="100" cy="120" rx="20" ry="14" fill="#b58d6a" ${S2}/><ellipse cx="100" cy="114" rx="7" ry="5" fill="#1e1a1b"/>
  ${eyes(100,98,17,{r:6})}
`);
C.yx_diao = () => beast(`
  <g class="tail" style="transform-origin:150px 160px"><path d="M146 162 C180 160 192 132 178 112 C176 134 160 146 140 150 Z" fill="#f2c94c" ${S}/></g>
  <ellipse cx="110" cy="166" rx="42" ry="24" fill="#f2c94c" ${S}/>
  <rect x="80" y="176" width="13" height="30" rx="6" fill="#f2c94c" ${S}/><rect x="124" y="176" width="13" height="30" rx="6" fill="#f2c94c" ${S}/>
  <circle cx="62" cy="118" r="9" fill="#f2c94c" ${S}/><circle cx="90" cy="114" r="9" fill="#f2c94c" ${S}/>
  <path d="M48 146 C48 124 64 116 80 118 C98 120 102 142 94 156 L60 166 L38 158 C36 150 42 148 48 146 Z" fill="#f2c94c" ${S}/>
  <ellipse cx="38" cy="156" rx="5" ry="4" fill="#5d3a1a"/>
  ${eyes(70,138,0.01,{r:6})}
`);
// 老虎原形 = 斑斓虎本身
C.yx_hu = () => C.tiger();

// ================= 神仙（扩充） =================
const robe = (c, extra='') => `<path d="M62 128 Q100 116 138 128 L150 204 Q100 214 50 204 Z" fill="${c}" ${S}/>${extra}`;
const hands = (c, l=[58,162], r=[152,166]) => `<circle cx="${l[0]}" cy="${l[1]}" r="8.5" fill="${c}" ${S2}/><circle cx="${r[0]}" cy="${r[1]}" r="8.5" fill="${c}" ${S2}/>`;
const sleeve = (c, x=58, y=150) => `<ellipse cx="${x}" cy="${y}" rx="12" ry="17" fill="${c}" ${S} transform="rotate(14 ${x} ${y})"/>`;
const head = (c, r=44, cy=84) => `<circle cx="100" cy="${cy}" r="${r}" fill="${c}" ${S}/>`;
const halo = (r=70, c='#f6d36b') => `<g class="spin slow" style="transform-origin:100px 82px"><circle cx="100" cy="82" r="${r}" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="4 10"/></g><circle cx="100" cy="82" r="${r-10}" fill="#fff4c2" opacity=".5"/>`;
const longBeard = (c='#fafafa', len=60) => `<path d="M66 100 C66 ${100+len} 90 ${120+len} 100 ${126+len} C110 ${120+len} 134 ${100+len} 134 100 C124 116 112 112 100 112 C88 112 76 116 66 100 Z" fill="${c}" ${S}/>`;
const threeBeard = (c='#2b2420') => `<path d="M86 112 C80 132 84 150 78 162 M100 114 C100 136 98 156 100 172 M114 112 C120 132 116 150 122 162" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`;
const mouth = (d='M92 106 Q100 112 108 106') => `<path d="${d}" fill="none" ${S2}/>`;
const armor = (c, trim) => `<path d="M58 130 Q100 114 142 130 L150 200 Q100 212 50 200 Z" fill="${c}" ${S}/>`+
  `<path d="M66 140 Q100 152 134 140 M64 158 Q100 170 136 158" fill="none" stroke="${trim}" stroke-width="4"/><circle cx="100" cy="150" r="11" fill="${trim}" ${S2}/><circle cx="100" cy="150" r="5" fill="#fff6d6"/>`+
  `<path d="M50 134 Q36 118 52 104 L70 124 Z M150 134 Q164 118 148 104 L130 124 Z" fill="${trim}" ${S}/>`;
const helmet = (c, plume='#e53935') => `<path d="M54 70 Q100 18 146 70 L140 76 Q100 50 60 76 Z" fill="${c}" ${S}/><path d="M96 34 L100 14 L104 34 Z" fill="${c}" ${S2}/><g class="sway" style="transform-origin:100px 18px"><path d="M100 18 C88 0 104 -10 114 -12 C108 0 116 8 100 18 Z" fill="${plume}" ${S2}/></g>`;

// 如来佛祖：螺髻、金身、背光，右手施无畏印（招式：五指山）
C.rulai = () => wrap(`
  <g class="spin slow" style="transform-origin:100px 96px"><circle cx="100" cy="96" r="92" fill="none" stroke="#f6d36b" stroke-width="4" stroke-dasharray="2 9"/></g>
  <ellipse cx="100" cy="110" rx="86" ry="96" fill="#ffe9a8" opacity=".55"/>
  <circle cx="100" cy="82" r="62" fill="#fff4c2" opacity=".7"/>
  <path d="M40 210 Q100 186 160 210 Z" fill="#f48fb1" ${S}/>
  ${robe('#d84332', `<path d="M62 128 Q90 150 96 210 L52 206 Z" fill="#f4c542" ${S}/><path d="M80 134 Q100 140 122 132" fill="none" stroke="#f6d36b" stroke-width="3"/>`)}
  <circle cx="72" cy="176" r="9" fill="#f6d58a" ${S2}/>
  <g class="weapon palm" style="transform-origin:148px 150px"><path d="M140 154 L140 120 Q140 112 146 112 Q150 112 150 118 L150 104 Q150 98 155 98 Q160 98 160 104 L160 108 Q160 102 165 102 Q170 102 170 108 L170 116 Q170 110 175 111 Q180 112 179 118 L176 150 Q170 166 152 166 Q140 166 140 154 Z" fill="#f6d58a" ${S}/></g>
  <ellipse cx="54" cy="94" rx="10" ry="20" fill="#f6d58a" ${S2}/><ellipse cx="146" cy="94" rx="10" ry="20" fill="#f6d58a" ${S2}/>
  ${head('#f6d58a', 44)}
  <path d="M58 76 Q60 34 100 32 Q140 34 142 76 Q122 62 100 62 Q78 62 58 76 Z" fill="#35477d" ${S}/>
  ${Array.from({length:14},(_,i)=>`<circle cx="${66+(i%7)*11.5}" cy="${52+Math.floor(i/7)*10 - (i%7===3?4:0)}" r="4.2" fill="#4a5f9e" stroke="${O}" stroke-width="1.2"/>`).join('')}
  <ellipse cx="100" cy="30" rx="14" ry="11" fill="#35477d" ${S2}/>
  <circle cx="100" cy="72" r="3" fill="#e53935"/>
  ${happyEyes(100,88,15)}
  ${mouth('M92 104 Q100 110 108 104')}
`, {sw:70, cls:'big'});

// 玉皇大帝：冕旒、黄龙袍、三绺须、手持玉笏（招式：天庭降旨）
C.yudi = () => wrap(`
  ${hold(150,166,4, `<rect x="-6" y="-58" width="12" height="58" rx="5" fill="#e8f5e9" ${S}/>`)}
  ${feet('#5d4037')}
  ${robe('#f2b632', `<path d="M76 150 q10 -10 20 0 q10 10 20 0 q10 -10 20 0" fill="none" stroke="#c0392b" stroke-width="3"/><path d="M100 124 v84" stroke="#c0392b" stroke-width="3"/><path d="M62 172 h76" stroke="#c0392b" stroke-width="5"/>`)}
  ${sleeve('#f2b632')}${hands('#f8dcc0')}
  ${head('#f8dcc0', 42, 86)}
  ${threeBeard()}
  <rect x="50" y="42" width="100" height="12" rx="3" fill="#2b2b33" ${S}/>
  <path d="M70 54 Q100 34 130 54 Z" fill="#f2b632" ${S2}/>
  <g class="sway" style="transform-origin:100px 54px">${[56,68,80,92,108,120,132,144].map(x=>`<path d="M${x} 54 v${x>66&&x<134?0:16}" stroke="#f2b632" stroke-width="2"/>${(x<66||x>134)?`<circle cx="${x}" cy="72" r="3" fill="#e53935"/>`:''}`).join('')}${[64,76,88,100,112,124,136].map(x=>`<circle cx="${x}" cy="62" r="2.6" fill="#e53935"/>`).join('')}</g>
  <path d="M74 76 q8 -4 14 0 M112 76 q8 -4 14 0" stroke="#2b2420" stroke-width="3.4" fill="none" stroke-linecap="round"/>
  ${eyes(100,88,15,{r:5.5})}
  <path d="M88 104 q12 -6 24 0" fill="none" stroke="#2b2420" stroke-width="4" stroke-linecap="round"/>
`);

// 王母娘娘：凤冠、霞帔、托着一盘蟠桃（招式：蟠桃雨）
C.wangmu = () => wrap(`
  ${feet('#8d6e63')}
  ${robe('#e57373', `<path d="M70 132 Q100 150 130 132 L132 210 L68 210 Z" fill="#fce4ec" ${S2}/><path d="M60 136 C40 160 46 190 40 206 M140 136 C160 160 154 190 160 206" fill="none" stroke="#f48fb1" stroke-width="6" stroke-linecap="round"/>`)}
  ${sleeve('#e57373')}${hands('#fbe3d0')}
  <g class="weapon" style="transform-origin:150px 160px"><ellipse cx="152" cy="156" rx="26" ry="7" fill="#f2b632" ${S}/>${[[140,146],[154,142],[166,148],[148,134]].map(([x,y])=>`<path d="M${x} ${y+8} C${x-10} ${y+4} ${x-8} ${y-10} ${x} ${y-8} C${x+8} ${y-10} ${x+10} ${y+4} ${x} ${y+8} Z" fill="#ffab91" ${S2}/><path d="M${x} ${y-8} q4 -6 9 -5 q-3 5 -9 5" fill="#7cb342" stroke="${O}" stroke-width="1.2"/>`).join('')}</g>
  ${head('#fbe3d0', 42, 86)}
  <path d="M60 80 Q62 48 100 46 Q138 48 140 80 Q124 64 100 64 Q76 64 60 80 Z" fill="#2b2b33" ${S2}/>
  <path d="M64 50 L76 22 L88 42 L100 14 L112 42 L124 22 L136 50 Q100 38 64 50 Z" fill="#f2b632" ${S}/>
  <circle cx="100" cy="24" r="5" fill="#e53935" ${S2}/><circle cx="76" cy="30" r="3.5" fill="#4fc3f7"/><circle cx="124" cy="30" r="3.5" fill="#4fc3f7"/>
  <g class="sway" style="transform-origin:64px 52px"><path d="M64 52 q-12 10 -8 30" stroke="#f2b632" stroke-width="2.6" fill="none"/><circle cx="56" cy="84" r="3.5" fill="#e53935"/></g>
  <g class="sway" style="transform-origin:136px 52px"><path d="M136 52 q12 10 8 30" stroke="#f2b632" stroke-width="2.6" fill="none"/><circle cx="144" cy="84" r="3.5" fill="#e53935"/></g>
  ${eyes(100,90,15,{r:5.5})}${blush(100,102,24)}
  <path d="M95 106 Q100 110 105 106" fill="#e53935" ${S2}/>
`);

// 太上老君：白长须、道冠、八卦道袍、金刚琢（招式：金刚琢）
C.laojun = () => wrap(`
  <g class="weapon" style="transform-origin:154px 160px"><circle cx="156" cy="138" r="18" fill="none" stroke="${O}" stroke-width="10"/><circle cx="156" cy="138" r="18" fill="none" stroke="#f2c94c" stroke-width="6"/><circle cx="150" cy="130" r="2.5" fill="#fff"/></g>
  ${feet('#5d4037')}
  ${robe('#b0c4de', `<circle cx="100" cy="176" r="14" fill="#fafafa" ${S2}/><path d="M100 162 a7 7 0 0 1 0 14 a7 7 0 0 0 0 14 a14 14 0 0 1 0 -28 Z" fill="#2b2b33"/><circle cx="100" cy="169" r="2.2" fill="#fafafa"/><circle cx="100" cy="183" r="2.2" fill="#2b2b33"/>`)}
  ${sleeve('#b0c4de')}${hands('#f8dcc0')}
  ${head('#f8dcc0', 42, 86)}
  ${longBeard('#fafafa', 64)}
  <path d="M70 76 q10 -10 22 -2 M108 74 q12 -8 22 2" stroke="#fafafa" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M72 60 Q100 30 128 60 Q100 52 72 60 Z" fill="#fafafa" ${S2}/>
  <path d="M86 46 L88 26 L112 26 L114 46 Z" fill="#37474f" ${S2}/><rect x="96" y="18" width="8" height="10" rx="2" fill="#f2b632" ${S2}/>
  ${happyEyes(100,90,14)}
  <ellipse cx="100" cy="102" rx="6" ry="4.5" fill="#f0a98c" ${S2}/>
`);

// 太白金星：红润老头、星冠、拂尘、圣旨（招式：拂尘星光）
C.taibai = () => wrap(`
  ${hold(152,166,10, `<rect x="-3" y="-90" width="6" height="90" rx="3" fill="#a0703c" ${S2}/><g class="sway" style="transform-origin:0px -90px"><path d="M0 -90 C-14 -110 -6 -140 -18 -160 C0 -146 8 -120 0 -90 Z M0 -90 C10 -114 4 -140 12 -164 C20 -140 14 -112 0 -90 Z" fill="#fafafa" ${S2}/></g>`)}
  ${feet('#5d4037')}
  ${robe('#ffd54f', `<path d="M62 172 h76" stroke="#7e57c2" stroke-width="5"/>`)}
  ${sleeve('#ffd54f')}
  <g transform="rotate(-10 58 162)"><rect x="40" y="150" width="34" height="14" rx="6" fill="#f2b632" ${S2}/><rect x="36" y="148" width="6" height="18" rx="3" fill="#8d6e63" ${S2}/><rect x="72" y="148" width="6" height="18" rx="3" fill="#8d6e63" ${S2}/></g>
  ${hands('#f8c9a8')}
  ${head('#f8c9a8', 42, 86)}
  ${longBeard('#fafafa', 44)}
  <path d="M72 76 q10 -8 20 -2 M108 74 q10 -6 20 2" stroke="#fafafa" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M64 64 Q100 38 136 64 Q100 54 64 64 Z" fill="#7e57c2" ${S2}/>
  <path d="M100 18 l5 12 l13 1 l-10 8 l4 13 l-12 -7 l-12 7 l4 -13 l-10 -8 l13 -1 Z" fill="#fff176" ${S2}/>
  ${happyEyes(100,90,14)}${blush(100,100,24,'#ef6c6c')}
  <ellipse cx="100" cy="102" rx="6" ry="4.5" fill="#ef8a6c" ${S2}/>
`);

// 托塔李天王：金甲、黑须、左手托玲珑宝塔（招式：宝塔镇妖）
C.litianwang = () => wrap(`
  ${hold(152,170,6, `<rect x="-4" y="-150" width="8" height="150" rx="3" fill="#8d6e63" ${S}/><path d="M0 -176 L10 -150 L-10 -150 Z" fill="#dfe6ea" ${S}/>`)}
  ${feet('#4e342e')}
  ${armor('#c0392b','#f2b632')}
  <g class="tower" style="transform-origin:52px 150px">${[0,1,2,3,4,5].map(i=>`<rect x="${36+i*2}" y="${138-i*14}" width="${32-i*4}" height="12" rx="2" fill="#f2c94c" ${S2}/><path d="M${32+i*2} ${138-i*14} h${40-i*4}" stroke="${O}" stroke-width="3" stroke-linecap="round"/>`).join('')}<path d="M52 56 l0 -14" ${S}/><circle cx="52" cy="40" r="4" fill="#e53935" ${S2}/></g>
  ${hands('#f8dcc0',[52,156],[152,170])}
  ${head('#f8dcc0', 42, 86)}
  ${helmet('#f2b632')}
  <path d="M70 104 C74 134 92 142 100 142 C108 142 126 134 130 104 C120 116 110 116 100 116 C90 116 80 116 70 104 Z" fill="#2b2420" ${S2}/>
  <path d="M74 76 l16 4 M126 76 l-16 4" stroke="#2b2420" stroke-width="4" stroke-linecap="round"/>
  ${eyes(100,88,15,{r:5.5})}
  <path d="M92 110 Q100 106 108 110" fill="none" stroke="#f8dcc0" stroke-width="3"/>
`);

// 哪吒三太子：双髻、混天绫、乾坤圈、火尖枪、脚踏风火轮（招式：风火轮突刺 + 乾坤圈）
const fireWheel = (x) => `<g transform="translate(${x} 204)"><g class="spin" style="transform-origin:0 0;animation-duration:.8s"><circle r="12" fill="#ffcc80" ${S}/><circle r="5" fill="#e53935"/><path d="M0 -12 V12 M-12 0 H12" stroke="${O}" stroke-width="2"/></g><path d="M-14 4 q-10 -8 -6 -18 q4 8 10 6 q-4 -10 4 -16 q2 10 8 12" fill="#ff7043" stroke="#e64a19" stroke-width="1.6" class="sway" style="transform-origin:0 0"/></g>`;
C.nezha = () => wrap(`
  <g class="sway" style="transform-origin:100px 128px"><path d="M64 128 C20 120 14 168 30 196 C38 176 40 150 70 140 M136 128 C180 116 190 160 176 190 C166 170 164 148 130 140" fill="#e53935" ${S}/></g>
  ${hold(150,164,10, W.spear('#ff7043','#c62828',170).replace('#dfe6ea','#ffb74d'))}
  ${fireWheel(80)}${fireWheel(120)}
  <path d="M68 132 Q100 122 132 132 L138 192 Q100 200 62 192 Z" fill="#f48fb1" ${S}/>
  <path d="M64 176 L136 176 L140 194 Q100 202 60 194 Z" fill="#fff59d" ${S2}/>
  <circle cx="100" cy="134" r="16" fill="none" stroke="${O}" stroke-width="8"/><circle cx="100" cy="134" r="16" fill="none" stroke="#f2c94c" stroke-width="4.5"/>
  ${hands('#fde0c8',[58,160],[150,160])}
  ${head('#fde0c8', 42, 86)}
  <path d="M60 80 Q60 46 100 46 Q140 46 140 80 Q124 64 100 64 Q76 64 60 80 Z" fill="#2b2b33" ${S2}/>
  <circle cx="68" cy="44" r="14" fill="#2b2b33" ${S}/><circle cx="132" cy="44" r="14" fill="#2b2b33" ${S}/>
  <path d="M60 48 h16 M124 48 h16" stroke="#e53935" stroke-width="4" stroke-linecap="round"/>
  <circle cx="100" cy="70" r="3" fill="#e53935"/>
  ${eyes(100,88,15,{r:6.5})}${blush(100,102,24)}
  <path d="M92 106 Q100 114 108 106" fill="#e53935" ${S2}/>
`);

// 二郎神杨戬：三山帽、天眼、银甲、三尖两刃刀、哮天犬（招式：天眼神光 + 哮天犬）
const sanjian = () => `<rect x="-3.5" y="-176" width="7" height="176" rx="3" fill="#5d4037" ${S}/><path d="M-12 -176 L-12 -196 L-4 -186 L0 -214 L4 -186 L12 -196 L12 -176 Z" fill="#e8eef0" ${S}/><path d="M0 -176 v-30" stroke="#90a4ae" stroke-width="1.6"/>`;
C.yangjian = () => wrap(`
  ${hold(152,166,8, sanjian())}
  <g class="dog" style="transform-origin:40px 200px"><g class="tail" style="transform-origin:20px 186px"><path d="M22 186 q-12 -10 -8 -24" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M22 186 q-12 -10 -8 -24" fill="none" stroke="#3a3436" stroke-width="3.5" stroke-linecap="round"/></g><ellipse cx="38" cy="192" rx="20" ry="12" fill="#3a3436" ${S}/><path d="M28 202 v8 M48 202 v8" ${S}/><circle cx="56" cy="178" r="12" fill="#3a3436" ${S}/><path d="M50 168 l-2 -12 l10 8 Z" fill="#3a3436" ${S2}/><ellipse cx="66" cy="182" rx="5" ry="4" fill="#3a3436" ${S2}/><circle cx="58" cy="176" r="2.4" fill="#fff"/></g>
  ${feet('#37474f')}
  ${armor('#cfd8dc','#90a4ae')}
  ${hands('#f8dcc0')}
  ${head('#f8dcc0', 42, 86)}
  <path d="M58 66 Q100 40 142 66 L138 72 Q100 56 62 72 Z" fill="#eceff1" ${S}/>
  <path d="M68 58 L74 24 L86 50 Z M88 50 L100 14 L112 50 Z M114 50 L126 24 L132 58 Z" fill="#eceff1" ${S2}/>
  <g class="weapon eye3" style="transform-origin:100px 74px"><ellipse cx="100" cy="74" rx="4" ry="8" fill="#fff" ${S2}/><ellipse cx="100" cy="74" rx="2" ry="4.5" fill="#e53935"/></g>
  <path d="M74 80 l16 2 M126 80 l-16 2" stroke="#2b2420" stroke-width="3.6" stroke-linecap="round"/>
  ${eyes(100,92,16,{r:5.5})}
  ${mouth('M92 108 Q100 112 108 108')}
`);

// 四大天王（护国四天王）
const tianwang = (face, armorC, trim, hat, weapon, wRot=6, extra='') => wrap(`
  ${extra}
  ${hold(152,166,wRot, weapon)}
  ${feet('#3e2723')}
  ${armor(armorC, trim)}
  ${hands(face)}
  ${head(face, 42, 88)}
  ${helmet(hat, '#ffca28')}
  <path d="M68 104 C70 132 90 144 100 144 C110 144 130 132 132 104 C120 118 110 116 100 116 C90 116 80 118 68 104 Z" fill="#2b2420" ${S2}/>
  <path d="M70 76 l18 6 M130 76 l-18 6" stroke="#2b2420" stroke-width="5" stroke-linecap="round"/>
  ${eyes(100,90,17,{r:6.5, iris:'#fff59d'})}
  <path d="M90 110 Q100 104 110 110" fill="none" stroke="${face}" stroke-width="3"/>
`, {sw:68});
const pipa = () => `<rect x="-3" y="-120" width="6" height="56" rx="3" fill="#8d6e63" ${S2}/><path d="M0 -70 C-26 -66 -30 -20 0 -4 C30 -20 26 -66 0 -70 Z" fill="#c68642" ${S}/><circle cx="0" cy="-36" r="7" fill="#5d4037"/><path d="M-2 -118 V-10 M2 -118 V-10" stroke="#fafafa" stroke-width="1"/><rect x="-7" y="-128" width="14" height="10" rx="3" fill="#5d4037" ${S2}/>`;
const umbrella = () => `<rect x="-3" y="-170" width="6" height="170" rx="3" fill="#8d6e63" ${S}/><path d="M-40 -150 Q0 -196 40 -150 Q30 -156 20 -150 Q10 -156 0 -150 Q-10 -156 -20 -150 Q-30 -156 -40 -150 Z" fill="#43a047" ${S}/><g class="sway" style="transform-origin:0 -150px"><path d="M-40 -150 v14 M-20 -150 v14 M20 -150 v14 M40 -150 v14" stroke="#f2c94c" stroke-width="3"/><circle cx="-40" cy="-134" r="3" fill="#f2c94c"/><circle cx="40" cy="-134" r="3" fill="#f2c94c"/></g>`;
const snakeArm = () => `<path d="M0 0 C-20 -30 20 -50 0 -80 C-14 -100 6 -120 0 -132" fill="none" stroke="${O}" stroke-width="13" stroke-linecap="round"/><path d="M0 0 C-20 -30 20 -50 0 -80 C-14 -100 6 -120 0 -132" fill="none" stroke="#e53935" stroke-width="8" stroke-linecap="round"/><ellipse cx="2" cy="-138" rx="10" ry="8" fill="#e53935" ${S2}/><circle cx="6" cy="-140" r="2" fill="#fff59d"/><g class="flick" style="transform-origin:10px -136px"><path d="M10 -136 l10 -2 l3 -3 m-3 3 l3 3" stroke="#ffca28" stroke-width="2" fill="none"/></g>`;
C.chiguo   = () => tianwang('#f5f0e6', '#eceff1', '#f2b632', '#f2b632', pipa(), -4);
C.zengzhang= () => tianwang('#90caf9', '#1e88e5', '#f2b632', '#1565c0', W.sword('#e3f2fd'), 8);
C.guangmu  = () => tianwang('#ef9a9a', '#c62828', '#f2b632', '#b71c1c', snakeArm(), 4, `<circle cx="48" cy="150" r="10" fill="#b3e5fc" ${S}/><circle cx="45" cy="146" r="3" fill="#fff"/>`);
C.duowen   = () => tianwang('#a5d6a7', '#2e7d32', '#f2b632', '#1b5e20', umbrella(), 4);

// 巨灵神：大块头、红脸大胡子、宣花板斧（招式：开山斧）
C.juling = () => wrap(`
  ${hold(158,166,14, `<rect x="-5" y="-160" width="10" height="160" rx="4" fill="#6d4c41" ${S}/><path d="M4 -158 C40 -170 54 -140 46 -108 C34 -116 20 -118 4 -116 Z" fill="#cfd8dc" ${S}/><path d="M14 -150 q14 6 18 22 M18 -136 q8 2 10 10" stroke="#90a4ae" stroke-width="2" fill="none"/>`)}
  <ellipse cx="78" cy="206" rx="20" ry="9" fill="#3e2723" ${S}/><ellipse cx="122" cy="206" rx="20" ry="9" fill="#3e2723" ${S}/>
  <path d="M46 128 Q100 108 154 128 L160 200 Q100 214 40 200 Z" fill="#6d4c41" ${S}/>
  <path d="M64 134 Q80 160 100 160 Q120 160 136 134" fill="#d9775a" ${S2}/>
  <path d="M40 132 Q24 116 40 100 L64 120 Z M160 132 Q176 116 160 100 L136 120 Z" fill="#f2b632" ${S}/>
  <rect x="48" y="172" width="104" height="11" rx="5" fill="#f2b632" ${S2}/>
  <circle cx="46" cy="164" r="13" fill="#d9775a" ${S}/><circle cx="158" cy="166" r="12" fill="#d9775a" ${S2}/>
  ${head('#d9775a', 48, 82)}
  <path d="M56 92 C56 140 84 156 100 158 C116 156 144 140 144 92 C130 112 116 114 100 114 C84 114 70 112 56 92 Z" fill="#3e2723" ${S}/>
  <path d="M58 54 Q100 22 142 54 L138 62 Q100 42 62 62 Z" fill="#3e2723" ${S}/>
  <path d="M66 70 l22 8 M134 70 l-22 8" stroke="#3e2723" stroke-width="7" stroke-linecap="round"/>
  ${eyes(100,86,18,{r:7, iris:'#fff59d'})}
  <path d="M88 118 Q100 110 112 118" fill="#c62828" ${S2}/>
`, {sw:74, cls:'big'});

// 东海龙王敖广：龙首、龙须、龙袍、宝珠（招式：东海巨浪）
C.longwang = () => wrap(`
  <g class="weapon" style="transform-origin:152px 160px"><circle cx="154" cy="146" r="13" fill="#4dd0e1" ${S}/><circle cx="150" cy="141" r="4" fill="#fff"/></g>
  ${feet('#004d40')}
  ${robe('#00897b', `<path d="M66 146 q8 -8 16 0 q8 8 16 0 q8 -8 16 0 q8 8 16 0" fill="none" stroke="#f2b632" stroke-width="3"/><path d="M62 176 h76" stroke="#f2b632" stroke-width="5"/>`)}
  ${sleeve('#00897b')}${hands('#a5d6a7',[56,166],[152,160])}
  <path d="M70 44 C64 26 70 14 62 4 M66 26 l-10 -4 M130 44 C136 26 130 14 138 4 M134 26 l10 -4" fill="none" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M70 44 C64 26 70 14 62 4 M66 26 l-10 -4 M130 44 C136 26 130 14 138 4 M134 26 l10 -4" fill="none" stroke="#f2c94c" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M100 38 C62 38 52 62 54 86 C56 112 76 132 100 132 C124 132 144 112 146 86 C148 62 138 38 100 38 Z" fill="#81c784" ${S}/>
  <path d="M74 106 C80 124 92 130 100 130 C108 130 120 124 126 106 C114 100 86 100 74 106 Z" fill="#c8e6c9" ${S2}/>
  <ellipse cx="90" cy="108" rx="3" ry="2.4" fill="#2e7d32"/><ellipse cx="110" cy="108" rx="3" ry="2.4" fill="#2e7d32"/>
  <g class="sway" style="transform-origin:86px 112px"><path d="M86 112 C70 120 56 112 44 124" fill="none" stroke="#fafafa" stroke-width="3.4" stroke-linecap="round"/><path d="M114 112 C130 120 144 112 156 124" fill="none" stroke="#fafafa" stroke-width="3.4" stroke-linecap="round"/></g>
  <path d="M84 126 C80 146 92 160 100 166 C108 160 120 146 116 126 Z" fill="#fafafa" ${S2}/>
  <rect x="78" y="34" width="44" height="10" rx="3" fill="#f2b632" ${S2}/>
  ${eyes(100,80,18,{r:7, iris:'#ffca28'})}
`);

// 雷公：鸟嘴、蓝脸、背生双翅、一手锤一手凿，背后雷鼓（招式：五雷轰顶）
C.leigong = () => wrap(`
  ${[0,1,2,3,4].map(i=>{const a=Math.PI*(1.05+0.9*i/4);return `<circle cx="${100+Math.cos(a)*74}" cy="${110+Math.sin(a)*74}" r="12" fill="#e53935" ${S2}/><circle cx="${100+Math.cos(a)*74}" cy="${110+Math.sin(a)*74}" r="5" fill="#ffca28"/>`}).join('')}
  <g class="tail" style="transform-origin:70px 130px"><path d="M70 130 C30 110 20 80 26 60 C40 80 50 90 72 104 Z" fill="#5c6bc0" ${S}/></g>
  <g class="tail" style="transform-origin:130px 130px;animation-delay:-1s"><path d="M130 130 C170 110 180 80 174 60 C160 80 150 90 128 104 Z" fill="#5c6bc0" ${S}/></g>
  ${hold(154,164,20, `<rect x="-3" y="-60" width="6" height="60" rx="3" fill="#8d6e63" ${S2}/><rect x="-14" y="-78" width="28" height="20" rx="5" fill="#90a4ae" ${S}/>`)}
  ${hold(48,164,-20, `<rect x="-3" y="-70" width="6" height="70" rx="3" fill="#8d6e63" ${S2}/><path d="M-6 -70 L0 -96 L6 -70 Z" fill="#cfd8dc" ${S2}/>`)}
  ${feet('#283593')}
  <path d="M66 132 Q100 120 134 132 L140 196 Q100 206 60 196 Z" fill="#283593" ${S}/>
  <path d="M66 172 h68" stroke="#ffca28" stroke-width="5"/>
  ${hands('#64b5f6',[48,164],[154,164])}
  ${head('#64b5f6', 42, 86)}
  <path d="M62 66 L56 40 L76 54 L84 30 L96 50 L104 26 L112 50 L124 30 L130 54 L146 42 L138 68 Z" fill="#e53935" ${S}/>
  ${eyes(100,82,17,{r:7, iris:'#ffeb3b'})}
  <path d="M86 98 L118 104 L96 118 Z" fill="#ffb300" ${S}/>
`);

// 电母：双手各持金光镜（招式：金光乍现）
C.dianmu = () => wrap(`
  <g class="sway" style="transform-origin:100px 130px"><path d="M60 130 C28 140 30 176 20 196 M140 130 C172 140 170 176 180 196" fill="none" stroke="#ba68c8" stroke-width="7" stroke-linecap="round"/></g>
  ${feet('#6a1b9a')}
  ${robe('#8e24aa', `<path d="M70 132 Q100 148 130 132" fill="none" stroke="#f2b632" stroke-width="4"/><path d="M62 176 h76" stroke="#f2b632" stroke-width="4"/>`)}
  <g class="weapon" style="transform-origin:46px 150px"><circle cx="40" cy="138" r="18" fill="#fff59d" ${S}/><circle cx="40" cy="138" r="11" fill="#fffde7"/><path d="M34 132 l6 -2" stroke="#fff" stroke-width="3"/></g>
  <g class="weapon" style="transform-origin:154px 150px"><circle cx="160" cy="138" r="18" fill="#fff59d" ${S}/><circle cx="160" cy="138" r="11" fill="#fffde7"/><path d="M154 132 l6 -2" stroke="#fff" stroke-width="3"/></g>
  ${hands('#fbe3d0',[50,152],[150,152])}
  ${head('#fbe3d0', 42, 86)}
  <path d="M60 82 Q60 46 100 46 Q140 46 140 82 Q124 64 100 64 Q76 64 60 82 Z" fill="#2b2b33" ${S2}/>
  <path d="M84 46 Q100 22 116 46 Z" fill="#2b2b33" ${S2}/><path d="M92 30 l8 -12 l8 12" fill="none" stroke="#ffca28" stroke-width="3"/>
  ${eyes(100,90,15,{r:5.8})}${blush(100,102,24)}
  <path d="M95 106 Q100 110 105 106" fill="#e53935" ${S2}/>
`);

// 镇元大仙：地仙之祖、宽袍大袖、黑长须（招式：袖里乾坤）
C.zhenyuan = () => wrap(`
  ${feet('#5d4037')}
  ${robe('#8bc34a', `<path d="M62 176 h76" stroke="#33691e" stroke-width="5"/>`)}
  <g class="weapon sleeveR" style="transform-origin:140px 140px"><path d="M136 132 C170 130 184 160 176 192 C162 186 150 176 140 164 Z" fill="#8bc34a" ${S}/></g>
  <path d="M64 132 C30 130 16 160 24 192 C38 186 50 176 60 164 Z" fill="#8bc34a" ${S}/>
  ${head('#f8dcc0', 42, 86)}
  <path d="M70 104 C70 150 90 170 100 176 C110 170 130 150 130 104 C120 116 110 114 100 114 C90 114 80 116 70 104 Z" fill="#2b2420" ${S}/>
  <path d="M60 78 Q60 46 100 46 Q140 46 140 78 Q124 62 100 62 Q76 62 60 78 Z" fill="#2b2420" ${S2}/>
  <path d="M84 48 L88 24 L112 24 L116 48 Z" fill="#f2b632" ${S2}/>
  ${eyes(100,88,15,{r:5.5})}
  <path d="M92 108 Q100 104 108 108" fill="none" stroke="#f8dcc0" stroke-width="3"/>
`);

// 南极仙翁（寿星）：大额头、龙头拐、寿桃、仙鹤（招式：仙鹤送桃）
C.shouxing = () => wrap(`
  ${hold(152,190,4, `<path d="M0 0 C-2 -60 3 -110 0 -150" fill="none" stroke="${O}" stroke-width="10" stroke-linecap="round"/><path d="M0 0 C-2 -60 3 -110 0 -150" fill="none" stroke="#8d6e63" stroke-width="6" stroke-linecap="round"/><path d="M0 -150 C-12 -164 6 -178 14 -166 C20 -156 10 -150 4 -156" fill="#8d6e63" ${S}/><g transform="translate(-4 -130)"><circle cy="6" r="8" fill="#e7a54a" ${S2}/><circle cy="-6" r="5" fill="#e7a54a" ${S2}/></g>`)}
  ${feet('#5d4037')}
  ${robe('#e53935', `<path d="M62 176 h76" stroke="#f2b632" stroke-width="5"/>`)}
  <g transform="translate(54 150)"><path d="M0 10 C-14 6 -12 -12 0 -10 C12 -12 14 6 0 10 Z" fill="#ffab91" ${S2}/><path d="M0 -10 q4 -6 9 -5 q-3 5 -9 5" fill="#7cb342" stroke="${O}" stroke-width="1.2"/></g>
  ${hands('#f8dcc0',[56,166],[152,180])}
  <ellipse cx="100" cy="64" rx="40" ry="50" fill="#f8dcc0" ${S}/>
  <path d="M74 52 q10 -6 18 0 M108 52 q10 -6 18 0" stroke="#e0b49a" stroke-width="2" fill="none"/>
  ${longBeard('#fafafa', 56)}
  <path d="M68 86 q10 -8 22 -2 M110 84 q12 -6 22 2" stroke="#fafafa" stroke-width="6" fill="none" stroke-linecap="round"/>
  ${happyEyes(100,96,15)}${blush(100,104,26,'#ef6c6c')}
  <ellipse cx="100" cy="106" rx="6" ry="4.5" fill="#ef8a6c" ${S2}/>
`);

// 文殊菩萨：宝冠、青袍、智慧剑（青狮的主人）
const pusaCrown = (c='#f2b632') => `<path d="M62 64 L70 36 L84 54 L100 26 L116 54 L130 36 L138 64 Q100 52 62 64 Z" fill="${c}" ${S}/><circle cx="100" cy="40" r="5" fill="#e53935" ${S2}/><circle cx="72" cy="48" r="3" fill="#4fc3f7"/><circle cx="128" cy="48" r="3" fill="#4fc3f7"/>`;
C.wenshu = () => wrap(`
  ${halo()}
  ${hold(152,166,6, W.sword('#bbdefb').replace('L0 -142','L0 -150') + `<path d="M0 -150 C-8 -164 6 -170 0 -182 C10 -170 8 -160 0 -150 Z" fill="#ff7043" ${S2}/>`)}
  ${feet('#5d4037')}
  ${robe('#26a69a', `<path d="M70 132 Q100 150 130 132" fill="none" stroke="#f2b632" stroke-width="4"/>`)}
  ${sleeve('#26a69a')}${hands('#f8dcc0')}
  ${head('#f8dcc0', 42, 86)}
  <path d="M60 84 Q60 54 100 54 Q140 54 140 84 Q124 68 100 68 Q76 68 60 84 Z" fill="#2b2b33" ${S2}/>
  ${pusaCrown()}
  <circle cx="100" cy="76" r="2.6" fill="#e53935"/>
  ${happyEyes(100,92,14)}${mouth('M94 106 Q100 110 106 106')}
`);
// 普贤菩萨：宝冠、白粉袍、如意（白象的主人）
C.puxian = () => wrap(`
  ${halo()}
  ${hold(152,166,4, `<rect x="-3.5" y="-110" width="7" height="110" rx="3" fill="#f2b632" ${S}/><path d="M0 -110 C-22 -112 -24 -136 -6 -136 C-2 -146 12 -146 14 -134 C26 -130 22 -112 0 -110 Z" fill="#a5d6a7" ${S}/>`)}
  ${feet('#8d6e63')}
  ${robe('#fce4ec', `<path d="M70 132 Q100 150 130 132" fill="none" stroke="#f48fb1" stroke-width="4"/><path d="M62 176 h76" stroke="#f48fb1" stroke-width="4"/>`)}
  ${sleeve('#fce4ec')}${hands('#f8dcc0')}
  ${head('#f8dcc0', 42, 86)}
  <path d="M60 84 Q60 54 100 54 Q140 54 140 84 Q124 68 100 68 Q76 68 60 84 Z" fill="#2b2b33" ${S2}/>
  ${pusaCrown('#ffcc80')}
  <circle cx="100" cy="76" r="2.6" fill="#e53935"/>
  ${happyEyes(100,92,14)}${mouth('M94 106 Q100 110 106 106')}
`);
// 弥勒佛：大肚笑口、人种袋（招式：人种袋）
C.mile = () => wrap(`
  <g class="weapon bag" style="transform-origin:156px 150px"><path d="M146 130 C130 150 132 196 160 198 C188 196 188 150 168 130 Z" fill="#d7ccc8" ${S}/><path d="M146 130 Q157 122 168 130" fill="none" stroke="#8d6e63" stroke-width="5"/></g>
  <ellipse cx="80" cy="206" rx="16" ry="8" fill="#8d6e63" ${S}/><ellipse cx="120" cy="206" rx="16" ry="8" fill="#8d6e63" ${S}/>
  <path d="M50 132 Q100 112 150 132 L156 200 Q100 214 44 200 Z" fill="#ffb74d" ${S}/>
  <ellipse cx="100" cy="166" rx="38" ry="32" fill="#fde0c8" ${S}/><circle cx="100" cy="170" r="3" fill="#e0a080"/>
  <g>${Array.from({length:11},(_,i)=>{const a=Math.PI*(0.08+0.84*i/10);return `<circle cx="${100-Math.cos(a)*40}" cy="${124+Math.sin(a)*18}" r="5.5" fill="#8d5524" stroke="${O}" stroke-width="1.8"/>`}).join('')}</g>
  ${hands('#fde0c8',[54,170],[150,150])}
  <ellipse cx="52" cy="94" rx="10" ry="20" fill="#fde0c8" ${S2}/><ellipse cx="148" cy="94" rx="10" ry="20" fill="#fde0c8" ${S2}/>
  ${head('#fde0c8', 46, 82)}
  ${happyEyes(100,82,17)}${blush(100,96,30)}
  <path d="M80 98 Q100 124 120 98 Q100 106 80 98 Z" fill="#c0392b" ${S2}/>
`, {sw:70});
// 昴日星官：公鸡神（招式：一声鸡鸣）
C.maori = () => wrap(`
  ${feet('#ffb300')}
  ${robe('#c62828', `<path d="M62 176 h76" stroke="#f2b632" stroke-width="5"/>`)}
  <g class="tail" style="transform-origin:136px 160px"><path d="M136 160 C170 150 180 120 168 104 C162 124 150 132 138 140 Z" fill="#1b5e20" ${S}/><path d="M138 168 C176 168 190 140 184 122 C174 140 160 148 140 152 Z" fill="#2e7d32" ${S}/></g>
  ${sleeve('#c62828')}${hands('#ffca28')}
  <path d="M86 46 Q84 26 96 30 Q98 18 108 24 Q116 16 120 30 Q130 30 124 46 Z" fill="#e53935" ${S}/>
  <path d="M100 40 C68 40 56 64 58 88 C60 114 80 128 100 128 C120 128 140 114 142 88 C144 64 132 40 100 40 Z" fill="#fafafa" ${S}/>
  <path d="M100 96 L126 104 L100 112 Z" fill="#ffb300" ${S}/><path class="mopen" d="M100 110 L124 118 L100 122 Z" fill="#ffb300" ${S2}/>
  <path d="M100 112 C94 124 100 134 106 128 C110 122 106 114 100 112 Z" fill="#e53935" ${S2}/>
  ${eyes(100,82,17,{r:6.5})}
`);

// ================= 第二批妖怪 =================
const mo = (x, y, rx = 9, ry = 7, c = '#7a1f1f') => `<ellipse class="mopen" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c}" ${S2}/>`;
const fangs = (y = 108) => `<path d="M88 ${y} l3 7 l3 -7 M106 ${y} l3 7 l3 -7" fill="#fff" stroke="${O}" stroke-width="1.6"/>`;
const mon = (o) => wrap(`${o.back || ''}${o.w || ''}${o.w2 || ''}${o.feet === false ? '' : feet(o.feet || '#3e2723')}${o.body}${o.hands || ''}${o.head}${o.front || ''}`, { sw: o.sw, cls: o.cls });
const ladyHair = (c = '#2b2b33') => `<path d="M58 84 Q58 44 100 44 Q142 44 142 84 Q126 64 100 64 Q74 64 58 84 Z" fill="${c}" ${S2}/>`;
const W2 = {
  sevenStar: () => W.sword('#e0f2f1') + [0, 1, 2, 3, 4, 5, 6].map(i => `<circle cx="${i % 2 ? 1.6 : -1.6}" cy="${-40 - i * 13}" r="2" fill="#f2c94c"/>`).join(''),
  gourd: () => `<g><path d="M0 0 C-16 -2 -18 -22 -6 -28 C-12 -36 -8 -48 0 -48 C8 -48 12 -36 6 -28 C18 -22 16 -2 0 0 Z" fill="#c62828" ${S}/><path d="M-4 -48 h8 v-6 h-8 Z" fill="#8d6e63" ${S2}/><path d="M-8 -28 h16" stroke="#f2c94c" stroke-width="3"/></g>`,
  steelWhip: () => `<rect x="-3" y="-20" width="6" height="20" rx="2" fill="#5d4037" ${S2}/>` + [0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="-5" y="${-36 - i * 18}" width="10" height="17" rx="4" fill="#90a4ae" ${S2}/>`).join(''),
  token: () => `<rect x="-3" y="-30" width="6" height="30" rx="2" fill="#8d6e63" ${S2}/><rect x="-14" y="-74" width="28" height="46" rx="5" fill="#ffe082" ${S}/><text x="0" y="-45" text-anchor="middle" font-size="18" font-weight="900" fill="#c62828" font-family="serif">令</text>`,
  talisman: () => `<g>${[-14, 0, 14].map((a, i) => `<g transform="rotate(${a})"><rect x="-7" y="-62" width="14" height="40" fill="#fff176" stroke="${O}" stroke-width="2"/><path d="M-3 -56 l6 6 l-6 6 l6 6 l-6 6" stroke="#c62828" stroke-width="2" fill="none"/></g>`).join('')}</g>`,
  whisk: () => `<rect x="-3" y="-90" width="6" height="90" rx="3" fill="#a0703c" ${S2}/><g class="sway" style="transform-origin:0px -90px"><path d="M0 -90 C-14 -110 -6 -140 -18 -160 C0 -146 8 -120 0 -90 Z M0 -90 C10 -114 4 -140 12 -164 C20 -140 14 -112 0 -90 Z" fill="#fafafa" ${S2}/></g>`,
  mace9: () => `<rect x="-4" y="-130" width="8" height="130" rx="3" fill="#8d6e63" ${S}/><g transform="translate(0 -146)">${Array.from({ length: 9 }, (_, i) => { const a = i / 9 * Math.PI * 2; return `<ellipse cx="${Math.cos(a) * 14}" cy="${Math.sin(a) * 14}" rx="9" ry="6" transform="rotate(${a * 180 / Math.PI} ${Math.cos(a) * 14} ${Math.sin(a) * 14})" fill="#d4a24c" ${S2}/>`; }).join('')}<circle r="12" fill="#e0b25a" ${S}/></g>`,
  ironClub: () => `<rect x="-6" y="-190" width="12" height="190" rx="6" fill="#37474f" ${S}/><rect x="-8" y="-190" width="16" height="16" rx="4" fill="#78909c" ${S2}/><rect x="-8" y="-60" width="16" height="10" rx="3" fill="#78909c" ${S2}/>`,
  fan: () => `<rect x="-3" y="-50" width="6" height="50" rx="3" fill="#8d6e63" ${S2}/><path d="M0 -48 C-46 -70 -40 -150 0 -160 C40 -150 46 -70 0 -48 Z" fill="#7cb342" ${S}/><path d="M0 -52 V-154 M0 -80 L-26 -100 M0 -100 L-28 -124 M0 -80 L26 -100 M0 -100 L28 -124 M0 -124 L-18 -142 M0 -124 L18 -142" stroke="#33691e" stroke-width="2.4" fill="none"/>`,
  moonSpade: () => `<rect x="-3.5" y="-170" width="7" height="170" rx="3" fill="#6d4c41" ${S}/><path d="M-22 -168 Q0 -150 22 -168 Q14 -190 0 -192 Q-14 -190 -22 -168 Z" fill="#cfd8dc" ${S}/><path d="M-12 -4 Q0 12 12 -4 Z" fill="#cfd8dc" ${S2}/>`,
  wolfTooth: () => `<rect x="-4" y="-70" width="8" height="70" rx="3" fill="#6d4c41" ${S}/><rect x="-11" y="-120" width="22" height="54" rx="9" fill="#795548" ${S}/>` + [0, 1, 2, 3].map(i => `<path d="M-11 ${-112 + i * 13} l-8 4 l8 3 M11 ${-112 + i * 13} l8 4 l-8 3" fill="#eceff1" stroke="${O}" stroke-width="1.6"/>`).join(''),
  yueAxe: () => `<rect x="-4" y="-160" width="8" height="160" rx="3" fill="#6d4c41" ${S}/><path d="M4 -158 C30 -168 44 -146 40 -120 C30 -126 16 -128 4 -126 Z" fill="#cfd8dc" ${S}/><path d="M-4 -150 C-20 -152 -24 -136 -18 -128 C-12 -132 -8 -134 -4 -134 Z" fill="#cfd8dc" ${S2}/><path d="M12 -150 q10 4 14 14" stroke="#fff" stroke-width="2" fill="none"/>`,
  bigBlade: () => `<rect x="-4" y="-120" width="8" height="120" rx="3" fill="#5d4037" ${S}/><path d="M-6 -118 C-8 -150 6 -178 26 -186 C24 -160 22 -138 6 -118 Z" fill="#cfd8dc" ${S}/><path d="M2 -126 C2 -150 12 -168 20 -176" stroke="#fff" stroke-width="2" fill="none"/><circle cx="0" cy="-118" r="6" fill="#e53935" ${S2}/>`,
  halberd: () => `<rect x="-3.5" y="-176" width="7" height="176" rx="3" fill="#b71c1c" ${S}/><path d="M0 -214 L7 -190 L0 -176 L-7 -190 Z" fill="#eceff1" ${S}/><path d="M4 -180 C24 -184 30 -168 24 -156 C18 -162 10 -166 4 -166 Z M-4 -180 C-24 -184 -30 -168 -24 -156 C-18 -162 -10 -166 -4 -166 Z" fill="#eceff1" ${S2}/><path d="M-2 -172 q-10 10 -4 22 q4 -10 4 -22" fill="#e53935" ${S2}/>`,
  dragonCane: () => `<path d="M0 0 C-2 -60 3 -110 0 -150" fill="none" stroke="${O}" stroke-width="10" stroke-linecap="round"/><path d="M0 0 C-2 -60 3 -110 0 -150" fill="none" stroke="#8d6e63" stroke-width="6" stroke-linecap="round"/><path d="M0 -60 C14 -70 -14 -84 0 -96 C14 -108 -14 -120 0 -132" fill="none" stroke="#f2c94c" stroke-width="5" stroke-linecap="round"/><path d="M0 -150 C-16 -160 -6 -178 8 -172 C16 -168 14 -156 4 -158" fill="#f2c94c" ${S2}/>`,
  pestle: () => `<rect x="-6" y="-100" width="12" height="100" rx="6" fill="#efebe9" ${S}/><rect x="-10" y="-112" width="20" height="22" rx="9" fill="#efebe9" ${S}/><path d="M-6 -60 h12" stroke="#bcaaa4" stroke-width="2"/>`,
  gangdao: () => `<rect x="-3" y="-24" width="6" height="24" rx="2" fill="#5d4037" ${S2}/><rect x="-12" y="-29" width="24" height="7" rx="3" fill="#f2b632" ${S2}/><path d="M-6 -29 L-8 -150 C4 -146 12 -120 8 -29 Z" fill="#cfd8dc" ${S}/><path d="M-2 -36 V-140" stroke="#fff" stroke-width="2"/>`,
};

// 白骨精：白发、骨簪、紫黑衣
C.baigujing = () => mon({
  back: `<path d="M56 80 C46 130 56 176 68 190 L132 190 C144 176 154 130 144 80 Z" fill="#eceff1" ${S}/>`,
  feet: '#4a2c5a',
  body: robe('#4a2c5a', `<path d="M70 140 h60 M68 156 h64 M66 172 h68" stroke="#e1d5ef" stroke-width="2.5" stroke-dasharray="6 5"/><path d="M84 124 L100 142 L116 124" fill="none" stroke="#e1d5ef" stroke-width="3"/>`),
  hands: `<path d="M52 158 l-8 6 M54 162 l-6 9 M58 164 l-2 10" stroke="${O}" stroke-width="2.4"/>` + hands('#f3f1f7', [56, 158], [150, 160]) + `<path d="M150 164 l8 6 M148 168 l4 9" stroke="${O}" stroke-width="2.4"/>`,
  head: `${head('#f3f1f7', 42, 86)}<path d="M58 84 Q58 42 100 42 Q142 42 142 84 Q130 62 100 62 Q70 62 58 84 Z" fill="#eceff1" ${S2}/><ellipse cx="100" cy="38" rx="20" ry="12" fill="#eceff1" ${S2}/>
  <g transform="rotate(-20 100 36)"><path d="M70 36 h60" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M70 36 h60" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="68" cy="33" r="4" fill="#fff" ${S2}/><circle cx="68" cy="39" r="4" fill="#fff" ${S2}/><circle cx="132" cy="33" r="4" fill="#fff" ${S2}/><circle cx="132" cy="39" r="4" fill="#fff" ${S2}/></g>
  <path d="M74 80 q10 -6 18 2 M108 82 q8 -8 18 -2" stroke="#7b1fa2" stroke-width="3" fill="none"/>
  ${eyes(100,90,15,{r:6, iris:'#ba68c8'})}<path d="M92 106 Q100 112 108 104" fill="#6a1b9a" ${S2}/>${mo(100,108,6,5,'#4a148c')}`,
});
// 黄袍怪（奎木狼）：青靛脸、红发、獠牙、黄袍、钢刀
C.huangpao = () => mon({
  w: hold(152, 166, 10, W2.gangdao()),
  body: robe('#f2b632', `<path d="M70 132 Q100 150 130 132" fill="none" stroke="#8d2c1f" stroke-width="4"/><path d="M62 174 h76" stroke="#8d2c1f" stroke-width="5"/><circle cx="100" cy="150" r="7" fill="#fff59d" ${S2}/>`),
  hands: hands('#5c7fd6'),
  head: `<g class="sway" style="transform-origin:100px 48px"><path d="M56 76 L44 44 L66 54 L66 24 L86 42 L100 14 L114 42 L134 24 L134 54 L156 44 L144 76 Z" fill="#e53935" ${S}/></g>${head('#5c7fd6', 44, 86)}
  <path d="M68 74 l22 6 M132 74 l-22 6" stroke="${O}" stroke-width="5" stroke-linecap="round"/>${eyes(100,88,18,{r:7, iris:'#fff176'})}
  <path d="M84 108 Q100 118 116 108" fill="#7a1f1f" ${S2}/><path d="M86 108 l4 10 l4 -9 M106 109 l4 9 l4 -10" fill="#fff" stroke="${O}" stroke-width="1.6"/>`,
});
// 金角大王：金角、蓝甲、七星剑、紫金红葫芦
C.jinjiao = () => mon({
  w: hold(152, 166, 8, W2.sevenStar()), w2: `<g class="weapon gourd" style="transform-origin:52px 160px"><g transform="translate(48 168)">${W2.gourd()}</g></g>`,
  body: armor('#1e3a8a', '#f2b632'),
  hands: hands('#e9a66b', [52, 164], [152, 166]),
  head: `${head('#e9a66b', 44, 86)}<path d="M92 46 L100 6 L108 46 Z" fill="#f2c94c" ${S}/><path d="M60 72 Q100 50 140 72 Q140 56 100 48 Q60 56 60 72 Z" fill="#1e3a8a" ${S2}/>
  <path d="M70 76 l20 4 M130 76 l-20 4" stroke="${O}" stroke-width="4.5" stroke-linecap="round"/>${eyes(100,90,17,{r:6.5, iris:'#fff59d'})}<path d="M86 110 Q100 116 114 110" fill="none" ${S2}/>${fangs(110)}${mo(100,112,10,7)}`,
});
// 银角大王：银角、紫甲、羊脂玉净瓶、幌金绳
C.yinjiao = () => mon({
  w: `<g class="weapon" style="transform-origin:152px 166px"><g transform="translate(152 176)">${W.vase().replace(/<g class="sway"[\s\S]*<\/g>$/, '')}</g></g>`,
  back: `<g class="sway" style="transform-origin:60px 170px"><path d="M60 170 C30 180 30 150 46 146 C60 142 62 160 48 162 C38 164 40 152 46 152" fill="none" stroke="#f2c94c" stroke-width="5" stroke-linecap="round"/></g>`,
  body: armor('#5b2c83', '#cfd8dc'),
  hands: hands('#c5cbe3', [58, 160], [152, 170]),
  head: `${head('#c5cbe3', 44, 86)}<path d="M92 46 L100 6 L108 46 Z" fill="#eceff1" ${S}/><path d="M60 72 Q100 50 140 72 Q140 56 100 48 Q60 56 60 72 Z" fill="#5b2c83" ${S2}/>
  <path d="M70 78 l20 4 M130 78 l-20 4" stroke="${O}" stroke-width="4.5" stroke-linecap="round"/>${eyes(100,90,17,{r:6.5, iris:'#e1bee7'})}<path d="M88 110 Q100 104 112 110" fill="none" ${S2}/>${mo(100,112,10,7)}`,
});
// 青毛狮子怪（乌鸡国假国王）：狮头、王冠、黄龙袍、宝剑
const lionHead = (mane, face, crown = '', mouthOpen = false) => `<g class="sway" style="transform-origin:100px 86px;animation-duration:3.4s">${Array.from({ length: 16 }, (_, i) => { const a = i / 16 * Math.PI * 2; return `<path d="M${100 + Math.cos(a) * 40} ${86 + Math.sin(a) * 40} L${100 + Math.cos(a + .2) * 64} ${86 + Math.sin(a + .2) * 64} L${100 + Math.cos(a + .4) * 40} ${86 + Math.sin(a + .4) * 40} Z" fill="${mane}" ${S2}/>`; }).join('')}</g>
  <circle cx="100" cy="86" r="48" fill="${mane}" ${S}/>${head(face, 38, 90)}${crown}
  <circle cx="66" cy="60" r="10" fill="${face}" ${S2}/><circle cx="134" cy="60" r="10" fill="${face}" ${S2}/>
  ${eyes(100,84,16,{r:6.5, iris:'#ffca28'})}<ellipse cx="100" cy="102" rx="8" ry="6" fill="#5d4037"/>
  ${mouthOpen ? `<path d="M80 110 Q100 140 120 110 Z" fill="#7a1f1f" ${S2}/><path d="M84 111 l4 8 l4 -8 M108 111 l4 8 l4 -8" fill="#fff" stroke="${O}" stroke-width="1.5"/>` : `<path d="M88 112 Q94 118 100 110 Q106 118 112 112" fill="none" ${S2}/>${mo(100,116,12,9)}`}`;
C.qingmaoshi = () => mon({
  w: hold(152, 166, 6, W.sword('#e3f2fd')),
  body: robe('#f2b632', `<path d="M76 150 q10 -10 20 0 q10 10 20 0 q10 -10 20 0" fill="none" stroke="#c0392b" stroke-width="3"/><path d="M62 174 h76" stroke="#c0392b" stroke-width="5"/>`),
  hands: hands('#e0b97a'),
  head: lionHead('#26a69a', '#e0b97a', `<path d="M78 46 L82 28 L92 40 L100 22 L108 40 L118 28 L122 46 Z" fill="#f2c94c" ${S}/>`),
});
// 红孩儿：火焰发、红肚兜、火尖枪
C.honghaier = () => mon({
  w: hold(150, 164, 8, W.spear('#ff7043', '#8d2c1f', 160).replace('#dfe6ea', '#ffb74d')),
  feet: '#fde0c8',
  body: `<path d="M70 132 Q100 122 130 132 L134 186 Q100 194 66 186 Z" fill="#fde0c8" ${S}/><path d="M76 134 L124 134 L120 178 Q100 186 80 178 Z" fill="#e53935" ${S}/><circle cx="100" cy="156" r="8" fill="#f2c94c" ${S2}/><path d="M64 180 L136 180 L140 198 Q100 206 60 198 Z" fill="#f57c00" ${S2}/>`,
  hands: hands('#fde0c8', [60, 156], [150, 160]),
  head: `<g class="sway" style="transform-origin:100px 50px"><path d="M66 60 C54 40 66 24 74 30 C72 14 88 6 94 18 C98 2 116 6 112 22 C124 12 140 22 130 40 C144 40 144 58 134 62 Z" fill="#ff5722" ${S}/><path d="M84 40 C82 26 92 22 96 30 C100 22 110 26 106 38" fill="#ffca28" stroke="none"/></g>
  ${head('#fde0c8', 40, 90)}${eyes(100,92,15,{r:6.5})}${blush(100,104,24)}<path d="M76 80 l14 4 M124 80 l-14 4" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/><path d="M92 110 Q100 104 108 110" fill="none" ${S2}/>${mo(100,110,8,7)}`,
});
// 鼍龙：鳄鱼头、竹节钢鞭
C.tuolong = () => mon({
  w: hold(152, 166, 10, W2.steelWhip()),
  body: armor('#00695c', '#80cbc4'),
  hands: hands('#7cb342'),
  head: `<path d="M100 40 C66 40 52 60 54 86 C56 110 72 126 96 126 L170 118 C184 116 186 98 172 94 L150 90 C146 60 132 40 100 40 Z" fill="#7cb342" ${S}/>
  <path d="M100 118 L172 110" stroke="#33691e" stroke-width="2"/>${[0,1,2,3,4,5].map(i=>`<path d="M${108+i*10} 112 l4 6 l4 -6" fill="#fff" stroke="${O}" stroke-width="1.4"/>`).join('')}
  <circle cx="170" cy="100" r="2.5" fill="${O}"/><path d="M76 48 l6 -8 l6 8 M96 44 l6 -8 l6 8 M116 46 l6 -8 l6 8" fill="#558b2f" ${S2}/>
  ${slitEyes(92,76,14,'#ffeb3b')}${mo(140,118,22,7,'#7a1f1f')}`,
});
// 车迟国三仙
const taoHat = (c = '#37474f') => `<path d="M84 48 L88 26 L112 26 L116 48 Z" fill="${c}" ${S2}/><rect x="96" y="18" width="8" height="10" rx="2" fill="#f2b632" ${S2}/>`;
const bagua = `<circle cx="100" cy="170" r="12" fill="#fafafa" ${S2}/><path d="M100 158 a6 6 0 0 1 0 12 a6 6 0 0 0 0 12 a12 12 0 0 1 0 -24 Z" fill="#2b2b33"/>`;
C.huli = () => mon({
  w: hold(150, 166, 8, W2.token()),
  body: robe('#f9a825', bagua),
  hands: hands('#f08a24'),
  head: `<circle cx="60" cy="54" r="13" fill="#f08a24" ${S}/><circle cx="140" cy="54" r="13" fill="#f08a24" ${S}/><ellipse cx="100" cy="88" rx="50" ry="44" fill="#f08a24" ${S}/>
  <path d="M86 56 h28 M90 64 h20 M100 54 v12" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/><path d="M52 88 l12 2 M52 100 l12 -2 M148 88 l-12 2 M148 100 l-12 -2" stroke="${O}" stroke-width="3" stroke-linecap="round"/>
  <path d="M72 104 C72 126 88 130 100 130 C112 130 128 126 128 104 C118 96 82 96 72 104 Z" fill="#fff4e0" ${S2}/>${taoHat()}${slitEyes(100,86,18,'#f5d33d')}<path d="M93 104 L107 104 L100 111 Z" fill="${O}"/><path d="M90 118 Q100 112 110 118" fill="none" ${S2}/>${mo(100,118,8,6)}`,
});
C.luli = () => mon({
  w: hold(150, 160, 4, W2.talisman()),
  body: robe('#78909c', bagua),
  hands: hands('#c8a27a'),
  head: `<path d="M70 50 C64 30 70 18 60 6 M66 30 l-12 -2 M68 40 l-10 4 M130 50 C136 30 130 18 140 6 M134 30 l12 -2 M132 40 l10 4" fill="none" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M70 50 C64 30 70 18 60 6 M66 30 l-12 -2 M68 40 l-10 4 M130 50 C136 30 130 18 140 6 M134 30 l12 -2 M132 40 l10 4" fill="none" stroke="#efe6d8" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="56" cy="74" rx="14" ry="8" fill="#c8a27a" ${S2} transform="rotate(-20 56 74)"/><ellipse cx="144" cy="74" rx="14" ry="8" fill="#c8a27a" ${S2} transform="rotate(20 144 74)"/>
  <path d="M100 44 C70 44 60 66 64 90 C68 116 84 132 100 132 C116 132 132 116 136 90 C140 66 130 44 100 44 Z" fill="#c8a27a" ${S}/><circle cx="84" cy="64" r="3" fill="#fff"/><circle cx="116" cy="64" r="3" fill="#fff"/><circle cx="90" cy="56" r="2.4" fill="#fff"/>
  <ellipse cx="100" cy="112" rx="18" ry="14" fill="#efe6d8" ${S2}/><ellipse cx="100" cy="106" rx="6" ry="4" fill="${O}"/>${taoHat('#455a64')}${eyes(100,84,17,{r:6.5})}${mo(100,120,7,5)}`,
});
C.yangli = () => mon({
  w: hold(150, 166, 8, W2.whisk()),
  body: robe('#43a047', bagua),
  hands: hands('#f5f5f5'),
  head: `<path d="M62 60 C34 50 30 86 50 92 C60 94 62 82 54 80" fill="none" stroke="${O}" stroke-width="11" stroke-linecap="round"/><path d="M62 60 C34 50 30 86 50 92 C60 94 62 82 54 80" fill="none" stroke="#d7ccc8" stroke-width="7" stroke-linecap="round"/><path d="M138 60 C166 50 170 86 150 92 C140 94 138 82 146 80" fill="none" stroke="${O}" stroke-width="11" stroke-linecap="round"/><path d="M138 60 C166 50 170 86 150 92 C140 94 138 82 146 80" fill="none" stroke="#d7ccc8" stroke-width="7" stroke-linecap="round"/>
  <path d="M100 44 C72 44 62 66 66 90 C70 114 84 128 100 128 C116 128 130 114 134 90 C138 66 128 44 100 44 Z" fill="#f5f5f5" ${S}/><path d="M92 126 C90 146 98 156 100 162 C102 156 110 146 108 126 Z" fill="#f5f5f5" ${S2}/>
  <ellipse cx="100" cy="108" rx="7" ry="5" fill="#e0a0a0" ${S2}/>${taoHat('#2e7d32')}${eyes(100,86,17,{r:6.5, iris:'#ffe082'})}${mo(100,118,7,5)}`,
});
// 灵感大王（金鱼精）：九瓣铜锤
C.linggan = () => mon({
  w: hold(152, 166, 10, W2.mace9()),
  back: `<g class="tail" style="transform-origin:100px 184px"><path d="M100 184 C70 200 40 196 30 210 C60 214 80 206 100 196 C120 206 140 214 170 210 C160 196 130 200 100 184 Z" fill="#ff7043" ${S}/></g>`,
  body: armor('#f2b632', '#e65100'),
  hands: hands('#ff8a65'),
  head: `<g class="sway" style="transform-origin:100px 44px"><path d="M70 50 C76 20 92 14 100 4 C108 14 124 20 130 50 Z" fill="#ffab91" ${S}/><path d="M84 46 L100 14 L116 46" fill="none" stroke="#e64a19" stroke-width="2.5"/></g>
  <path d="M100 44 C62 44 52 70 54 92 C56 116 76 130 100 130 C124 130 144 116 146 92 C148 70 138 44 100 44 Z" fill="#ff8a65" ${S}/><path d="M66 100 q8 6 0 12 M134 100 q-8 6 0 12" fill="none" stroke="#e64a19" stroke-width="2"/>
  <circle cx="74" cy="72" r="14" fill="#fff" ${S2}/><circle cx="126" cy="72" r="14" fill="#fff" ${S2}/><g class="blink" style="transform-origin:100px 72px"><circle cx="76" cy="73" r="7" fill="${O}"/><circle cx="124" cy="73" r="7" fill="${O}"/><circle cx="78" cy="70" r="2.5" fill="#fff"/><circle cx="126" cy="70" r="2.5" fill="#fff"/></g>${'<g class="ouch"><path d="M66 66 L82 72 L66 78 M134 66 L118 72 L134 78" fill="none" stroke="#3a2618" stroke-width="3.8" stroke-linecap="round"/></g>'}
  <ellipse cx="100" cy="108" rx="12" ry="9" fill="#e64a19" ${S2}/>${mo(100,108,14,12,'#7a1f1f')}`,
});
// 独角兕大王（青牛精）：独角、点钢枪、金刚琢
C.sidawang = () => mon({
  w: hold(154, 166, 10, W.spear('#263238', '#5d4037', 184)),
  w2: `<g class="weapon zhuo" style="transform-origin:54px 160px"><circle cx="52" cy="150" r="13" fill="none" stroke="${O}" stroke-width="8"/><circle cx="52" cy="150" r="13" fill="none" stroke="#eceff1" stroke-width="4.5"/></g>`,
  body: armor('#37474f', '#90a4ae'),
  hands: hands('#546e7a', [52, 162], [154, 166]),
  head: `<path d="M62 62 C40 58 34 72 44 78 L64 76 Z M138 62 C160 58 166 72 156 78 L136 76 Z" fill="#546e7a" ${S}/><path d="M100 40 C68 40 56 60 58 86 C60 112 76 128 100 128 C124 128 140 112 142 86 C144 60 132 40 100 40 Z" fill="#546e7a" ${S}/>
  <path d="M92 44 C92 24 100 8 108 2 C108 18 110 34 108 44 Z" fill="#eceff1" ${S}/><ellipse cx="100" cy="108" rx="24" ry="17" fill="#90a4ae" ${S2}/><ellipse cx="92" cy="106" rx="3.5" ry="5" fill="${O}"/><ellipse cx="108" cy="106" rx="3.5" ry="5" fill="${O}"/>
  <path d="M90 118 Q100 128 110 118" fill="none" stroke="#f2c94c" stroke-width="4"/>${eyes(100,80,20,{r:6.5, iris:'#ffcc80'})}${mo(100,120,9,5)}`,
  sw: 70,
});
// 蝎子精：毒尾、三股叉
C.xiezi = () => mon({
  back: `<g class="tail stinger" style="transform-origin:120px 176px"><path d="M120 176 C170 170 186 120 168 76 C160 56 140 50 132 64" fill="none" stroke="${O}" stroke-width="16" stroke-linecap="round"/><path d="M120 176 C170 170 186 120 168 76 C160 56 140 50 132 64" fill="none" stroke="#8d2c1f" stroke-width="10" stroke-linecap="round" stroke-dasharray="12 3"/><path d="M134 62 L118 70 L128 52 Z" fill="#212121" ${S2}/></g>`,
  w: hold(48, 166, -6, W.trident().replace(/#5d6d7e/g, '#4e342e')),
  body: robe('#8d2c1f', `<path d="M70 132 Q100 150 130 132" fill="none" stroke="#f2b632" stroke-width="3"/><path d="M62 172 h76" stroke="#3e2723" stroke-width="5"/>`),
  hands: hands('#fbe3d0', [48, 166], [150, 162]),
  head: `${head('#fbe3d0', 42, 88)}${ladyHair('#212121')}<path d="M80 46 Q100 26 120 46 Z" fill="#212121" ${S2}/><path d="M86 38 l-10 -14 M114 38 l10 -14" stroke="${O}" stroke-width="3"/><circle cx="76" cy="22" r="4" fill="#8d2c1f"/><circle cx="124" cy="22" r="4" fill="#8d2c1f"/>
  ${eyes(100,92,15,{r:5.8, iris:'#ff8a65'})}<path d="M94 108 Q100 112 106 108" fill="#c62828" ${S2}/>`,
});
// 牛魔王：巨角、鼻环、金甲、红披风、混铁棍
C.niumowang = () => mon({
  back: `<g class="sway" style="transform-origin:100px 128px"><path d="M56 128 C24 160 30 200 46 212 L154 212 C170 200 176 160 144 128 Z" fill="#b71c1c" ${S}/></g>`,
  w: hold(158, 166, 12, W2.ironClub()),
  feet: '#3e2723',
  body: `<path d="M48 128 Q100 108 152 128 L158 202 Q100 216 42 202 Z" fill="#3e2723" ${S}/><path d="M60 130 Q100 150 140 130 L136 176 Q100 186 64 176 Z" fill="#f2b632" ${S2}/>${[0,1,2].map(r=>[0,1,2,3,4].map(c=>`<path d="M${70+c*13} ${142+r*11} q6 7 12 0" fill="none" stroke="#b8860b" stroke-width="2"/>`).join('')).join('')}<path d="M42 132 Q26 116 42 100 L66 120 Z M158 132 Q174 116 158 100 L134 120 Z" fill="#f2b632" ${S}/>`,
  hands: hands('#5d4037', [46, 164], [158, 166]),
  head: `<path d="M62 56 C30 50 14 22 22 2 C34 22 50 30 70 38 Z M138 56 C170 50 186 22 178 2 C166 22 150 30 130 38 Z" fill="#fff8e1" ${S}/><path d="M56 70 C36 66 30 80 42 86 L62 82 Z M144 70 C164 66 170 80 158 86 L138 82 Z" fill="#5d4037" ${S}/>
  <path d="M100 36 C64 36 52 60 54 88 C56 116 76 132 100 132 C124 132 144 116 146 88 C148 60 136 36 100 36 Z" fill="#5d4037" ${S}/><path d="M84 40 Q100 30 116 40 Q108 50 100 48 Q92 50 84 40 Z" fill="#212121"/>
  <ellipse cx="100" cy="112" rx="28" ry="19" fill="#a1887f" ${S2}/><ellipse cx="90" cy="110" rx="4" ry="6" fill="${O}"/><ellipse cx="110" cy="110" rx="4" ry="6" fill="${O}"/><path d="M90 122 Q100 134 110 122" fill="none" stroke="#f2c94c" stroke-width="5"/>
  <path d="M68 70 l22 8 M132 70 l-22 8" stroke="${O}" stroke-width="6" stroke-linecap="round"/>${eyes(100,84,20,{r:7, iris:'#ff7043'})}${mo(100,126,10,5)}`,
  sw: 76, cls: 'big',
});
// 铁扇公主：芭蕉扇
C.tieshan = () => mon({
  w: hold(152, 168, 6, W2.fan()),
  body: robe('#2e7d32', `<path d="M70 132 Q100 150 130 132 L132 210 L68 210 Z" fill="#c8e6c9" ${S2}/><path d="M60 136 C40 160 46 190 40 206 M140 136 C160 160 154 190 160 206" fill="none" stroke="#a5d6a7" stroke-width="6" stroke-linecap="round"/>`),
  hands: hands('#fbe3d0', [58, 162], [152, 168]),
  head: `${head('#fbe3d0', 42, 88)}${ladyHair()}<ellipse cx="100" cy="40" rx="26" ry="14" fill="#2b2b33" ${S2}/><path d="M76 40 h48" stroke="#f2c94c" stroke-width="3"/><circle cx="76" cy="40" r="5" fill="#e53935" ${S2}/><g class="sway" style="transform-origin:124px 40px"><path d="M124 40 q14 6 12 24" stroke="#f2c94c" stroke-width="2.4" fill="none"/><circle cx="136" cy="66" r="3.5" fill="#4caf50"/></g>
  <path d="M76 82 q8 -4 16 2 M108 84 q8 -6 16 -2" stroke="${O}" stroke-width="3" fill="none"/>${eyes(100,92,15,{r:5.8})}${blush(100,104,24)}<path d="M94 108 Q100 112 106 108" fill="#c62828" ${S2}/>`,
});
// 九头虫：九个鸟头、月牙铲
C.jiutouchong = () => mon({
  back: [[-62, 34], [-40, 12], [40, 12], [62, 34], [0, -6], [-22, 0], [22, 0], [-74, 62]].map(([dx, dy], i) => `<g class="sway" style="transform-origin:100px 110px;animation-delay:${-i * .3}s;animation-duration:${1.8 + (i % 3) * .3}s"><path d="M100 110 Q${100 + dx * .5} ${70 + dy} ${100 + dx} ${46 + dy}" fill="none" stroke="${O}" stroke-width="11" stroke-linecap="round"/><path d="M100 110 Q${100 + dx * .5} ${70 + dy} ${100 + dx} ${46 + dy}" fill="none" stroke="#5e35b1" stroke-width="6" stroke-linecap="round"/><circle cx="${100 + dx}" cy="${40 + dy}" r="11" fill="#7e57c2" ${S2}/><path d="M${100 + dx + 6} ${38 + dy} l12 4 l-12 4 Z" fill="#ffca28" ${S2}/><circle cx="${100 + dx + 2}" cy="${36 + dy}" r="2.4" fill="${O}"/></g>`).join(''),
  w: hold(154, 166, 8, W2.moonSpade()),
  body: armor('#4527a0', '#ffca28'),
  hands: hands('#9575cd'),
  head: `<path d="M100 44 C70 44 58 66 60 90 C62 114 80 128 100 128 C120 128 138 114 140 90 C142 66 130 44 100 44 Z" fill="#7e57c2" ${S}/><path d="M86 48 L92 24 L100 42 L108 22 L114 48" fill="#ffca28" ${S2}/>
  ${eyes(100,84,17,{r:7, iris:'#ff8a65'})}<path d="M96 98 L132 108 L96 118 Z" fill="#ffca28" ${S}/><path class="mopen" d="M96 116 L128 124 L96 126 Z" fill="#ffca28" ${S2}/>`,
});
// 黄眉大王：长黄眉、狼牙棒、金铙
C.huangmei = () => mon({
  back: `<g class="cymbal" style="transform-origin:100px 100px"><ellipse cx="44" cy="120" rx="26" ry="30" fill="#f2c94c" ${S}/><ellipse cx="44" cy="120" rx="8" ry="10" fill="#c49a00"/><ellipse cx="156" cy="120" rx="26" ry="30" fill="#f2c94c" ${S}/><ellipse cx="156" cy="120" rx="8" ry="10" fill="#c49a00"/></g>`,
  w: hold(152, 166, 10, W2.wolfTooth()),
  body: robe('#f9a825', `<path d="M62 136 L130 128 L146 196 L70 200 Z" fill="#e65100" opacity=".85" ${S2}/>`),
  hands: hands('#fde0c8'),
  head: `<ellipse cx="54" cy="92" rx="9" ry="16" fill="#fde0c8" ${S2}/><ellipse cx="146" cy="92" rx="9" ry="16" fill="#fde0c8" ${S2}/><circle cx="54" cy="108" r="5" fill="none" stroke="#f2c94c" stroke-width="3"/><circle cx="146" cy="108" r="5" fill="none" stroke="#f2c94c" stroke-width="3"/>${head('#fde0c8', 44, 84)}
  <g class="sway" style="transform-origin:100px 72px"><path d="M98 74 C84 60 66 66 52 92 C66 80 80 78 96 80 Z M102 74 C116 60 134 66 148 92 C134 80 120 78 104 80 Z" fill="#ffd54f" ${S2}/></g>
  ${eyes(100,88,15,{r:5.5})}<path d="M86 108 Q100 116 114 108" fill="none" ${S2}/>${mo(100,110,9,6)}`,
});
// 赛太岁（金毛犼）：紫金铃、宣花钺斧
C.saitaisui = () => mon({
  w: hold(154, 166, 10, W2.yueAxe()),
  front: `<g class="bells">${[78, 100, 122].map((x, i) => `<g class="sway" style="transform-origin:${x}px 176px;animation-delay:${-i * .4}s"><path d="M${x} 176 v6" stroke="${O}" stroke-width="2"/><path d="M${x - 8} 194 Q${x - 8} 182 ${x} 182 Q${x + 8} 182 ${x + 8} 194 Z" fill="#9c27b0" ${S2}/><circle cx="${x}" cy="196" r="2.5" fill="#f2c94c"/></g>`).join('')}</g>`,
  body: armor('#c62828', '#f2c94c'),
  hands: hands('#ffb74d'),
  head: lionHead('#ffca28', '#ffb74d'),
});
// 蜘蛛精：背生蛛腿、网纹裙
C.zhizhu = () => mon({
  back: [0, 1, 2].map(i => `<g class="sway" style="transform-origin:76px 140px;animation-delay:${-i * .5}s"><path d="M76 140 L${40 - i * 4} ${110 + i * 22} L${30 - i * 6} ${150 + i * 22}" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M76 140 L${40 - i * 4} ${110 + i * 22} L${30 - i * 6} ${150 + i * 22}" fill="none" stroke="#6a1b9a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g><g class="sway" style="transform-origin:124px 140px;animation-delay:${-i * .5 - .25}s"><path d="M124 140 L${160 + i * 4} ${110 + i * 22} L${170 + i * 6} ${150 + i * 22}" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M124 140 L${160 + i * 4} ${110 + i * 22} L${170 + i * 6} ${150 + i * 22}" fill="none" stroke="#6a1b9a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>`).join(''),
  body: robe('#8e24aa', `<path d="M100 140 L70 200 M100 140 L130 200 M100 140 L100 206 M78 170 Q100 160 122 170 M68 194 Q100 182 132 194" fill="none" stroke="#e1bee7" stroke-width="2"/>`),
  hands: hands('#fbe3d0', [58, 158], [142, 158]),
  head: `${head('#fbe3d0', 42, 88)}${ladyHair('#311b92')}<path d="M80 50 Q100 30 120 50 Z" fill="#311b92" ${S2}/><circle cx="100" cy="40" r="6" fill="#9c27b0" ${S2}/>
  ${eyes(100,92,15,{r:5.8, iris:'#ce93d8'})}${blush(100,104,24)}<path d="M94 108 Q100 112 106 108" fill="#8e24aa" ${S2}/>`,
});
// 百眼魔君（蜈蚣精）：道袍上千只眼、宝剑
C.baiyan = () => mon({
  w: hold(152, 166, 8, W.sword('#cfd8dc')),
  body: robe('#1b5e20') + `<g class="robe-eyes">${[[70, 142], [86, 152], [114, 152], [130, 142], [72, 170], [92, 176], [108, 176], [128, 170], [80, 194], [100, 198], [120, 194]].map(([x, y]) => `<g class="blink" style="transform-origin:${x}px ${y}px;animation-delay:${-(x * y) % 4}s"><ellipse cx="${x}" cy="${y}" rx="6" ry="4" fill="#fff59d" stroke="${O}" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="2" fill="${O}"/></g>`).join('')}</g>`,
  hands: hands('#c5e1a5'),
  head: `${head('#c5e1a5', 42, 86)}<path d="M70 104 C74 140 92 150 100 154 C108 150 126 140 130 104 C120 116 110 114 100 114 C90 114 80 116 70 104 Z" fill="#33691e" ${S2}/>${taoHat('#1b5e20')}
  <path d="M68 76 q10 -8 22 0 M110 76 q12 -8 22 0" stroke="${O}" stroke-width="3.6" fill="none"/>${eyes(100,88,16,{r:6, iris:'#fff59d'})}${[[80, 64], [100, 60], [120, 64]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="3.5" fill="#fff59d" stroke="${O}" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="1.8" fill="${O}"/>`).join('')}`,
});
// 狮驼岭·青狮精：张开大嘴、大砍刀
C.qingshi = () => mon({
  w: hold(156, 166, 8, W2.bigBlade()),
  body: armor('#004d40', '#ffca28'),
  hands: hands('#e0b97a', [48, 162], [156, 166]),
  head: lionHead('#4db6ac', '#e0b97a', '', true),
  sw: 72, cls: 'big',
});
// 狮驼岭·白象精：长鼻、象牙、长枪
C.baixiang = () => mon({
  w: hold(156, 166, 8, W.spear('#eceff1', '#5d4037', 184)),
  body: armor('#546e7a', '#cfd8dc'),
  hands: hands('#cfd8dc', [48, 162], [156, 166]),
  head: `<path d="M58 60 C22 52 14 98 30 116 C40 126 58 118 62 104 Z M142 60 C178 52 186 98 170 116 C160 126 142 118 138 104 Z" fill="#cfd8dc" ${S}/><path d="M38 76 C30 90 34 104 44 108 M162 76 C170 90 166 104 156 108" fill="none" stroke="#f8bbd0" stroke-width="5" stroke-linecap="round"/>
  <path d="M100 40 C68 40 56 60 58 86 C60 110 74 122 100 122 C126 122 140 110 142 86 C144 60 132 40 100 40 Z" fill="#cfd8dc" ${S}/>
  <path d="M80 112 C70 130 74 140 66 146 M120 112 C130 130 126 140 134 146" fill="none" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M80 112 C70 130 74 140 66 146 M120 112 C130 130 126 140 134 146" fill="none" stroke="#fffde7" stroke-width="5" stroke-linecap="round"/>
  <g class="trunk" style="transform-origin:100px 108px"><path d="M100 100 C100 130 94 150 104 164 C112 172 122 164 116 156" fill="none" stroke="${O}" stroke-width="20" stroke-linecap="round"/><path d="M100 100 C100 130 94 150 104 164 C112 172 122 164 116 156" fill="none" stroke="#cfd8dc" stroke-width="14" stroke-linecap="round"/><path d="M95 120 h10 M94 134 h10 M96 148 h9" stroke="#90a4ae" stroke-width="2"/></g>
  ${eyes(100,80,20,{r:6.5})}`,
  sw: 72, cls: 'big',
});
// 狮驼岭·大鹏金翅雕：双翅、方天画戟
C.dapeng = () => mon({
  back: `<g class="wing" style="transform-origin:76px 128px"><path d="M76 128 C30 100 8 60 14 30 C30 52 46 60 60 64 C44 44 42 26 48 10 C62 40 78 62 88 92 Z" fill="#ffb300" ${S}/><path d="M70 110 C44 92 28 70 22 46 M78 100 C64 80 56 56 54 30" stroke="#e65100" stroke-width="2.5" fill="none"/></g><g class="wing" style="transform-origin:124px 128px;animation-delay:-.2s"><path d="M124 128 C170 100 192 60 186 30 C170 52 154 60 140 64 C156 44 158 26 152 10 C138 40 122 62 112 92 Z" fill="#ffb300" ${S}/><path d="M130 110 C156 92 172 70 178 46 M122 100 C136 80 144 56 146 30" stroke="#e65100" stroke-width="2.5" fill="none"/></g>`,
  w: hold(156, 166, 8, W2.halberd()),
  body: armor('#b71c1c', '#ffca28'),
  hands: hands('#ffca28'),
  head: `<path d="M100 40 C68 40 58 62 60 88 C62 112 80 126 100 126 C120 126 138 112 140 88 C142 62 132 40 100 40 Z" fill="#ffb300" ${S}/><path d="M76 46 L70 22 L90 40 L100 14 L110 40 L130 22 L124 46 Z" fill="#ff7043" ${S2}/>
  <path d="M92 94 C108 92 128 100 126 116 C120 110 110 108 100 112 Z" fill="#fff3e0" ${S}/><path d="M118 110 l8 10 l-12 -4" fill="#fff3e0" ${S2}/>
  <path d="M68 74 l22 8 M132 74 l-22 8" stroke="${O}" stroke-width="5" stroke-linecap="round"/>${eyes(100,84,18,{r:6.5, iris:'#ff5722'})}`,
});
// 白鹿精（比丘国国丈）：白须、鹿角、蟠龙拐棍
C.bailujing = () => mon({
  w: hold(152, 190, 4, W2.dragonCane()),
  body: robe('#795548', `<path d="M62 176 h76" stroke="#f2b632" stroke-width="5"/>`),
  hands: hands('#f8dcc0', [58, 166], [152, 182]),
  head: `<path d="M74 46 C68 30 74 18 64 8 M70 30 l-10 -4 M126 46 C132 30 126 18 136 8 M130 30 l10 -4" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M74 46 C68 30 74 18 64 8 M70 30 l-10 -4 M126 46 C132 30 126 18 136 8 M130 30 l10 -4" fill="none" stroke="#efe6d8" stroke-width="3.5" stroke-linecap="round"/>
  ${head('#f8dcc0', 42, 86)}${longBeard('#fafafa', 50)}<path d="M70 76 q10 -8 22 -2 M108 74 q12 -6 22 2" stroke="#fafafa" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M68 62 Q100 40 132 62 Q100 54 68 62 Z" fill="#5d4037" ${S2}/>
  ${eyes(100,90,14,{r:5})}<ellipse cx="100" cy="102" rx="6" ry="4.5" fill="#f0a98c" ${S2}/>`,
});
// 金鼻白毛老鼠精（地涌夫人）：大圆耳、双股剑
C.laoshu = () => mon({
  back: `<g class="tail" style="transform-origin:120px 186px"><path d="M120 186 C160 200 186 180 176 150" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M120 186 C160 200 186 180 176 150" fill="none" stroke="#f8bbd0" stroke-width="3.5" stroke-linecap="round"/></g>`,
  w: hold(154, 166, 14, W.sword('#eceff1')), w2: hold(46, 166, -14, W.sword('#eceff1')),
  body: robe('#ec407a', `<path d="M70 132 Q100 150 130 132" fill="none" stroke="#fff" stroke-width="3"/>`),
  hands: hands('#fafafa', [46, 166], [154, 166]),
  head: `<circle cx="60" cy="50" r="22" fill="#fafafa" ${S}/><circle cx="60" cy="50" r="12" fill="#f8bbd0"/><circle cx="140" cy="50" r="22" fill="#fafafa" ${S}/><circle cx="140" cy="50" r="12" fill="#f8bbd0"/>
  ${head('#fafafa', 42, 88)}<path d="M66 76 Q72 54 100 52 Q128 54 134 76 Q116 66 100 66 Q84 66 66 76 Z" fill="#eceff1" ${S2}/>
  ${eyes(100,90,15,{r:6, iris:'#e91e63'})}<ellipse cx="100" cy="104" rx="5" ry="4" fill="#f2c94c" ${S2}/><path d="M82 104 l-22 -4 M82 108 l-22 4 M118 104 l22 -4 M118 108 l22 4" stroke="${O}" stroke-width="1.6"/><path d="M95 112 Q100 116 105 112" fill="none" ${S2}/>`,
});
// 玉兔精（天竺国假公主）：长兔耳、捣药杵
C.yutu = () => mon({
  w: hold(152, 166, 10, W2.pestle()),
  body: robe('#f48fb1', `<path d="M70 132 Q100 150 130 132 L132 210 L68 210 Z" fill="#fce4ec" ${S2}/>`),
  hands: hands('#fbe3d0'),
  head: `<g class="ear" style="transform-origin:80px 50px"><path d="M80 52 C62 20 64 -14 78 -16 C92 -14 94 20 88 50 Z" fill="#fafafa" ${S}/><path d="M80 44 C72 20 72 -4 78 -6 C84 -4 86 20 84 44 Z" fill="#f8bbd0"/></g><g class="ear" style="transform-origin:120px 50px;animation-delay:-.6s"><path d="M120 52 C138 20 136 -14 122 -16 C108 -14 106 20 112 50 Z" fill="#fafafa" ${S}/><path d="M120 44 C128 20 128 -4 122 -6 C116 -4 114 20 116 44 Z" fill="#f8bbd0"/></g>
  ${head('#fbe3d0', 42, 88)}${ladyHair('#fafafa')}<path d="M80 54 L86 40 L94 50 L100 36 L106 50 L114 40 L120 54 Z" fill="#f2c94c" ${S2}/>
  ${eyes(100,92,15,{r:6, iris:'#e53935'})}${blush(100,104,24)}<path d="M96 106 l4 3 l4 -3 M100 109 v4" fill="none" ${S2}/>`,
});

// ---------- 新神仙 / 押解者 ----------
C.change = () => wrap(`
  <circle cx="150" cy="44" r="26" fill="#fff9c4" ${S}/><path d="M150 18 A26 26 0 1 0 150 70 A20 20 0 1 1 150 18 Z" fill="#fff59d" ${S2}/>
  <g class="sway" style="transform-origin:100px 130px"><path d="M60 130 C26 150 36 186 20 206 M140 130 C174 150 164 186 180 206" fill="none" stroke="#b3e5fc" stroke-width="7" stroke-linecap="round"/></g>
  ${feet('#8d6e63')}
  ${robe('#e3f2fd', `<path d="M70 132 Q100 150 130 132" fill="none" stroke="#90caf9" stroke-width="4"/><path d="M62 176 h76" stroke="#90caf9" stroke-width="4"/>`)}
  ${hands('#fbe3d0')}
  ${head('#fbe3d0', 42, 88)}${ladyHair()}<path d="M84 50 C80 30 92 20 100 28 C108 20 120 30 116 50 Z" fill="#2b2b33" ${S2}/><circle cx="100" cy="30" r="4" fill="#90caf9"/>
  ${happyEyes(100,92,15)}${blush(100,104,24)}<path d="M95 108 Q100 112 105 108" fill="#e57373" ${S2}/>
`);
C.moang = () => C.longwang().replace(/#00897b/g, '#3949ab').replace(/#81c784/g, '#90caf9').replace(/#c8e6c9/g, '#e3f2fd');

// ================= 原形（动物） =================
function animal(o) {
  const c = o.c, d = o.d || c, belly = o.belly || '#fff8e1';
  let tail = '';
  if (o.tail === 'tuft') tail = `<path d="M54 152 C30 150 22 130 30 116" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M54 152 C30 150 22 130 30 116" fill="none" stroke="${d}" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="30" cy="112" rx="8" ry="10" fill="${o.mane || d}" ${S2}/>`;
  else if (o.tail === 'puff') tail = `<circle cx="52" cy="146" r="11" fill="#fff" ${S2}/>`;
  else if (o.tail === 'thin') tail = `<path d="M54 158 C20 166 14 140 24 126" fill="none" stroke="${O}" stroke-width="6" stroke-linecap="round"/><path d="M54 158 C20 166 14 140 24 126" fill="none" stroke="#f8bbd0" stroke-width="3" stroke-linecap="round"/>`;
  else tail = `<path d="M54 150 C34 146 28 132 34 120" fill="none" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M54 150 C34 146 28 132 34 120" fill="none" stroke="${d}" stroke-width="5" stroke-linecap="round"/>`;
  const legs = (x) => `<rect x="${x}" y="168" width="15" height="38" rx="7" fill="${d}" ${S}/>`;
  let hd = '';
  const hx = 148, hy = 122;
  const eye = `${eyes(hx + 4, hy - 4, .01, { r: 6 })}`;
  if (o.head === 'cat') hd = `${o.mane ? `<g class="sway" style="transform-origin:${hx}px ${hy}px">${Array.from({ length: 14 }, (_, i) => { const a = i / 14 * Math.PI * 2; return `<path d="M${hx + Math.cos(a) * 26} ${hy + Math.sin(a) * 26} L${hx + Math.cos(a + .22) * 44} ${hy + Math.sin(a + .22) * 44} L${hx + Math.cos(a + .44) * 26} ${hy + Math.sin(a + .44) * 26} Z" fill="${o.mane}" ${S2}/>`; }).join('')}<circle cx="${hx}" cy="${hy}" r="34" fill="${o.mane}" ${S}/></g>` : ''}<circle cx="${hx - 14}" cy="${hy - 22}" r="9" fill="${c}" ${S2}/><circle cx="${hx + 14}" cy="${hy - 24}" r="9" fill="${c}" ${S2}/><circle cx="${hx}" cy="${hy}" r="26" fill="${c}" ${S}/><ellipse cx="${hx + 10}" cy="${hy + 12}" rx="13" ry="9" fill="${belly}" ${S2}/><ellipse cx="${hx + 15}" cy="${hy + 7}" rx="4.5" ry="3.2" fill="${O}"/>${eyes(hx - 2, hy - 9, .01, { r: 6 })}`;
  if (o.head === 'ox') hd = `${o.horn === 'one' ? `<path d="M${hx - 2} ${hy - 22} C${hx} ${hy - 44} ${hx + 8} ${hy - 54} ${hx + 14} ${hy - 58} C${hx + 14} ${hy - 44} ${hx + 10} ${hy - 30} ${hx + 8} ${hy - 22} Z" fill="#eceff1" ${S}/>` : `<path d="M${hx - 14} ${hy - 18} C${hx - 30} ${hy - 30} ${hx - 30} ${hy - 46} ${hx - 22} ${hy - 52} C${hx - 20} ${hy - 40} ${hx - 12} ${hy - 32} ${hx - 4} ${hy - 26} Z M${hx + 14} ${hy - 18} C${hx + 30} ${hy - 30} ${hx + 30} ${hy - 46} ${hx + 22} ${hy - 52} C${hx + 20} ${hy - 40} ${hx + 12} ${hy - 32} ${hx + 4} ${hy - 26} Z" fill="#fff8e1" ${S}/>`}<ellipse cx="${hx - 26}" cy="${hy - 12}" rx="12" ry="6" fill="${c}" ${S2}/><path d="M${hx - 22} ${hy} C${hx - 22} ${hy - 28} ${hx + 22} ${hy - 28} ${hx + 22} ${hy} L${hx + 24} ${hy + 18} C${hx + 24} ${hy + 30} ${hx - 6} ${hy + 30} ${hx - 6} ${hy + 18} Z" fill="${c}" ${S}/><ellipse cx="${hx + 10}" cy="${hy + 20}" rx="15" ry="10" fill="${belly}" ${S2}/><circle cx="${hx + 6}" cy="${hy + 20}" r="2.4" fill="${O}"/><circle cx="${hx + 15}" cy="${hy + 20}" r="2.4" fill="${O}"/>${eye}`;
  if (o.head === 'deer') hd = `${o.horn === 'goat' ? `<path d="M${hx - 6} ${hy - 20} C${hx - 30} ${hy - 30} ${hx - 34} ${hy - 4} ${hx - 18} ${hy - 4}" fill="none" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M${hx - 6} ${hy - 20} C${hx - 30} ${hy - 30} ${hx - 34} ${hy - 4} ${hx - 18} ${hy - 4}" fill="none" stroke="#d7ccc8" stroke-width="5" stroke-linecap="round"/>` : `<path d="M${hx - 6} ${hy - 20} C${hx - 14} ${hy - 40} ${hx - 6} ${hy - 52} ${hx - 16} ${hy - 64} M${hx - 10} ${hy - 40} l-12 -4 M${hx + 6} ${hy - 20} C${hx + 12} ${hy - 40} ${hx + 6} ${hy - 52} ${hx + 16} ${hy - 62} M${hx + 9} ${hy - 42} l12 -6" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M${hx - 6} ${hy - 20} C${hx - 14} ${hy - 40} ${hx - 6} ${hy - 52} ${hx - 16} ${hy - 64} M${hx - 10} ${hy - 40} l-12 -4 M${hx + 6} ${hy - 20} C${hx + 12} ${hy - 40} ${hx + 6} ${hy - 52} ${hx + 16} ${hy - 62} M${hx + 9} ${hy - 42} l12 -6" fill="none" stroke="#efe6d8" stroke-width="3.5" stroke-linecap="round"/>`}<ellipse cx="${hx - 20}" cy="${hy - 12}" rx="12" ry="6" fill="${c}" ${S2} transform="rotate(-20 ${hx - 20} ${hy - 12})"/><path d="M${hx - 18} ${hy} C${hx - 18} ${hy - 26} ${hx + 18} ${hy - 26} ${hx + 18} ${hy - 4} L${hx + 30} ${hy + 14} C${hx + 30} ${hy + 22} ${hx + 6} ${hy + 22} ${hx - 6} ${hy + 16} Z" fill="${c}" ${S}/><ellipse cx="${hx + 28}" cy="${hy + 14}" rx="4" ry="3" fill="${O}"/>${o.beard ? `<path d="M${hx + 8} ${hy + 18} l2 16 l6 -14" fill="#fff" ${S2}/>` : ''}${o.spots ? `<circle cx="80" cy="150" r="4" fill="#fff"/><circle cx="98" cy="144" r="4" fill="#fff"/><circle cx="112" cy="156" r="4" fill="#fff"/>` : ''}${eye}`;
  if (o.head === 'mouse') hd = `<circle cx="${hx - 12}" cy="${hy - 22}" r="15" fill="${c}" ${S}/><circle cx="${hx - 12}" cy="${hy - 22}" r="8" fill="#f8bbd0"/><path d="M${hx - 20} ${hy} C${hx - 20} ${hy - 22} ${hx + 10} ${hy - 22} ${hx + 14} ${hy - 6} L${hx + 34} ${hy + 8} L${hx + 10} ${hy + 18} C${hx - 6} ${hy + 20} ${hx - 20} ${hy + 14} ${hx - 20} ${hy} Z" fill="${c}" ${S}/><circle cx="${hx + 34}" cy="${hy + 8}" r="4" fill="#f2c94c" ${S2}/><path d="M${hx + 26} ${hy + 6} l14 -6 M${hx + 26} ${hy + 10} l14 4" stroke="${O}" stroke-width="1.5"/>${eye}`;
  if (o.head === 'rabbit') hd = `<g class="ear" style="transform-origin:${hx - 6}px ${hy - 18}px"><path d="M${hx - 8} ${hy - 16} C${hx - 24} ${hy - 50} ${hx - 16} ${hy - 76} ${hx - 6} ${hy - 74} C${hx + 4} ${hy - 70} ${hx + 2} ${hy - 44} ${hx} ${hy - 18} Z" fill="${c}" ${S}/><path d="M${hx - 7} ${hy - 26} C${hx - 16} ${hy - 50} ${hx - 12} ${hy - 66} ${hx - 6} ${hy - 64}" fill="none" stroke="#f8bbd0" stroke-width="5" stroke-linecap="round"/></g><circle cx="${hx}" cy="${hy}" r="24" fill="${c}" ${S}/><ellipse cx="${hx + 20}" cy="${hy + 4}" rx="4" ry="3" fill="#f48fb1"/>${eyes(hx + 6, hy - 4, .01, { r: 6, iris: '#e53935' })}`;
  if (o.head === 'elephant') hd = `<path d="M${hx - 10} ${hy - 30} C${hx - 50} ${hy - 30} ${hx - 50} ${hy + 20} ${hx - 14} ${hy + 18} Z" fill="${c}" ${S}/><circle cx="${hx}" cy="${hy - 2}" r="28" fill="${c}" ${S}/><g class="trunk" style="transform-origin:${hx + 20}px ${hy + 6}px"><path d="M${hx + 20} ${hy + 4} C${hx + 34} ${hy + 20} ${hx + 30} ${hy + 50} ${hx + 44} ${hy + 56}" fill="none" stroke="${O}" stroke-width="18" stroke-linecap="round"/><path d="M${hx + 20} ${hy + 4} C${hx + 34} ${hy + 20} ${hx + 30} ${hy + 50} ${hx + 44} ${hy + 56}" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round"/></g><path d="M${hx + 10} ${hy + 16} C${hx + 18} ${hy + 30} ${hx + 28} ${hy + 32} ${hx + 34} ${hy + 28}" fill="none" stroke="#fffde7" stroke-width="5" stroke-linecap="round"/>${eye}`;
  return `<svg viewBox="0 0 200 220" class="char beast" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${shadow(56)}<g class="actor"><g class="bob">
    <g class="tail" style="transform-origin:56px 150px">${tail}</g>${legs(70)}${legs(118)}
    <ellipse cx="98" cy="154" rx="50" ry="30" fill="${c}" ${S}/>${o.stripes ? `<path d="M76 130 q4 10 0 18 M96 126 q4 12 0 20 M116 128 q4 10 0 18" stroke="${O}" stroke-width="3.4" fill="none"/>` : ''}
    ${legs(82)}${legs(130)}${hd}</g></g></svg>`;
}
C.yx_shizi = () => animal({ c: '#e0b97a', d: '#c8a060', mane: '#26a69a', head: 'cat', tail: 'tuft' });
C.yx_hou = () => animal({ c: '#ffb74d', d: '#f59f33', mane: '#ffca28', head: 'cat', tail: 'tuft' });
C.yx_qingniu = () => animal({ c: '#546e7a', d: '#455a64', head: 'ox', horn: 'one', tail: 'tuft', belly: '#90a4ae' });
C.yx_bainiu = () => animal({ c: '#fafafa', d: '#e0e0e0', head: 'ox', tail: 'tuft', belly: '#ffccbc', mane: '#bdbdbd' });
C.yx_lu = () => animal({ c: '#c8a27a', d: '#a1825e', head: 'deer', tail: 'puff', spots: true });
C.yx_bailu = () => animal({ c: '#f5f5f5', d: '#e0e0e0', head: 'deer', tail: 'puff' });
C.yx_yang = () => animal({ c: '#f5f5f5', d: '#e0e0e0', head: 'deer', horn: 'goat', beard: true, tail: 'puff' });
C.yx_shu = () => animal({ c: '#fafafa', d: '#eeeeee', head: 'mouse', tail: 'thin' });
C.yx_tu = () => animal({ c: '#fafafa', d: '#eeeeee', head: 'rabbit', tail: 'puff' });
C.yx_xiang = () => animal({ c: '#cfd8dc', d: '#b0bec5', head: 'elephant', tail: 'thin' });
C.yx_tiger2 = () => animal({ c: '#f08a24', d: '#d97a1a', head: 'cat', tail: 'long', stripes: true });
// 特殊原形
const bwrap = (inner) => `<svg viewBox="0 0 200 220" class="char beast" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${shadow(54)}<g class="actor"><g class="bob">${inner}</g></g></svg>`;
C.yx_gu = () => bwrap(`
  <rect x="84" y="176" width="9" height="30" rx="4" fill="#fafafa" ${S2}/><rect x="107" y="176" width="9" height="30" rx="4" fill="#fafafa" ${S2}/>
  <rect x="96" y="120" width="8" height="58" rx="3" fill="#fafafa" ${S2}/>${[0, 1, 2, 3].map(i => `<path d="M${76 + i * 2} ${130 + i * 11} Q100 ${124 + i * 11} ${124 - i * 2} ${130 + i * 11}" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M${76 + i * 2} ${130 + i * 11} Q100 ${124 + i * 11} ${124 - i * 2} ${130 + i * 11}" fill="none" stroke="#fafafa" stroke-width="3.5" stroke-linecap="round"/>`).join('')}
  <path d="M74 130 L58 160 M126 130 L142 160" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M74 130 L58 160 M126 130 L142 160" stroke="#fafafa" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M100 52 C70 52 60 72 62 92 C64 106 74 112 82 114 L84 124 L116 124 L118 114 C126 112 136 106 138 92 C140 72 130 52 100 52 Z" fill="#fafafa" ${S}/>
  <g class="blink" style="transform-origin:100px 88px"><ellipse cx="86" cy="88" rx="9" ry="10" fill="#4a148c"/><ellipse cx="114" cy="88" rx="9" ry="10" fill="#4a148c"/><circle cx="88" cy="85" r="3" fill="#e1bee7"/><circle cx="116" cy="85" r="3" fill="#e1bee7"/></g><g class="ouch"><path d="M78 82 L92 88 L78 94 M122 82 L108 88 L122 94" fill="none" stroke="#3a2618" stroke-width="3.8" stroke-linecap="round"/></g>
  <path d="M98 100 l2 -4 l2 4 Z" fill="${O}"/><path d="M90 114 v8 M96 114 v8 M102 114 v8 M108 114 v8" stroke="${O}" stroke-width="1.6"/>
`);
const tongzi = (robeC, band, brows) => bwrap(`
  ${feet('#5d4037')}
  <path d="M70 134 Q100 124 130 134 L136 198 Q100 206 64 198 Z" fill="${robeC}" ${S}/><path d="M64 170 h72" stroke="${band}" stroke-width="5"/>
  ${hands('#fde0c8', [64, 162], [136, 162])}
  ${head('#fde0c8', 40, 92)}<circle cx="74" cy="56" r="13" fill="#2b2b33" ${S}/><circle cx="126" cy="56" r="13" fill="#2b2b33" ${S}/><path d="M64 88 Q66 58 100 56 Q134 58 136 88 Q118 70 100 72 Q82 70 64 88 Z" fill="#2b2b33" ${S2}/>
  ${brows ? `<path d="M74 82 C82 74 92 76 96 84 M126 82 C118 74 108 76 104 84" fill="none" stroke="#ffd54f" stroke-width="5" stroke-linecap="round"/>` : ''}
  ${eyes(100,94,14,{r:6})}${blush(100,106,24)}<path d="M94 110 Q100 116 106 110" fill="#e57373" ${S2}/>
`);
C.yx_jintong = () => tongzi('#f2b632', '#c62828');
C.yx_yintong = () => tongzi('#b0bec5', '#5b2c83');
C.yx_huangmeitong = () => tongzi('#ffe082', '#8d6e63', true);
C.yx_shancai = () => bwrap(`
  <g class="spin slow" style="transform-origin:100px 90px"><circle cx="100" cy="90" r="64" fill="none" stroke="#f6d36b" stroke-width="3" stroke-dasharray="4 10"/></g>
  <path d="M50 206 Q100 180 150 206 Z" fill="#f48fb1" ${S}/>${[-40, -20, 0, 20, 40].map(a => `<path transform="rotate(${a} 100 206)" d="M100 206 C90 190 94 176 100 170 C106 176 110 190 100 206 Z" fill="#fce4ec" ${S2}/>`).join('')}
  <path d="M72 134 Q100 124 128 134 L132 188 Q100 196 68 188 Z" fill="#fde0c8" ${S}/><path d="M78 136 L122 136 L118 182 L82 182 Z" fill="#e53935" ${S}/>
  <path d="M92 150 L100 132 L108 150 Z" fill="#fde0c8" ${S2}/>
  ${head('#fde0c8', 40, 92)}<path d="M66 70 C60 50 76 40 84 48 C88 34 112 34 116 48 C124 40 140 50 134 70 Q100 56 66 70 Z" fill="#2b2b33" ${S2}/><circle cx="100" cy="40" r="10" fill="#2b2b33" ${S2}/>
  ${happyEyes(100,94,14)}${blush(100,106,24)}<path d="M95 110 Q100 114 105 110" fill="#e57373" ${S2}/>
`);
C.yx_tuo = () => bwrap(`
  <g class="tail" style="transform-origin:60px 170px"><path d="M64 170 C30 176 16 196 6 200 C30 204 50 196 66 186 Z" fill="#7cb342" ${S}/></g>
  <ellipse cx="100" cy="174" rx="52" ry="24" fill="#7cb342" ${S}/>${[0, 1, 2, 3].map(i => `<path d="M${72 + i * 16} 154 l6 -8 l6 8" fill="#558b2f" ${S2}/>`).join('')}
  <path d="M60 190 l-6 16 h14 Z M86 194 l-4 14 h14 Z M116 194 l-2 14 h14 Z M140 190 l2 16 h14 Z" fill="#689f38" ${S2}/>
  <path d="M140 160 C170 156 196 164 196 176 C196 186 170 188 140 186 Z" fill="#7cb342" ${S}/><path d="M146 176 L194 176" stroke="#33691e" stroke-width="2"/>${[0, 1, 2, 3].map(i => `<path d="M${152 + i * 10} 176 l3 5 l3 -5" fill="#fff" stroke="${O}" stroke-width="1.2"/>`).join('')}
  ${slitEyes(150,156,.01,'#ffeb3b')}
`);
C.yx_jinyu = () => bwrap(`
  <g class="tail" style="transform-origin:60px 130px"><path d="M64 130 C30 96 14 110 20 130 C14 150 30 164 64 130 Z" fill="#ff7043" ${S}/><path d="M60 130 L24 112 M60 130 L22 132 M60 130 L26 150" stroke="#e64a19" stroke-width="2"/></g>
  <ellipse cx="108" cy="130" rx="50" ry="40" fill="#ff8a65" ${S}/><path d="M96 94 C104 72 124 74 126 94 Z" fill="#ffab91" ${S2}/><path d="M104 168 C110 186 126 186 126 168 Z" fill="#ffab91" ${S2}/>
  ${[0, 1, 2].map(r => [0, 1, 2].map(c => `<path d="M${84 + c * 14} ${112 + r * 14} q6 6 12 0" fill="none" stroke="#e64a19" stroke-width="1.8"/>`).join('')).join('')}
  <circle cx="140" cy="116" r="14" fill="#fff" ${S2}/><g class="blink" style="transform-origin:142px 116px"><circle cx="143" cy="117" r="7" fill="${O}"/><circle cx="145" cy="114" r="2.5" fill="#fff"/></g><g class="ouch"><path d="M134 110 L150 116 L134 122" fill="none" stroke="#3a2618" stroke-width="3.8" stroke-linecap="round"/></g>
  <ellipse cx="156" cy="138" rx="5" ry="6" fill="#e64a19" ${S2}/>
`);
C.yx_xiezi = () => bwrap(`
  <g class="tail stinger" style="transform-origin:70px 160px"><path d="M70 164 C40 156 30 120 46 96 C56 84 74 90 70 102" fill="none" stroke="${O}" stroke-width="16" stroke-linecap="round"/><path d="M70 164 C40 156 30 120 46 96 C56 84 74 90 70 102" fill="none" stroke="#8d2c1f" stroke-width="10" stroke-linecap="round" stroke-dasharray="10 3"/><path d="M72 104 L60 112 L64 94 Z" fill="#212121" ${S2}/></g>
  ${[0, 1, 2, 3].map(i => `<path d="M${84 + i * 14} 172 l-8 30 M${84 + i * 14} 172 l8 30" stroke="${O}" stroke-width="4" stroke-linecap="round"/>`).join('')}
  <ellipse cx="108" cy="170" rx="44" ry="18" fill="#8d2c1f" ${S}/>${[0, 1, 2, 3].map(i => `<path d="M${80 + i * 16} 158 v24" stroke="#5d1a1a" stroke-width="2"/>`).join('')}
  <path d="M150 164 C166 150 180 150 186 160 L176 166 L186 172 C180 180 166 178 150 172 Z" fill="#8d2c1f" ${S2}/>
  ${eyes(150,160,7,{r:4.5})}
`);
C.yx_jiutou = () => bwrap(`
  <ellipse cx="96" cy="160" rx="44" ry="30" fill="#5e35b1" ${S}/><path d="M60 156 C40 140 40 120 56 116 C60 132 70 140 80 144 Z" fill="#7e57c2" ${S2}/>
  <path d="M84 188 v18 M108 188 v18" stroke="${O}" stroke-width="4"/><path d="M78 206 h12 M102 206 h12" stroke="${O}" stroke-width="4"/>
  ${[[-30, -60], [-10, -72], [12, -74], [32, -64], [48, -48], [-46, -44], [56, -24], [-52, -20], [26, -36]].map(([dx, dy], i) => `<g class="sway" style="transform-origin:110px 140px;animation-delay:${-i * .27}s;animation-duration:${1.6 + (i % 3) * .3}s"><path d="M110 140 Q${110 + dx * .5} ${140 + dy * .6} ${110 + dx} ${140 + dy}" fill="none" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M110 140 Q${110 + dx * .5} ${140 + dy * .6} ${110 + dx} ${140 + dy}" fill="none" stroke="#5e35b1" stroke-width="5" stroke-linecap="round"/><circle cx="${110 + dx}" cy="${136 + dy}" r="9" fill="#7e57c2" ${S2}/><path d="M${116 + dx} ${134 + dy} l9 3 l-9 3 Z" fill="#ffca28" ${S2}/><circle cx="${112 + dx}" cy="${133 + dy}" r="2" fill="${O}"/></g>`).join('')}
`);
C.yx_zhizhu = () => bwrap(`
  ${[0, 1, 2, 3].map(i => `<path d="M100 160 L${50 - i * 2} ${130 + i * 16} L${36 - i * 4} ${178 + i * 8}" fill="none" stroke="${O}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M100 160 L${150 + i * 2} ${130 + i * 16} L${164 + i * 4} ${178 + i * 8}" fill="none" stroke="${O}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
  <ellipse cx="100" cy="176" rx="34" ry="28" fill="#6a1b9a" ${S}/><path d="M86 168 l14 14 l14 -14 M100 182 v14" stroke="#e1bee7" stroke-width="2.5" fill="none"/>
  <circle cx="100" cy="138" r="20" fill="#8e24aa" ${S}/>${eyes(100,134,8,{r:4.5})}
`);
C.yx_wugong = () => bwrap(`
  <g class="tail" style="transform-origin:100px 180px">${Array.from({ length: 8 }, (_, i) => { const x = 30 + i * 18, y = 180 + Math.sin(i) * 8; return `<path d="M${x} ${y} l-6 18 M${x} ${y} l6 18" stroke="${O}" stroke-width="3"/><ellipse cx="${x}" cy="${y}" rx="12" ry="10" fill="${i % 2 ? '#c62828' : '#d84315'}" ${S2}/>`; }).join('')}</g>
  <circle cx="176" cy="170" r="14" fill="#212121" ${S}/><path d="M184 160 C192 150 198 146 200 140 M184 176 C194 182 198 188 200 194" stroke="${O}" stroke-width="3" fill="none"/>${eyes(178,166,5,{r:3.5, iris:'#ffeb3b'})}
`);
C.yx_dapeng = () => bwrap(`
  <g class="wing" style="transform-origin:100px 140px"><path d="M100 140 C60 100 20 96 6 110 C30 116 46 126 60 140 C40 136 24 144 16 156 C44 154 70 156 96 160 Z" fill="#ffb300" ${S}/></g>
  <ellipse cx="110" cy="156" rx="40" ry="26" fill="#ffca28" ${S}/><path d="M74 166 C50 180 40 200 34 206 C56 200 70 190 84 180 Z" fill="#ff8f00" ${S2}/>
  <path d="M104 182 v20 M122 182 v20" stroke="${O}" stroke-width="4"/><path d="M96 204 h16 M114 204 h16" stroke="${O}" stroke-width="4" stroke-linecap="round"/>
  <circle cx="150" cy="122" r="22" fill="#ffca28" ${S}/><path d="M166 116 C184 116 192 128 184 138 C178 132 172 130 166 130 Z" fill="#fff3e0" ${S}/>${eyes(152,118,.01,{r:5.5, iris:'#ff5722'})}
`);

// 练功木人桩 / 宝箱
C.dummy = () => bwrap(`
  <rect x="94" y="60" width="12" height="150" rx="4" fill="#8d6e63" ${S}/>
  <path d="M60 120 h80" stroke="${O}" stroke-width="12" stroke-linecap="round"/><path d="M60 120 h80" stroke="#a1887f" stroke-width="7" stroke-linecap="round"/>
  <path d="M74 150 h52" stroke="${O}" stroke-width="12" stroke-linecap="round"/><path d="M74 150 h52" stroke="#a1887f" stroke-width="7" stroke-linecap="round"/>
  <ellipse cx="100" cy="70" rx="30" ry="34" fill="#bcaaa4" ${S}/><path d="M76 60 q24 -6 48 0" stroke="#8d6e63" stroke-width="2" fill="none"/>
  ${eyes(100,70,11,{r:5})}<path d="M92 86 q8 6 16 0" fill="none" ${S2}/>
  <path d="M80 210 l20 -14 l20 14" fill="none" stroke="${O}" stroke-width="5"/>
`);
C.chest = () => bwrap(`
  <rect x="44" y="126" width="112" height="78" rx="8" fill="#a1563a" ${S}/><path d="M44 148 h112" stroke="#f2b632" stroke-width="5"/><path d="M60 126 v78 M140 126 v78" stroke="#f2b632" stroke-width="5"/>
  <g class="lid" style="transform-origin:44px 126px"><path d="M42 128 Q42 88 100 88 Q158 88 158 128 Z" fill="#c0703c" ${S}/><path d="M60 94 v34 M140 94 v34" stroke="#f2b632" stroke-width="5"/></g>
  <g class="glow" style="opacity:0"><ellipse cx="100" cy="122" rx="54" ry="14" fill="#fff59d"/></g>
  <g class="lock"><path d="M89 140 v-12 a11 11 0 0 1 22 0 v12" fill="none" stroke="${O}" stroke-width="7"/><path d="M89 140 v-12 a11 11 0 0 1 22 0 v12" fill="none" stroke="#bdbdbd" stroke-width="3.5"/>
    <rect x="82" y="138" width="36" height="32" rx="6" fill="#f2c94c" ${S}/><circle cx="100" cy="151" r="4" fill="${O}"/><path d="M100 153 v8" stroke="${O}" stroke-width="3.4"/>
    <path class="ck ck1" d="M86 140 l8 8 l-3 6" fill="none" stroke="${O}" stroke-width="2.4" opacity="0"/>
    <path class="ck ck2" d="M114 142 l-6 7 l4 6 l-5 6" fill="none" stroke="${O}" stroke-width="2.4" opacity="0"/>
    <path class="ck ck3" d="M84 160 l9 -3 l5 6 l7 -4" fill="none" stroke="${O}" stroke-width="2.4" opacity="0"/>
    <path class="ck ck4" d="M100 138 l-2 9 l5 5 l-4 8 l4 10" fill="none" stroke="${O}" stroke-width="2.6" opacity="0"/></g>
  <g class="ouch"></g>
  <g class="sparkle"><path d="M30 92 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z M166 82 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z" fill="#fff59d"/></g>
`);
// ================= 路上的小怪（第三批） =================
const club = () => `<rect x="-4" y="-40" width="8" height="40" rx="3" fill="#8d6e63" ${S2}/><path d="M-8 -40 C-14 -80 -10 -110 0 -116 C10 -110 14 -80 8 -40 Z" fill="#a1887f" ${S}/><path d="M-6 -70 l-6 -2 M6 -84 l6 -2 M-4 -98 l-6 -2" stroke="${O}" stroke-width="3"/>`;
// 野猪精：獠牙、木棒
C.yezhu = () => mon({
  w: hold(150, 166, 12, club()),
  feet: '#4e342e',
  body: robe('#795548', `<path d="M70 132 L100 150 L130 132" fill="none" stroke="#d7ccc8" stroke-width="4"/><rect x="62" y="166" width="76" height="8" rx="4" fill="#3e2723"/>`),
  hands: hands('#8d6e63'),
  head: `<path d="M62 54 L56 30 L78 46 Z M138 54 L144 30 L122 46 Z" fill="#6d4c41" ${S}/><ellipse cx="100" cy="84" rx="50" ry="44" fill="#8d6e63" ${S}/>
  <path d="M74 50 q26 -14 52 0" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
  <ellipse cx="100" cy="104" rx="22" ry="15" fill="#bcaaa4" ${S}/><ellipse cx="92" cy="104" rx="4" ry="5" fill="${O}"/><ellipse cx="108" cy="104" rx="4" ry="5" fill="${O}"/>
  <path d="M78 110 C70 100 68 90 74 84 C76 94 80 100 86 104 Z M122 110 C130 100 132 90 126 84 C124 94 120 100 114 104 Z" fill="#fffde7" ${S2}/>
  <path d="M72 72 l16 4 M128 72 l-16 4" stroke="${O}" stroke-width="4" stroke-linecap="round"/>${eyes(100,82,18,{r:6, iris:'#ffcc80'})}${mo(100,122,9,5)}`,
});
// 狐狸精：尖耳、三条尾巴、狐火
C.hujing = () => mon({
  back: [0, 1, 2].map(i => `<g class="tail" style="transform-origin:110px 176px;animation-delay:${-i * .5}s"><path d="M110 176 C${150 + i * 10} ${170 - i * 20} ${170 + i * 6} ${130 - i * 18} ${150 + i * 4} ${110 - i * 16} C${150} ${140 - i * 10} ${140} ${160 - i * 6} 110 176 Z" fill="#ff9800" ${S}/><path d="M${150 + i * 4} ${110 - i * 16} C${158 + i * 4} ${120 - i * 14} ${160 + i * 4} ${128 - i * 14} ${156 + i * 4} ${134 - i * 14}" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/></g>`).join(''),
  feet: '#5d4037',
  body: robe('#f48fb1', `<path d="M70 132 Q100 150 130 132" fill="none" stroke="#fff" stroke-width="3"/>`),
  hands: hands('#fbe3d0'),
  head: `<path d="M62 60 L52 14 L86 44 Z M138 60 L148 14 L114 44 Z" fill="#ff9800" ${S}/><path d="M64 50 L58 26 L76 42 Z M136 50 L142 26 L124 42 Z" fill="#fff3e0"/>
  <path d="M100 40 C66 40 54 62 56 86 C58 106 72 118 86 122 L100 134 L114 122 C128 118 142 106 144 86 C146 62 134 40 100 40 Z" fill="#ff9800" ${S}/>
  <path d="M68 94 C74 116 90 128 100 134 C110 128 126 116 132 94 C120 102 110 106 100 106 C90 106 80 102 68 94 Z" fill="#fff3e0" ${S2}/>
  <ellipse cx="100" cy="112" rx="6" ry="4" fill="${O}"/>${slitEyes(100,84,18,'#ffeb3b')}<path d="M94 122 Q100 126 106 122" fill="none" ${S2}/>
  <g class="spin" style="transform-origin:46px 150px"><circle cx="46" cy="132" r="7" fill="#80d8ff" opacity=".85"/></g>`,
});
// 蝙蝠精：大耳、翅膀、獠牙
C.bianfu = () => mon({
  back: `<g class="wing" style="transform-origin:72px 130px"><path d="M72 130 C40 90 8 100 4 124 C18 118 26 126 26 136 C36 128 46 132 48 144 C56 136 66 140 72 150 Z" fill="#5e35b1" ${S}/></g><g class="wing" style="transform-origin:128px 130px;animation-delay:-.3s"><path d="M128 130 C160 90 192 100 196 124 C182 118 174 126 174 136 C164 128 154 132 152 144 C144 136 134 140 128 150 Z" fill="#5e35b1" ${S}/></g>`,
  feet: '#311b92',
  body: robe('#4527a0', `<path d="M62 172 h76" stroke="#b39ddb" stroke-width="4"/>`),
  hands: hands('#9575cd'),
  head: `<path d="M60 70 L46 14 L84 50 Z M140 70 L154 14 L116 50 Z" fill="#7e57c2" ${S}/><path d="M62 58 L54 28 L76 50 Z M138 58 L146 28 L124 50 Z" fill="#f8bbd0"/>
  <circle cx="100" cy="88" r="42" fill="#7e57c2" ${S}/><ellipse cx="100" cy="102" rx="9" ry="6" fill="#4a148c"/>
  ${eyes(100,84,16,{r:7, iris:'#ff5252'})}<path d="M86 112 Q100 120 114 112" fill="none" ${S2}/><path d="M90 113 l3 7 l3 -6 M104 114 l3 6 l3 -7" fill="#fff" stroke="${O}" stroke-width="1.4"/>${mo(100,116,10,7,'#4a148c')}`,
});
// 蛤蟆精：大嘴、疙瘩、长舌头
C.hama = () => mon({
  w: hold(152, 166, 6, W.trident().replace(/#5d6d7e/g, '#6d4c41')),
  feet: '#558b2f',
  body: `<ellipse cx="100" cy="168" rx="46" ry="38" fill="#7cb342" ${S}/><ellipse cx="100" cy="174" rx="30" ry="26" fill="#f0f4c3" ${S2}/>`,
  hands: hands('#8bc34a', [56, 162], [152, 166]),
  head: `<circle cx="72" cy="52" r="16" fill="#8bc34a" ${S}/><circle cx="128" cy="52" r="16" fill="#8bc34a" ${S}/>
  <ellipse cx="100" cy="94" rx="58" ry="40" fill="#8bc34a" ${S}/>${[[70, 82], [130, 80], [84, 110], [118, 112], [100, 72]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="#689f38"/>`).join('')}
  <g class="blink" style="transform-origin:100px 52px"><circle cx="72" cy="52" r="8" fill="${O}"/><circle cx="128" cy="52" r="8" fill="${O}"/><circle cx="75" cy="49" r="3" fill="#fff"/><circle cx="131" cy="49" r="3" fill="#fff"/></g><g class="ouch"><path d="M64 46 L80 52 L64 58 M136 46 L120 52 L136 58" fill="none" stroke="${O}" stroke-width="3.8" stroke-linecap="round"/></g>
  <path d="M56 100 Q100 124 144 100" fill="none" ${S}/>${mo(100,110,34,12,'#c62828')}`,
});
// 石头精：岩块身体、发光的眼睛
C.shitou = () => mon({
  feet: '#616161',
  body: `<path d="M56 130 L80 118 L122 120 L146 136 L150 196 L118 208 L78 206 L50 192 Z" fill="#9e9e9e" ${S}/><path d="M70 150 l20 6 l10 -10 M110 170 l18 4 M66 182 l14 -6" stroke="#616161" stroke-width="3" fill="none"/><path d="M90 140 l6 10 l-4 10" stroke="#ffb74d" stroke-width="3" fill="none"/>`,
  hands: `<path d="M38 150 L56 140 L62 166 L44 172 Z" fill="#8d8d8d" ${S}/><path d="M162 150 L144 140 L138 166 L156 172 Z" fill="#8d8d8d" ${S}/>`,
  head: `<path d="M58 70 L70 40 L104 32 L136 44 L146 76 L134 112 L100 122 L66 112 Z" fill="#bdbdbd" ${S}/><path d="M80 44 l10 14 M120 50 l-6 12 M70 92 l12 -4" stroke="#757575" stroke-width="3"/>
  <g class="blink" style="transform-origin:100px 80px"><path d="M74 76 L92 80 L76 88 Z M126 76 L108 80 L124 88 Z" fill="#ff9800" style="filter:drop-shadow(0 0 4px #ffeb3b)"/></g><g class="ouch"><path d="M70 74 L86 80 L70 86 M130 74 L114 80 L130 86" fill="none" stroke="${O}" stroke-width="3.8" stroke-linecap="round"/></g>
  <path d="M86 102 h28" stroke="${O}" stroke-width="4" stroke-linecap="round"/>`,
  sw: 66,
});
// 树精：树干身体、树冠头发、枝条手臂
C.shujing = () => mon({
  feet: '#4e342e',
  back: `<g class="sway" style="transform-origin:100px 80px">${[[64, 50, 30], [100, 34, 34], [136, 50, 30], [80, 76, 26], [122, 76, 26]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#43a047" ${S}/>`).join('')}<circle cx="74" cy="40" r="4" fill="#e53935"/><circle cx="128" cy="44" r="4" fill="#e53935"/></g>`,
  body: `<path d="M70 130 Q100 120 130 130 L136 204 Q100 212 64 204 Z" fill="#8d6e63" ${S}/><path d="M84 140 q6 20 0 40 M112 146 q-6 18 0 36" stroke="#5d4037" stroke-width="3" fill="none"/>`,
  hands: `<path d="M70 146 C50 140 40 150 34 136 M42 142 l-8 -10" fill="none" stroke="${O}" stroke-width="10" stroke-linecap="round"/><path d="M70 146 C50 140 40 150 34 136 M42 142 l-8 -10" fill="none" stroke="#8d6e63" stroke-width="6" stroke-linecap="round"/><path d="M130 146 C150 140 160 150 166 136 M158 142 l8 -10" fill="none" stroke="${O}" stroke-width="10" stroke-linecap="round"/><path d="M130 146 C150 140 160 150 166 136 M158 142 l8 -10" fill="none" stroke="#8d6e63" stroke-width="6" stroke-linecap="round"/>`,
  head: `<ellipse cx="100" cy="98" rx="34" ry="30" fill="#a1887f" ${S}/><path d="M78 90 q4 -4 8 0 M114 90 q4 -4 8 0" stroke="#6d4c41" stroke-width="2" fill="none"/>${eyes(100,96,13,{r:5.5})}${mo(100,114,8,6,'#4e342e')}<path d="M92 112 Q100 116 108 112" fill="none" ${S2}/>`,
});

window.QJ_CHARS = C;
window.QJ_WEAPONS = W;
})();

/* 取经小英雄 · 战斗特效引擎（Web Animations） */
(function(){
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
function an(el, kf, dur, o = {}) {
  if (!el) return Promise.resolve();
  const a = el.animate(kf, Object.assign({ duration: dur, easing: 'ease-out', fill: 'forwards' }, o));
  return a.finished.then(() => a).catch(() => a);
}
function clear(...els) { els.forEach(e => e && e.getAnimations().forEach(a => { if (!(window.CSSAnimation && a instanceof CSSAnimation)) a.cancel(); })); }

class Fighter {
  constructor(slot) { this.slot = slot; this.mover = slot.querySelector('.mover'); this.flip = slot.querySelector('.flip'); }
  get svg() { return this.slot.querySelector('svg'); }
  get weapon() { return this.svg && this.svg.querySelector('.weapon'); }
  get weapons() { return this.svg ? [...this.svg.querySelectorAll('.weapon')] : []; }
  get actor() { return this.svg && this.svg.querySelector('.actor'); }
  get mirrored() { return this.slot.classList.contains('R'); }
  get dir() { return this.mirrored ? -1 : 1; }
  part(sel) { return this.svg && this.svg.querySelector(sel); }
  parts(sel) { return this.svg ? [...this.svg.querySelectorAll(sel)] : []; }
  mouth(ms = 600) { const v = this.svg; if (!v) return; v.classList.add('mouthy'); setTimeout(() => v.classList.remove('mouthy'), ms); }
  // 归位：把角色搬进全新的容器，彻底甩掉任何残留的位移（iPad Safari 偶尔会留住动画终点）
  fresh() {
    const m = document.createElement('div'), fl = document.createElement('div'); m.className = 'mover'; fl.className = 'flip';
    while (this.flip.firstChild) fl.appendChild(this.flip.firstChild);
    m.appendChild(fl); this.mover.replaceWith(m); this.mover = m; this.flip = fl; this._t = null;
    if (this.svg) this.svg.querySelectorAll('.weapon,.actor').forEach(el => { el.getAnimations().forEach(a => { if (!(window.CSSAnimation && a instanceof CSSAnimation)) a.cancel(); }); el.style.transform = ''; el._r = 0; });
  }
  reset() { if (this.mover) this.mover.style.transform = ''; this._t = null; clear(this.mover, this.flip, this.actor, ...this.weapons, ...(this.svg ? this.svg.querySelectorAll('.tail,.dog,.tower,.eye3,.bag,.sleeveR,.palm,.trunk,.wing,.cymbal,.sway,.robe-eyes,.gourd,.zhuo,.bells') : [])); }
}

class Arena {
  constructor(root) {
    this.root = root; this.fxl = root.querySelector('.fx');
    this.L = new Fighter(root.querySelector('.slot.L')); this.R = new Fighter(root.querySelector('.slot.R'));
  }
  get s() { return this.L.slot.getBoundingClientRect().width / 200; }
  pt(f, x, y, live) {
    const r = (live ? f.mover : f.slot).getBoundingClientRect(), b = this.root.getBoundingClientRect();
    const sx = r.width / 200, sy = r.height / 220, vx = f.mirrored ? 200 - x : x;
    return { x: r.left - b.left + vx * sx, y: r.top - b.top + y * sy };
  }
  gap(A, D) { return this.pt(D, 100, 100).x - this.pt(A, 100, 100).x; }
  get W() { return this.root.clientWidth; } get H() { return this.root.clientHeight; }
  get ground() { return this.pt(this.L, 100, 212).y; }

  caption(t) { const el = this.root.querySelector('.capbar'); if (!el) return; el.textContent = t || ''; el.classList.toggle('on', !!t); }
  // ---------- 基础 ----------
  spawn(html, x, y, w, h, cls = '') {
    const d = document.createElement('div'); d.className = 'fxo ' + cls;
    d.style.cssText = `left:${x - w / 2}px;top:${y - h / 2}px;width:${w}px;height:${h}px`;
    d.innerHTML = html; this.fxl.appendChild(d); return d;
  }
  async life(d, p) { await p; d.remove(); }
  shake(amp = 8, dur = 380) {
    const k = []; for (let i = 0; i < 8; i++) k.push({ transform: `translate(${rnd(-amp, amp)}px,${rnd(-amp, amp) * .6}px)` });
    k.push({ transform: 'none' });
    return an(this.root, k, dur, { fill: 'none', easing: 'linear' });
  }
  flash(color = '#fff', dur = 260, peak = .85) {
    const d = this.spawn('', this.W / 2, this.H / 2, this.W, this.H, 'flash'); d.style.background = color;
    return this.life(d, an(d, [{ opacity: 0 }, { opacity: peak, offset: .15 }, { opacity: 0 }], dur));
  }
  pop(x, y, text, o = {}) {
    const size = (o.size || 30) * Math.max(.75, this.s);
    const d = this.spawn(`<span style="font-size:${size}px;color:${o.color || '#fff'};-webkit-text-stroke:${Math.max(3, size / 7)}px ${o.stroke || '#3a2618'}">${text}</span>`, x, y, 260, size * 1.6, 'popt');
    return this.life(d, an(d, [{ transform: 'translateY(10px) scale(.3) rotate(-8deg)', opacity: 0 }, { transform: 'translateY(-14px) scale(1.25) rotate(3deg)', opacity: 1, offset: .25 }, { transform: 'translateY(-26px) scale(1)', opacity: 1, offset: .7 }, { transform: 'translateY(-44px) scale(.9)', opacity: 0 }], o.dur || 900, { easing: 'cubic-bezier(.2,1.4,.4,1)' }));
  }
  burst(x, y, o = {}) {
    const R = (o.size || 90) * this.s, n = o.points || 10;
    let p = ''; for (let i = 0; i < n * 2; i++) { const a = Math.PI * i / n, r = i % 2 ? 0.42 : 1; p += `${50 + Math.cos(a) * 48 * r},${50 + Math.sin(a) * 48 * r} `; }
    const d = this.spawn(`<svg viewBox="0 0 100 100"><polygon points="${p}" fill="${o.color || '#fff59d'}" stroke="${o.stroke || '#ff9800'}" stroke-width="4" stroke-linejoin="round"/><circle cx="50" cy="50" r="14" fill="#fff"/></svg>`, x, y, R, R);
    return this.life(d, an(d, [{ transform: 'scale(.2) rotate(0deg)', opacity: 1 }, { transform: 'scale(1.15) rotate(25deg)', opacity: 1, offset: .35 }, { transform: 'scale(1.35) rotate(40deg)', opacity: 0 }], o.dur || 420));
  }
  ring(x, y, o = {}) {
    const R = (o.r || 50) * 2 * this.s;
    const d = this.spawn(`<svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="46" ry="${46 * (o.squash || 1)}" fill="none" stroke="${o.color || '#fff'}" stroke-width="${o.width || 6}"/></svg>`, x, y, R, R);
    return this.life(d, an(d, [{ transform: `scale(${o.from || .2})`, opacity: 1 }, { transform: `scale(${o.to || 2})`, opacity: 0 }], o.dur || 500, { delay: o.delay || 0 }));
  }
  particles(x, y, o = {}) {
    const n = o.n || 12, ps = [];
    for (let i = 0; i < n; i++) {
      const kind = o.kind || 'dot', c = Array.isArray(o.color) ? o.color[i % o.color.length] : (o.color || '#fff');
      const sz = (o.size || 12) * this.s * rnd(.7, 1.3);
      let shape;
      if (kind === 'dot') shape = `<circle cx="50" cy="50" r="40" fill="${c}" stroke="#3a2618" stroke-width="8"/>`;
      else if (kind === 'drop') shape = `<path d="M50 6 C70 40 86 58 86 70 A36 36 0 0 1 14 70 C14 58 30 40 50 6 Z" fill="${c}" stroke="#2b5d8a" stroke-width="7"/>`;
      else if (kind === 'spark') shape = `<path d="M50 0 L60 40 L100 50 L60 60 L50 100 L40 60 L0 50 L40 40 Z" fill="${c}"/>`;
      else if (kind === 'rock') shape = `<polygon points="20,30 60,10 90,40 80,80 30,90 10,60" fill="${c}" stroke="#3a2618" stroke-width="8"/>`;
      else if (kind === 'bubble') shape = `<circle cx="50" cy="50" r="40" fill="rgba(180,230,255,.35)" stroke="#6ec6ff" stroke-width="7"/><circle cx="36" cy="34" r="10" fill="#fff"/>`;
      else if (kind === 'leaf') shape = `<path d="M10 90 C10 40 40 10 90 10 C90 60 60 90 10 90 Z" fill="${c}" stroke="#3a2618" stroke-width="6"/>`;
      else if (kind === 'smoke') shape = `<circle cx="50" cy="50" r="44" fill="${c}" opacity=".75"/>`;
      else if (kind === 'text') shape = `<text x="50" y="72" text-anchor="middle" font-size="70" font-weight="900" fill="${c}" stroke="#3a2618" stroke-width="5" paint-order="stroke" font-family="sans-serif">${o.texts[i % o.texts.length]}</text>`;
      const d = this.spawn(`<svg viewBox="0 0 100 100" overflow="visible">${shape}</svg>`, x, y, sz, sz);
      const ang = (o.angle != null ? o.angle : -90) * Math.PI / 180 + rnd(-1, 1) * (o.spread || Math.PI);
      const sp = (o.speed || 90) * this.s * rnd(.5, 1.2), gx = Math.cos(ang) * sp, gy = Math.sin(ang) * sp, g = (o.gravity == null ? 120 : o.gravity) * this.s;
      const dur = (o.dur || 700) * rnd(.8, 1.2), rot = rnd(-360, 360) * (o.spin == null ? 1 : o.spin);
      ps.push(this.life(d, an(d, [
        { transform: 'translate(0,0) scale(.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(${gx * .6}px,${gy * .6 + g * .1}px) scale(1) rotate(${rot * .5}deg)`, opacity: 1, offset: .45 },
        { transform: `translate(${gx}px,${gy + g}px) scale(.7) rotate(${rot}deg)`, opacity: 0 }], dur, { easing: 'cubic-bezier(.2,.7,.4,1)', delay: (o.stagger || 0) * i })));
    }
    return Promise.all(ps);
  }
  slash(x, y, o = {}) {
    const R = (o.r || 70) * this.s, w = o.width || 14, a0 = (o.from ?? -70) * Math.PI / 180, a1 = (o.to ?? 70) * Math.PI / 180;
    const P = a => `${100 + Math.cos(a) * 80},${100 + Math.sin(a) * 80}`;
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
    const path = `M${P(a0)} A80 80 0 ${large} ${sweep} ${P(a1)}`;
    const d = this.spawn(`<svg viewBox="0 0 200 200" overflow="visible" style="transform:rotate(${o.rot || 0}deg)"><path d="${path}" fill="none" stroke="${o.color || '#fff59d'}" stroke-width="${w}" stroke-linecap="round" pathLength="100" stroke-dasharray="100" class="sl"/><path d="${path}" fill="none" stroke="#fff" stroke-width="${w * .35}" stroke-linecap="round" pathLength="100" stroke-dasharray="100" class="sl"/></svg>`, x, y, R * 2, R * 2);
    d.querySelectorAll('.sl').forEach(p => an(p, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], o.dur || 180));
    return this.life(d, an(d, [{ opacity: 1 }, { opacity: 1, offset: .55 }, { opacity: 0, transform: 'scale(1.12)' }], (o.dur || 180) + 280));
  }
  line(x1, y1, x2, y2, o = {}) {
    const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI, w = (o.width || 10) * this.s;
    const d = this.spawn(`<div style="width:100%;height:100%;border-radius:${w}px;background:${o.color || '#fff'};box-shadow:0 0 ${w * 1.6}px ${o.glow || o.color || '#fff'}"></div>`, x1, y1, len, w);
    d.style.left = x1 + 'px'; d.style.top = (y1 - w / 2) + 'px'; d.style.transformOrigin = '0 50%';
    return this.life(d, an(d, [{ transform: `rotate(${ang}deg) scaleX(0)`, opacity: 1 }, { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 1, offset: .3 }, { transform: `rotate(${ang}deg) scaleX(1) scaleY(.2)`, opacity: 0 }], o.dur || 500));
  }
  async proj(html, from, to, o = {}) {
    const sz = (o.size || 50) * this.s, d = this.spawn(html, from.x, from.y, sz, sz, 'proj');
    const dx = to.x - from.x, dy = to.y - from.y, arc = (o.arc || 0) * this.s, spin = o.spin || 0;
    await an(d, [{ transform: 'translate(0,0) rotate(0deg) scale(.6)' }, { transform: `translate(${dx / 2}px,${dy / 2 - arc}px) rotate(${spin / 2}deg) scale(1)` }, { transform: `translate(${dx}px,${dy}px) rotate(${spin}deg) scale(1)` }], o.dur || 420, { easing: o.ease || 'linear' });
    if (o.back) { await an(d, [{ transform: `translate(${dx}px,${dy}px) rotate(${spin}deg)` }, { transform: `translate(${dx * .3}px,${dy * .3 - arc}px) rotate(${spin * 1.5}deg)`, opacity: 1 }, { transform: `translate(0,0) rotate(${spin * 2}deg)`, opacity: 0 }], o.dur || 420, { easing: 'ease-in' }); }
    if (!o.keep) d.remove();
    return d;
  }
  speed(x, y, dir, o = {}) {
    const ps = []; for (let i = 0; i < (o.n || 6); i++) ps.push(this.line(x - dir * rnd(10, 60) * this.s, y + rnd(-50, 50) * this.s, x - dir * rnd(90, 170) * this.s, y + rnd(-50, 50) * this.s, { width: 4, color: o.color || 'rgba(255,255,255,.9)', dur: 300 }));
    return Promise.all(ps);
  }
  claw(x, y, o = {}) { const ps = []; for (let i = -1; i <= 1; i++) ps.push(this.slash(x + i * 16 * this.s, y, { r: 50, from: -140, to: -40, rot: 30, width: 9, color: o.color || '#ff5252', dur: 140 })); return Promise.all(ps); }
  crack(x, y) {
    const w = 160 * this.s;
    const d = this.spawn(`<svg viewBox="0 0 160 40" overflow="visible"><path d="M80 20 L60 10 L40 22 L18 12 L2 20 M80 20 L100 30 L122 16 L140 26 L158 18 M60 10 L56 0 M122 16 L128 2" fill="none" stroke="#3a2618" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`, x, y, w, w / 4);
    this.particles(x, y - 6 * this.s, { kind: 'rock', color: ['#a1887f', '#8d6e63', '#bcaaa4'], n: 9, spread: .9, speed: 110, gravity: 160, size: 14 });
    return this.life(d, an(d, [{ opacity: 1, transform: 'scaleX(.2)' }, { opacity: 1, transform: 'scaleX(1)', offset: .2 }, { opacity: 1, offset: .8 }, { opacity: 0 }], 900));
  }
  dust(x, y, n = 8) { return this.particles(x, y, { kind: 'smoke', color: ['#e0d6c8', '#d7ccc8', '#efebe9'], n, spread: 1.2, angle: -90, speed: 60, gravity: -10, size: 34, spin: 0, dur: 650 }); }
  async tornado(from, to, o = {}) {
    const sz = 110 * this.s, c = o.color || '#d7b46a';
    const d = this.spawn(`<svg viewBox="0 0 100 120" overflow="visible">${[0, 1, 2, 3, 4].map(i => `<ellipse cx="50" cy="${16 + i * 22}" rx="${46 - i * 8}" ry="${9 - i}" fill="none" stroke="${c}" stroke-width="6" stroke-dasharray="40 14"><animateTransform attributeName="transform" type="rotate" from="0 50 ${16 + i * 22}" to="${i % 2 ? -360 : 360} 50 ${16 + i * 22}" dur="${.5 + i * .08}s" repeatCount="indefinite"/></ellipse>`).join('')}</svg>`, from.x, from.y, sz, sz * 1.2);
    const pp = this.particles(from.x, from.y, { kind: 'leaf', color: ['#c0ca33', '#8d6e63', '#ffb300'], n: 10, speed: 70, spread: 3.1, dur: 900, stagger: 40, size: 12 });
    await an(d, [{ transform: 'translate(0,0) scale(.3)', opacity: .2 }, { transform: `translate(${(to.x - from.x) * .3}px,${(to.y - from.y) * .3}px) scale(1)`, opacity: 1, offset: .25 }, { transform: `translate(${to.x - from.x}px,${to.y - from.y}px) scale(1.15)`, opacity: 1 }], o.dur || 650, { easing: 'ease-in' });
    this.life(d, an(d, [{ opacity: 1 }, { opacity: 0, transform: `translate(${to.x - from.x}px,${to.y - from.y}px) scale(1.6)` }], 380));
    return pp;
  }
  async bolt(x, yHit, o = {}) {
    const h = yHit + 10, w = 70 * this.s;
    let p = `M35 0`; let cx = 35; for (let y = 20; y < h; y += 26 * this.s) { cx = 35 + rnd(-22, 22); p += ` L${cx} ${y}`; } p += ` L35 ${h}`;
    const d = this.spawn(`<svg viewBox="0 0 70 ${h}" width="${w}" height="${h}" overflow="visible" preserveAspectRatio="none"><path d="${p}" fill="none" stroke="#fff59d" stroke-width="14" stroke-linejoin="round" opacity=".6"/><path d="${p}" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg>`, x, h / 2, w, h);
    this.flash('#fff59d', 200, .7);
    an(d, [{ opacity: 0 }, { opacity: 1, offset: .1 }, { opacity: .3, offset: .3 }, { opacity: 1, offset: .45 }, { opacity: 0 }], 420);
    await sleep(80); this.life(d, sleep(420));
    this.particles(x, yHit, { kind: 'spark', color: ['#fff59d', '#ffeb3b', '#fff'], n: 12, speed: 120, spread: 3.1, size: 16, gravity: 30 });
  }
  async wave(from, to, o = {}) {
    const w = 170 * this.s, h = 150 * this.s, flip = to.x < from.x ? -1 : 1;
    const d = this.spawn(`<svg viewBox="0 0 170 150" overflow="visible" style="transform:scaleX(${flip})"><path d="M0 150 L0 80 C20 30 70 0 120 20 C150 32 160 60 140 70 C125 76 112 62 120 52 C100 48 90 70 104 90 C120 110 160 100 170 90 L170 150 Z" fill="#4fc3f7" stroke="#0277bd" stroke-width="5"/><path d="M14 92 C40 60 70 52 92 60" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>`, from.x, to.y, w, h);
    const pp = this.particles(to.x, to.y, { kind: 'drop', color: '#81d4fa', n: 14, speed: 120, spread: 1.4, delay: 300, size: 14 });
    await an(d, [{ transform: 'translateX(0) scale(.3)', opacity: .3 }, { transform: `translateX(${(to.x - from.x) * .5}px) scale(1)`, opacity: 1, offset: .4 }, { transform: `translateX(${to.x - from.x}px) scale(1.2)`, opacity: 1 }], o.dur || 600, { easing: 'ease-in' });
    this.particles(to.x, to.y, { kind: 'drop', color: '#81d4fa', n: 16, speed: 140, spread: 1.6, size: 15 });
    this.life(d, an(d, [{ opacity: 1 }, { opacity: 0, transform: `translateX(${to.x - from.x + flip * 60}px) scale(1.4,.4)` }], 400));
    return pp;
  }
  pillar(x, yBottom, o = {}) {
    const w = (o.w || 90) * this.s;
    const d = this.spawn(`<div style="width:100%;height:100%;background:linear-gradient(90deg,transparent,${o.color || '#fff59d'} 30%,#fff 50%,${o.color || '#fff59d'} 70%,transparent);border-radius:0 0 50% 50%/0 0 20px 20px"></div>`, x, yBottom / 2, w, yBottom);
    d.style.transformOrigin = '50% 0';
    return this.life(d, an(d, [{ transform: 'scaleY(0)', opacity: 1 }, { transform: 'scaleY(1)', opacity: 1, offset: .3 }, { transform: 'scaleY(1) scaleX(1.4)', opacity: 0 }], o.dur || 700));
  }
  async drop(html, x, yTo, o = {}) {
    const sz = (o.size || 140) * this.s, d = this.spawn(html, x, yTo - sz / 2, sz, sz, 'proj');
    await an(d, [{ transform: `translateY(${-yTo - sz}px)` }, { transform: 'translateY(0)' }], o.dur || 380, { easing: 'cubic-bezier(.6,0,.9,.4)' });
    return d;
  }
  afterimage(f, n = 3) {
    const src = f.svg; if (!src) return;
    const r = f.mover.getBoundingClientRect(), b = this.root.getBoundingClientRect();
    for (let i = 0; i < n; i++) setTimeout(() => {
      const rr = f.mover.getBoundingClientRect();
      const d = this.spawn(src.outerHTML, rr.left - b.left + rr.width / 2, rr.top - b.top + rr.height / 2, rr.width, rr.height, 'ghost' + (f.mirrored ? ' mir' : ''));
      this.life(d, an(d, [{ opacity: .45 }, { opacity: 0 }], 380));
    }, i * 70);
  }
  stars(f, dur = 1300) {
    const p = this.pt(f, 100, 34, true), R = 34 * this.s;
    const d = this.spawn(`<svg viewBox="-50 -20 100 40" overflow="visible">${[0, 1, 2].map(i => `<g><animateTransform attributeName="transform" type="rotate" from="${i * 120} 0 0" to="${i * 120 + 360} 0 0" dur=".9s" repeatCount="indefinite"/><path transform="translate(40 0) scale(1 1)" d="M0 -9 L3 -3 L9 -2 L4 2 L6 9 L0 5 L-6 9 L-4 2 L-9 -2 L-3 -3 Z" fill="#ffeb3b" stroke="#3a2618" stroke-width="2"/></g>`).join('')}</svg>`, p.x, p.y, R * 2.6, R);
    d.firstChild.style.transform = 'scaleY(.45)';
    return this.life(d, sleep(dur));
  }
  question(f) { const p = this.pt(f, 100, 20, true); return this.particles(p.x, p.y, { kind: 'text', texts: ['?', '?', '？'], color: '#fff', n: 3, angle: -90, spread: .8, speed: 60, gravity: -20, size: 34, spin: .1, dur: 1100, stagger: 120 }); }
  sweat(f) { const p = this.pt(f, 100, 50, true); return this.particles(p.x, p.y, { kind: 'drop', color: '#b3e5fc', n: 6, angle: -90, spread: 1.2, speed: 80, gravity: 100, size: 13, spin: 0 }); }

  async stream(from, to, o = {}) {
    const n = o.n || 18, ps = [];
    for (let i = 0; i < n; i++) {
      const sz = (o.size || 26) * this.s * rnd(.7, 1.3), c = o.colors ? o.colors[i % o.colors.length] : '#ff7043';
      const d = this.spawn(`<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="${c}"/><circle cx="44" cy="40" r="18" fill="#fff59d" opacity=".7"/></svg>`, from.x, from.y, sz, sz);
      const jy = rnd(-24, 24) * this.s;
      ps.push(this.life(d, an(d, [{ transform: 'translate(0,0) scale(.4)', opacity: 1 }, { transform: `translate(${to.x - from.x}px,${to.y - from.y + jy}px) scale(1.4)`, opacity: .9, offset: .8 }, { transform: `translate(${to.x - from.x}px,${to.y - from.y + jy - 30 * this.s}px) scale(1.8)`, opacity: 0 }], o.dur || 420, { delay: i * (o.gap || 30), easing: 'linear' })));
    }
    await sleep((o.dur || 420) * .8 + n * (o.gap || 30) * .5);
    return Promise.all(ps);
  }
  overlay(f, html, w, h, y = 120) { const c = this.pt(f, 100, y); return this.spawn(html, c.x, c.y, w * this.s, h * this.s); }

  // ---------- 受击（夸张版） ----------
  async hurt(D, o = {}) {
    const power = o.power || 1, kind = o.kind || 'hit', dir = -D.dir, s = this.s;
    const hp = this.pt(D, 100, 96);
    const svg = D.svg; svg.classList.add('ouchy');
    const tilt = dir * (12 + power * 8);
    // 冲击：爆点 + 数字 + 震屏
    this.burst(hp.x, hp.y, { size: 70 + power * 30, color: { fire: '#ffcc80', water: '#b3e5fc', thunder: '#fff59d', light: '#fffde7', poison: '#ccff90', ink: '#90a4ae' }[kind] || '#fff59d', stroke: { fire: '#e64a19', water: '#0288d1', poison: '#558b2f', ink: '#263238' }[kind] || '#ff9800' });
    const dmg = this.nextDmg; this.nextDmg = null;
    if (dmg != null) { this.pop(hp.x + dir * 30 * s, hp.y - 50 * s, dmg.text, { color: dmg.crit ? '#ffeb3b' : '#fff', size: dmg.crit ? 40 : 34, stroke: '#c62828' }); if (o.text) this.pop(hp.x - dir * 20 * s, hp.y - 110 * s, o.text, { size: 20, color: '#fff', stroke: '#3a2618', dur: 1100 }); }
    else this.pop(hp.x + dir * 30 * s, hp.y - 50 * s, o.text || (power >= 3 ? '暴击！' : '-' + Math.max(1, Math.round(power))), { color: power >= 3 ? '#ffeb3b' : '#fff', size: power >= 3 ? 38 : 32, stroke: '#c62828' });
    if (this.onHit) { try { this.onHit(D); } catch (e) {} }
    this.shake(5 + power * 4, 300 + power * 60);
    an(svg, [{ filter: 'brightness(3.2) saturate(0)' }, { filter: 'brightness(1.6) sepia(1) saturate(4) hue-rotate(-40deg)', offset: .3 }, { filter: 'none' }], 420, { fill: 'none' });
    this.sweat(D);
    // 属性反应
    if (kind === 'fire') { an(svg, [{ filter: 'brightness(.35) sepia(.8)' }, { filter: 'brightness(.35) sepia(.8)', offset: .8 }, { filter: 'none' }], 1300, { fill: 'none', delay: 380 }); const t = this.pt(D, 100, 40); this.particles(t.x, t.y, { kind: 'smoke', color: ['#616161', '#757575', '#9e9e9e'], n: 8, angle: -90, spread: .5, speed: 90, gravity: -40, size: 30, spin: 0, dur: 1200, stagger: 60 }); }
    if (kind === 'water') { const t = this.pt(D, 100, 60); this.particles(t.x, t.y, { kind: 'drop', color: '#81d4fa', n: 10, angle: 90, spread: .8, speed: 40, gravity: 90, size: 12, spin: 0, dur: 1100, stagger: 60 }); }
    if (kind === 'poison') an(svg, [{ filter: 'hue-rotate(80deg) saturate(1.6)' }, { filter: 'hue-rotate(80deg) saturate(1.6)', offset: .8 }, { filter: 'none' }], 1200, { fill: 'none', delay: 380 });
    if (kind === 'ink') an(svg, [{ filter: 'brightness(.25)' }, { filter: 'brightness(.25)', offset: .75 }, { filter: 'none' }], 1300, { fill: 'none', delay: 300 });
    if (kind === 'magic') { const t = this.pt(D, 100, 90); this.particles(t.x, t.y, { kind: 'spark', color: ['#fff59d', '#e1bee7', '#b3e5fc'], n: 14, spread: 3.1, speed: 90, gravity: 0, size: 14 }); an(svg, [{ filter: 'hue-rotate(0deg) saturate(2)' }, { filter: 'hue-rotate(360deg) saturate(2)' }], 900, { fill: 'none', delay: 400 }); }
    if (kind === 'thunder') { an(svg, [0, 1, 2, 3, 4, 5].map(i => ({ filter: i % 2 ? 'invert(1) brightness(1.4)' : 'brightness(2.2) saturate(0)' })).concat([{ filter: 'none' }]), 700, { fill: 'none', easing: 'steps(7)' }); an(D.mover, Array.from({ length: 10 }, (_, i) => ({ transform: `translate(${i % 2 ? 4 : -4}px,${i % 3 - 1}px)` })).concat([{ transform: 'none' }]), 600, { fill: 'none' }); }
    if (kind === 'ice') { const c = this.pt(D, 100, 120), w = 150 * s, h = 200 * s; const ice = this.spawn(`<svg viewBox="0 0 150 200" preserveAspectRatio="none"><rect x="4" y="4" width="142" height="192" rx="18" fill="rgba(179,229,252,.55)" stroke="#4fc3f7" stroke-width="5"/><path d="M24 30 l30 -14 M110 160 l20 -30 M30 120 l14 -24" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>`, c.x, c.y, w, h); this.life(ice, an(ice, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: .15 }, { opacity: 1, offset: .85 }, { opacity: 0, transform: 'scale(1.15)' }], 1300)).then(() => this.particles(c.x, c.y, { kind: 'rock', color: ['#b3e5fc', '#e1f5fe', '#81d4fa'], n: 14, spread: 3.1, speed: 120, size: 14 })); an(svg, [{ filter: 'hue-rotate(170deg) saturate(.6) brightness(1.2)' }, { filter: 'hue-rotate(170deg) saturate(.6) brightness(1.2)', offset: .85 }, { filter: 'none' }], 1300, { fill: 'none' }); }
    if (kind === 'web') { const c = this.pt(D, 100, 120), R = 190 * s; const web = this.spawn(`<svg viewBox="-50 -50 100 100">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<path d="M0 0 L${Math.cos(i * Math.PI / 4) * 48} ${Math.sin(i * Math.PI / 4) * 48}" stroke="#fff" stroke-width="1.6"/>`).join('')}${[14, 26, 38].map(r => `<polygon points="${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `${Math.cos(i * Math.PI / 4) * r},${Math.sin(i * Math.PI / 4) * r}`).join(' ')}" fill="none" stroke="#fff" stroke-width="1.6"/>`).join('')}</svg>`, c.x, c.y, R, R); this.life(web, an(web, [{ opacity: 0, transform: 'scale(.3) rotate(-90deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)', offset: .2 }, { opacity: 1, offset: .85 }, { opacity: 0 }], 1500)); an(D.mover, Array.from({ length: 10 }, (_, i) => ({ transform: `rotate(${i % 2 ? 4 : -4}deg)` })).concat([{ transform: 'none' }]), 1100, { fill: 'none', delay: 250 }); }
    if (kind === 'sound') an(D.mover, Array.from({ length: 12 }, (_, i) => ({ transform: `scaleX(${i % 2 ? 1.12 : .9}) scaleY(${i % 2 ? .9 : 1.1})` })).concat([{ transform: 'none' }]), 800, { fill: 'none' });
    // 身体反应
    let p;
    if (kind === 'fly') {
      p = (async () => { const W = this.W; await an(D.mover, [{ transform: 'none' }, { transform: `translate(${dir * W * .7}px,-${this.H * 1.2}px) rotate(${dir * 1080}deg) scale(.4)` }], 700, { easing: 'ease-in' }); this.pop(this.W / 2, 50 * s, '飞走啦～', { size: 26, color: '#fff' }); await sleep(500); await an(D.mover, [{ transform: `translateY(-${this.H * 1.3}px) rotate(${dir * 720}deg)` }, { transform: 'translateY(0) rotate(0deg) scale(1.2,.7)', offset: .8 }, { transform: 'translateY(-20px) scale(.95,1.05)', offset: .9 }, { transform: 'none' }], 650, { easing: 'ease-in' }); const g = this.pt(D, 100, 210); this.dust(g.x, g.y, 8); this.shake(10, 300); this.stars(D, 1000); await sleep(300); clear(D.mover); })();
    } else if (kind === 'squash') {
      p = (async () => { await an(D.mover, [{ transform: 'none' }, { transform: 'scale(1.5,.18) translateY(40%)' }], 140, { easing: 'ease-in' }); await sleep(650); await an(D.mover, [{ transform: 'scale(1.5,.18) translateY(40%)' }, { transform: 'scale(.8,1.35) translateY(-30px)', offset: .4 }, { transform: 'scale(1.1,.9)', offset: .7 }, { transform: 'none' }], 520, { easing: 'ease-out' }); })();
    } else if (kind === 'wind') {
      p = an(D.mover, [{ transform: 'none' }, { transform: `translate(${dir * 30}px,-90px) rotate(${dir * 540}deg) scale(.85)`, offset: .55 }, { transform: `translate(${dir * 40}px,0) rotate(${dir * 720}deg)`, offset: .85 }, { transform: 'none' }], 1150, { easing: 'ease-in-out', fill: 'none' });
    } else if (power >= 2) {
      const up = 60 + power * 18;
      p = an(D.mover, [{ transform: 'none' }, { transform: `translate(${dir * 30}px,-${up}px) rotate(${dir * 200}deg) scale(1.05)`, offset: .3 }, { transform: `translate(${dir * 60}px,0) rotate(${dir * 360}deg) scale(1.15,.75)`, offset: .55 }, { transform: `translate(${dir * 55}px,-18px) rotate(${dir * 360}deg) scale(.95,1.05)`, offset: .68 }, { transform: `translate(${dir * 52}px,0) rotate(${dir * 360}deg) scale(1.08,.92)`, offset: .78 }, { transform: `translate(0,0) rotate(${dir * 360}deg)` }], 1100, { easing: 'ease-out', fill: 'none' });
      setTimeout(() => { const g = this.pt(D, 100, 210); this.dust(g.x + dir * 50 * s, g.y, 6); this.stars(D, 1200); }, 560);
    } else {
      p = an(D.mover, [{ transform: 'none' }, { transform: `translate(${dir * 46}px,-8px) rotate(${tilt}deg) scale(1.12,.86)`, offset: .25 }, { transform: `translate(${dir * 22}px,0) rotate(${-tilt * .4}deg) scale(.94,1.06)`, offset: .6 }, { transform: 'none' }], 620, { easing: 'ease-out', fill: 'none' });
    }
    await p; await sleep(120);
    svg.classList.remove('ouchy');
  }

  // ---------- 收服 ----------
  async capture(D, o, C) {
    // o: {beast: key|null, owner: key|null, text}
    const svg = D.svg;
    const k = o.quick ? .45 : 1;
    await an(D.mover, [{ transform: 'none' }, { transform: 'scale(1.1) rotate(-6deg)', filter: 'brightness(2)' }, { transform: 'scale(.15) rotate(30deg)', opacity: 0 }], 600 * k, { easing: 'ease-in' });
    const c = this.pt(D, 100, 130); this.particles(c.x, c.y, { kind: 'smoke', color: ['#fff', '#eceff1', '#cfd8dc'], n: 12, spread: 3.1, speed: 70, gravity: -10, size: 40, spin: 0, dur: 700 });
    this.burst(c.x, c.y, { size: 130, color: '#fff', stroke: '#90a4ae' });
    D.flip.innerHTML = o.beast ? C[o.beast]() : C[o.key]();
    clear(D.mover);
    await an(D.mover, [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: .7 }, { transform: 'none', opacity: 1 }], 450 * k, { easing: 'cubic-bezier(.3,1.6,.5,1)' });
    this.caption(o.text);
    await sleep(o.quick ? 380 : 500);
    if (o.owner) {
      const ox = this.pt(D, 100, 100).x, top = this.pt(D, 100, 0).y;
      const sz = 180 * this.s;
      const g = this.spawn(`<div class="cloudride">${C[o.owner]()}<svg viewBox="0 0 150 40" class="cl"><path d="M14 34 C2 34 2 18 16 18 C18 6 36 4 42 14 C50 2 72 4 74 16 C84 6 104 8 104 20 C118 14 136 20 132 34 Z" fill="#fff" stroke="#9ccbe8" stroke-width="3"/></svg></div>`, ox - D.dir * 90 * this.s, top + sz * .2, sz, sz * 1.15);
      await an(g, [{ transform: `translateY(-${top + sz * 1.4}px)` }, { transform: 'translateY(0)' }], 900, { easing: 'cubic-bezier(.2,.9,.3,1)' });
      this.particles(ox, top + sz * .6, { kind: 'spark', color: ['#fff59d', '#fff'], n: 14, spread: 3.1, speed: 70, gravity: 0, size: 14 });
      await sleep(600);
      an(D.mover, [{ transform: 'none' }, { transform: `translate(${-D.dir * 40}px,-${this.H}px) scale(.5)`, opacity: 0 }], 1300, { easing: 'ease-in' });
      await an(g, [{ transform: 'translateY(0)' }, { transform: `translateY(-${this.H + sz}px)` }], 1400, { easing: 'ease-in' });
      g.remove();
    } else {
      await an(D.mover, [{ transform: 'none' }, { transform: 'translateY(-14px) scaleX(-1)', offset: .2 }, { transform: `translateX(${-D.dir * this.W * .6}px) scaleX(-1)`, opacity: 0 }], o.quick ? 450 : 1100, { easing: 'ease-in' });
    }
  }
}
window.QJ_FX = { Arena, Fighter, an, clear, sleep, rnd };
})();

/* 取经小英雄 · 每个角色的独立招式编排 */
(function(){
const { an, clear, sleep, rnd } = window.QJ_FX;
const T = (f, dx, dy = 0, extra = '') => `translate(${dx * f.dir}px,${dy}px) ${extra}`;
// 位移动画结束后，把终点写进内联样式再取消动画：不同浏览器（尤其 iPad Safari）对“动画停在终点”的处理不一样，这样最稳
function go(f, t, dur, o = {}) {
  const from = f._t || 'translate(0px,0px)'; f._t = t;
  const kf = [{ transform: from }]; if (o.mid) kf.push({ transform: o.mid }); kf.push({ transform: t });
  const el = f.mover;
  return an(el, kf, dur, { easing: o.ease || 'ease-out' }).then(a => { if (f._t === t && el === f.mover) el.style.transform = t; if (a && a.cancel) a.cancel(); return a; });
}
async function home(f, dur = 320) { await go(f, 'translate(0px,0px)', dur, { ease: 'ease-in-out' }); clear(f.mover); f.mover.style.transform = ''; f._t = null; }
function rot(el, list, dur, ease = 'ease-out') {
  if (!el) return Promise.resolve();
  const from = el._r || 0, to = list[list.length - 1]; el._r = to;
  return an(el, [from, ...list].map(d => ({ transform: `rotate(${d}deg)` })), dur, { easing: ease }).then(a => { if (el._r === to) el.style.transform = `rotate(${to}deg)`; if (a && a.cancel) a.cancel(); return a; });
}
async function rotHome(el, dur = 260) { if (!el) return; await rot(el, [0], dur, 'ease-in-out'); clear(el); el.style.transform = ''; el._r = 0; }
const near = (ar, A, D, keep = 125) => Math.max(0, Math.abs(ar.gap(A, D)) - keep * ar.s);
const svgs = {
  palm: `<svg viewBox="0 0 120 140" overflow="visible"><path d="M20 140 L20 70 Q20 58 30 58 Q38 58 38 70 L38 30 Q38 18 48 18 Q58 18 58 30 L58 20 Q58 8 68 8 Q78 8 78 20 L78 30 Q78 20 88 20 Q98 22 98 34 L98 60 Q98 50 106 52 Q116 56 112 72 L100 116 Q92 140 60 140 Z" fill="#f6d58a" stroke="#3a2618" stroke-width="4" stroke-linejoin="round"/><path d="M48 100 q12 8 26 0" fill="none" stroke="#c9a24a" stroke-width="3"/></svg>`,
  ring: `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="22" fill="none" stroke="#3a2618" stroke-width="12"/><circle cx="30" cy="30" r="22" fill="none" stroke="#f2c94c" stroke-width="7"/><circle cx="22" cy="20" r="3" fill="#fff"/></svg>`,
  peach: `<svg viewBox="0 0 60 60"><path d="M30 54 C6 48 8 16 30 18 C52 16 54 48 30 54 Z" fill="#ffab91" stroke="#3a2618" stroke-width="4"/><path d="M30 18 q8 -12 18 -10 q-6 10 -18 10" fill="#7cb342" stroke="#3a2618" stroke-width="3"/><path d="M30 22 q-4 14 0 28" stroke="#ef8a6c" stroke-width="3" fill="none"/></svg>`,
  crescent: c => `<svg viewBox="0 0 80 120" overflow="visible"><path d="M10 6 C70 20 70 100 10 114 C44 90 44 30 10 6 Z" fill="${c}" stroke="#fff" stroke-width="4" opacity=".95"/></svg>`,
  tower: `<svg viewBox="0 0 120 170" overflow="visible">${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${12 + i * 7}" y="${142 - i * 24}" width="${96 - i * 14}" height="22" rx="4" fill="#f2c94c" stroke="#3a2618" stroke-width="4"/><path d="M${4 + i * 7} ${142 - i * 24} h${112 - i * 14}" stroke="#3a2618" stroke-width="6" stroke-linecap="round"/><rect x="${52}" y="${148 - i * 24}" width="16" height="12" rx="3" fill="#8d2c1f"/>`).join('')}<path d="M60 22 v-18" stroke="#3a2618" stroke-width="5"/><circle cx="60" cy="4" r="7" fill="#e53935" stroke="#3a2618" stroke-width="3"/></svg>`,
  scroll: `<svg viewBox="0 0 200 60" overflow="visible"><rect x="20" y="10" width="160" height="40" fill="#fff3c4" stroke="#3a2618" stroke-width="4"/><rect x="6" y="4" width="16" height="52" rx="6" fill="#c0392b" stroke="#3a2618" stroke-width="4"/><rect x="178" y="4" width="16" height="52" rx="6" fill="#c0392b" stroke="#3a2618" stroke-width="4"/><text x="100" y="40" text-anchor="middle" font-size="26" font-weight="900" fill="#c0392b" font-family="sans-serif">奉旨降妖</text></svg>`,
  dragon: `<svg viewBox="0 0 140 60" overflow="visible"><path d="M0 30 C20 0 40 60 60 30 C80 0 100 60 120 30" fill="none" stroke="#3a2618" stroke-width="18" stroke-linecap="round"/><path d="M0 30 C20 0 40 60 60 30 C80 0 100 60 120 30" fill="none" stroke="#f2c94c" stroke-width="12" stroke-linecap="round"/><circle cx="126" cy="28" r="14" fill="#f2c94c" stroke="#3a2618" stroke-width="4"/><path d="M126 14 l6 -12 M120 14 l-4 -12" stroke="#3a2618" stroke-width="4"/><circle cx="130" cy="26" r="3" fill="#3a2618"/></svg>`,
  redsnake: `<svg viewBox="0 0 140 60" overflow="visible"><path d="M0 30 C20 0 40 60 60 30 C80 0 100 60 120 30" fill="none" stroke="#3a2618" stroke-width="16" stroke-linecap="round"/><path d="M0 30 C20 0 40 60 60 30 C80 0 100 60 120 30" fill="none" stroke="#e53935" stroke-width="10" stroke-linecap="round"/><ellipse cx="126" cy="28" rx="14" ry="11" fill="#e53935" stroke="#3a2618" stroke-width="4"/><circle cx="130" cy="25" r="3" fill="#fff59d"/></svg>`,
  crane: `<svg viewBox="0 0 140 90" overflow="visible"><path d="M20 50 C40 40 70 40 90 50 C70 60 40 60 20 50 Z" fill="#fff" stroke="#3a2618" stroke-width="4"/><path d="M40 46 L70 6 L80 44 Z" fill="#fff" stroke="#3a2618" stroke-width="4"><animateTransform attributeName="transform" type="scale" values="1 1;1 -0.6;1 1" dur=".35s" repeatCount="indefinite" additive="sum"/></path><path d="M90 50 C104 40 108 28 116 20" fill="none" stroke="#3a2618" stroke-width="5"/><circle cx="118" cy="18" r="7" fill="#fff" stroke="#3a2618" stroke-width="3"/><circle cx="118" cy="13" r="3" fill="#e53935"/><path d="M124 18 l14 4" stroke="#3a2618" stroke-width="3"/><path d="M28 56 l-16 20 M34 56 l-10 24" stroke="#3a2618" stroke-width="3"/></svg>`,
  lotus: `<svg viewBox="0 0 160 70" overflow="visible">${[-60, -30, 0, 30, 60].map((a, i) => `<path transform="rotate(${a} 80 66)" d="M80 66 C62 40 68 10 80 0 C92 10 98 40 80 66 Z" fill="${i % 2 ? '#f8bbd0' : '#fce4ec'}" stroke="#3a2618" stroke-width="3"/>`).join('')}</svg>`,
  mound: `<svg viewBox="0 0 60 30" overflow="visible"><path d="M0 30 Q30 -10 60 30 Z" fill="#a1887f" stroke="#3a2618" stroke-width="4"/></svg>`,
  spike: `<svg viewBox="0 0 120 90" overflow="visible"><path d="M10 90 L24 30 L38 90 Z M40 90 L60 0 L80 90 Z M82 90 L96 36 L110 90 Z" fill="#8d6e63" stroke="#3a2618" stroke-width="4" stroke-linejoin="round"/></svg>`,
  ink: `<svg viewBox="0 0 60 60"><path d="M30 6 C46 6 56 18 52 30 C60 40 50 56 36 52 C26 60 8 52 10 40 C0 30 10 12 22 14 C24 8 28 6 30 6 Z" fill="#263238" stroke="#000" stroke-width="3"/><circle cx="22" cy="24" r="4" fill="#607d8b"/></svg>`,
  sound: `<svg viewBox="0 0 40 80" overflow="visible"><path d="M6 6 C34 24 34 56 6 74" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/></svg>`,
  note: c => `<svg viewBox="0 0 40 50"><path d="M14 40 V6 L34 2 V30" fill="none" stroke="#3a2618" stroke-width="5"/><ellipse cx="10" cy="40" rx="9" ry="7" fill="${c}" stroke="#3a2618" stroke-width="3"/><ellipse cx="30" cy="32" rx="9" ry="7" fill="${c}" stroke="#3a2618" stroke-width="3"/></svg>`,
  bigaxe: `<svg viewBox="0 0 120 160" overflow="visible"><path d="M20 10 C90 -10 120 50 100 110 C80 90 50 80 20 80 Z" fill="#cfd8dc" stroke="#3a2618" stroke-width="5"/><path d="M40 30 q30 10 40 50" stroke="#fff" stroke-width="5" fill="none"/></svg>`,
  bigBubble: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="rgba(179,229,252,.35)" stroke="#4fc3f7" stroke-width="3"/><path d="M24 30 A30 30 0 0 1 46 14" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="72" cy="72" r="5" fill="#fff" opacity=".8"/></svg>`,
  ghost: `<svg viewBox="0 0 60 70"><path d="M30 4 C48 4 56 18 54 34 C52 46 46 52 46 60 L40 54 L34 64 L28 54 L20 64 L18 52 C10 50 6 40 6 30 C6 14 16 4 30 4 Z" fill="#ce93d8" stroke="#4a148c" stroke-width="3" opacity=".9"/><ellipse cx="22" cy="30" rx="6" ry="8" fill="#4a148c"/><ellipse cx="40" cy="30" rx="6" ry="8" fill="#4a148c"/><path d="M26 44 l4 -4 l4 4" stroke="#4a148c" stroke-width="2" fill="none"/></svg>`,
  well: `<svg viewBox="0 0 170 70" overflow="visible"><ellipse cx="85" cy="20" rx="80" ry="18" fill="#263238" stroke="#3a2618" stroke-width="4"/><ellipse cx="85" cy="24" rx="64" ry="11" fill="#4fc3f7" opacity=".6"/><path d="M5 20 L5 52 Q85 80 165 52 L165 20 Q85 44 5 20 Z" fill="#9e9e9e" stroke="#3a2618" stroke-width="4"/><path d="M30 34 v26 M60 40 v28 M95 41 v28 M128 37 v26" stroke="#757575" stroke-width="3"/></svg>`,
  cloud: `<svg viewBox="0 0 160 60" overflow="visible"><path d="M20 54 C2 54 2 30 22 30 C24 12 48 8 58 22 C68 2 100 4 104 24 C118 12 146 18 144 38 C160 40 160 56 144 56 Z" fill="#78909c" stroke="#455a64" stroke-width="4"/></svg>`,
  pot: `<svg viewBox="0 0 110 80" overflow="visible"><path d="M8 26 Q55 14 102 26 L94 66 Q55 82 16 66 Z" fill="#424242" stroke="#3a2618" stroke-width="4"/><ellipse cx="55" cy="26" rx="47" ry="10" fill="#ffca28" stroke="#3a2618" stroke-width="4"/><path d="M0 30 h10 M100 30 h10" stroke="#3a2618" stroke-width="6" stroke-linecap="round"/><path d="M30 80 q8 -12 0 -20 M55 82 q8 -12 0 -20 M80 80 q8 -12 0 -20" stroke="#ff7043" stroke-width="5" fill="none"/></svg>`,
  ringW: `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="22" fill="none" stroke="#3a2618" stroke-width="12"/><circle cx="30" cy="30" r="22" fill="none" stroke="#eceff1" stroke-width="7"/></svg>`,
  ringSpear: `<svg viewBox="0 0 60 60" overflow="visible"><circle cx="30" cy="30" r="22" fill="none" stroke="#3a2618" stroke-width="12"/><circle cx="30" cy="30" r="22" fill="none" stroke="#eceff1" stroke-width="7"/><path d="M4 56 L56 4" stroke="#3a2618" stroke-width="8" stroke-linecap="round"/><path d="M4 56 L56 4" stroke="#4b4650" stroke-width="4" stroke-linecap="round"/><path d="M50 6 l8 -4 l-4 8 Z M6 50 l-4 8 l8 -4 Z" fill="#f2b632" stroke="#3a2618" stroke-width="2"/></svg>`,
  nao: `<svg viewBox="0 0 210 110" overflow="visible"><path d="M8 100 Q105 -40 202 100 Z" fill="#f2c94c" stroke="#3a2618" stroke-width="5"/><ellipse cx="105" cy="34" rx="22" ry="14" fill="#c49a00" stroke="#3a2618" stroke-width="4"/><path d="M40 86 Q105 10 170 86" fill="none" stroke="#fff59d" stroke-width="4"/></svg>`,
};

const M = {};
// ---------- 取经队伍 ----------
M.wukong = { name: '跳劈·金箍棒', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 110);
  await go(A, T(A, 0, 10, 'scale(1.08,.82)'), 140);
  ar.dust(ar.pt(A, 100, 210).x, ar.pt(A, 100, 210).y, 5);
  const w = A.weapon;
  rot(w, [-360, -720, -900], 520, 'linear');
  ar.afterimage(A, 4);
  await go(A, T(A, g * .55, -130 * s, `rotate(${A.dir * -20}deg)`), 380, { ease: 'cubic-bezier(.2,.8,.3,1)' });
  ar.pop(ar.pt(A, 100, 0, true).x, ar.pt(A, 100, 0, true).y, '吃俺老孙一棒！', { size: 20, color: '#ffeb3b', stroke: '#3a2618' });
  await sleep(120);
  rot(w, [-900 + 220], 130, 'ease-in');
  await go(A, T(A, g, 0, `rotate(${A.dir * 12}deg) scale(1.1,.9)`), 140, { ease: 'ease-in' });
  const hp = ar.pt(D, 100, 205);
  ar.ring(hp.x, hp.y, { r: 70, squash: .3, color: '#ffeb3b', width: 8, to: 2.4 }); ar.crack(hp.x, hp.y); ar.dust(hp.x, hp.y, 10);
  ar.pop(hp.x, hp.y - 160 * s, '砰！', { size: 44, color: '#ff7043' });
  const h = ar.hurt(D, { power: 3 });
  await sleep(250); await rotHome(w, 200); await home(A, 360); await h;
} };
M.liuer = { name: '分身乱棒', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 110);
  ar.pop(ar.pt(A, 100, 10).x, ar.pt(A, 100, 10).y, '真假难辨！', { size: 20, color: '#e1bee7' });
  for (let i = 0; i < 3; i++) { ar.afterimage(A, 2); await go(A, T(A, g * (.3 + i * .35), -40 * s * (i % 2), ''), 140); }
  rot(A.weapon, [-200, 120], 260, 'ease-in');
  for (let i = 0; i < 3; i++) { const hp = ar.pt(D, 100, 70 + i * 30); ar.slash(hp.x, hp.y, { r: 60, rot: i * 50 - 50, color: '#b39ddb', width: 12 }); await sleep(90); }
  const h = ar.hurt(D, { power: 2 });
  await rotHome(A.weapon); await home(A); await h;
} };
M.tangseng = { name: '紧箍咒', async run(ar, A, D) {
  const s = ar.s;
  rot(A.weapon, [-15, 10, -10, 0], 600);
  const src = ar.pt(A, 100, 70), hp = ar.pt(D, 100, 60);
  ar.ring(src.x, src.y, { r: 60, color: '#f6d36b', width: 5, to: 1.6 });
  const words = ['唵', '嘛', '呢', '叭', '咪', '吽'];
  const ps = words.map((w, i) => sleep(i * 110).then(() => ar.proj(`<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="#fff8e1" stroke="#f2b632" stroke-width="4"/><text x="30" y="41" text-anchor="middle" font-size="30" font-weight="900" fill="#c0392b" font-family="serif">${w}</text></svg>`, src, { x: hp.x, y: hp.y + rnd(-30, 30) * s }, { size: 40, arc: 40 + i * 10, dur: 520, spin: 360 })));
  await Promise.all(ps);
  for (let i = 0; i < 3; i++) ar.ring(hp.x, hp.y - 10 * s, { r: 40, squash: .35, color: '#f2c230', width: 10, from: 1.8, to: .9, dur: 360, delay: i * 120 });
  await sleep(250);
  ar.pop(hp.x, hp.y - 70 * s, '头好痛！', { size: 22, color: '#fff' });
  await ar.hurt(D, { power: 2, kind: 'magic', text: '-2' });
} };
M.bailong = { name: '白龙出水', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 90);
  an(A.part('.tail'), [0, 25, -25, 25, 0].map(d => ({ transform: `rotate(${d}deg)` })), 600, { fill: 'none' });
  await go(A, T(A, -20 * s, 6, 'scale(1.05,.92)'), 160);
  const from = ar.pt(A, 100, 150), to = ar.pt(D, 100, 150);
  ar.wave(from, to, { dur: 520 });
  ar.particles(from.x, from.y, { kind: 'bubble', n: 10, angle: A.dir > 0 ? 0 : 180, spread: .6, speed: 140, gravity: -40, size: 18 });
  await go(A, T(A, g, -30 * s, `rotate(${A.dir * 10}deg)`), 420, { ease: 'cubic-bezier(.5,0,.8,1)' });
  ar.pop(ar.pt(D, 100, 20).x, ar.pt(D, 100, 20).y, '哗啦！', { size: 36, color: '#81d4fa', stroke: '#01579b' });
  const h = ar.hurt(D, { power: 2, kind: 'water' });
  await home(A, 420); await h;
} };
M.bajie = { name: '钉耙筑地', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 120), w = A.weapon;
  for (let i = 1; i <= 2; i++) await go(A, T(A, g * i / 2, 0, 'scale(1.1,.88)'), 200, { mid: T(A, g * (i - .5) / 2, -30 * s) });
  await rot(w, [-150], 260, 'ease-out');
  ar.pop(ar.pt(A, 100, 0, true).x, ar.pt(A, 100, 0, true).y, '看耙！', { size: 22, color: '#f8bbd0' });
  await sleep(120);
  await rot(w, [95], 140, 'ease-in');
  const hp = ar.pt(D, 100, 206);
  ar.crack(hp.x, hp.y); ar.ring(hp.x, hp.y, { r: 60, squash: .3, color: '#ffccbc', width: 8 });
  ar.pop(hp.x, hp.y - 150 * s, '咚！', { size: 44, color: '#ffab91' });
  an(A.svg.querySelector('ellipse[fill="#f6b8c2"]'), [{ transform: 'scale(1)' }, { transform: 'scale(1.08,.9)' }, { transform: 'scale(.96,1.05)' }, { transform: 'scale(1)' }], 400, { fill: 'none' });
  const h = ar.hurt(D, { power: 2, kind: 'squash' });
  await sleep(300); await rotHome(w); await home(A); await h;
} };
M.shaseng = { name: '宝杖横扫', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 115), w = A.weapon;
  await go(A, T(A, g * .5, 0), 220);
  await an(A.flip, [{ transform: A.mirrored ? 'scaleX(-1)' : 'none' }, { transform: `${A.mirrored ? 'scaleX(-1) ' : ''}rotateY(180deg)` }, { transform: `${A.mirrored ? 'scaleX(-1) ' : ''}rotateY(360deg)` }], 360, { fill: 'none' });
  await go(A, T(A, g, 0), 120);
  await rot(w, [-110], 150);
  rot(w, [130], 200, 'ease-in');
  const hp = ar.pt(D, 100, 110);
  ar.slash(hp.x - A.dir * 40 * s, hp.y, { r: 95, from: A.dir > 0 ? -150 : -30, to: A.dir > 0 ? -10 : -170, color: '#f4cf5a', width: 18, dur: 200 });
  ar.particles(hp.x, hp.y, { kind: 'dot', color: '#fff', n: 10, angle: A.dir > 0 ? 0 : 180, spread: 1, speed: 120, size: 9 });
  const h = ar.hurt(D, { power: 2 });
  await sleep(250); await rotHome(w); await home(A); await h;
} };

// ---------- 关卡妖怪 ----------
M.tiger = { name: '猛虎扑', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 80);
  for (let i = 0; i < 3; i++) await go(A, T(A, -10 * s, 8, `rotate(${A.dir * (i % 2 ? 4 : -4)}deg) scale(1.05,.9)`), 90);
  ar.pop(ar.pt(A, 100, 20).x, ar.pt(A, 100, 20).y, '嗷呜！', { size: 30, color: '#ffb74d' });
  await go(A, T(A, g, 0, `rotate(${A.dir * 18}deg)`), 340, { mid: T(A, g * .5, -110 * s, `rotate(${A.dir * -15}deg)`), ease: 'ease-in' });
  const hp = ar.pt(D, 100, 100); ar.claw(hp.x, hp.y);
  const h = ar.hurt(D, { power: 2, kind: 'slash' });
  await home(A, 420); await h;
} };
M.xia = { name: '虾枪连刺', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 150), w = A.weapon;
  await rot(w, [86], 180);
  for (let i = 0; i < 3; i++) {
    await go(A, T(A, g, 0), 90); const hp = ar.pt(D, 100, 90 + i * 15);
    ar.burst(hp.x, hp.y, { size: 46 }); ar.speed(ar.pt(A, 170, 110, true).x, hp.y, A.dir);
    an(D.mover, [{ transform: 'none' }, { transform: `translateX(${-D.dir * 10}px)` }, { transform: 'none' }], 120, { fill: 'none' });
    await go(A, T(A, g * .6, 0), 90);
  }
  await go(A, T(A, g + 10 * s, 0), 80);
  const h = ar.hurt(D, { power: 1, kind: 'pierce' });
  await rotHome(w); await home(A); await h;
} };
M.langjing = { name: '青锋剑气', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-60], 220);
  ar.pop(ar.pt(A, 100, 10).x, ar.pt(A, 100, 10).y, '嗷——', { size: 26, color: '#b0bec5' });
  await sleep(120);
  rot(w, [120], 160, 'ease-in');
  const from = ar.pt(A, 160, 100), to = ar.pt(D, 100, 100);
  await ar.proj(`<div style="transform:scaleX(${A.dir})">${svgs.crescent('#7fd1c7')}</div>`, from, to, { size: 110, dur: 340 });
  ar.slash(to.x, to.y, { r: 60, rot: 90, color: '#7fd1c7' });
  const h = ar.hurt(D, { power: 2, kind: 'slash' });
  await rotHome(w); await h;
} };
M.shejing = { name: '毒信花枪', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 160), w = A.weapon;
  an(A.mover, [0, 1, 2, 3, 4].map(i => ({ transform: `skewX(${i % 2 ? 10 : -10}deg)` })), 500, { fill: 'none' });
  an(A.part('.flick'), [{ transform: 'scaleX(1)' }, { transform: 'scaleX(1.6)' }, { transform: 'scaleX(1)' }], 500, { fill: 'none', iterations: 1 });
  await sleep(450);
  await rot(w, [88], 140);
  await go(A, T(A, g, 0, 'scaleX(1.15)'), 150, { ease: 'cubic-bezier(.6,0,.9,.6)' });
  ar.speed(ar.pt(A, 170, 110, true).x, ar.pt(A, 170, 110, true).y, A.dir, { n: 8 });
  const hp = ar.pt(D, 100, 100); ar.particles(hp.x, hp.y, { kind: 'bubble', n: 10, spread: 3.1, speed: 60, gravity: -30, size: 16 });
  const h = ar.hurt(D, { power: 2, kind: 'poison' });
  await sleep(200); await rotHome(w); await home(A); await h;
} };
M.heixiong = { name: '黑风旋枪', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 130), w = A.weapon;
  const c = ar.pt(A, 100, 120);
  const t = ar.tornado({ x: c.x, y: c.y }, { x: c.x, y: c.y }, { color: '#4e4446', dur: 700 });
  await rot(w, [-1080], 700, 'ease-in');
  ar.pop(c.x, c.y - 140 * s, '黑风来也！', { size: 22, color: '#bdbdbd' });
  await go(A, T(A, g * .5, -60 * s), 220);
  await go(A, T(A, g, 0, 'scale(1.12,.86)'), 130, { ease: 'ease-in' });
  const gp = ar.pt(A, 100, 210, true); ar.shake(16, 500); ar.ring(gp.x, gp.y, { r: 90, squash: .25, color: '#5d4037', width: 10, to: 2.6 }); ar.dust(gp.x, gp.y, 12);
  await rot(w, [-1080 + 450], 130);
  const h = ar.hurt(D, { power: 3 });
  await t; await sleep(200); await rotHome(w); await home(A); await h;
} };
M.hufeng = { name: '双刀十字斩', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 110), [w1, w2] = A.weapons;
  rot(w1, [-70], 160); rot(w2, [70], 160);
  await go(A, T(A, g, 0, `rotate(${A.dir * 8}deg)`), 220, { ease: 'ease-in' });
  ar.afterimage(A, 2);
  rot(w1, [130], 140, 'ease-in'); rot(w2, [-130], 140, 'ease-in');
  const hp = ar.pt(D, 100, 100);
  ar.slash(hp.x, hp.y, { r: 70, rot: 45, color: '#ff7043', width: 14 }); await sleep(70);
  ar.slash(hp.x, hp.y, { r: 70, rot: 135, color: '#ff7043', width: 14 });
  ar.pop(hp.x, hp.y - 110 * s, '斩！', { size: 40, color: '#ff7043' });
  const h = ar.hurt(D, { power: 2, kind: 'slash' });
  await sleep(200); await Promise.all([rotHome(w1), rotHome(w2)]); await home(A); await h;
} };
M.huangfeng = { name: '三昧神风', async run(ar, A, D) {
  const s = ar.s;
  await go(A, T(A, -8 * s, 0, 'scale(1.15,1.1)'), 400);
  ar.pop(ar.pt(A, 100, 10).x, ar.pt(A, 100, 10).y, '呼——', { size: 34, color: '#ffe082', stroke: '#8d6e63', dur: 1200 });
  go(A, T(A, 6 * s, 0, 'scale(.95,1)'), 200);
  const from = ar.pt(A, 140, 110), to = ar.pt(D, 100, 120);
  ar.flash('#d7b46a', 900, .35);
  await ar.tornado(from, to, { dur: 650 });
  const h = ar.hurt(D, { power: 2, kind: 'wind' });
  await sleep(200); await home(A); await h;
} };

// ---------- 错题小妖 ----------
M.xiaozuanfeng = { name: '巡山锣', async run(ar, A, D) {
  const s = ar.s, [gong, mallet] = A.weapons;
  for (let i = 0; i < 3; i++) {
    await rot(mallet, [60], 90, 'ease-in'); await rot(mallet, [0], 90);
    const p = ar.pt(A, 150, 150); ar.pop(p.x, p.y - 50 * s, '咣！', { size: 26, color: '#ffd54f', dur: 600 });
    ar.ring(p.x, p.y, { r: 30, color: '#ffd54f', width: 5, to: 3 });
    an(gong, [{ transform: 'rotate(0)' }, { transform: 'rotate(12deg)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(0)' }], 260, { fill: 'none' });
    ar.proj(`<div style="transform:scaleX(${A.dir})">${svgs.sound}</div>`, p, ar.pt(D, 100, 100), { size: 50, dur: 380 });
  }
  await sleep(300); clear(mallet); mallet._r = 0;
  await ar.hurt(D, { power: 1, kind: 'sound', text: '吵死了！' });
} };
M.benbo = { name: '泡泡水箭', async run(ar, A, D) {
  const s = ar.s;
  await go(A, T(A, -10 * s, 0, 'scale(1.1,.95)'), 200);
  go(A, T(A, 10 * s, 0), 150);
  const from = ar.pt(A, 140, 100), to = ar.pt(D, 100, 100);
  await Promise.all([0, 1, 2, 3, 4].map(i => sleep(i * 90).then(() => ar.proj(svgs.ring.replace(/#f2c94c/g, '#b3e5fc').replace(/#3a2618/g, '#0288d1'), from, { x: to.x, y: to.y + rnd(-30, 30) * s }, { size: 30, dur: 360, arc: rnd(-20, 30) }))));
  ar.particles(to.x, to.y, { kind: 'bubble', n: 12, spread: 3.1, speed: 80, size: 18 });
  const h = ar.hurt(D, { power: 1, kind: 'water' });
  await home(A); await h;
} };
M.babo = { name: '墨汁炮', async run(ar, A, D) {
  const s = ar.s;
  await go(A, T(A, -16 * s, 0, 'scale(.9,1.15)'), 260);
  await go(A, T(A, 10 * s, 0, 'scale(1.15,.9)'), 120);
  const from = ar.pt(A, 150, 90), to = ar.pt(D, 100, 90);
  await ar.proj(svgs.ink, from, to, { size: 60, dur: 420, arc: 60, spin: 360 });
  ar.particles(to.x, to.y, { kind: 'dot', color: '#263238', n: 12, spread: 3.1, speed: 90, size: 12 });
  ar.pop(to.x, to.y - 80 * s, '啪叽！', { size: 30, color: '#90a4ae' });
  const h = ar.hurt(D, { power: 1, kind: 'ink' });
  await home(A); await h;
} };

// ---------- 神仙 ----------
M.guanyin = { name: '杨柳甘露', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-50], 400);
  const hp = ar.pt(D, 100, 60), top = ar.pt(D, 100, -40);
  for (let i = 0; i < 4; i++) { ar.particles(top.x, top.y, { kind: 'drop', color: '#b3e5fc', n: 6, angle: 90, spread: .5, speed: 90, gravity: 140, size: 13, spin: 0, dur: 700 }); await sleep(120); }
  ar.ring(hp.x, hp.y + 40 * s, { r: 60, color: '#b2ebf2', width: 6, to: 1.8 });
  ar.pop(hp.x, hp.y - 60 * s, '现出原形！', { size: 22, color: '#e0f7fa', stroke: '#00838f' });
  const h = ar.hurt(D, { power: 1, kind: 'magic' });
  await rotHome(w, 400); await h;
} };
M.lingji = { name: '飞龙宝杖', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-40], 200); rot(w, [60], 160, 'ease-in');
  w.style.opacity = 0;
  const from = ar.pt(A, 150, 40), to = ar.pt(D, 100, 100);
  ar.pop(from.x, from.y - 20 * s, '宝杖化龙！', { size: 22, color: '#fff59d' });
  await ar.proj(`<div style="transform:scaleX(${A.dir})">${svgs.dragon}</div>`, from, to, { size: 120, dur: 520, arc: 50 });
  ar.ring(to.x, to.y, { r: 60, color: '#f2c94c', width: 10 });
  const h = ar.hurt(D, { power: 2, kind: 'light' });
  await sleep(200); w.style.opacity = ''; await rotHome(w); await h;
} };
M.tudi = { name: '土遁地刺', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  for (let i = 0; i < 2; i++) { await rot(w, [12], 90); await rot(w, [0], 90); const g = ar.pt(A, 150, 208); ar.dust(g.x, g.y, 4); }
  const a = ar.pt(A, 150, 206), d = ar.pt(D, 100, 206);
  for (let i = 1; i <= 4; i++) { const x = a.x + (d.x - a.x) * i / 5; const m = ar.spawn(svgs.mound, x, a.y - 6 * s, 50 * s, 26 * s); ar.life(m, an(m, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }, { transform: 'scale(0)' }], 260)); await sleep(90); }
  const sp = ar.spawn(svgs.spike, d.x, d.y - 40 * s, 140 * s, 100 * s); sp.style.transformOrigin = '50% 100%';
  ar.life(sp, an(sp, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1.1)', offset: .3 }, { transform: 'scaleY(1)', offset: .8 }, { transform: 'scaleY(0)' }], 800));
  ar.particles(d.x, d.y, { kind: 'rock', color: ['#a1887f', '#8d6e63'], n: 10, spread: 1, speed: 140, size: 13 });
  await ar.hurt(D, { power: 3 });
} };
M.rulai = { name: '五指山', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-20], 300);
  ar.flash('#fff8e1', 500, .5);
  const hp = ar.pt(D, 100, 206);
  ar.pop(ar.W / 2, 40 * s, '五指山！', { size: 34, color: '#ffe082', stroke: '#8d6e63', dur: 1400 });
  const palm = await ar.drop(svgs.palm, hp.x, hp.y + 10 * s, { size: 200, dur: 420 });
  ar.shake(22, 600); ar.dust(hp.x, hp.y, 14); ar.crack(hp.x, hp.y);
  const h = ar.hurt(D, { power: 3, kind: 'squash' });
  await sleep(700);
  await ar.life(palm, an(palm, [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-ar.H}px)`, opacity: 0 }], 400, { easing: 'ease-in' }));
  await rotHome(w); await h;
} };
M.yudi = { name: '奉旨降妖', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-30], 300);
  const sc = ar.spawn(svgs.scroll, ar.W / 2, 34 * s, 230 * s, 70 * s);
  await an(sc, [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], 400, { easing: 'cubic-bezier(.3,1.5,.5,1)' });
  const hp = ar.pt(D, 100, 206);
  await ar.pillar(hp.x, hp.y, { color: '#ffe082', w: 120, dur: 700 });
  const h = ar.hurt(D, { power: 3, kind: 'light' });
  ar.life(sc, an(sc, [{ opacity: 1 }, { opacity: 0 }], 600, { delay: 500 }));
  await rotHome(w); await h;
} };
M.wangmu = { name: '蟠桃雨', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-25], 250);
  const hp = ar.pt(D, 100, 30);
  ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '赏你蟠桃！', { size: 20, color: '#ffccbc' });
  for (let i = 0; i < 5; i++) {
    const x = hp.x + rnd(-40, 40) * s;
    ar.drop(svgs.peach, x, hp.y + rnd(0, 40) * s, { size: 46, dur: 360 }).then(p => { ar.burst(x, hp.y + 20 * s, { size: 40 }); ar.life(p, an(p, [{ transform: 'none', opacity: 1 }, { transform: `translate(${rnd(-60, 60) * s}px,-40px) rotate(200deg)`, opacity: 0 }], 400)); an(D.mover, [{ transform: 'none' }, { transform: 'scaleY(.85)' }, { transform: 'none' }], 160, { fill: 'none' }); });
    await sleep(140);
  }
  await sleep(300);
  await ar.hurt(D, { power: 2, text: '咚咚咚！' });
  await rotHome(w);
} };
M.laojun = { name: '金刚琢', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-40], 200); rot(w, [40], 120);
  w.style.opacity = 0;
  const from = ar.pt(A, 156, 138), to = ar.pt(D, 100, 50);
  ar.pop(from.x, from.y - 40 * s, '着！', { size: 30, color: '#ffe082' });
  await ar.proj(svgs.ring, from, to, { size: 56, dur: 420, arc: 80, spin: 1080 });
  ar.pop(to.x, to.y - 30 * s, '当！', { size: 40, color: '#ffeb3b' });
  const h = ar.hurt(D, { power: 3 });
  await ar.proj(svgs.ring, to, from, { size: 56, dur: 420, arc: 60, spin: -1080 });
  w.style.opacity = ''; await rotHome(w); await h;
} };
M.taibai = { name: '拂尘星光', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-50], 200);
  await rot(w, [60], 160, 'ease-in');
  const from = ar.pt(A, 170, 60), to = ar.pt(D, 100, 90);
  await Promise.all([0, 1, 2, 3, 4, 5].map(i => sleep(i * 60).then(() => ar.proj(`<svg viewBox="0 0 40 40"><path d="M20 2 L25 15 L38 16 L28 25 L31 38 L20 31 L9 38 L12 25 L2 16 L15 15 Z" fill="#fff59d" stroke="#f9a825" stroke-width="2"/></svg>`, from, { x: to.x + rnd(-30, 30) * s, y: to.y + rnd(-40, 40) * s }, { size: 26, dur: 380, spin: 360, arc: rnd(-40, 40) }))));
  ar.question(D);
  const h = ar.hurt(D, { power: 1, kind: 'magic', text: '晕乎乎' });
  an(D.mover, [{ transform: 'rotate(0)' }, { transform: 'rotate(-12deg)' }, { transform: 'rotate(12deg)' }, { transform: 'rotate(0)' }], 1200, { fill: 'none', delay: 600 });
  await rotHome(w); await h;
} };
M.litianwang = { name: '宝塔镇妖', async run(ar, A, D) {
  const s = ar.s, tw = A.part('.tower');
  await an(tw, [{ transform: 'translateY(0)' }, { transform: 'translateY(-14px) scale(1.1)' }], 300);
  tw.style.opacity = 0;
  const hp = ar.pt(D, 100, 210);
  ar.pop(ar.pt(A, 50, 10).x, ar.pt(A, 50, 10).y, '宝塔收！', { size: 24, color: '#ffe082' });
  const tower = await ar.drop(svgs.tower, hp.x, hp.y + 8 * s, { size: 210, dur: 420 });
  D.mover.style.visibility = 'hidden';
  ar.shake(14, 400); ar.dust(hp.x, hp.y, 10);
  for (let i = 0; i < 4; i++) { await an(tower, [{ transform: 'rotate(0)' }, { transform: `rotate(${i % 2 ? 4 : -4}deg)` }, { transform: 'rotate(0)' }], 150, { fill: 'none' }); }
  await ar.life(tower, an(tower, [{ transform: 'none', opacity: 1 }, { transform: `translateY(${-ar.H}px)`, opacity: 0 }], 360, { easing: 'ease-in' }));
  D.mover.style.visibility = '';
  await ar.hurt(D, { power: 2, text: '关晕了' });
  clear(tw); tw.style.opacity = '';
} };
M.nezha = { name: '风火轮·乾坤圈', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 140), w = A.weapon;
  await rot(w, [88], 160);
  const gp = ar.pt(A, 100, 204);
  ar.particles(gp.x, gp.y, { kind: 'smoke', color: ['#ff7043', '#ffca28', '#ff5722'], n: 10, angle: A.dir > 0 ? 180 : 0, spread: .5, speed: 110, gravity: -30, size: 22, spin: 0 });
  ar.afterimage(A, 3);
  await go(A, T(A, g, -6 * s), 260, { ease: 'cubic-bezier(.6,0,.9,.5)' });
  const hp = ar.pt(D, 100, 100);
  ar.burst(hp.x, hp.y, { size: 110, color: '#ffcc80', stroke: '#e64a19' });
  ar.particles(hp.x, hp.y, { kind: 'smoke', color: ['#ff7043', '#ffca28'], n: 10, spread: 3.1, speed: 100, gravity: -60, size: 22, spin: 0 });
  const h = ar.hurt(D, { power: 2, kind: 'fire' });
  await sleep(200); await rotHome(w); await home(A, 300);
  const from = ar.pt(A, 100, 134);
  await ar.proj(svgs.ring, from, ar.pt(D, 100, 60), { size: 44, dur: 300, spin: 900, arc: 40 });
  ar.burst(ar.pt(D, 100, 60).x, ar.pt(D, 100, 60).y, { size: 60 });
  ar.pop(ar.pt(D, 100, 20).x, ar.pt(D, 100, 20).y, '再来一圈！', { size: 20, color: '#ffe082' });
  await ar.proj(svgs.ring, ar.pt(D, 100, 60), from, { size: 44, dur: 300, spin: -900, arc: 40 });
  await h;
} };
M.yangjian = { name: '天眼神光·哮天犬', async run(ar, A, D) {
  const s = ar.s, eye = A.part('.eye3'), dog = A.part('.dog');
  await an(eye, [{ transform: 'scale(1)' }, { transform: 'scale(1.8)' }], 300);
  const e = ar.pt(A, 100, 74), hp = ar.pt(D, 100, 90);
  ar.flash('#ff8a80', 300, .3);
  await ar.line(e.x, e.y, hp.x, hp.y, { color: '#ff5252', glow: '#ff8a80', width: 12, dur: 520 });
  ar.hurt(D, { power: 1, kind: 'light' });
  clear(eye);
  const g = Math.abs(ar.gap(A, D));
  ar.pop(ar.pt(A, 40, 160).x, ar.pt(A, 40, 160).y - 30 * s, '汪！', { size: 30, color: '#fff' });
  await an(dog, [{ transform: 'translateX(0)' }, { transform: `translateX(${g / s * .78}px) translateY(-30px)` }], 360, { easing: 'ease-in' });
  ar.claw(ar.pt(D, 100, 150).x, ar.pt(D, 100, 150).y, { color: '#fff' });
  const h = ar.hurt(D, { power: 2, text: '被咬了！' });
  await an(dog, [{ transform: `translateX(${g / s * .78}px)` }, { transform: 'translateX(0)' }], 380);
  clear(dog); await h;
} };
const tianwangMove = (name, fn) => ({ name, run: fn });
M.chiguo = tianwangMove('琵琶音波', async (ar, A, D) => {
  const s = ar.s, w = A.weapon;
  for (let i = 0; i < 6; i++) { an(w, [{ transform: 'rotate(0)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(0)' }], 120, { fill: 'none' }); const p = ar.pt(A, 160, 120); ar.proj(svgs.note(['#ffeb3b', '#80deea', '#f48fb1'][i % 3]), p, { x: ar.pt(D, 100, 90).x, y: ar.pt(D, 100, 90).y + rnd(-50, 50) * s }, { size: 34, dur: 480, arc: rnd(-50, 50) }); if (i % 2) ar.ring(p.x, p.y, { r: 30, color: '#fff', width: 4, to: 2.5 }); await sleep(110); }
  await sleep(300);
  await ar.hurt(D, { power: 2, kind: 'sound', text: '耳朵嗡嗡！' });
});
M.zengzhang = tianwangMove('青锋巨剑', async (ar, A, D) => {
  const s = ar.s, w = A.weapon;
  await rot(w, [-30], 300);
  an(A.svg, [{ filter: 'drop-shadow(0 0 0 #90caf9)' }, { filter: 'drop-shadow(0 0 14px #90caf9)' }], 300, { fill: 'none' });
  const hp = ar.pt(D, 100, 100);
  const big = ar.spawn(`<svg viewBox="0 0 40 220" overflow="visible"><path d="M14 0 L26 0 L26 180 L20 200 L14 180 Z" fill="#e3f2fd" stroke="#1e88e5" stroke-width="4"/><path d="M20 4 V176" stroke="#fff" stroke-width="3"/><rect x="2" y="-14" width="36" height="12" rx="4" fill="#f2b632" stroke="#3a2618" stroke-width="3"/></svg>`, hp.x, hp.y - 60 * s, 46 * s, 250 * s);
  await an(big, [{ transform: `translateY(${-ar.H}px)` }, { transform: 'translateY(0)' }], 280, { easing: 'ease-in' });
  ar.slash(hp.x, hp.y, { r: 80, rot: 90, color: '#90caf9', width: 16 });
  const h = ar.hurt(D, { power: 3, kind: 'slash' });
  ar.life(big, an(big, [{ opacity: 1 }, { opacity: 0, transform: 'scale(1.3)' }], 400));
  await rotHome(w); await h;
});
M.guangmu = tianwangMove('赤龙缠身', async (ar, A, D) => {
  const s = ar.s, w = A.weapon;
  await rot(w, [60], 200);
  const from = ar.pt(A, 160, 50), to = ar.pt(D, 100, 110);
  await ar.proj(`<div style="transform:scaleX(${A.dir})">${svgs.redsnake}</div>`, from, to, { size: 110, dur: 420, arc: 40 });
  for (let i = 0; i < 3; i++) ar.ring(to.x, to.y + (i - 1) * 30 * s, { r: 46, squash: .35, color: '#e53935', width: 9, from: 1.4, to: .8, dur: 600, delay: i * 80 });
  an(D.mover, [{ transform: 'none' }, { transform: 'scale(.8,1.1)' }, { transform: 'scale(.8,1.1)', offset: .7 }, { transform: 'none' }], 700, { fill: 'none' });
  await sleep(600);
  await ar.hurt(D, { power: 2, text: '勒住了！' });
  await rotHome(w);
});
M.duowen = tianwangMove('混元伞', async (ar, A, D) => {
  const s = ar.s, w = A.weapon;
  await an(w, [{ transform: 'rotate(0)' }, { transform: 'rotate(-20deg) scale(1.25)' }], 300);
  an(w, [{ transform: 'rotate(-20deg) scale(1.25)' }, { transform: 'rotate(340deg) scale(1.25)' }], 700, { easing: 'linear' });
  ar.flash('#1b5e20', 700, .35);
  const from = ar.pt(A, 160, 30), to = ar.pt(D, 100, 90);
  for (let i = 0; i < 8; i++) { ar.proj(`<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#fffde7" stroke="#bdbdbd" stroke-width="2"/></svg>`, from, { x: to.x + rnd(-40, 40) * s, y: to.y + rnd(-50, 50) * s }, { size: 18, dur: 300 }); await sleep(60); }
  const h = ar.hurt(D, { power: 2, text: '珍珠雨！' });
  await sleep(300); clear(w); await h;
});
M.juling = { name: '开山大斧', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 130), w = A.weapon;
  await go(A, T(A, 0, 12, 'scale(1.15,.8)'), 200);
  rot(w, [-150], 300);
  await go(A, T(A, g * .6, -120 * s), 320);
  ar.pop(ar.pt(A, 100, 0, true).x, ar.pt(A, 100, 0, true).y, '开——山——！', { size: 24, color: '#ffccbc' });
  rot(w, [110], 160, 'ease-in');
  await go(A, T(A, g, 0, 'scale(1.15,.85)'), 160, { ease: 'ease-in' });
  const a = ar.pt(A, 160, 208, true), d = ar.pt(D, 100, 208);
  ar.shake(26, 700);
  for (let i = 0; i <= 3; i++) setTimeout(() => ar.crack(a.x + (d.x - a.x) * i / 3, a.y), i * 70);
  ar.dust(d.x, d.y, 14);
  const h = ar.hurt(D, { power: 3 });
  await sleep(300); await rotHome(w); await home(A, 400); await h;
} };
M.longwang = { name: '东海巨浪', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await an(w, [{ transform: 'translateY(0)' }, { transform: 'translateY(-30px) scale(1.3)' }], 300);
  ar.flash('#4fc3f7', 600, .3);
  const from = ar.pt(A, 60, 160), to = ar.pt(D, 100, 140);
  ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '东海之水，来！', { size: 20, color: '#b3e5fc' });
  await ar.wave(from, to, { dur: 700 });
  const h = ar.hurt(D, { power: 3, kind: 'water' });
  clear(w); await h;
} };
M.leigong = { name: '五雷轰顶', async run(ar, A, D) {
  const s = ar.s, [ham, chi] = A.weapons;
  for (let i = 0; i < 2; i++) {
    await Promise.all([rot(ham, [-60], 120), rot(chi, [40], 120)]);
    await Promise.all([rot(ham, [10], 90, 'ease-in'), rot(chi, [-10], 90, 'ease-in')]);
    const p = ar.pt(A, 100, 100); ar.pop(p.x, p.y - 100 * s, '轰隆！', { size: 30, color: '#fff59d' }); ar.burst(p.x, p.y - 20 * s, { size: 50 });
    const hp = ar.pt(D, 100, 100); ar.bolt(hp.x + rnd(-14, 14) * s, hp.y);
    await sleep(200);
  }
  await ar.hurt(D, { power: 3, kind: 'thunder', text: '麻麻的！' });
  await Promise.all([rotHome(ham), rotHome(chi)]);
} };
M.dianmu = { name: '金光乍现', async run(ar, A, D) {
  const s = ar.s, [m1, m2] = A.weapons;
  await Promise.all([an(m1, [{ transform: 'none' }, { transform: 'translate(30px,-20px)' }], 260), an(m2, [{ transform: 'none' }, { transform: 'translate(-30px,-20px)' }], 260)]);
  const p = ar.pt(A, 100, 110), hp = ar.pt(D, 100, 84);
  ar.burst(p.x, p.y, { size: 120, color: '#fffde7', stroke: '#ffeb3b' });
  ar.flash('#fff', 500, .95);
  ar.line(p.x, p.y, hp.x, hp.y, { color: '#fff59d', width: 26, dur: 500 });
  ar.pop(hp.x, hp.y - 70 * s, '好刺眼！', { size: 22, color: '#fff' });
  await ar.hurt(D, { power: 2, kind: 'light' });
  clear(m1, m2);
} };
M.zhenyuan = { name: '袖里乾坤', async run(ar, A, D) {
  const s = ar.s, sl = A.part('.sleeveR');
  await an(sl, [{ transform: 'scale(1)' }, { transform: 'scale(2.2) rotate(-20deg)' }], 350, { easing: 'cubic-bezier(.3,1.6,.5,1)' });
  const mouth = ar.pt(A, 176, 170), hp = ar.pt(D, 100, 110);
  ar.speed(hp.x, hp.y, -A.dir, { n: 8, color: 'rgba(139,195,74,.8)' });
  ar.pop(mouth.x, mouth.y - 120 * s, '收！', { size: 34, color: '#c5e1a5' });
  const dx = mouth.x - hp.x, dy = mouth.y - hp.y;
  await an(D.mover, [{ transform: 'none' }, { transform: `translate(${dx * .5}px,${dy * .5}px) rotate(${A.dir * -360}deg) scale(.6)` }, { transform: `translate(${dx}px,${dy}px) rotate(${A.dir * -720}deg) scale(.05)`, opacity: 0 }], 600, { easing: 'ease-in' });
  for (let i = 0; i < 4; i++) await an(sl, [{ transform: 'scale(2.2) rotate(-20deg)' }, { transform: `scale(2.4,2) rotate(${i % 2 ? -10 : -30}deg)` }, { transform: 'scale(2.2) rotate(-20deg)' }], 150, { fill: 'none' });
  clear(D.mover);
  await an(D.mover, [{ transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }, { transform: `translate(${dx * .5}px,${dy * .5 - 80 * s}px) rotate(${A.dir * 360}deg) scale(.8)`, opacity: 1 }, { transform: 'none', opacity: 1 }], 500, { easing: 'ease-out', fill: 'none' });
  clear(sl);
  await ar.hurt(D, { power: 2, text: '转晕了' });
} };
M.shouxing = { name: '仙鹤送桃', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-15], 200);
  const top = ar.pt(A, 100, -20), hp = ar.pt(D, 100, 30);
  ar.pop(ar.pt(A, 100, 10).x, ar.pt(A, 100, 10).y, '鹤来！', { size: 24, color: '#fff' });
  const crane = ar.proj(`<div style="transform:scaleX(${A.dir})">${svgs.crane}</div>`, { x: top.x - A.dir * 60 * s, y: top.y }, { x: hp.x + A.dir * 120 * s, y: top.y - 10 * s }, { size: 110, dur: 900, arc: 30 });
  await sleep(420);
  await ar.proj(svgs.peach, { x: hp.x, y: top.y }, hp, { size: 46, dur: 260, spin: 360 });
  ar.pop(hp.x, hp.y - 20 * s, '咚！', { size: 34, color: '#ffccbc' });
  const h = ar.hurt(D, { power: 2, text: '大包！' });
  await crane; await rotHome(w); await h;
} };
M.wenshu = { name: '智慧剑·狮吼', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-40], 220); await rot(w, [100], 150, 'ease-in');
  const hp = ar.pt(D, 100, 100); ar.slash(hp.x, hp.y, { r: 80, rot: 60, color: '#bbdefb', width: 16 });
  ar.hurt(D, { power: 1, kind: 'slash' });
  await sleep(450);
  const p = ar.pt(A, 140, 90); ar.pop(p.x, p.y - 30 * s, '吼——！', { size: 38, color: '#80cbc4', dur: 900 });
  for (let i = 0; i < 4; i++) ar.ring(p.x + A.dir * i * 40 * s, p.y, { r: 40, color: '#80cbc4', width: 7, to: 2.2, delay: i * 70 });
  await sleep(250);
  await ar.hurt(D, { power: 2, kind: 'sound' });
  await rotHome(w);
} };
M.puxian = { name: '如意莲台', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-30], 250);
  an(A.svg, [{ filter: 'drop-shadow(0 0 0 #a5d6a7)' }, { filter: 'drop-shadow(0 0 14px #a5d6a7)' }, { filter: 'none' }], 700, { fill: 'none' });
  const gp = ar.pt(D, 100, 206);
  const lo = ar.spawn(svgs.lotus, gp.x, gp.y - 20 * s, 180 * s, 80 * s); lo.style.transformOrigin = '50% 100%';
  an(lo, [{ transform: 'scale(0)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], 400);
  await sleep(250);
  await an(D.mover, [{ transform: 'none' }, { transform: 'translateY(-70px) rotate(360deg)' }, { transform: 'translateY(-70px) rotate(720deg)' }, { transform: 'none' }], 1000, { fill: 'none', easing: 'ease-in-out' });
  ar.life(lo, an(lo, [{ opacity: 1 }, { opacity: 0 }], 300));
  await ar.hurt(D, { power: 1, kind: 'magic', text: '定！' });
  await rotHome(w);
} };
M.mile = { name: '人种袋', async run(ar, A, D) {
  const s = ar.s, bag = A.part('.bag');
  ar.pop(ar.pt(A, 100, 10).x, ar.pt(A, 100, 10).y, '哈哈哈！', { size: 28, color: '#ffe082' });
  await an(bag, [{ transform: 'none' }, { transform: 'scale(1.8) rotate(-30deg)' }], 320, { easing: 'cubic-bezier(.3,1.6,.5,1)' });
  const mouth = ar.pt(A, 156, 120), hp = ar.pt(D, 100, 110);
  ar.speed(hp.x, hp.y, -A.dir, { n: 8, color: 'rgba(215,204,200,.9)' });
  const dx = mouth.x - hp.x, dy = mouth.y - hp.y;
  await an(D.mover, [{ transform: 'none' }, { transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }], 500, { easing: 'ease-in' });
  for (let i = 0; i < 5; i++) await an(bag, [{ transform: 'scale(1.8) rotate(-30deg)' }, { transform: `scale(${i % 2 ? 2.1 : 1.6},${i % 2 ? 1.6 : 2.1}) rotate(-30deg)` }, { transform: 'scale(1.8) rotate(-30deg)' }], 130, { fill: 'none' });
  clear(D.mover);
  await an(D.mover, [{ transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }, { transform: `translate(${dx * .4}px,${-100 * s}px) rotate(${A.dir * 540}deg)`, opacity: 1 }, { transform: 'none', opacity: 1 }], 560, { fill: 'none' });
  clear(bag);
  await ar.hurt(D, { power: 2, text: '吐出来了' });
} };
M.maori = { name: '金鸡报晓', async run(ar, A, D) {
  const s = ar.s;
  await go(A, T(A, -6 * s, 0, 'scale(.95,1.12)'), 260);
  go(A, T(A, 6 * s, 0, 'scale(1.1,.95)'), 160);
  const p = ar.pt(A, 126, 104);
  ar.flash('#ffb74d', 700, .4);
  ar.pop(p.x + A.dir * 60 * s, p.y - 70 * s, '喔喔喔——！', { size: 30, color: '#ffe082', dur: 1100 });
  for (let i = 0; i < 5; i++) ar.ring(p.x + A.dir * i * 50 * s, p.y, { r: 36, color: '#ffcc80', width: 6, to: 2.4, delay: i * 80 });
  await sleep(450);
  await an(D.mover, [{ transform: 'none' }, { transform: 'scale(.6)' }, { transform: 'scale(.6)', offset: .7 }, { transform: 'none' }], 700, { fill: 'none' });
  await ar.hurt(D, { power: 2, kind: 'sound', text: '缩小了！' });
  await home(A);
} };


// ================= 修改：错题小妖 =================
M.xiaozuanfeng = { name: '巡山锣', async run(ar, A, D) {
  const s = ar.s, [gong, mallet] = A.weapons;
  for (let i = 0; i < 3; i++) {
    await rot(mallet, [-82], 110, 'ease-in');
    const p = ar.pt(A, 90, 154);
    ar.burst(p.x, p.y, { size: 46, color: '#fff59d', stroke: '#e5b33c' });
    ar.pop(p.x, p.y - 70 * s, '咣！', { size: 28, color: '#ffd54f', dur: 600 });
    an(gong, [{ transform: 'rotate(0)' }, { transform: 'rotate(-16deg)' }, { transform: 'rotate(10deg)' }, { transform: 'rotate(0)' }], 300, { fill: 'none' });
    for (let k = 0; k < 3; k++) ar.ring(p.x, p.y, { r: 26, color: '#ffd54f', width: 5, to: 3.4, delay: k * 90 });
    ar.proj(`<div style="transform:scaleX(${A.dir})">${svgs.sound}</div>`, p, ar.pt(D, 100, 90), { size: 56, dur: 360 });
    an(D.mover, [{ transform: 'none' }, { transform: 'scale(1.06,.94)' }, { transform: 'none' }], 160, { fill: 'none', delay: 300 });
    await rot(mallet, [8], 140);
  }
  A.mouth(900); ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '大王叫我来巡山～', { size: 18, color: '#fff', dur: 1200 });
  await sleep(250); await rotHome(mallet);
  await ar.hurt(D, { power: 2, kind: 'sound', text: '耳朵要聋了！' });
} };
M.benbo = { name: '大泡泡困敌', async run(ar, A, D) {
  const s = ar.s;
  await go(A, T(A, -12 * s, 0, 'scale(1.18,1.08)'), 380);
  A.mouth(900);
  const from = ar.pt(A, 100, 110), to = ar.pt(D, 100, 110);
  ar.particles(from.x, from.y, { kind: 'bubble', n: 8, angle: A.dir > 0 ? 0 : 180, spread: .5, speed: 90, gravity: -40, size: 16 });
  go(A, T(A, 8 * s, 0, 'scale(.92,1)'), 160);
  const big = await ar.proj(svgs.bigBubble, from, to, { size: 210, dur: 520, keep: true, ease: 'ease-out' });
  // 泡泡把妖怪装进去，往上飘
  await Promise.all([
    an(big, [{ transform: `translate(${to.x - from.x}px,${to.y - from.y}px) scale(1)` }, { transform: `translate(${to.x - from.x}px,${to.y - from.y - 70 * s}px) scale(1.05)` }], 800, { easing: 'ease-in-out' }),
    an(D.mover, [{ transform: 'none' }, { transform: `translateY(-${70 * s}px) rotate(${-D.dir * 20}deg)` }], 800, { easing: 'ease-in-out' }),
  ]);
  await an(D.mover, [0, 1, 2, 3, 4].map(i => ({ transform: `translateY(-${70 * s}px) rotate(${i % 2 ? 12 : -12}deg)` })), 500);
  big.remove();
  const c = ar.pt(D, 100, 40);
  ar.pop(c.x, c.y - 30 * s, '啵！', { size: 40, color: '#b3e5fc', stroke: '#0277bd' });
  ar.particles(c.x, c.y + 60 * s, { kind: 'drop', color: '#81d4fa', n: 16, spread: 3.1, speed: 120, size: 13 });
  clear(D.mover);
  await an(D.mover, [{ transform: `translateY(-${70 * s}px)` }, { transform: 'translateY(0) scale(1.2,.75)', offset: .8 }, { transform: 'none' }], 300, { easing: 'ease-in', fill: 'none' });
  const h = ar.hurt(D, { power: 2, kind: 'water' });
  await home(A); await h;
} };
M.babo = { name: '墨汁炮', async run(ar, A, D) {
  const s = ar.s;
  await go(A, T(A, -16 * s, 0, 'scale(.9,1.15)'), 260);
  A.mouth(700);
  await go(A, T(A, 10 * s, 0, 'scale(1.15,.9)'), 120);
  const from = ar.pt(A, 100, 106), to = ar.pt(D, 100, 90);
  for (let i = 0; i < 2; i++) ar.proj(svgs.ink, from, { x: to.x, y: to.y + (i ? 40 : -10) * s }, { size: 34, dur: 380, arc: 40, spin: 360 });
  await ar.proj(svgs.ink, from, to, { size: 64, dur: 420, arc: 60, spin: 360 });
  ar.particles(to.x, to.y, { kind: 'dot', color: '#263238', n: 14, spread: 3.1, speed: 100, size: 12 });
  ar.pop(to.x, to.y - 80 * s, '啪叽！', { size: 32, color: '#90a4ae' });
  const h = ar.hurt(D, { power: 2, kind: 'ink' });
  await home(A); await h;
} };

// ================= 第二批妖怪招式 =================
M.baigujing = { name: '尸魔三变', async run(ar, A, D) {
  const s = ar.s, c = ar.pt(A, 100, 110);
  for (const t of ['变！', '再变！', '三变！']) {
    ar.particles(c.x, c.y, { kind: 'smoke', color: ['#7b1fa2', '#9c27b0', '#4a148c'], n: 10, spread: 3.1, speed: 60, gravity: -20, size: 40, spin: 0, dur: 500 });
    ar.pop(c.x, c.y - 130 * s, t, { size: 24, color: '#e1bee7', stroke: '#4a148c', dur: 500 });
    await an(A.mover, [{ transform: 'scale(1)' }, { transform: 'scale(.2,1.3)', filter: 'hue-rotate(90deg)' }, { transform: 'scale(1)' }], 380, { fill: 'none' });
  }
  A.mouth(800);
  const from = ar.pt(A, 150, 90), to = ar.pt(D, 100, 90);
  await Promise.all([0, 1, 2].map(i => sleep(i * 150).then(() => ar.proj(svgs.ghost, from, { x: to.x, y: to.y + (i - 1) * 40 * s }, { size: 54, dur: 480, arc: 60 * (i - 1) }))));
  await ar.hurt(D, { power: 2, kind: 'poison', text: '阴风阵阵！' });
} };
M.huangpao = { name: '钢刀·舍利内丹', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 115), w = A.weapon;
  await rot(w, [-50], 160);
  await go(A, T(A, g, 0), 220, { ease: 'ease-in' });
  rot(w, [120], 140, 'ease-in');
  const hp = ar.pt(D, 100, 100); ar.slash(hp.x, hp.y, { r: 70, rot: 30, color: '#f2c94c', width: 14 });
  ar.hurt(D, { power: 1, kind: 'slash' });
  await rotHome(w); await home(A, 260);
  A.mouth(700);
  const from = ar.pt(A, 100, 110);
  ar.pop(from.x, from.y - 120 * s, '内丹出！', { size: 22, color: '#fff59d' });
  await ar.proj(`<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="24" fill="#fffde7" stroke="#ffca28" stroke-width="5"/><circle cx="22" cy="22" r="7" fill="#fff"/></svg>`, from, hp, { size: 50, dur: 420, arc: 50 });
  ar.ring(hp.x, hp.y, { r: 60, color: '#ffeb3b', width: 8 }); ar.flash('#fff59d', 300, .5);
  await ar.hurt(D, { power: 3, kind: 'light' });
} };
M.jinjiao = { name: '紫金红葫芦', async run(ar, A, D) {
  const s = ar.s, gourd = A.part('.gourd');
  await an(gourd, [{ transform: 'none' }, { transform: 'translate(10px,-40px) rotate(150deg) scale(1.4)' }], 400);
  A.mouth(700);
  const a = ar.pt(A, 100, 0), d = ar.pt(D, 100, 0);
  ar.pop(a.x, a.y, '孙行者！', { size: 26, color: '#ffeb3b', dur: 1000 });
  await sleep(700);
  ar.pop(d.x, d.y, '哎！', { size: 30, color: '#fff', dur: 800 });
  await sleep(500);
  const mouth = ar.pt(A, 60, 110), hp = ar.pt(D, 100, 110);
  ar.speed(hp.x, hp.y, -A.dir, { n: 10, color: 'rgba(255,183,77,.9)' });
  const dx = mouth.x - hp.x, dy = mouth.y - hp.y;
  await an(D.mover, [{ transform: 'none' }, { transform: `translate(${dx * .5}px,${dy * .5}px) scale(.5,1.4)` }, { transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }], 600, { easing: 'ease-in' });
  for (let i = 0; i < 5; i++) await an(gourd, [{ transform: 'translate(10px,-40px) rotate(150deg) scale(1.4)' }, { transform: `translate(10px,-40px) rotate(${150 + (i % 2 ? 12 : -12)}deg) scale(1.55,1.3)` }, { transform: 'translate(10px,-40px) rotate(150deg) scale(1.4)' }], 140, { fill: 'none' });
  ar.pop(mouth.x, mouth.y - 80 * s, '一时三刻化为脓！', { size: 18, color: '#ffccbc' });
  await sleep(500); clear(D.mover);
  await an(D.mover, [{ transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }, { transform: `translate(${dx * .5}px,${-120 * s}px) rotate(${A.dir * 720}deg)`, opacity: 1 }, { transform: 'none', opacity: 1 }], 600, { fill: 'none' });
  clear(gourd);
  await ar.hurt(D, { power: 2, text: '逃出来了！' });
} };
M.yinjiao = { name: '幌金绳', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-30], 200);
  const from = ar.pt(A, 50, 160), hp = ar.pt(D, 100, 120);
  ar.pop(from.x, from.y - 140 * s, '捆！', { size: 34, color: '#ffeb3b' });
  await ar.proj(`<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="22" fill="none" stroke="#3a2618" stroke-width="10"/><circle cx="30" cy="30" r="22" fill="none" stroke="#f2c94c" stroke-width="6" stroke-dasharray="8 4"/></svg>`, from, hp, { size: 70, dur: 420, spin: 720, arc: 60 });
  const rings = [];
  for (let i = 0; i < 4; i++) { const r = ar.spawn(`<svg viewBox="0 0 100 30"><ellipse cx="50" cy="15" rx="46" ry="11" fill="none" stroke="#3a2618" stroke-width="7"/><ellipse cx="50" cy="15" rx="46" ry="11" fill="none" stroke="#f2c94c" stroke-width="4"/></svg>`, hp.x, hp.y - 40 * s + i * 26 * s, 120 * s, 34 * s); rings.push(r); an(r, [{ transform: 'scale(1.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], 220, { delay: i * 80 }); }
  await an(D.mover, [{ transform: 'none' }, { transform: 'scale(.85,1.02)' }].concat(Array.from({ length: 8 }, (_, i) => ({ transform: `scale(.85,1.02) rotate(${i % 2 ? 5 : -5}deg)` }))).concat([{ transform: 'scale(.85,1.02)' }]), 1000);
  ar.pop(hp.x, hp.y - 110 * s, '动不了！', { size: 22, color: '#fff' });
  rings.forEach(r => ar.life(r, an(r, [{ opacity: 1 }, { opacity: 0, transform: 'scale(1.6)' }], 300)));
  clear(D.mover);
  await ar.hurt(D, { power: 2 });
  await rotHome(w);
} };
M.qingmaoshi = { name: '推下御井', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 90);
  await go(A, T(A, g, 0), 380, { ease: 'ease-in-out' });
  const gp = ar.pt(D, 100, 206);
  const well = ar.spawn(svgs.well, gp.x, gp.y - 10 * s, 170 * s, 70 * s); well.style.zIndex = 3;
  an(well, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], 260, { easing: 'cubic-bezier(.3,1.6,.5,1)' });
  ar.pop(ar.pt(A, 100, 0, true).x, ar.pt(A, 100, 0, true).y, '下去吧！', { size: 24, color: '#ffe082' });
  await go(A, T(A, g + 20 * s, 0, `rotate(${A.dir * 12}deg)`), 140);
  await an(D.mover, [{ transform: 'none' }, { transform: `translate(${-D.dir * 20}px,-30px) rotate(${-D.dir * 20}deg)`, offset: .3 }, { transform: 'translateY(120px) scale(.5)', opacity: 0 }], 700, { easing: 'ease-in' });
  ar.pop(gp.x, gp.y - 60 * s, '扑通！', { size: 36, color: '#81d4fa', stroke: '#01579b' });
  ar.particles(gp.x, gp.y - 20 * s, { kind: 'drop', color: '#81d4fa', n: 14, spread: .8, speed: 140, size: 13 });
  await home(A, 300); await sleep(500);
  clear(D.mover);
  await an(D.mover, [{ transform: 'translateY(120px) scale(.5)', opacity: 0 }, { transform: 'translateY(-60px) scale(1.05)', opacity: 1, offset: .6 }, { transform: 'none', opacity: 1 }], 600, { fill: 'none' });
  ar.life(well, an(well, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.4)' }], 300));
  await ar.hurt(D, { power: 2, kind: 'water', text: '湿透了！' });
} };
M.honghaier = { name: '三昧真火', async run(ar, A, D) {
  const s = ar.s;
  for (let i = 0; i < 2; i++) { await go(A, T(A, 0, 0, `rotate(${A.dir * -8}deg) scale(1.05,.95)`), 110); await go(A, 'translate(0px,0px)', 110); }
  ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '三昧真火！', { size: 26, color: '#ffab40', stroke: '#bf360c' });
  A.mouth(1500);
  const from = ar.pt(A, 100, 110), to = ar.pt(D, 100, 100);
  ar.flash('#ff7043', 900, .25);
  await ar.stream(from, to, { n: 26, colors: ['#ff7043', '#ffab40', '#ff5722', '#ffd54f'], size: 30, gap: 32 });
  await ar.hurt(D, { power: 3, kind: 'fire', text: '烧焦了！' });
  await home(A);
} };
M.tuolong = { name: '钢鞭卷浪', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 120), w = A.weapon;
  const hp = ar.pt(D, 100, 120);
  for (let i = 0; i < 3; i++) { await rot(w, [-80], 90); await rot(w, [100], 110, 'ease-in'); ar.slash(hp.x - A.dir * (g * .5 - i * 10), hp.y, { r: 50, rot: i * 40, color: '#4fc3f7', width: 10 }); }
  for (let i = 0; i < 3; i++) ar.ring(hp.x, hp.y + 40 * s, { r: 60, squash: .35, color: '#29b6f6', width: 10, from: 1.6, to: .7, dur: 500, delay: i * 120 });
  an(D.mover, [{ transform: 'none' }, { transform: 'rotate(360deg)' }], 700, { fill: 'none' });
  await sleep(500); await rotHome(w);
  A.mouth(600);
  await go(A, T(A, g, 0), 200, { ease: 'ease-in' });
  ar.pop(hp.x, hp.y - 110 * s, '咔嚓！', { size: 34, color: '#c5e1a5' });
  const h = ar.hurt(D, { power: 2, kind: 'water' });
  await home(A); await h;
} };
M.huli = { name: '令牌风云雷', async run(ar, A, D) {
  const s = ar.s, w = A.weapon, hp = ar.pt(D, 100, 100), top = ar.pt(D, 100, -10);
  const steps = ['一声令牌风来！', '二声令牌云起！', '三声令牌雷闪！'];
  for (let i = 0; i < 3; i++) {
    await rot(w, [-40], 120); await rot(w, [10], 90, 'ease-in');
    ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y + i * 26 * s, steps[i], { size: 18, color: '#ffe082', dur: 900 });
    if (i === 0) ar.particles(hp.x - A.dir * 120 * s, hp.y, { kind: 'leaf', color: ['#c0ca33', '#ffb300'], n: 12, angle: A.dir > 0 ? 0 : 180, spread: .4, speed: 160, gravity: 0, size: 13 });
    if (i === 1) { const cl = ar.spawn(svgs.cloud, top.x, top.y, 160 * s, 60 * s); ar.life(cl, an(cl, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)', offset: .2 }, { opacity: 1, offset: .85 }, { opacity: 0 }], 1500)); }
    if (i === 2) ar.bolt(hp.x, hp.y);
    await sleep(260);
  }
  await ar.hurt(D, { power: 3, kind: 'thunder' });
  await rotHome(w);
} };
M.luli = { name: '符咒贴身', async run(ar, A, D) {
  const s = ar.s, from = ar.pt(A, 150, 110), hp = ar.pt(D, 100, 100);
  const tal = `<svg viewBox="0 0 20 50"><rect x="1" y="1" width="18" height="48" fill="#fff176" stroke="#3a2618" stroke-width="2"/><path d="M5 8 l10 8 l-10 8 l10 8 l-10 8" stroke="#c62828" stroke-width="2.4" fill="none"/></svg>`;
  ar.pop(from.x, from.y - 120 * s, '急急如律令！', { size: 20, color: '#fff176' });
  const stuck = [];
  for (let i = 0; i < 3; i++) { const t = { x: hp.x + (i - 1) * 26 * s, y: hp.y + (i % 2 ? 30 : -20) * s }; await ar.proj(tal, from, t, { size: 40, dur: 260, spin: 720, arc: 30 }); const el = ar.spawn(tal, t.x, t.y, 22 * s, 54 * s); el.style.transform = `rotate(${(i - 1) * 15}deg)`; stuck.push(el); }
  await an(D.mover, Array.from({ length: 6 }, (_, i) => ({ transform: `translateX(${i % 2 ? 3 : -3}px)` })).concat([{ transform: 'none' }]), 500, { fill: 'none' });
  stuck.forEach(el => { const r = el.getBoundingClientRect(), b = ar.root.getBoundingClientRect(); ar.burst(r.left - b.left + r.width / 2, r.top - b.top + r.height / 2, { size: 60, color: '#fff176', stroke: '#c62828' }); el.remove(); });
  await ar.hurt(D, { power: 2, kind: 'magic', text: '定身符！' });
} };
M.yangli = { name: '滚油锅', async run(ar, A, D) {
  const s = ar.s, p = ar.pt(A, 170, 190);
  const pot = ar.spawn(svgs.pot, p.x, p.y - 10 * s, 110 * s, 80 * s);
  await an(pot, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], 300, { easing: 'cubic-bezier(.3,1.6,.5,1)' });
  ar.particles(p.x, p.y - 30 * s, { kind: 'bubble', n: 10, angle: -90, spread: .5, speed: 60, gravity: -30, size: 14, stagger: 40 });
  ar.pop(p.x, p.y - 90 * s, '咕嘟咕嘟', { size: 20, color: '#ffe082' });
  await sleep(500);
  await rot(A.weapon, [70], 160);
  const hp = ar.pt(D, 100, 90);
  for (let i = 0; i < 6; i++) ar.proj(`<svg viewBox="0 0 30 30"><path d="M15 2 C22 12 26 18 26 22 A11 11 0 0 1 4 22 C4 18 8 12 15 2 Z" fill="#ffca28" stroke="#e65100" stroke-width="2"/></svg>`, { x: p.x, y: p.y - 30 * s }, { x: hp.x + rnd(-30, 30) * s, y: hp.y + rnd(-30, 40) * s }, { size: 22, dur: 420, arc: 80 + i * 10 });
  await sleep(450);
  const h = ar.hurt(D, { power: 2, kind: 'fire', text: '好烫！' });
  ar.life(pot, an(pot, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.3)' }], 300, { delay: 400 }));
  await rotHome(A.weapon); await h;
} };
M.linggan = { name: '冰封通天河', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await rot(w, [-120], 260);
  await rot(w, [80], 140, 'ease-in');
  const gp = ar.pt(A, 170, 206), dp = ar.pt(D, 100, 206);
  ar.shake(10, 300);
  for (let i = 0; i <= 4; i++) { const x = gp.x + (dp.x - gp.x) * i / 4; setTimeout(() => ar.particles(x, gp.y, { kind: 'spark', color: ['#e1f5fe', '#b3e5fc', '#fff'], n: 6, angle: -90, spread: .6, speed: 70, size: 14 }), i * 70); }
  ar.ring(dp.x, dp.y, { r: 70, squash: .3, color: '#b3e5fc', width: 10, to: 2 });
  ar.pop(dp.x, dp.y - 200 * s, '冻住！', { size: 32, color: '#e1f5fe', stroke: '#0277bd' });
  await sleep(300);
  await ar.hurt(D, { power: 2, kind: 'ice' });
  await rotHome(w);
} };
M.sidawang = { name: '金刚琢缴械', async run(ar, A, D) {
  const s = ar.s, zhuo = A.part('.zhuo'), from = ar.pt(A, 52, 150), hp = ar.pt(D, 100, 120);
  zhuo.style.opacity = 0;
  ar.pop(from.x, from.y - 100 * s, '套！', { size: 34, color: '#eceff1' });
  await ar.proj(svgs.ringW, from, hp, { size: 60, dur: 420, spin: 1080, arc: 60 });
  const dw = D.weapon; let ghost = null;
  ar.flash('#fff', 200, .6);
  if (dw) { dw.style.opacity = 0; ghost = true; }
  ar.pop(hp.x, hp.y - 100 * s, '缴械！', { size: 30, color: '#ffeb3b' });
  await ar.proj(ghost ? svgs.ringSpear : svgs.ringW, hp, from, { size: 60, dur: 420, spin: -1080, arc: 60 });
  zhuo.style.opacity = '';
  const g = near(ar, A, D, 150), w = A.weapon;
  await rot(w, [88], 140);
  await go(A, T(A, g, 0), 180, { ease: 'ease-in' });
  const h = ar.hurt(D, { power: 2, kind: 'pierce' });
  await sleep(200); await rotHome(w); await home(A); await h;
  if (dw) dw.style.opacity = '';
} };
M.xiezi = { name: '倒马毒桩', async run(ar, A, D) {
  const s = ar.s, tail = A.part('.stinger'), g = near(ar, A, D, 150);
  await go(A, T(A, g * .5, 0), 260);
  await an(tail, [{ transform: 'rotate(0)' }, { transform: 'rotate(-25deg)' }], 300);
  ar.pop(ar.pt(A, 160, 40, true).x, ar.pt(A, 160, 40, true).y, '蛰！', { size: 34, color: '#ff8a65' });
  await an(tail, [{ transform: 'rotate(-25deg)' }, { transform: 'rotate(55deg) scale(1.3)' }], 140, { easing: 'ease-in' });
  const hp = ar.pt(D, 100, 60); ar.burst(hp.x, hp.y, { size: 70, color: '#ccff90', stroke: '#558b2f' });
  const h = ar.hurt(D, { power: 3, kind: 'poison', text: '头好疼！' });
  await an(tail, [{ transform: 'rotate(55deg) scale(1.3)' }, { transform: 'rotate(0)' }], 300);
  clear(tail); await home(A); await h;
} };
M.niumowang = { name: '大力蛮牛冲', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 100);
  ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '哞——！', { size: 36, color: '#ffccbc', dur: 1000 });
  for (let i = 0; i < 2; i++) { await go(A, T(A, -10 * s, 0, `rotate(${A.dir * 14}deg) scale(1.05,.92)`), 160); const f = ar.pt(A, 100, 210); ar.dust(f.x, f.y, 6); ar.shake(6, 160); await go(A, T(A, -10 * s, 0, `rotate(${A.dir * 18}deg)`), 120); }
  ar.afterimage(A, 4);
  await go(A, T(A, g, 0, `rotate(${A.dir * 20}deg)`), 240, { ease: 'cubic-bezier(.6,0,.9,.5)' });
  const hp = ar.pt(D, 100, 110); ar.burst(hp.x, hp.y, { size: 130 }); ar.shake(22, 600);
  const h = ar.hurt(D, { power: 3, text: '撞飞了！' });
  await sleep(200); await home(A, 420); await h;
} };
M.tieshan = { name: '芭蕉扇·一扇万里', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  await an(w, [{ transform: 'rotate(0)' }, { transform: 'rotate(-60deg) scale(1.6)' }], 360);
  ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '扇！', { size: 40, color: '#c5e1a5' });
  await an(w, [{ transform: 'rotate(-60deg) scale(1.6)' }, { transform: 'rotate(70deg) scale(1.6)' }], 180, { easing: 'ease-in' });
  const from = ar.pt(A, 170, 100), hp = ar.pt(D, 100, 110);
  for (let i = 0; i < 8; i++) ar.line(from.x, from.y + rnd(-70, 70) * s, hp.x + D.dir * -80 * s, hp.y + rnd(-80, 60) * s, { width: 5, color: 'rgba(197,225,165,.9)', dur: 400 });
  ar.particles(hp.x, hp.y, { kind: 'leaf', color: ['#7cb342', '#c0ca33'], n: 14, angle: A.dir > 0 ? -20 : 200, spread: .6, speed: 220, gravity: 0, size: 13 });
  await ar.hurt(D, { power: 2, kind: 'fly', text: '一扇八万四千里！' });
  clear(w);
} };
M.jiutouchong = { name: '九头连啄', async run(ar, A, D) {
  const s = ar.s, heads = A.parts('.sway'), hp = ar.pt(D, 100, 90);
  await go(A, T(A, near(ar, A, D, 150) * .6, 0), 260);
  for (let i = 0; i < heads.length; i++) {
    an(heads[i], [{ transform: 'rotate(0)' }, { transform: `rotate(${30 + (i % 3) * 8}deg) scale(1.25)` }, { transform: 'rotate(0)' }], 220, { fill: 'none' });
    ar.burst(hp.x + rnd(-30, 30) * s, hp.y + rnd(-40, 40) * s, { size: 40 });
    an(D.mover, [{ transform: 'none' }, { transform: `translate(${-D.dir * 6}px,0) rotate(${i % 2 ? 4 : -4}deg)` }, { transform: 'none' }], 120, { fill: 'none' });
    await sleep(95);
  }
  A.mouth(400);
  ar.pop(hp.x, hp.y - 110 * s, '九连啄！', { size: 30, color: '#d1c4e9' });
  const h = ar.hurt(D, { power: 2 });
  await home(A); await h;
} };
M.huangmei = { name: '金铙罩顶', async run(ar, A, D) {
  const s = ar.s, cy = A.part('.cymbal'); cy.style.opacity = 0;
  const hp = ar.pt(D, 100, 120);
  ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '金铙合！', { size: 26, color: '#ffe082' });
  const top = ar.spawn(svgs.nao, hp.x, hp.y - 300 * s, 210 * s, 110 * s), bot = ar.spawn(svgs.nao.replace('<svg ', '<svg style="transform:scaleY(-1)" '), hp.x, hp.y + 300 * s, 210 * s, 110 * s);
  await Promise.all([an(top, [{ transform: 'translateY(0)' }, { transform: `translateY(${246 * s}px)` }], 420, { easing: 'ease-in' }), an(bot, [{ transform: 'translateY(0)' }, { transform: `translateY(${-246 * s}px)` }], 420, { easing: 'ease-in' })]);
  D.mover.style.visibility = 'hidden';
  ar.pop(hp.x, hp.y - 120 * s, '铛——！', { size: 40, color: '#ffeb3b' }); ar.shake(14, 400);
  for (let i = 0; i < 4; i++) { const k = [{ transform: `translateY(${246 * s}px) rotate(0)` }, { transform: `translateY(${246 * s}px) rotate(${i % 2 ? 4 : -4}deg)` }, { transform: `translateY(${246 * s}px) rotate(0)` }]; an(top, k, 160, { fill: 'none' }); await sleep(170); }
  await Promise.all([an(top, [{ transform: `translateY(${246 * s}px)` }, { transform: 'translateY(0)', opacity: 0 }], 400), an(bot, [{ transform: `translateY(${-246 * s}px)` }, { transform: 'translateY(0)', opacity: 0 }], 400)]);
  top.remove(); bot.remove(); D.mover.style.visibility = ''; cy.style.opacity = '';
  await ar.hurt(D, { power: 2, kind: 'sound', text: '震晕了！' });
} };
M.saitaisui = { name: '紫金铃三响', async run(ar, A, D) {
  const s = ar.s, bells = A.part('.bells'), hp = ar.pt(D, 100, 100);
  const shakeB = () => an(bells, Array.from({ length: 6 }, (_, i) => ({ transform: `rotate(${i % 2 ? 8 : -8}deg)` })).concat([{ transform: 'none' }]), 300, { fill: 'none' });
  await shakeB(); ar.pop(hp.x, hp.y - 100 * s, '一摇火来！', { size: 22, color: '#ffab40' });
  ar.particles(hp.x, hp.y + 40 * s, { kind: 'smoke', color: ['#ff7043', '#ffca28', '#ff5722'], n: 16, angle: -90, spread: .6, speed: 120, gravity: -60, size: 26, spin: 0 });
  ar.hurt(D, { power: 1, kind: 'fire' });
  await sleep(700); await shakeB(); ar.pop(hp.x, hp.y - 100 * s, '二摇烟来！', { size: 22, color: '#bdbdbd' });
  ar.particles(hp.x, hp.y, { kind: 'smoke', color: ['#616161', '#9e9e9e', '#757575'], n: 18, spread: 3.1, speed: 70, gravity: -10, size: 46, spin: 0, dur: 1000 });
  await sleep(700); await shakeB(); ar.pop(hp.x, hp.y - 100 * s, '三摇黄沙！', { size: 22, color: '#ffe082' });
  ar.particles(hp.x - A.dir * 140 * s, hp.y, { kind: 'dot', color: ['#d7b46a', '#c8a050', '#e0c080'], n: 30, angle: A.dir > 0 ? 0 : 180, spread: .5, speed: 260, gravity: 20, size: 7, stagger: 15 });
  await sleep(300);
  await ar.hurt(D, { power: 2, kind: 'wind' });
} };
M.zhizhu = { name: '盘丝缚身', async run(ar, A, D) {
  const s = ar.s, a1 = ar.pt(A, 58, 158), a2 = ar.pt(A, 142, 158), hp = ar.pt(D, 100, 110);
  an(A.mover, [{ transform: 'none' }, { transform: 'scale(1.05,.95)' }, { transform: 'none' }], 300, { fill: 'none' });
  for (let i = 0; i < 6; i++) { const f = i % 2 ? a1 : a2; ar.line(f.x, f.y, hp.x + rnd(-40, 40) * s, hp.y + rnd(-60, 60) * s, { color: '#fafafa', width: 3, dur: 900 }); await sleep(60); }
  ar.pop(hp.x, hp.y - 120 * s, '缠住你！', { size: 24, color: '#fff' });
  await ar.hurt(D, { power: 2, kind: 'web', text: '黏糊糊！' });
} };
M.baiyan = { name: '千眼金光', async run(ar, A, D) {
  const s = ar.s, eyesG = A.part('.robe-eyes');
  an(eyesG, [{ filter: 'none' }, { filter: 'brightness(1.8) drop-shadow(0 0 6px #ffeb3b)' }], 400, { fill: 'none', iterations: 2 });
  await sleep(400);
  const hp = ar.pt(D, 100, 100);
  ar.flash('#fff59d', 600, .5);
  const pts = [[70, 142], [86, 152], [114, 152], [130, 142], [72, 170], [92, 176], [108, 176], [128, 170]];
  for (const [x, y] of pts) { const p = ar.pt(A, x, y); ar.line(p.x, p.y, hp.x + rnd(-20, 20) * s, hp.y + rnd(-30, 30) * s, { color: '#ffeb3b', glow: '#fff59d', width: 6, dur: 600 }); }
  ar.pop(hp.x, hp.y - 110 * s, '金光罩！', { size: 26, color: '#fff59d' });
  await sleep(300);
  await ar.hurt(D, { power: 2, kind: 'light', text: '看不见了！' });
} };
M.qingshi = { name: '狮口吞天', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 120);
  ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '嗷呜——一口吞！', { size: 22, color: '#80cbc4' });
  await go(A, T(A, g * .5, 0, 'scale(1.15)'), 300);
  const mouth = ar.pt(A, 100, 124, true), hp = ar.pt(D, 100, 110), dx = mouth.x - hp.x, dy = mouth.y - hp.y;
  await an(D.mover, [{ transform: 'none' }, { transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }], 450, { easing: 'ease-in' });
  await go(A, T(A, g * .5, 0, 'scale(1.2,1.1)'), 200);
  ar.pop(mouth.x, mouth.y - 160 * s, '咦？肚子里有猴？', { size: 18, color: '#fff' });
  for (let i = 0; i < 6; i++) { await go(A, T(A, g * .5, 0, `scale(${i % 2 ? 1.25 : 1.1},${i % 2 ? 1.05 : 1.2}) rotate(${i % 2 ? 6 : -6}deg)`), 110); }
  ar.pop(mouth.x, mouth.y - 120 * s, '哎哟肚子疼！', { size: 22, color: '#ffccbc' });
  clear(D.mover);
  await an(D.mover, [{ transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }, { transform: `translate(${dx * .5}px,${-110 * s}px) rotate(${D.dir * -540}deg)`, opacity: 1 }, { transform: 'none', opacity: 1 }], 560, { fill: 'none' });
  await home(A);
  await ar.hurt(D, { power: 2, text: '被吐出来了' });
} };
M.baixiang = { name: '长鼻卷摔', async run(ar, A, D) {
  const s = ar.s, trunk = A.part('.trunk'), g = near(ar, A, D, 130);
  await go(A, T(A, g, 0), 300);
  await an(trunk, [{ transform: 'rotate(0)' }, { transform: 'rotate(-80deg) scale(1.3)' }], 260);
  ar.pop(ar.pt(D, 100, 0).x, ar.pt(D, 100, 0).y, '卷起来！', { size: 24, color: '#eceff1' });
  await an(D.mover, [{ transform: 'none' }, { transform: `translate(${-D.dir * 10}px,-90px) rotate(${D.dir * 180}deg)`, offset: .5 }, { transform: `translate(${-D.dir * 10}px,-110px) rotate(${D.dir * 360}deg)` }], 700);
  const gp = ar.pt(D, 100, 206);
  an(trunk, [{ transform: 'rotate(-80deg) scale(1.3)' }, { transform: 'rotate(20deg) scale(1.2)' }], 160);
  await an(D.mover, [{ transform: `translate(${-D.dir * 10}px,-110px) rotate(${D.dir * 360}deg)` }, { transform: 'none' }], 160, { easing: 'ease-in' });
  ar.crack(gp.x, gp.y); ar.shake(16, 400);
  clear(D.mover);
  const h = ar.hurt(D, { power: 3, kind: 'squash' });
  clear(trunk); await home(A); await h;
} };
M.dapeng = { name: '金翅俯冲', async run(ar, A, D) {
  const s = ar.s, wings = A.parts('.wing'), w = A.weapon;
  wings.forEach(el => an(el, Array.from({ length: 8 }, (_, i) => ({ transform: `rotate(${i % 2 ? -25 : 15}deg)` })).concat([{ transform: 'none' }]), 600, { fill: 'none' }));
  const g = Math.abs(ar.gap(A, D));
  ar.dust(ar.pt(A, 100, 210).x, ar.pt(A, 100, 210).y, 8);
  await go(A, T(A, 0, -ar.H * 1.2), 420, { ease: 'ease-in' });
  ar.pop(ar.W / 2, 40 * s, '一翅九万里！', { size: 28, color: '#ffca28' });
  await sleep(300);
  await rot(w, [140], 10);
  A.mover.style.zIndex = 4;
  await go(A, T(A, g - 70 * s, -20 * s, `rotate(${A.dir * 30}deg)`), 260, { ease: 'ease-in' });
  ar.speed(ar.pt(D, 100, 100).x, ar.pt(D, 100, 100).y - 40 * s, A.dir, { n: 10 });
  const h = ar.hurt(D, { power: 3, kind: 'pierce' });
  await sleep(200); await rotHome(w); await home(A, 420); A.mover.style.zIndex = ''; await h;
} };
M.bailujing = { name: '寒光白鹿', async run(ar, A, D) {
  const s = ar.s, w = A.weapon;
  for (let i = 0; i < 2; i++) { await rot(w, [14], 90); await rot(w, [0], 90); }
  const from = ar.pt(A, 140, 140), hp = ar.pt(D, 100, 130);
  ar.pop(from.x, from.y - 140 * s, '去！', { size: 34, color: '#e3f2fd' });
  await ar.proj(`<div style="transform:scaleX(${A.dir});filter:drop-shadow(0 0 8px #b3e5fc) brightness(1.1);opacity:.9">${window.QJ_CHARS.yx_bailu()}</div>`, from, hp, { size: 130, dur: 520 });
  ar.ring(hp.x, hp.y, { r: 60, color: '#e3f2fd', width: 8 });
  await ar.hurt(D, { power: 2, kind: 'light', text: '冻得发抖' });
} };
M.laoshu = { name: '遁地双剑', async run(ar, A, D) {
  const s = ar.s, [w1, w2] = A.weapons, a = ar.pt(A, 100, 206), d = ar.pt(D, 100, 206), g = Math.abs(ar.gap(A, D));
  ar.dust(a.x, a.y, 8);
  await go(A, T(A, 0, 60 * s, 'scale(1,0)'), 300, { ease: 'ease-in' });
  for (let i = 1; i <= 4; i++) { const x = a.x + (d.x - a.x) * i / 5; const m = ar.spawn(svgs.mound, x, a.y - 6 * s, 50 * s, 26 * s); ar.life(m, an(m, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }, { transform: 'scale(0)' }], 260)); await sleep(90); }
  ar.dust(d.x, d.y, 10);
  await go(A, T(A, g - 40 * s, -60 * s, 'scale(1)'), 260, { ease: 'ease-out' });
  rot(w1, [130], 140, 'ease-in'); rot(w2, [-130], 140, 'ease-in');
  const hp = ar.pt(D, 100, 100); ar.slash(hp.x, hp.y, { r: 60, rot: 45, color: '#f8bbd0', width: 12 }); ar.slash(hp.x, hp.y, { r: 60, rot: 135, color: '#f8bbd0', width: 12 });
  ar.pop(hp.x, hp.y - 110 * s, '偷袭！', { size: 30, color: '#f8bbd0' });
  const h = ar.hurt(D, { power: 2, kind: 'slash' });
  await sleep(200); await Promise.all([rotHome(w1), rotHome(w2)]); await home(A, 400); await h;
} };
M.yutu = { name: '捣药杵', async run(ar, A, D) {
  const s = ar.s, w = A.weapon, g = near(ar, A, D, 100), ears = A.parts('.ear');
  ears.forEach(e => an(e, [{ transform: 'rotate(0)' }, { transform: 'rotate(-15deg)' }, { transform: 'rotate(10deg)' }, { transform: 'rotate(0)' }], 400, { fill: 'none', iterations: 2 }));
  for (let i = 1; i <= 3; i++) await go(A, T(A, g * i / 3, 0, 'scale(1.1,.9)'), 180, { mid: T(A, g * (i - .5) / 3, -50 * s, 'scale(.9,1.1)') });
  const hp = ar.pt(D, 100, 30);
  for (let i = 0; i < 3; i++) {
    await rot(w, [-40], 120); await rot(w, [70], 100, 'ease-in');
    ar.burst(hp.x, hp.y, { size: 50 }); ar.pop(hp.x + (i - 1) * 40 * s, hp.y - 30 * s, '咚！', { size: 26, color: '#fce4ec', stroke: '#ad1457' });
    an(D.mover, [{ transform: 'none' }, { transform: 'scale(1.15,.8)' }, { transform: 'none' }], 200, { fill: 'none' });
    await sleep(80);
  }
  const h = ar.hurt(D, { power: 2, kind: 'squash', text: '捣成年糕！' });
  await rotHome(w); await home(A); await h;
} };
M.change = { name: '月华清辉', async run(ar, A, D) {
  const s = ar.s, moon = ar.pt(A, 150, 44), hp = ar.pt(D, 100, 100);
  an(A.svg, [{ filter: 'none' }, { filter: 'drop-shadow(0 0 16px #fff59d)' }, { filter: 'none' }], 900, { fill: 'none' });
  ar.ring(moon.x, moon.y, { r: 40, color: '#fff59d', width: 6, to: 2.4 });
  await ar.line(moon.x, moon.y, hp.x, hp.y, { color: '#fffde7', glow: '#fff59d', width: 18, dur: 700 });
  ar.particles(hp.x, hp.y, { kind: 'spark', color: ['#e1f5fe', '#fffde7'], n: 18, spread: 3.1, speed: 90, gravity: 40, size: 14 });
  await ar.hurt(D, { power: 2, kind: 'ice', text: '广寒宫好冷！' });
} };

// ================= 悟空：普通出招 / 终结技 =================
let wkTurn = 0;
M.wk_normal = { name: '金箍棒连击', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 120), w = A.weapon; wkTurn++;
  if (wkTurn % 2) {
    // 戳棍
    await rot(w, [88], 140);
    await go(A, T(A, g, 0, 'scale(1.08,.94)'), 160, { ease: 'cubic-bezier(.6,0,.9,.5)' });
    const hp = ar.pt(D, 100, 110); ar.speed(ar.pt(A, 170, 110, true).x, hp.y, A.dir, { n: 5 }); ar.burst(hp.x, hp.y, { size: 60 });
    const h = ar.hurt(D, { power: 1 });
    await sleep(120); await rotHome(w, 180); await home(A, 260); await h;
  } else {
    // 横扫
    await go(A, T(A, g * .9, 0), 200);
    await rot(w, [-120], 130);
    rot(w, [110], 160, 'ease-in');
    const hp = ar.pt(D, 100, 110); ar.slash(hp.x - A.dir * 30 * s, hp.y, { r: 80, from: A.dir > 0 ? -150 : -30, to: A.dir > 0 ? -10 : -170, color: '#ffe082', width: 14, dur: 170 });
    const h = ar.hurt(D, { power: 1 });
    await sleep(150); await rotHome(w, 200); await home(A, 280); await h;
  }
} };
M.wk_heavy = Object.assign({}, M.wukong, { name: '重棍·跳劈' });
M.wk_finish = { name: '如意金箍棒·变！', async run(ar, A, D) {
  const s = ar.s, hp = ar.pt(D, 100, 110), gp = ar.pt(D, 100, 206);
  an(A.svg, [{ filter: 'none' }, { filter: 'drop-shadow(0 0 14px #ffd54f) brightness(1.2)' }], 400);
  await go(A, T(A, 0, 10, 'scale(1.1,.85)'), 220);
  ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '身外身法！', { size: 26, color: '#ffe082', dur: 900 });
  // 拔毫毛变分身，从三面围攻
  const clones = [];
  const spots = [[-1.2, -.1], [0, -1.05], [1.2, -.1]];
  for (const [fx, fy] of spots) {
    const sz = 150 * s, x = hp.x + fx * 110 * s * -A.dir, y = hp.y + fy * 120 * s;
    const c = ar.spawn(`<div style="transform:scaleX(${(x < hp.x ? 1 : -1)})">${A.svg.outerHTML}</div>`, x, y, sz, sz * 1.1, 'clone');
    clones.push(c); an(c, [{ transform: 'scale(0) rotate(-180deg)', opacity: 0 }, { transform: 'scale(1)', opacity: .95 }], 300, { easing: 'cubic-bezier(.3,1.6,.5,1)' });
    ar.particles(x, y, { kind: 'smoke', color: ['#fff', '#ffe082'], n: 6, spread: 3.1, speed: 50, gravity: 0, size: 30, spin: 0, dur: 400 });
    await sleep(110);
  }
  await sleep(200);
  for (let i = 0; i < 6; i++) {
    const c = clones[i % 3]; const r = c.getBoundingClientRect(), b = ar.root.getBoundingClientRect();
    const cx = r.left - b.left + r.width / 2, cy = r.top - b.top + r.height / 2;
    an(c, [{ transform: 'none' }, { transform: `translate(${(hp.x - cx) * .4}px,${(hp.y - cy) * .4}px)` }, { transform: 'none' }], 180, { fill: 'none' });
    ar.slash(hp.x, hp.y, { r: 70, rot: i * 60, color: '#ffe082', width: 12, dur: 140 });
    ar.burst(hp.x + rnd(-30, 30) * s, hp.y + rnd(-40, 40) * s, { size: 50 });
    an(D.mover, [{ transform: 'none' }, { transform: `translate(${i % 2 ? 6 : -6}px,0)` }, { transform: 'none' }], 120, { fill: 'none' });
    await sleep(110);
  }
  clones.forEach(c => ar.life(c, an(c, [{ opacity: .95 }, { opacity: 0, transform: 'scale(.3)' }], 250)));
  // 本体跃起，金箍棒变得顶天立地，从天而降
  ar.afterimage(A, 3);
  await go(A, T(A, 0, -ar.H * 1.2), 300, { ease: 'ease-in' });
  ar.pop(ar.W / 2, 44 * s, '大！大！大！', { size: 36, color: '#ffd54f', stroke: '#8d2c1f', dur: 1100 });
  await sleep(250);
  const big = ar.spawn(`<svg viewBox="0 0 60 600" preserveAspectRatio="none"><rect x="10" y="0" width="40" height="600" rx="20" fill="#4b4650" stroke="#3a2618" stroke-width="6"/><rect x="24" y="60" width="8" height="480" fill="#8a8494"/><rect x="4" y="0" width="52" height="70" rx="12" fill="#f2b632" stroke="#3a2618" stroke-width="6"/><rect x="4" y="530" width="52" height="70" rx="12" fill="#f2b632" stroke="#3a2618" stroke-width="6"/></svg>`, gp.x, gp.y - ar.H * .55, 70 * s, ar.H * 1.1);
  big.style.filter = 'drop-shadow(0 0 16px #ffd54f)';
  await an(big, [{ transform: `translateY(${-ar.H * 1.3}px)` }, { transform: 'translateY(0)' }], 260, { easing: 'cubic-bezier(.7,0,1,.6)' });
  ar.flash('#fff8e1', 500, .9); ar.shake(30, 800);
  for (let i = 0; i < 3; i++) ar.ring(gp.x, gp.y, { r: 80, squash: .3, color: '#ffd54f', width: 10, to: 3, delay: i * 120 });
  ar.crack(gp.x - 60 * s, gp.y); ar.crack(gp.x + 60 * s, gp.y); ar.dust(gp.x, gp.y, 16);
  ar.pop(hp.x, hp.y - 150 * s, '砰——！！', { size: 54, color: '#ff7043', dur: 1100 });
  const h = ar.hurt(D, { power: 3, kind: 'squash' });
  await sleep(500);
  ar.life(big, an(big, [{ opacity: 1 }, { opacity: 0, transform: 'scaleX(.2)' }], 300));
  clear(A.mover); A._t = null;
  await an(A.mover, [{ transform: `translateY(${-ar.H}px)` }, { transform: 'translateY(0) scale(1.1,.9)', offset: .8 }, { transform: 'none' }], 380, { easing: 'ease-in', fill: 'none' });
  an(A.svg, [{ filter: 'drop-shadow(0 0 14px #ffd54f)' }, { filter: 'none' }], 300);
  await h;
} };

// ================= 第三批小怪招式 =================
M.yezhu = { name: '野猪冲撞', async run(ar, A, D) {
  const s = ar.s, g = near(ar, A, D, 95);
  for (let i = 0; i < 3; i++) { await go(A, T(A, -6 * s, 0, `rotate(${A.dir * 14}deg)`), 90); const f = ar.pt(A, 100, 210); ar.dust(f.x, f.y, 3); await go(A, T(A, 0, 0, `rotate(${A.dir * 10}deg)`), 90); }
  ar.pop(ar.pt(A, 100, 10).x, ar.pt(A, 100, 10).y, '哼哼！', { size: 28, color: '#d7ccc8' });
  await go(A, T(A, g, 0, `rotate(${A.dir * 16}deg)`), 240, { ease: 'cubic-bezier(.6,0,.9,.5)' });
  const hp = ar.pt(D, 100, 120); ar.burst(hp.x, hp.y, { size: 90 }); ar.shake(10, 300);
  const h = ar.hurt(D, { power: 2 });
  await home(A, 380); await h;
} };
M.hujing = { name: '狐火', async run(ar, A, D) {
  const s = ar.s, from = ar.pt(A, 60, 130), to = ar.pt(D, 100, 100);
  ar.pop(ar.pt(A, 100, 10).x, ar.pt(A, 100, 10).y, '嘻嘻～', { size: 26, color: '#ffe0b2' });
  const fire = `<svg viewBox="0 0 40 50"><path d="M20 48 C4 46 4 28 14 20 C14 30 20 32 20 26 C20 16 26 10 24 2 C36 12 38 30 32 40 C30 46 26 48 20 48 Z" fill="#80d8ff" stroke="#0091ea" stroke-width="2"/><path d="M20 44 C12 42 12 32 18 28 C18 34 24 34 24 30 C30 36 28 44 20 44 Z" fill="#fff"/></svg>`;
  await Promise.all([0, 1, 2].map(i => sleep(i * 160).then(() => ar.proj(fire, { x: from.x, y: from.y - i * 20 * s }, { x: to.x, y: to.y + (i - 1) * 30 * s }, { size: 40, dur: 520, arc: 50 + i * 20 }))));
  ar.particles(to.x, to.y, { kind: 'spark', color: ['#80d8ff', '#e1f5fe'], n: 14, spread: 3.1, speed: 90, size: 14 });
  await ar.hurt(D, { power: 2, kind: 'magic' });
} };
M.bianfu = { name: '蝙蝠音波', async run(ar, A, D) {
  const s = ar.s, wings = A.parts('.wing');
  wings.forEach(el => an(el, Array.from({ length: 8 }, (_, i) => ({ transform: `rotate(${i % 2 ? -25 : 15}deg)` })).concat([{ transform: 'none' }]), 600, { fill: 'none' }));
  await go(A, T(A, 0, -40 * s), 300);
  A.mouth(900);
  const p = ar.pt(A, 140, 100, true);
  for (let i = 0; i < 5; i++) ar.ring(p.x + A.dir * i * 50 * s, p.y, { r: 30, color: '#b39ddb', width: 5, to: 2.4, delay: i * 80 });
  ar.pop(p.x, p.y - 60 * s, '吱吱吱！', { size: 26, color: '#d1c4e9' });
  await sleep(450);
  const h = ar.hurt(D, { power: 1, kind: 'sound' });
  await home(A, 300); await h;
} };
M.hama = { name: '长舌头', async run(ar, A, D) {
  const s = ar.s; A.mouth(900);
  await go(A, T(A, 0, 8, 'scale(1.1,.9)'), 200);
  const m = ar.pt(A, 100, 110), hp = ar.pt(D, 100, 100);
  await ar.line(m.x, m.y, hp.x, hp.y, { color: '#ef5350', glow: '#ffcdd2', width: 12, dur: 420 });
  ar.pop(hp.x, hp.y - 80 * s, '啪！', { size: 34, color: '#ffcdd2' });
  const h = ar.hurt(D, { power: 2, text: '黏糊糊' });
  await home(A, 250); await h;
} };
M.shitou = { name: '落石', async run(ar, A, D) {
  const s = ar.s;
  await go(A, T(A, 0, 0, 'scale(1.1,.85)'), 250);
  ar.shake(8, 300); ar.pop(ar.pt(A, 100, 10).x, ar.pt(A, 100, 10).y, '轰隆隆', { size: 26, color: '#e0e0e0' });
  await go(A, 'translate(0px,0px)', 150);
  const hp = ar.pt(D, 100, 60);
  const rock = `<svg viewBox="0 0 60 50"><path d="M6 30 L14 8 L40 4 L56 20 L50 44 L18 46 Z" fill="#9e9e9e" stroke="#3a2618" stroke-width="3"/><path d="M20 20 l10 4 M36 30 l8 -2" stroke="#616161" stroke-width="2"/></svg>`;
  for (let i = 0; i < 3; i++) { ar.drop(rock, hp.x + (i - 1) * 30 * s, hp.y + 20 * s, { size: 50, dur: 320 }).then(d => { ar.burst(hp.x + (i - 1) * 30 * s, hp.y, { size: 50 }); ar.particles(hp.x, hp.y, { kind: 'rock', color: ['#9e9e9e', '#bdbdbd'], n: 6, spread: 1.4, speed: 80, size: 10 }); d.remove(); }); await sleep(150); }
  await sleep(250);
  await ar.hurt(D, { power: 2 });
} };
M.shujing = { name: '藤蔓缠绕', async run(ar, A, D) {
  const s = ar.s, a = ar.pt(A, 100, 206), d = ar.pt(D, 100, 140);
  ar.pop(ar.pt(A, 100, 0).x, ar.pt(A, 100, 0).y, '沙沙沙……', { size: 22, color: '#c5e1a5' });
  for (let i = 0; i < 4; i++) { ar.line(a.x, a.y, d.x + rnd(-30, 30) * s, d.y + rnd(-60, 40) * s, { color: '#558b2f', glow: '#8bc34a', width: 7, dur: 900 }); await sleep(90); }
  ar.particles(d.x, d.y - 60 * s, { kind: 'leaf', color: ['#7cb342', '#aed581'], n: 12, spread: 3.1, speed: 70, size: 13 });
  await sleep(250);
  await ar.hurt(D, { power: 2, kind: 'web', text: '缠住了！' });
} };

window.QJ_MOVES = M;
})();

/* 取经小英雄 · 装备数据（外观 + 属性 + 掉落） */
(function(){
const RARITY = [
  { n: '凡品', c: '#9e9e9e' },
  { n: '良品', c: '#43a047' },
  { n: '上品', c: '#1e88e5' },
  { n: '极品', c: '#8e24aa' },
  { n: '仙品', c: '#f9a825' },
];
const SLOTS = [
  { k: 'head', n: '头' }, { k: 'body', n: '身' }, { k: 'arm', n: '臂' },
  { k: 'leg', n: '腿' }, { k: 'weapon', n: '棍' }, { k: 'acc', n: '珍玩' },
];
const STATS = [
  { k: 'hp', n: '气血', base: 100 }, { k: 'atk', n: '攻击', base: 10 }, { k: 'def', n: '防御', base: 0 },
  { k: 'crit', n: '暴击', base: 5, pct: true }, { k: 'focus', n: '棍势', base: 1 },
  { k: 'gold', n: '灵蕴加成', base: 0, pct: true }, { k: 'luck', n: '掉宝加成', base: 0, pct: true },
];
// 套装：2 件、4 件效果
const SETS = {
  heifeng: { n: '黑风套', ch: '第一章', b2: { def: 5 }, b2t: '防御 +5', b4t: '黑风护体：每场战斗第一次答错不掉血' },
  baigu: { n: '白骨套', ch: '第二章', b2: { crit: 10 }, b2t: '暴击 +10%', b4t: '白骨爪：暴击伤害从 2 倍变成 3 倍' },
  jinyin: { n: '金银套', ch: '第三章', b2: { gold: 20 }, b2t: '灵蕴 +20%', b4t: '宝葫芦：每场开局棍势直接满格' },
  huoyun: { n: '火云套', ch: '第四章', b2: { atk: 5 }, b2t: '攻击 +5', b4t: '三昧火：连对 3 题，额外喷一次真火' },
  binghe: { n: '冰河套', ch: '第五章', b2: { hp: 30 }, b2t: '气血 +30', b4t: '寒冰护身：每答对 1 题回 3 点气血' },
  niumo: { n: '牛魔套', ch: '第六章', b2: { atk: 8 }, b2t: '攻击 +8', b4t: '大力牛魔：攻击再提高 30%' },
  leiyin: { n: '雷音套', ch: '第七章', b2: { focus: 1 }, b2t: '棍势 +1', b4t: '金铙护法：每场法术可多用 1 次' },
  tuoluo: { n: '狮驼套', ch: '第八章', b2: { def: 10 }, b2t: '防御 +10', b4t: '三魔之力：打 Boss 伤害 +30%' },
  qitian: { n: '齐天套', ch: '灵山', b2: { hp: 50, atk: 10 }, b2t: '气血 +50，攻击 +10', b4t: '齐天大圣：每场开局放出一个分身，多打一次' },
};
const I = [];
const add = (id, n, slot, r, look, stats, src, drop, extra = {}) => I.push(Object.assign({ id, n, slot, r, look, stats, src, drop }, extra));

// ---------- 凡品 / 良品（小妖低概率掉落） ----------
add('hood1', '粗布头巾', 'head', 0, { t: 'hood', c1: '#8d6e63', c2: '#d7ccc8' }, { hp: 5 }, '任意小妖', 'mob');
add('hood2', '青布头巾', 'head', 1, { t: 'hood', c1: '#26a69a', c2: '#b2dfdb' }, { hp: 10, def: 1 }, '第二章起的小妖', 'mob');
add('cloth1', '麻布短褂', 'body', 0, { t: 'cloth', c1: '#a1887f', c2: '#5d4037' }, { hp: 10 }, '任意小妖', 'mob');
add('cloth2', '青布短褂', 'body', 1, { t: 'cloth', c1: '#4db6ac', c2: '#00695c' }, { hp: 15, def: 2 }, '第二章起的小妖', 'mob');
add('wrap1', '皮护腕', 'arm', 0, { t: 'wrap', c1: '#8d6e63', c2: '#d7ccc8' }, { atk: 1 }, '任意小妖', 'mob');
add('wrap2', '铁扣护腕', 'arm', 1, { t: 'bracer', c1: '#78909c', c2: '#eceff1' }, { atk: 2, crit: 2 }, '第二章起的小妖', 'mob');
add('straw1', '芒鞋', 'leg', 0, { t: 'straw', c1: '#d7b46a', c2: '#a1825e' }, { hp: 5 }, '任意小妖', 'mob');
add('boot2', '快靴', 'leg', 1, { t: 'boots', c1: '#5d4037', c2: '#a1887f' }, { hp: 8, focus: 1 }, '第二章起的小妖', 'mob');
add('bell1', '巡山铜铃', 'acc', 1, { t: 'bell', c1: '#e5b33c' }, { gold: 10 }, '错题小妖（复习时）', 'review', { fx: '复习打败错题小妖时灵蕴更多' });
add('staff0', '如意金箍棒', 'weapon', 0, {}, { atk: 0 }, '开局自带', 'start', { fx: '可以用灵蕴强化，最高 +9' });

// ---------- 章节套装（Boss 掉落） ----------
const setPieces = (set, r, src, looks, names, base) => {
  ['head', 'body', 'arm', 'leg'].forEach((slot, i) => add(set + '_' + slot, names[i], slot, r, looks[i], base[i], src, 'boss', { set }));
};
setPieces('heifeng', 2, '黑熊精、黄风怪', [
  { t: 'helm', c1: '#3a3436', c2: '#b8892e', plume: '#222' }, { t: 'fur', c1: '#3a3436', c2: '#6d5a4a' },
  { t: 'bracer', c1: '#2b2b33', c2: '#b8892e' }, { t: 'boots', c1: '#3a3436', c2: '#b8892e' }],
  ['黑缨盔', '熊皮甲', '乌金护臂', '黑风靴'], [{ hp: 15, def: 2 }, { hp: 25, def: 4 }, { atk: 3, def: 1 }, { hp: 10, def: 2 }]);
setPieces('baigu', 2, '白骨精、黄袍怪', [
  { t: 'bone', c1: '#ba68c8' }, { t: 'bone', c1: '#4a2c5a' },
  { t: 'bone', c1: '#ba68c8' }, { t: 'spike', c1: '#4a2c5a', c2: '#fafafa' }],
  ['白骨冠', '白骨甲', '骨刺护臂', '踏骨靴'], [{ hp: 15, crit: 3 }, { hp: 25, crit: 3 }, { atk: 4, crit: 4 }, { hp: 10, crit: 2 }]);
setPieces('jinyin', 2, '金角大王、银角大王', [
  { t: 'helm', c1: '#1e3a8a', c2: '#f2c94c', horn: 'one' }, { t: 'scale', c1: '#cfd8dc', c2: '#78909c' },
  { t: 'ring', c1: '#f2c94c' }, { t: 'boots', c1: '#1e3a8a', c2: '#f2c94c' }],
  ['金角盔', '银丝甲', '幌金绳护臂', '七星靴'], [{ hp: 18, gold: 5 }, { hp: 28, def: 4 }, { atk: 4, gold: 5 }, { hp: 12, gold: 5 }]);
setPieces('huoyun', 3, '红孩儿', [
  { t: 'flame', c1: '#ff5722', c2: '#ffca28' }, { t: 'plate', c1: '#c62828', c2: '#ffb74d' },
  { t: 'claw', c1: '#c62828', c2: '#ffb74d' }, { t: 'fire', c1: '#8d2c1f' }],
  ['火云冠', '赤焰甲', '火尖护臂', '风火靴'], [{ hp: 20, atk: 3 }, { hp: 35, def: 5 }, { atk: 6, crit: 3 }, { hp: 15, atk: 2 }]);
setPieces('binghe', 3, '灵感大王、车迟国三仙', [
  { t: 'helm', c1: '#4fc3f7', c2: '#e1f5fe', plume: '#ff7043' }, { t: 'scale', c1: '#ff8a65', c2: '#e64a19' },
  { t: 'bracer', c1: '#81d4fa', c2: '#e1f5fe' }, { t: 'boots', c1: '#b3e5fc', c2: '#0288d1' }],
  ['冰鳞盔', '金鱼鳞甲', '寒铁护臂', '踏冰靴'], [{ hp: 25, def: 3 }, { hp: 40, def: 5 }, { atk: 5, def: 2 }, { hp: 20, def: 2 }]);
setPieces('niumo', 3, '牛魔王、铁扇公主', [
  { t: 'helm', c1: '#5d4037', c2: '#f2c94c', horn: 'ox' }, { t: 'plate', c1: '#37474f', c2: '#f2c94c' },
  { t: 'claw', c1: '#37474f', c2: '#fff8e1' }, { t: 'boots', c1: '#2e7d32', c2: '#a5d6a7' }],
  ['牛角盔', '混铁甲', '蛮牛护臂', '芭蕉履'], [{ hp: 25, atk: 4 }, { hp: 40, def: 6 }, { atk: 8 }, { hp: 20, atk: 3 }]);
setPieces('leiyin', 3, '黄眉大王、赛太岁', [
  { t: 'lotus', c1: '#ffe082', c2: '#f9a825' }, { t: 'robe', c1: '#f9a825', c2: '#c62828' },
  { t: 'ring', c1: '#ab47bc' }, { t: 'cloud', c1: '#fff3e0', c2: '#f9a825' }],
  ['金铙莲冠', '袈裟战袍', '紫金护臂', '莲台靴'], [{ hp: 25, focus: 1 }, { hp: 45, def: 5 }, { atk: 6, crit: 4 }, { hp: 20, def: 3 }]);
setPieces('tuoluo', 3, '青狮精、白象精、大鹏金翅雕', [
  { t: 'helm', c1: '#00695c', c2: '#ffca28', mane: '#4db6ac' }, { t: 'plate', c1: '#546e7a', c2: '#cfd8dc' },
  { t: 'claw', c1: '#ffb300', c2: '#fff3e0' }, { t: 'boots', c1: '#ffb300', c2: '#e65100' }],
  ['狮王盔', '象皮甲', '金翅护臂', '鹏羽靴'], [{ hp: 30, def: 4 }, { hp: 50, def: 8 }, { atk: 9, crit: 4 }, { hp: 25, def: 3 }]);
setPieces('qitian', 4, '四海龙王（取经途中的龙宫秘境）', [
  { t: 'crown', c1: '#9575cd', c2: '#f2c94c' }, { t: 'scale', c1: '#f2c94c', c2: '#b8860b' },
  { t: 'bracer', c1: '#f2c94c', c2: '#c62828' }, { t: 'cloud', c1: '#f8e1e7', c2: '#7fb3d5' }],
  ['凤翅紫金冠', '锁子黄金甲', '齐天护臂', '藕丝步云履'], [{ hp: 40, atk: 5 }, { hp: 70, def: 10 }, { atk: 12, crit: 6 }, { hp: 30, focus: 1 }]);

// ---------- 棍（Boss 专属掉落） ----------
add('staff_heiying', '黑缨棍', 'weapon', 2, { shaft: '#2b2b33', ends: '#b8892e', tassel: '#222' }, { atk: 5, def: 2 }, '黑熊精', 'boss');
add('staff_feng', '定风棍', 'weapon', 2, { shaft: '#8d6e63', ends: '#f2c94c', tip: 'wind' }, { atk: 5, focus: 1 }, '黄风怪', 'boss');
add('staff_gu', '白骨棒', 'weapon', 2, { shaft: '#e0dccf', hi: '#fff', ends: '#7b1fa2', tip: 'skull' }, { atk: 6, crit: 5 }, '白骨精', 'boss');
add('staff_qixing', '七星棍', 'weapon', 3, { shaft: '#1e3a8a', hi: '#5c6bc0', ends: '#eceff1', tip: 'star' }, { atk: 8, gold: 10 }, '金角大王', 'boss');
add('staff_huo', '火尖棍', 'weapon', 3, { shaft: '#8d2c1f', hi: '#e57373', ends: '#ffb74d', tip: 'flame', aura: '#ff7043' }, { atk: 10, crit: 5 }, '红孩儿', 'boss');
add('staff_bing', '寒霜棍', 'weapon', 3, { shaft: '#4fc3f7', hi: '#e1f5fe', ends: '#eceff1', tip: 'ice' }, { atk: 9, hp: 20 }, '灵感大王', 'boss');
add('staff_hunt', '混铁棍', 'weapon', 3, { shaft: '#263238', hi: '#546e7a', ends: '#78909c', len: 200 }, { atk: 14 }, '牛魔王', 'boss');
add('staff_jinchi', '金翅棍', 'weapon', 3, { shaft: '#b71c1c', hi: '#ef9a9a', ends: '#ffca28', tip: 'wing' }, { atk: 12, crit: 8 }, '大鹏金翅雕', 'boss');
add('staff_qitian', '如意金箍棒·齐天', 'weapon', 4, { aura: '#ffd54f', len: 200 }, { atk: 20, crit: 10 }, '灵山（全部通关）', 'boss');

// ---------- 珍玩（Boss 小概率掉落 / 剧情奖励） ----------
add('acc_hair', '救命毫毛', 'acc', 4, { t: 'hair' }, {}, '鹰愁涧剧情：观音所赐', 'story', { fx: '气血归零时自动复活一次（每场 1 次）' });
add('acc_dingfeng', '定风丹', 'acc', 2, { t: 'pearl', c1: '#c5e1a5' }, { def: 3 }, '黄风怪（小概率）', 'rare', { fx: '不怕风：黄风怪的招式伤害减半' });
add('acc_neidan', '舍利内丹', 'acc', 3, { t: 'pearl', c1: '#fff59d' }, { hp: 30 }, '黄袍怪（小概率）', 'rare');
add('acc_hulu', '紫金红葫芦', 'acc', 3, { t: 'gourd', c1: '#c62828' }, { gold: 30 }, '金角大王（小概率）', 'rare', { fx: '灵蕴大幅增加' });
add('acc_zhuo', '金刚琢', 'acc', 3, { t: 'ring', c1: '#eceff1' }, { crit: 10 }, '独角兕大王（小概率）', 'rare');
add('acc_bajiao', '小芭蕉扇', 'acc', 3, { t: 'fan' }, { luck: 20 }, '铁扇公主（小概率）', 'rare', { fx: '掉宝概率提高' });
add('acc_ling', '紫金铃', 'acc', 3, { t: 'bell', c1: '#9c27b0' }, { atk: 6 }, '赛太岁（小概率）', 'rare', { fx: '法术伤害提高' });
add('acc_zhuzi', '菩提念珠', 'acc', 2, { t: 'beads', c1: '#8d5524' }, { def: 2, hp: 15 }, '土地庙（用灵蕴换）', 'shop');
add('acc_renshen', '人参果', 'acc', 4, { t: 'fruit' }, { hp: 50 }, '五庄观秘境：镇元大仙', 'rare', { fx: '每场开局多一口葫芦（回血一次）' });

const DROP = [
  ['Boss 第一次被打败', '必掉 1 件这一章的套装（优先给还没有的部位），外加 1 个援军卡碎片'],
  ['Boss 再次挑战', '25% 掉套装部位，10% 掉这个 Boss 的专属棍，5% 掉它的珍玩'],
  ['保底', '同一个 Boss 连续 3 次没掉东西，第 4 次一定掉'],
  ['路上的小妖', '5% 掉凡品或良品装备，1% 掉这一章的套装部位'],
  ['错题小妖（复习）', '打败后必得灵蕴，10% 掉援军卡碎片；复习越认真，奖励越多'],
  ['重复的装备', '自动化成“精魄”，用来强化已有的同部位装备，每强化一级属性 +10%，最高 +5'],
];
window.QJ_GEAR = { RARITY, SLOTS, STATS, SETS, ITEMS: I, DROP };
})();

/* 取经小英雄 · 游戏数据：妖怪、神仙、章节关卡、故事 */
(function(){
const E = {};
const e = (k, n, kind, o) => E[k] = Object.assign({ k, n, kind }, o);
// kind: mob 小妖 / boss / mini 错题小妖 / ally 可收为队友
e('tiger', '斑斓虎', 'boss', { place: '五行山', end: '被打服了，献出虎皮给悟空做了条虎皮裙', story: '悟空刚从五行山下出来，就遇到一只斑斓猛虎拦路。悟空拿出金箍棒一晃，老虎就乖乖认输了。' });
e('xia', '虾兵', 'mob', { place: '鹰愁涧', yx: null, end: '吓得缩回涧底', story: '鹰愁涧里住着许多虾兵蟹将，平时替小白龙巡逻。它们胆子很小，一见悟空就往水底钻。' });
e('langjing', '凌虚子', 'mob', { yx: 'yx_lang', end: '打回原形：一只苍狼', story: '凌虚子是一只苍狼精，喜欢扮成仙风道骨的道士，拿着青锋剑去给黑熊精贺寿。' });
e('shejing', '白衣秀士', 'mob', { yx: 'yx_she', end: '打回原形：一条白花蛇', story: '白衣秀士是白花蛇变的书生，是黑熊精的好朋友，最爱吐信子。' });
e('hufeng', '虎先锋', 'mob', { yx: 'yx_tiger2', end: '打回原形：一只老虎', story: '虎先锋是黄风怪手下的先锋官，两手各拿一口赤铜刀，打不过就会金蝉脱壳，留下一张虎皮逃跑。' });
e('bailong', '小白龙', 'ally', { place: '鹰愁涧', end: '观音菩萨点化，小白龙变成白龙马，驮着唐僧去西天', story: '小白龙是西海龙王的三太子，犯了错被贬在鹰愁涧。他一口吞了唐僧的白马，后来被观音点化，自己变成了白龙马。' });
e('heixiong', '黑熊精', 'boss', { place: '黑风山', yx: 'yx_xiong', owner: 'guanyin', end: '现出原形黑熊，被观音收为落伽山守山大神', story: '观音禅院着了火，黑熊精趁乱偷走了唐僧的锦襕袈裟，还想开个“佛衣会”炫耀。最后观音菩萨亲自出手把他收服。' });
e('bajie', '猪八戒', 'ally', { place: '高老庄', end: '拜唐僧为师，取名猪八戒，扛起九齿钉耙一起西行', story: '八戒原来是天上的天蓬元帅，投胎错了投成猪的样子。他在高老庄当女婿，被悟空打败后拜唐僧为师。' });
e('shaseng', '沙悟净', 'ally', { place: '流沙河', end: '拜唐僧为师，取名沙悟净，帮大家挑担子', story: '沙僧原是天上的卷帘大将，打碎了琉璃盏被贬到流沙河。他脖子上挂着九个骷髅，后来拜唐僧为师。' });
e('huangfeng', '黄风怪', 'boss', { place: '黄风岭', yx: 'yx_diao', owner: 'lingji', end: '现出原形黄毛貂鼠，被灵吉菩萨带回灵山', story: '黄风怪本是灵山脚下的黄毛貂鼠，偷喝了琉璃盏里的清油逃下界。他吹的三昧神风把悟空的眼睛都吹疼了。' });
e('baigujing', '白骨精', 'boss', { place: '白虎岭', yx: 'yx_gu', end: '现出原形：一副小骷髅，吓得逃走', story: '白骨精变成村姑、老婆婆、老公公三次来骗唐僧，都被悟空的火眼金睛看穿。这就是“三打白骨精”。' });
e('huangpao', '黄袍怪', 'boss', { place: '宝象国', yx: 'yx_lang', owner: 'yudi', end: '现出原形奎木狼，被玉帝召回天庭', story: '黄袍怪本是天上二十八星宿里的奎木狼，偷偷下凡做了妖怪。他吐出的舍利内丹亮得像一颗小月亮。' });
e('jinjiao', '金角大王', 'boss', { place: '平顶山莲花洞', yx: 'yx_jintong', owner: 'laojun', end: '变回看炉童子，被太上老君领回兜率宫', story: '金角大王有个紫金红葫芦，叫你名字你一答应，就会被吸进去。悟空变成“者行孙”“行者孙”，反把他骗了。' });
e('yinjiao', '银角大王', 'boss', { place: '平顶山莲花洞', yx: 'yx_yintong', owner: 'laojun', end: '变回看炉童子，被太上老君领回兜率宫', story: '银角大王是金角大王的弟弟，有羊脂玉净瓶和幌金绳。幌金绳一捆，谁也挣不脱。' });
e('qingmaoshi', '青毛狮子怪', 'boss', { place: '乌鸡国', yx: 'yx_shizi', owner: 'wenshu', end: '现出原形青毛狮子，被文殊菩萨骑走', story: '青毛狮子怪把乌鸡国国王推下井，自己变成国王的样子当了三年皇帝。原来他是文殊菩萨的坐骑。' });
e('honghaier', '红孩儿', 'boss', { place: '火云洞', yx: 'yx_shancai', owner: 'guanyin', end: '被观音收为善财童子', story: '红孩儿是牛魔王的儿子，捶两下鼻子就能喷出三昧真火，连水都浇不灭。最后观音把他收为善财童子。' });
e('tuolong', '鼍龙', 'boss', { place: '黑水河', yx: 'yx_tuo', owner: 'moang', end: '现出原形鼍龙，被摩昂太子押回西海', story: '鼍龙是西海龙王的外甥，在黑水河抓了唐僧和八戒。他的表哥摩昂太子把他抓回了西海。' });
e('huli', '虎力大仙', 'boss', { place: '车迟国', yx: 'yx_tiger2', end: '现出原形：一只黄毛虎', story: '车迟国有三位大仙，虎力大仙会用五雷令牌求雨。悟空偷偷叫来风婆、雷公、电母帮忙，赢了比赛。' });
e('luli', '鹿力大仙', 'boss', { place: '车迟国', yx: 'yx_lu', end: '现出原形：一只白毛角鹿', story: '鹿力大仙和悟空比隔板猜枚，猜箱子里放的是什么。悟空变成小虫钻进去，每次都把东西换掉。' });
e('yangli', '羊力大仙', 'boss', { place: '车迟国', yx: 'yx_yang', end: '现出原形：一只羚羊', story: '羊力大仙敢跳进滚烫的油锅洗澡，是因为他叫了一条冷龙护身。悟空把冷龙赶走，他就再也不敢下锅了。' });
e('linggan', '灵感大王', 'boss', { place: '通天河', yx: 'yx_jinyu', owner: 'guanyin', end: '现出原形金鱼，被观音装进竹篮带回莲花池', story: '灵感大王是观音莲花池里的金鱼，让通天河结冰骗唐僧走上去。观音菩萨提着竹篮来，一下就把他收走了。' });
e('sidawang', '独角兕大王', 'boss', { place: '金兜山', yx: 'yx_qingniu', owner: 'laojun', end: '现出原形青牛，被太上老君牵回', story: '独角兕大王有一个金刚琢，连悟空的金箍棒、哪吒的兵器都被它套走了。原来他是太上老君的青牛。' });
e('xiezi', '蝎子精', 'boss', { place: '琵琶洞', yx: 'yx_xiezi', owner: 'maori', end: '现出原形蝎子，被昴日星官一声鸡鸣降伏', story: '蝎子精尾巴上的倒马毒桩，连如来佛祖都被扎过。悟空请来昴日星官，公鸡一叫，蝎子就怕了。' });
e('tieshan', '铁扇公主', 'boss', { place: '翠云山芭蕉洞', end: '交出芭蕉扇，回山修行去了', story: '铁扇公主是牛魔王的妻子、红孩儿的妈妈。她的芭蕉扇一扇能把人扇出八万四千里，悟空第一次借扇就被扇飞了。' });
e('niumowang', '牛魔王', 'boss', { place: '积雷山', yx: 'yx_bainiu', owner: 'nezha', end: '现出原形大白牛，被哪吒牵去灵山', story: '牛魔王是悟空当年结拜的大哥，力大无穷。为了借芭蕉扇过火焰山，悟空和他大战了好多回合。' });
e('jiutouchong', '九头虫', 'boss', { place: '碧波潭', yx: 'yx_jiutou', owner: 'yangjian', end: '现出原形九头鸟，被哮天犬咬跑', story: '九头虫偷走了祭赛国宝塔里的舍利子。二郎神路过帮忙，哮天犬一口咬下了他一个头。' });
e('huangmei', '黄眉大王', 'boss', { place: '小雷音寺', yx: 'yx_huangmeitong', owner: 'mile', end: '变回敲磬的黄眉童儿，被弥勒佛领回', story: '黄眉大王假造了一座小雷音寺骗人。他的金铙把悟空罩在里面，人种袋还能装走一大群神仙。' });
e('saitaisui', '赛太岁', 'boss', { place: '麒麟山', yx: 'yx_hou', owner: 'guanyin', end: '现出原形金毛犼，被观音骑回南海', story: '赛太岁有三个紫金铃，一摇放火，二摇放烟，三摇放黄沙。悟空把铃铛偷了过来，他就没办法了。' });
e('zhizhu', '蜘蛛精', 'boss', { place: '盘丝洞', yx: 'yx_zhizhu', end: '现出原形：一只大蜘蛛，爬走了', story: '盘丝洞里住着七个蜘蛛精姐妹，会吐出白色的丝把整个山洞都罩住。' });
e('baiyan', '百眼魔君', 'boss', { place: '黄花观', yx: 'yx_wugong', end: '现出原形蜈蚣，被毗蓝婆菩萨收去看门', story: '百眼魔君是蜈蚣精，身上有一千只眼睛，一起放出金光就能把人罩住。毗蓝婆菩萨用一根绣花针破了他的金光。' });
e('qingshi', '青狮精', 'boss', { place: '狮驼岭', yx: 'yx_shizi', owner: 'wenshu', end: '现出原形青毛狮子，被文殊菩萨骑走', story: '狮驼岭的大大王，号称一口能吞下十万天兵。他把悟空吞进肚子，结果悟空在他肚子里翻跟头，疼得他直求饶。' });
e('baixiang', '白象精', 'boss', { place: '狮驼岭', yx: 'yx_xiang', owner: 'puxian', end: '现出原形白象，被普贤菩萨骑走', story: '狮驼岭的二大王，长鼻子一卷就能把八戒卷起来。他是普贤菩萨的白象。' });
e('dapeng', '大鹏金翅雕', 'boss', { place: '狮驼岭', yx: 'yx_dapeng', owner: 'rulai', end: '现出原形大鹏，被如来佛祖收在身边', story: '狮驼岭的三大王，一翅能飞九万里，比悟空的筋斗云还快。最后如来佛祖亲自来收服了他。' });
e('bailujing', '白鹿精', 'boss', { place: '比丘国', yx: 'yx_bailu', owner: 'shouxing', end: '现出原形白鹿，被南极寿星骑走', story: '白鹿精扮成国丈骗了比丘国国王。他原是南极寿星的坐骑，手里的拐杖也是寿星的。' });
e('laoshu', '老鼠精', 'boss', { place: '无底洞', yx: 'yx_shu', owner: 'litianwang', end: '现出原形白老鼠，被李天王和哪吒带回天庭', story: '金鼻白毛老鼠精住在陷空山无底洞，最会钻地。原来她还是托塔李天王的干女儿。' });
e('yutu', '玉兔精', 'boss', { place: '天竺国', yx: 'yx_tu', owner: 'change', end: '现出原形玉兔，被嫦娥接回月宫', story: '月宫里捣药的玉兔偷偷下凡，变成天竺国的公主。最后嫦娥仙子来到天上，把她接回了月宫。' });
e('liuer', '六耳猕猴', 'boss', { place: '灵山', end: '在如来佛祖面前现了原形，再也装不成悟空了', story: '六耳猕猴长得和悟空一模一样，连观音都分不出来。只有如来佛祖一眼看穿了他。' });
e('yezhu', '野猪精', 'mob', { end: '哼哼叫着钻回了树林', story: '山里的野猪成了精，拿着一根大木棒，喜欢低着头往前冲。' });
e('hujing', '狐狸精', 'mob', { end: '摇着三条尾巴溜走了', story: '修炼出三条尾巴的狐狸精，会放出蓝色的狐火，最爱捉弄过路的人。' });
e('bianfu', '蝙蝠精', 'mob', { end: '扑棱扑棱飞回山洞', story: '住在山洞里的蝙蝠精，白天睡觉晚上出来，叫声能把人耳朵震得嗡嗡响。' });
e('hama', '蛤蟆精', 'mob', { end: '扑通一声跳回了水塘', story: '水塘边的蛤蟆精，舌头又长又黏，一伸就能卷到很远的东西。' });
e('shitou', '石头精', 'mob', { end: '变回一块大石头不动了', story: '山上的大石头吸了日月精华变成的妖怪，力气很大，就是走得慢。' });
e('shujing', '树精', 'mob', { end: '缩回地里变回了一棵老树', story: '老树成了精，会用藤蔓缠人，一跑起来叶子沙沙响。' });
e('xiaozuanfeng', '小钻风', 'mini', { end: '敲着锣跑回去报信了', story: '狮驼岭的巡山小妖，一边敲锣一边唱“大王叫我来巡山”。在这里，他专门替你守着错题。' });
e('benbo', '奔波儿灞', 'mini', { end: '一溜烟钻回水里', story: '碧波潭的鲇鱼精，九头虫的小跟班。错题第二次复习时，他会来拦路。' });
e('babo', '灞波儿奔', 'mini', { end: '吐着泡泡逃走了', story: '碧波潭的黑鱼精，和奔波儿灞是好兄弟。错题第三次复习时，他会来拦路。' });
e('dummy', '木人桩', 'mob', { end: '木人桩被打得转了好几圈', story: '土地公给悟空准备的练功木人桩，打不坏。' });
e('chest', '宝箱', 'mob', { end: '宝箱打开了！', story: '打败 Boss 后剩下的题目会变成宝箱，答对就能开出宝贝。' });

const GODS = {
  rulai: '如来佛祖', guanyin: '观音菩萨', yudi: '玉皇大帝', wangmu: '王母娘娘', laojun: '太上老君', taibai: '太白金星',
  litianwang: '托塔李天王', nezha: '哪吒三太子', yangjian: '二郎神杨戬', chiguo: '持国天王', zengzhang: '增长天王', guangmu: '广目天王',
  duowen: '多闻天王', juling: '巨灵神', longwang: '东海龙王', leigong: '雷公', dianmu: '电母', zhenyuan: '镇元大仙',
  shouxing: '南极寿星', wenshu: '文殊菩萨', puxian: '普贤菩萨', mile: '弥勒佛', maori: '昴日星官', lingji: '灵吉菩萨', tudi: '土地公', change: '嫦娥',
};
const MOB_POOL = [null, ['langjing', 'shejing', 'hufeng', 'yezhu', 'bianfu'], ['hujing', 'bianfu', 'shujing', 'langjing'], ['hujing', 'yezhu', 'shitou', 'hufeng'], ['hama', 'xia', 'yezhu', 'shitou'], ['hama', 'xia', 'hujing', 'shujing'], ['yezhu', 'shitou', 'hufeng', 'bianfu'], ['shujing', 'hujing', 'bianfu', 'hama'], ['hufeng', 'langjing', 'yezhu', 'shitou', 'bianfu'], ['hujing', 'shujing', 'hama', 'bianfu']];
const GOD_COMMON = ['tudi', 'taibai', 'juling', 'chiguo', 'zengzhang', 'guangmu', 'duowen', 'leigong', 'dianmu', 'longwang', 'maori'];

const CH = [
  { n: '第一章 · 出五行山', set: 'heifeng', stages: [
    { id: '1-1', n: '五行山', boss: 'tiger', mobs: [], tut: true, q: 8, intro: '五百年前大闹天宫的齐天大圣，被如来佛祖压在五行山下。今天唐僧路过，揭下了山顶的压帖，悟空终于出来了！刚出山，就有一只斑斓虎拦路……' },
    { id: '1-2', n: '鹰愁涧', boss: 'bailong', mobs: ['xia'], intro: '师徒走到鹰愁涧，涧里忽然窜出一条白龙，一口把唐僧的白马吞了下去！', gift: 'acc_hair' },
    { id: '1-3', n: '黑风山', boss: 'heixiong', mobs: ['langjing', 'shejing'], intro: '观音禅院起了大火，唐僧的锦襕袈裟被黑风山的黑熊精偷走了。悟空要去把袈裟讨回来！' },
    { id: '1-4', n: '高老庄', boss: 'bajie', mobs: ['hufeng'], intro: '高老庄的高太公说，家里招了个长嘴大耳朵的女婿，力气很大，就是太能吃了……' },
    { id: '1-5', n: '流沙河', boss: 'shaseng', mobs: ['xia'], intro: '八百里流沙河，鹅毛都浮不起来。河里有个红头发的妖怪，挡住了去路。' },
    { id: '1-6', n: '黄风岭', boss: 'huangfeng', mobs: ['hufeng'], intro: '黄风岭上黄沙漫天，黄风怪的三昧神风吹得人睁不开眼。要小心！' },
  ] },
  { n: '第二章 · 白虎岭与宝象国', set: 'baigu', stages: [
    { id: '2-1', n: '白虎岭', boss: 'baigujing', mobs: ['shejing', 'langjing'], intro: '白虎岭阴风阵阵，有个妖怪想吃唐僧肉，一连变了三次来骗人。悟空，用你的火眼金睛看穿她！' },
    { id: '2-2', n: '宝象国', boss: 'huangpao', mobs: ['langjing', 'hufeng'], intro: '碗子山波月洞里的黄袍怪，抓走了宝象国的公主。' },
  ] },
  { n: '第三章 · 平顶山莲花洞', set: 'jinyin', stages: [
    { id: '3-1', n: '莲花洞外', boss: 'yinjiao', mobs: ['xia', 'hufeng'], intro: '平顶山莲花洞住着金角、银角两个大王。银角大王拿着幌金绳，先来拦路。' },
    { id: '3-2', n: '莲花洞内', boss: 'jinjiao', mobs: ['langjing', 'shejing'], intro: '金角大王的紫金红葫芦，叫你名字你可千万别答应！' },
  ] },
  { n: '第四章 · 乌鸡国与火云洞', set: 'huoyun', stages: [
    { id: '4-1', n: '乌鸡国', boss: 'qingmaoshi', mobs: ['hufeng', 'shejing'], intro: '乌鸡国的国王半夜托梦：三年前他被一个道士推下了御花园的井，那个道士现在正假扮成他当皇帝！' },
    { id: '4-2', n: '火云洞', boss: 'honghaier', mobs: ['langjing', 'xia'], intro: '火云洞的红孩儿会喷三昧真火，八戒和沙僧都被烧得直叫唤。' },
    { id: '4-3', n: '黑水河', boss: 'tuolong', mobs: ['xia', 'xia'], intro: '黑水河的河水黑得像墨汁，一个摆渡的船夫把唐僧和八戒载到了河中间……' },
  ] },
  { n: '第五章 · 车迟国与通天河', set: 'binghe', stages: [
    { id: '5-1', n: '车迟国·求雨', boss: 'huli', mobs: ['hufeng'], intro: '车迟国的国王最相信三位大仙。虎力大仙要和悟空比赛求雨！' },
    { id: '5-2', n: '车迟国·猜枚', boss: 'luli', mobs: ['langjing'], intro: '第二场比赛：隔板猜枚，猜猜箱子里放的是什么。' },
    { id: '5-3', n: '车迟国·油锅', boss: 'yangli', mobs: ['shejing'], intro: '第三场比赛：下滚油锅洗澡！羊力大仙说他一点也不怕烫。' },
    { id: '5-4', n: '通天河', boss: 'linggan', mobs: ['xia', 'xia'], intro: '通天河一夜之间冻成了冰。唐僧急着赶路，想从冰面上走过去……' },
  ] },
  { n: '第六章 · 金兜山与火焰山', set: 'niumo', stages: [
    { id: '6-1', n: '金兜山', boss: 'sidawang', mobs: ['hufeng', 'langjing'], intro: '金兜山的独角兕大王有个金刚琢，专门套别人的兵器。看好你的金箍棒！' },
    { id: '6-2', n: '琵琶洞', boss: 'xiezi', mobs: ['shejing'], intro: '毒敌山琵琶洞里，蝎子精的尾巴可厉害了。' },
    { id: '6-3', n: '芭蕉洞', boss: 'tieshan', mobs: ['langjing'], intro: '火焰山挡住了去路，只有铁扇公主的芭蕉扇能扇灭大火。' },
    { id: '6-4', n: '积雷山', boss: 'niumowang', mobs: ['hufeng', 'hufeng'], intro: '铁扇公主不肯借扇，悟空只好去找牛魔王——这可是他当年的结拜大哥。' },
    { id: '6-5', n: '碧波潭', boss: 'jiutouchong', mobs: ['xia', 'xia'], intro: '祭赛国宝塔里的舍利子被偷了，小偷就藏在碧波潭里。' },
  ] },
  { n: '第七章 · 小雷音寺与朱紫国', set: 'leiyin', stages: [
    { id: '7-1', n: '小雷音寺', boss: 'huangmei', mobs: ['langjing', 'shejing'], intro: '咦？前面怎么就到雷音寺了？八戒高兴坏了，悟空却觉得不对劲……' },
    { id: '7-2', n: '麒麟山', boss: 'saitaisui', mobs: ['hufeng'], intro: '朱紫国的王后被麒麟山的赛太岁抢走了。他腰上挂着三个紫金铃。' },
    { id: '7-3', n: '盘丝洞', boss: 'zhizhu', mobs: ['shejing'], intro: '唐僧去化斋，一进盘丝洞就被白白的丝缠住了。' },
    { id: '7-4', n: '黄花观', boss: 'baiyan', mobs: ['langjing'], intro: '黄花观的道士请大家喝茶，茶里却放了毒……' },
  ] },
  { n: '第八章 · 狮驼岭', set: 'tuoluo', stages: [
    { id: '8-1', n: '狮驼岭·大大王', boss: 'qingshi', mobs: ['hufeng', 'langjing'], intro: '狮驼岭有三个魔王，小妖多得数不清。大大王张开嘴，能一口吞下十万天兵！' },
    { id: '8-2', n: '狮驼岭·二大王', boss: 'baixiang', mobs: ['hufeng', 'shejing'], intro: '二大王的长鼻子一卷，八戒就被卷走了！' },
    { id: '8-3', n: '狮驼城', boss: 'dapeng', mobs: ['langjing', 'hufeng'], intro: '三大王大鹏金翅雕一翅九万里，比筋斗云还快。这是一路上最难的一关！' },
  ] },
  { n: '第九章 · 比丘国到灵山', set: 'qitian', stages: [
    { id: '9-1', n: '比丘国', boss: 'bailujing', mobs: ['shejing', 'langjing'], intro: '比丘国的国丈是个白胡子老道士，他要用一千一百一十一个小孩的心做药引子！' },
    { id: '9-2', n: '无底洞', boss: 'laoshu', mobs: ['xia', 'hufeng'], intro: '陷空山无底洞，洞口小小的，里面却深得看不见底。' },
    { id: '9-3', n: '天竺国', boss: 'yutu', mobs: ['hufeng', 'langjing'], intro: '天竺国的公主抛绣球招亲，绣球正好打中了唐僧！可这位公主好像有一对长耳朵……' },
    { id: '9-4', n: '灵山', boss: 'liuer', mobs: ['xiaozuanfeng', 'benbo'], final: true, intro: '灵山就在眼前！可是又出现了一个一模一样的孙悟空……真假美猴王，谁才是真的？' },
  ] },
];
// Boss 专属掉落
const BOSS_DROP = {
  heixiong: { staff: 'staff_heiying' }, huangfeng: { staff: 'staff_feng', acc: 'acc_dingfeng' }, baigujing: { staff: 'staff_gu' },
  huangpao: { acc: 'acc_neidan' }, jinjiao: { staff: 'staff_qixing', acc: 'acc_hulu' }, honghaier: { staff: 'staff_huo' },
  linggan: { staff: 'staff_bing' }, sidawang: { acc: 'acc_zhuo' }, tieshan: { acc: 'acc_bajiao' }, niumowang: { staff: 'staff_hunt' },
  saitaisui: { acc: 'acc_ling' }, dapeng: { staff: 'staff_jinchi' }, liuer: { staff: 'staff_qitian' },
};
const TITLES = [[0, '石猴'], [50, '美猴王'], [150, '弼马温'], [400, '齐天大圣'], [1000, '斗战胜佛']];
const KP_HINT = {
  '汉字结构': '先看这个字能不能拆开；能拆的话，是上下排、左右排，还是一部分包住另一部分？',
  '偏旁部首': '偏旁在字的哪个位置？在左边叫“旁”，在上面叫“头”，在下面叫“底”，在外面叫“框”。',
  '笔顺笔画': '用手指在桌上把这个字写一遍，一笔一笔数。',
  '字音辨析': '把这个词完整地读出来，想想平时怎么说。',
  '古诗词义': '把这句诗用自己的话说一遍，再看哪个意思放进去最通顺。',
  '古诗名句': '小声把这首诗背一遍，背到这一句就知道下一句了。',
  '诗人字号': '想想这位诗人的外号是怎么来的：诗仙、诗圣、诗佛、诗魔……',
  '诗人诗作': '先想起这首诗的第一句，再想想是谁写的。',
  '诗歌常识': '数一数每句有几个字、一共有几句。',
  '成语典故': '想想这个故事讲了什么事，最后明白了什么道理。',
  '经典名言': '《论语》记的是孔子的话，《三字经》《千字文》是小朋友的识字书。',
  '古代文化': '想想古时候的人是怎么生活的。',
  '北京与古都': '北京的中轴线从北边的钟楼一直到南边的永定门。',
  '名山大川': '三山：黄山、庐山、雁荡山；五岳：东泰、西华、南衡、北恒、中嵩。',
  '农耕与自然': '南方温暖多雨种水稻，北方寒冷干燥种小米。',
  '汉字本义': '看看这个字最早像什么东西。',
  '四大名楼': '四大名楼：黄鹤楼（武汉）、岳阳楼（岳阳）、滕王阁（南昌）、鹳雀楼（永济）。想想每座楼的名字是怎么来的。',
  '神话传说': '回想一下故事里发生了什么，主人公是谁、他做了什么。',
  '四大美女': '沉鱼西施、落雁昭君、闭月貂蝉、羞花玉环。',
  '自然常识': '想想这种小动物平时是怎么生活的。',
  '找规律': '看看相邻两个之间是怎么变的：多了几？少了几？还是在重复？',
  '排队问题': '画一画小圆圈代表人，别忘了把自己也算进去。',
  '比较推理': '把它们从高到矮（从快到慢）排成一排。',
  '等量代换': '一步一步换：先换成中间的东西，再换成最后的东西。',
  '凑十法': '先凑成 10，再加剩下的。',
  '加减应用': '想想是变多了还是变少了。',
  '植树锯木': '画一画！段数和次数差 1。',
  '年龄问题': '每过一年，两个人都长一岁，相差的岁数不变。',
};
window.QJ_DATA = { E, GODS, GOD_COMMON, MOB_POOL, CH, BOSS_DROP, TITLES, KP_HINT };
})();

/* 取经小英雄 · 援军神仙的介绍、身份和能力（按《西游记》原著） */
(function(){
'use strict';
// fx：dmg 伤害倍数（乘悟空攻击）；heal 回血比例；stun 定住妖怪（下次答错不挨打）；focus 棍势加满
const G = {
  rulai: { tag: '西天灵山 · 佛祖', story: '西天灵山雷音寺的佛祖，法力最大。当年悟空大闹天宫，翻了无数个筋斗也没翻出他的手掌心，被压在五行山下五百年。', fx: { dmg: 4 }, power: '佛掌压顶：伤害是攻击的 4 倍，所有援军里最强。' },
  guanyin: { tag: '南海普陀山 · 菩萨', story: '南海普陀山的菩萨，取经的事就是她安排的。她给了悟空紧箍和三根救命毫毛，还收服了黑熊精、红孩儿。', fx: { dmg: 2, heal: .4 }, power: '杨柳净瓶：洒下甘露，悟空回血 40%，同时打妖怪 2 倍伤害。' },
  yudi: { tag: '天庭 · 天帝', story: '天庭的主人。悟空先被他封了“弼马温”，嫌官小反下天宫，后来又封了“齐天大圣”。', fx: { dmg: 4 }, power: '天兵天将：伤害是攻击的 4 倍。' },
  wangmu: { tag: '瑶池 · 天后', story: '住在瑶池，管着蟠桃园。悟空看守蟠桃园时偷吃了大桃子，还搅乱了她的蟠桃大会。', fx: { dmg: 2, heal: .5 }, power: '蟠桃仙果：悟空回血 50%，再打 2 倍伤害。' },
  laojun: { tag: '兜率宫 · 道祖', story: '在兜率宫炼仙丹。他把悟空关进八卦炉烧了七七四十九天，没烧死，反而炼出了火眼金睛。金角、银角大王是他看炉子的童子。', fx: { dmg: 3, heal: .3 }, power: '金丹妙药：悟空回血 30%，再用金刚琢打 3 倍伤害。' },
  taibai: { tag: '天庭 · 老神仙', story: '白胡子老神仙，两次下界请悟空上天当官，一路上还常常变成老人给取经队伍报信。', fx: { dmg: 3, focus: true }, power: '圣旨招安：打 3 倍伤害，还把悟空的棍势一下加满。' },
  litianwang: { tag: '天庭 · 元帅', story: '手里托着一座玲珑宝塔，是哪吒的爸爸。当年他带十万天兵去花果山捉悟空。', fx: { dmg: 3, stun: true }, power: '宝塔镇妖：打 3 倍伤害，并把妖怪关住——下次答错妖怪也打不了你。' },
  nezha: { tag: '天庭 · 三太子', story: '李天王的三儿子，能变成三头六臂，脚踩风火轮，手拿火尖枪和乾坤圈，和悟空打过好几回。', fx: { dmg: 3.5 }, power: '三头六臂：六件兵器一起上，伤害是攻击的 3.5 倍。' },
  yangjian: { tag: '灌江口 · 真君', story: '额头上长着第三只眼，带着哮天犬。他和悟空斗变化，七十二变对七十二变，最后帮天庭捉住了悟空。', fx: { dmg: 3.5 }, power: '天眼神光：伤害是攻击的 3.5 倍。' },
  chiguo: { tag: '南天门 · 东方天王', story: '四大天王之一，守护东方，手里拿着琵琶，弹一下就能让人站不稳。', fx: { dmg: 3 }, power: '琵琶震音：伤害是攻击的 3 倍。' },
  zengzhang: { tag: '南天门 · 南方天王', story: '四大天王之一，守护南方，手拿青锋宝剑。', fx: { dmg: 3 }, power: '青锋宝剑：伤害是攻击的 3 倍。' },
  guangmu: { tag: '南天门 · 西方天王', story: '四大天王之一，守护西方，手上缠着一条龙（也有人说是蛇），眼睛能看遍世界。', fx: { dmg: 3 }, power: '缠龙出击：伤害是攻击的 3 倍。' },
  duowen: { tag: '南天门 · 北方天王', story: '四大天王之一，守护北方，手里撑着一把宝伞，一打开就天昏地暗。', fx: { dmg: 3 }, power: '混元宝伞：伤害是攻击的 3 倍。' },
  juling: { tag: '天庭 · 大力神', story: '个子特别高大，拿着两把大板斧。他是第一个下界去打悟空的天将，结果被悟空一棍打败。', fx: { dmg: 3 }, power: '开山巨斧：伤害是攻击的 3 倍。' },
  longwang: { tag: '东海龙宫 · 龙王', story: '悟空的如意金箍棒就是从他的东海龙宫拿走的。车迟国比赛求雨时，他帮悟空降了大雨。', fx: { dmg: 3 }, power: '翻江倒海：伤害是攻击的 3 倍。' },
  leigong: { tag: '天庭 · 雷神', story: '负责打雷的神仙，尖嘴、长翅膀，拿着锤子和凿子。车迟国求雨时听悟空的号令打雷。', fx: { dmg: 3 }, power: '五雷轰顶：伤害是攻击的 3 倍。' },
  dianmu: { tag: '天庭 · 闪电女神', story: '负责闪电的女神，手里拿着两面镜子，一照就是一道闪电。', fx: { dmg: 3 }, power: '金光电镜：伤害是攻击的 3 倍。' },
  zhenyuan: { tag: '万寿山五庄观 · 地仙之祖', story: '五庄观的主人，种着三千年开花、三千年结果的人参果树。悟空推倒了他的果树，后来请观音救活，两人结拜成兄弟。', fx: { heal: .5, dmg: 2 }, power: '人参果：悟空回血 50%，再用袖里乾坤打 2 倍伤害。' },
  shouxing: { tag: '南极 · 寿星老人', story: '额头高高的老寿星，骑着白鹿。比丘国的白鹿精就是他的坐骑偷跑下界变的。', fx: { heal: .4, dmg: 2 }, power: '延年仙桃：悟空回血 40%，再打 2 倍伤害。' },
  wenshu: { tag: '五台山 · 菩萨', story: '代表智慧的菩萨，骑着青毛狮子。乌鸡国和狮驼岭的狮子精，都是他的坐骑跑下界变的。', fx: { dmg: 3 }, power: '智慧剑：伤害是攻击的 3 倍。' },
  puxian: { tag: '峨眉山 · 菩萨', story: '骑着六牙白象的菩萨。狮驼岭会用长鼻子卷人的二大王，就是他的白象。', fx: { dmg: 3 }, power: '白象踏地：伤害是攻击的 3 倍。' },
  mile: { tag: '灵山 · 未来佛', story: '大肚子、笑眯眯。小雷音寺的黄眉大王是他敲磬的童子，偷了他的人种袋下界作怪。', fx: { dmg: 3, stun: true }, power: '人种袋：打 3 倍伤害，并把妖怪装进袋子——下次答错妖怪也打不了你。' },
  maori: { tag: '天庭 · 星官', story: '本相是一只大公鸡。他在毒敌山叫了一声，就把蝎子精制服了。', fx: { dmg: 3 }, power: '金鸡报晓：伤害是攻击的 3 倍。' },
  lingji: { tag: '小须弥山 · 菩萨', story: '有一颗定风丹和一根飞龙宝杖。黄风怪吹三昧神风时，就是他出手降服的。', fx: { dmg: 3, stun: true }, power: '定风丹：打 3 倍伤害，再把妖怪定住——下次答错妖怪也打不了你。' },
  tudi: { tag: '各地 · 土地神', story: '个子矮矮的白胡子老爷爷。悟空每到一个地方不认路，就用金箍棒敲敲地，把他叫出来问路。', fx: { dmg: 2, heal: .2 }, power: '指路小帮手：悟空回血 20%，再打 2 倍伤害。' },
  change: { tag: '月宫 · 仙子', story: '住在月亮上的仙子，养着玉兔。天竺国假公主就是她的玉兔偷偷下界变的。', fx: { heal: .3, dmg: 2 }, power: '月华清辉：悟空回血 30%，再打 2 倍伤害。' },
};
window.QJ_GODINFO = G;
})();

/* 取经小英雄 · 火眼金睛用的小知识库：诗人特点、诗文大意、写字的部件顺序 */
(function(){
'use strict';
// 诗人/人物的特点（不写名字，也尽量不提别的诗人名字，免得和选项混淆）
const PEOPLE = {
  '李白': '唐朝的“诗仙”，字太白，最爱喝酒、看月亮，喜欢坐船游遍名山大川，诗写得又豪迈又浪漫。',
  '杜甫': '唐朝的“诗圣”，字子美，最关心老百姓的苦和乐，一辈子漂泊，在成都住过草堂。',
  '王维': '唐朝的“诗佛”，字摩诘，信佛，还是大画家，诗里有画、画里有诗，最爱写安静的山水田园。',
  '孟浩然': '唐朝有名的田园诗人，家在湖北襄阳，一辈子没做官，最爱写农家生活和山水，诗写得清淡自然。',
  '白居易': '唐朝诗人，字乐天，被称为“诗魔”，写诗特别通俗好懂，据说写完要念给不识字的老奶奶听。',
  '苏轼': '宋朝的大文学家，号东坡居士，爱吃肉（东坡肉就是他发明的），写过很多西湖、庐山的诗。',
  '杨万里': '宋朝诗人，最爱写小池塘、小荷叶、蝴蝶、蜻蜓这些小景物，写得活泼有趣，像小朋友看世界。',
  '骆宾王': '唐朝的小神童，七岁时看到池塘里的大白鹅，就写出了一首诗。',
  '王之涣': '唐朝诗人，登上鹳雀楼，写下了“更上一层楼”的名句。',
  '胡令能': '唐朝诗人，年轻时是修锅补碗的手艺人，写过一个小孩学钓鱼的诗。',
  '李贺': '唐朝的“诗鬼”，想象力特别奇特，诗里常有神仙鬼怪。',
  '高适': '唐朝的边塞诗人，爱写边关、军营和打仗。',
  '杜牧': '唐朝晚期的诗人，和李商隐合称“小李杜”，写过《山行》《清明》。',
  '孟郊': '唐朝诗人，写过妈妈给远行的孩子缝衣服的诗《游子吟》。',
  '贺知章': '唐朝诗人，写过《咏柳》，年纪很大才回到家乡，写了《回乡偶书》。',
  '孔子': '春秋时候的大教育家，儒家的开创者，名丘、字仲尼，他和学生说的话记在《论语》里。',
  '孟子': '战国时候儒家的大学者，被称为“亚圣”，小时候他的妈妈为了让他好好学习搬了三次家。',
  '老子': '道家的开创者，骑着青牛出函谷关，写下了《道德经》。',
  '庄子': '道家的大学者，梦见自己变成蝴蝶，讲了很多寓言故事。',
  '周敦颐': '宋朝的学者，最爱莲花，说它从淤泥里长出来却一点不脏。',
  '范仲淹': '宋朝的大臣，写过“先天下之忧而忧，后天下之乐而乐”。',
  '王勃': '唐朝初年的少年天才，二十多岁就写出了“落霞与孤鹜齐飞”。',
  '刘禹锡': '唐朝诗人，被称为“诗豪”，是白居易的好朋友，写过洞庭湖和黄河的诗。',
  '吴承恩': '明朝的小说家，写了唐僧师徒去西天取经的故事。',
};
// 诗文的大意（不出现题目里的字）
const WORKS = {
  '九月九日忆山东兄弟': '重阳节一个人在外地做客，想到家乡的兄弟们正在登高、插茱萸，就少了自己一个。',
  '鹿柴': '空荡荡的山里看不见人，只听到说话声；夕阳照进深深的树林，又照在青苔上。',
  '望天门山': '长江把两座山冲开，碧绿的江水向东流去，一只小船从太阳那边开过来。',
  '宿建德江': '小船停在烟雾蒙蒙的江边过夜，旷野的天好像比树还低，江里的月亮离人很近，诗人想家了。',
  '山居秋暝': '秋天傍晚，山里刚下过一场雨，月光照着松林，清泉在石头上流，洗衣服的姑娘和渔船回来了。',
  '春晓': '春天睡得香，不知不觉天就亮了，到处听到鸟叫；想起夜里的风雨声，不知道打落了多少花。',
  '相思': '红豆长在南方，春天发出新枝；劝朋友多采一些，它最能表达想念。',
  '忆江南': '回忆南方的好风景：太阳出来时江边的花红得像火，春天的江水绿得像蓝草。',
  '暮江吟': '夕阳铺在江面上，一半碧绿一半红；九月初三的晚上，露珠像珍珠，月亮像弯弓。',
  '赋得古原草送别': '原野上的草每年枯了又绿，野火烧不完，春风一吹又长出来；诗人在这里送别朋友。',
  '池上': '一个小娃娃撑着小船偷偷去采白莲，不会藏踪迹，水面的浮萍被划开了一道。',
  '望庐山瀑布': '太阳照着香炉峰升起紫色的烟雾，远远看见瀑布挂在山前，好像银河从天上落下来。',
  '题西林壁': '横着看是山岭，侧着看是山峰，远近高低都不一样；看不清山的真面目，是因为自己就在山里。',
  '独坐敬亭山': '鸟都飞走了，云也飘走了，只有一座山和诗人互相看着，怎么看也看不够。',
  '早发白帝城': '清早告别彩云间的城，一天就回到千里外的江陵；两岸猴子叫个不停，小船已经过了万重山。',
  '黄鹤楼送孟浩然之广陵': '在江边的高楼上送别老朋友，他在三月花开时去扬州，小船越走越远，最后只看见长江流向天边。',
  '江畔独步寻花': '黄四娘家门前的小路开满了花，千朵万朵把枝条都压弯了，蝴蝶在跳舞，黄莺在唱歌。',
  '望岳': '远远望着泰山，诗人说：一定要登上最高的山顶，看看周围的山都变得多么小。',
  '饮湖上初晴后雨': '西湖晴天波光闪闪，下雨时山色朦朦胧胧，都很美，就像美女西施，淡妆浓妆都好看。',
  '小池': '泉眼静静地流出细细的水，刚露出尖尖角的小荷叶上，早就有一只蜻蜓站在上面。',
  '小儿垂钓': '一个头发乱蓬蓬的小孩坐在草丛里学钓鱼，有人问路，他怕把鱼吓跑，远远地招手不说话。',
  '静夜思': '床前的月光像地上的霜，抬头望着月亮，低头就想起了家乡。',
  '赠汪伦': '诗人坐上船正要走，忽然听到岸上有人踏着节拍唱歌来送行，潭水再深也比不上朋友的情谊。',
  '绝句（两个黄鹂鸣翠柳）': '两只黄鹂在柳树上唱歌，一行白鹭飞上蓝天，窗外是千年不化的雪山，门口停着去东吴的船。',
  '春夜喜雨': '好雨知道春天到了，在夜里跟着风悄悄地下，滋润万物一点声音也没有。',
  '过故人庄': '老朋友准备了鸡和黄米饭，请诗人去农家做客，绿树围着村子，大家边喝酒边聊庄稼。',
  '宿新市徐公店': '篱笆边的小路伸向远方，小孩子急急忙忙追一只黄蝴蝶，蝴蝶飞进黄色的菜花里，找不到了。',
  '惠崇春江晚景': '竹林外桃花开了两三枝，春天的江水变暖了，鸭子最先知道。',
  '咏鹅': '一只大白鹅弯着脖子向天唱歌，白羽毛浮在绿水上，红红的脚掌拨着清清的水波。',
  '登鹳雀楼': '太阳靠着山慢慢落下，黄河向大海流去；想看到千里以外，就要再登上一层楼。',
  '山行': '诗人坐车走在秋天的山路上，看见白云深处有人家，停下车欣赏傍晚的枫林，经霜的叶子比二月的花还红。',
  '望洞庭': '秋夜的湖面和月光融在一起，没有风，像一面没磨过的镜子；远看湖里的君山，像白银盘里放着一只青螺。',
  '使至塞上': '诗人奉命出使到边塞，看见大沙漠里一道烟直直升起，长长的黄河上落日圆圆的。',
  '过故人庄': '老朋友准备了鸡和黄米饭，请诗人去农家做客，绿树围着村子，大家边喝酒边聊庄稼。',
  '琵琶行': '一首很长的诗：诗人在江边送客，听一位弹琵琶的女子弹曲子、讲她的身世。',
  '长恨歌': '一首很长的诗，讲唐玄宗和杨贵妃的故事。',
  '大林寺桃花': '四月山下的花都谢了，山上寺庙里的桃花才刚开，诗人惊喜地发现春天原来跑到山上来了。',
  '爱莲说': '一篇文章，赞美莲花从淤泥里长出来却不被弄脏，用它比喻品格高洁的人。',
  '岳阳楼记': '一篇文章，写洞庭湖边一座名楼的风景，讲“先替天下人担忧，后和天下人一起快乐”。',
  '滕王阁序': '一篇文章，写江西一座名楼的秋景：晚霞和野鸭一起飞，秋水和长天一个颜色。',
  '三字经': '小朋友的启蒙书，三个字一句，开头是“人之初，性本善”。',
  '论语': '记录孔子和他的学生说过的话，比如“学而时习之”。',
  '千字文': '用一千个不重复的字编成的启蒙书，开头是“天地玄黄”。',
  '西游记': '写唐僧带着三个徒弟去西天取经、一路降妖除魔的长篇小说。',
  '唐诗三百首': '清朝人从唐朝的诗里挑了三百多首好诗编成的书。',
  '列子': '道家的一本古书，里面有一位老人带着子孙挖山的故事。',
  '愚公移山': '一位九十岁的老人带着子孙一筐一筐挖走挡路的大山，最后感动了天帝。',
  '夸父逐日': '一个巨人拼命追赶太阳，渴得喝干了黄河、渭河的水。',
};
// 写字的部件顺序（先写哪部分、再写哪部分）
const PARTS = {
  '边': '先写里面的「力」，最后写下面的走之底（辶）。', '园': '先写外框的左边和上边，再写里面的「元」，最后封口。',
  '池': '先写左边的三点水，再写右边的「也」。', '玩': '先写左边的王字旁（做偏旁时最后一笔是提），再写右边的「元」。',
  '爸': '先写上面的「父」，再写下面的「巴」。', '冰': '先写左边的两点水，再写右边的「水」。',
  '国': '先写外框的左边和上边，再写里面，最后封口。', '回': '先外后内再封口。',
};
// 全诗（答错时唐僧黑板上写出来）
const POEMS = {"九月九日忆山东兄弟": {"era": "唐", "poet": "王维", "text": "独在异乡为异客，每逢佳节倍思亲。遥知兄弟登高处，遍插茱萸少一人。"}, "鹿柴": {"era": "唐", "poet": "王维", "text": "空山不见人，但闻人语响。返景入深林，复照青苔上。"}, "山居秋暝": {"era": "唐", "poet": "王维", "text": "空山新雨后，天气晚来秋。明月松间照，清泉石上流。竹喧归浣女，莲动下渔舟。随意春芳歇，王孙自可留。"}, "相思": {"era": "唐", "poet": "王维", "text": "红豆生南国，春来发几枝。愿君多采撷，此物最相思。"}, "使至塞上": {"era": "唐", "poet": "王维", "text": "单车欲问边，属国过居延。征蓬出汉塞，归雁入胡天。大漠孤烟直，长河落日圆。萧关逢候骑，都护在燕然。"}, "春晓": {"era": "唐", "poet": "孟浩然", "text": "春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。"}, "宿建德江": {"era": "唐", "poet": "孟浩然", "text": "移舟泊烟渚，日暮客愁新。野旷天低树，江清月近人。"}, "过故人庄": {"era": "唐", "poet": "孟浩然", "text": "故人具鸡黍，邀我至田家。绿树村边合，青山郭外斜。开轩面场圃，把酒话桑麻。待到重阳日，还来就菊花。"}, "池上": {"era": "唐", "poet": "白居易", "text": "小娃撑小艇，偷采白莲回。不解藏踪迹，浮萍一道开。"}, "忆江南": {"era": "唐", "poet": "白居易", "text": "江南好，风景旧曾谙。日出江花红胜火，春来江水绿如蓝。能不忆江南？"}, "赋得古原草送别": {"era": "唐", "poet": "白居易", "text": "离离原上草，一岁一枯荣。野火烧不尽，春风吹又生。远芳侵古道，晴翠接荒城。又送王孙去，萋萋满别情。"}, "暮江吟": {"era": "唐", "poet": "白居易", "text": "一道残阳铺水中，半江瑟瑟半江红。可怜九月初三夜，露似真珠月似弓。"}, "大林寺桃花": {"era": "唐", "poet": "白居易", "text": "人间四月芳菲尽，山寺桃花始盛开。长恨春归无觅处，不知转入此中来。"}, "山行": {"era": "唐", "poet": "杜牧", "text": "远上寒山石径斜，白云生处有人家。停车坐爱枫林晚，霜叶红于二月花。"}, "望洞庭": {"era": "唐", "poet": "刘禹锡", "text": "湖光秋月两相和，潭面无风镜未磨。遥望洞庭山水翠，白银盘里一青螺。"}, "静夜思": {"era": "唐", "poet": "李白", "text": "床前明月光，疑是地上霜。举头望明月，低头思故乡。"}, "望庐山瀑布": {"era": "唐", "poet": "李白", "text": "日照香炉生紫烟，遥看瀑布挂前川。飞流直下三千尺，疑是银河落九天。"}, "独坐敬亭山": {"era": "唐", "poet": "李白", "text": "众鸟高飞尽，孤云独去闲。相看两不厌，只有敬亭山。"}, "早发白帝城": {"era": "唐", "poet": "李白", "text": "朝辞白帝彩云间，千里江陵一日还。两岸猿声啼不住，轻舟已过万重山。"}, "黄鹤楼送孟浩然之广陵": {"era": "唐", "poet": "李白", "text": "故人西辞黄鹤楼，烟花三月下扬州。孤帆远影碧空尽，唯见长江天际流。"}, "望天门山": {"era": "唐", "poet": "李白", "text": "天门中断楚江开，碧水东流至此回。两岸青山相对出，孤帆一片日边来。"}, "赠汪伦": {"era": "唐", "poet": "李白", "text": "李白乘舟将欲行，忽闻岸上踏歌声。桃花潭水深千尺，不及汪伦送我情。"}, "江畔独步寻花": {"era": "唐", "poet": "杜甫", "text": "黄四娘家花满蹊，千朵万朵压枝低。留连戏蝶时时舞，自在娇莺恰恰啼。"}, "绝句（两个黄鹂鸣翠柳）": {"era": "唐", "poet": "杜甫", "text": "两个黄鹂鸣翠柳，一行白鹭上青天。窗含西岭千秋雪，门泊东吴万里船。"}, "春夜喜雨": {"era": "唐", "poet": "杜甫", "text": "好雨知时节，当春乃发生。随风潜入夜，润物细无声。野径云俱黑，江船火独明。晓看红湿处，花重锦官城。"}, "望岳": {"era": "唐", "poet": "杜甫", "text": "岱宗夫如何？齐鲁青未了。造化钟神秀，阴阳割昏晓。荡胸生曾云，决眦入归鸟。会当凌绝顶，一览众山小。"}, "题西林壁": {"era": "宋", "poet": "苏轼", "text": "横看成岭侧成峰，远近高低各不同。不识庐山真面目，只缘身在此山中。"}, "饮湖上初晴后雨": {"era": "宋", "poet": "苏轼", "text": "水光潋滟晴方好，山色空蒙雨亦奇。欲把西湖比西子，淡妆浓抹总相宜。"}, "惠崇春江晚景": {"era": "宋", "poet": "苏轼", "text": "竹外桃花三两枝，春江水暖鸭先知。蒌蒿满地芦芽短，正是河豚欲上时。"}, "小池": {"era": "宋", "poet": "杨万里", "text": "泉眼无声惜细流，树阴照水爱晴柔。小荷才露尖尖角，早有蜻蜓立上头。"}, "宿新市徐公店": {"era": "宋", "poet": "杨万里", "text": "篱落疏疏一径深，树头新绿未成阴。儿童急走追黄蝶，飞入菜花无处寻。"}, "小儿垂钓": {"era": "唐", "poet": "胡令能", "text": "蓬头稚子学垂纶，侧坐莓苔草映身。路人借问遥招手，怕得鱼惊不应人。"}, "咏鹅": {"era": "唐", "poet": "骆宾王", "text": "鹅，鹅，鹅，曲项向天歌。白毛浮绿水，红掌拨清波。"}, "登鹳雀楼": {"era": "唐", "poet": "王之涣", "text": "白日依山尽，黄河入海流。欲穷千里目，更上一层楼。"}};
window.QJ_HINT_DATA = { PEOPLE, WORKS, PARTS, POEMS };
})();

/* 取经小英雄 · 火眼金睛的提示
   不直接说答案，但要真的有用：按题型给“怎么想”的线索；知识题用讲解里的线索（把答案挖掉）；
   实在没有，就给答案里的一个字。妈妈新加的题也能自动生成。 */
(function(){
'use strict';
// 偏旁名字里的关键字 → 这个部首和什么有关
const MEAN = [
  [/三点水|水字旁|四点水/, '水'], [/两点水/, '冰、冷'], [/提手|手字旁/, '手的动作'], [/竖心|心字|心字底|心字头/, '心情、想法'],
  [/口字旁/, '嘴巴'], [/口字框|国字框|方框/, '把东西围起来'], [/提土|土字/, '泥土'], [/木字/, '树木'], [/禾字/, '庄稼'], [/草字头/, '花草'],
  [/金字|铁字/, '金属'], [/言字|语字/, '说话'], [/食字|饭字/, '吃东西'], [/走之|之字底|建之/, '走路、路程'], [/走字旁/, '走、跑'],
  [/足字|提足/, '脚'], [/日字/, '太阳、时间'], [/目字/, '眼睛'], [/女字/, '女孩子、女性'], [/竹字/, '竹子'], [/雨字头/, '天气、下雨'],
  [/宝盖|秃宝盖/, '房子、屋顶'], [/穴字/, '洞'], [/米字/, '米、粮食'], [/火字|四点底|点字旁/, '火'], [/力字/, '力气'], [/反文|折文|攵|收字/, '手拿着东西做动作'],
  [/单人|人字/, '人'], [/双人/, '走路、行走'], [/刀字/, '刀'], [/牛字|提牛|物字/, '牛'], [/反犬/, '动物'], [/月字/, '身体'], [/子字/, '孩子'],
  [/父字/, '爸爸'], [/田字/, '田地'], [/云字/, '云、说话'], [/立字/, '站立'], [/目字/, '眼睛'], [/米字/, '米'], [/巴字/, '巴'], [/十字头/, '数字十'],
];
const POS = n => /底/.test(n) ? '字的下面' : /头/.test(n) ? '字的上面' : /框/.test(n) ? '字的外面，把别的部分包起来' : /边/.test(n) ? '字的一边' : /旁/.test(n) ? '字的左边' : '';
const meanOf = n => { for (const [re, m] of MEAN) if (re.test(n)) return m; return null; };
const strip = s => String(s || '').replace(/[《》“”"「」]/g, '').trim();
const NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function mask(text, words) {
  let t = String(text || '');
  words.filter(w => w && w.length).sort((a, b) => b.length - a.length).forEach(w => { t = t.split(w).join('□'.repeat(w.length)); });
  return t;
}
// 挖掉答案后还剩多少“新信息”（题目里已经有的字不算）
function info(masked, q) {
  const qs = new Set(q.q + q.opts.join(''));
  return [...masked].filter(c => !qs.has(c) && !/[□\s，。、；：！？“”《》（）()…—\-=+0-9a-zA-Z]/.test(c) && !'是的了在里这首诗作者写所以就叫出自本书句话说她他它们一个'.includes(c)).length;
}
// 正确答案里有、错误选项里都没有的字
function uniqueChar(q) {
  const right = strip(q.opts[q.ans[0]]), wrong = q.opts.filter((_, i) => !q.ans.includes(i)).map(strip).join('');
  for (const c of right) if (!wrong.includes(c) && /[一-龥]/.test(c)) return c;
  return null;
}

function make(q) {
  if (!q || !q.opts || !q.ans || !q.ans.length) return null;
  if (q.hint) return q.hint;
  const ansText = q.ans.map(a => q.opts[a]);
  const right = strip(ansText[0]);
  const ch = (q.q.match(/[“"]([^”"]{1,2})[”"]/) || [])[1];
  const kp = q.kp || '';

  // ---- 偏旁部首 ----
  if (kp === '偏旁部首' || /偏旁|部首/.test(q.q)) {
    const target = (q.q.match(/偏旁是(.{2,4})？?/) || [])[1];
    if (target) { const m = meanOf(target), p = POS(target); return `${target}在${p || '字里'}${m ? `，带它的字常常和「${m}」有关` : ''}。一个一个字看，找找哪个字的${p ? p.replace('字的', '').replace(/，.*/, '') : ''}有它。`; }
    if (ch && ansText.length === 1) { const m = meanOf(right), p = POS(right); if (m) return `想想“${ch}”是什么意思——它和「${m}」有关。表示这个意思的部分在${p || '字里'}。`; if (p) return `看看“${ch}”${p}是哪一部分。`; }
  }
  // ---- 汉字结构 ----
  if (kp === '汉字结构' || /结构/.test(q.q)) {
    const dm = String(q.exp || '').match(/[“"][^”"]{1,2}[”"]\s*[=＝][^，。；,]*/);
    if (ch && dm) { const dec = dm[0].trim(), parts = dec.split(/[=＝]/)[1] || ''; const n = parts.split(/[+＋]/).filter(s => s.trim()).length; return `把“${ch}”拆开：${dec}${n ? `，一共 ${n} 块` : ''}。想想这几块是左右排、上下排，还是一块包着另一块？`; }
    if (ch && /独体/.test(right)) return `试试把“${ch}”拆成两块——拆得开吗？`;
    if (!ch) return '把每个字都拆一拆，看看部件是左右排、上下排，还是一块包着另一块。';
  }
  // ---- 笔顺 ----
  const sn = q.q.match(/第(.)笔/);
  if (sn && ch) {
    const N = NUM.indexOf(sn[1]) > 0 ? NUM.indexOf(sn[1]) : parseInt(sn[1]) || 1;
    const D = window.QJ_HINT_DATA || {};
    const EXTRA = { '池': ['点', '点', '提', '横折钩', '竖', '竖弯钩'] };
    let list = EXTRA[ch];
    if (!list) { const ms = String(q.exp || '').match(/[横竖撇点捺提折钩弯卧平斜]+(?:、[横竖撇点捺提折钩弯卧平斜]+)+/g); if (ms) list = ms.join('、').split('、'); }
    const parts = (D.PARTS || {})[ch] || '';
    let tip = parts ? `“${ch}”要${parts}` : '';
    if (list && list.length >= N && N > 1 && list.slice(0, N - 1).includes(list[N - 1])) tip += `前面已经写了${N - 1 === 2 ? '两' : NUM[N - 1]}笔，用手指在桌上把“${ch}”慢慢写一遍，数到第${sn[1]}笔停下来。`;
    else if (list && list.length >= N && N > 1) tip += (N === 2 ? `第一笔是${list[0]}。` : `前面${N - 1 === 2 ? '两' : NUM[N - 1]}笔依次是：${list.slice(0, N - 1).join('、')}。`) + `接下来写的那一笔，就是第${sn[1]}笔。`;
    else if (N === 1) tip += `笔顺口诀：从上到下、从左到右、先横后竖、先撇后捺、点在上面先写点。看看“${ch}”最先落笔在哪儿。`;
    else tip += `用手指在桌上把“${ch}”慢慢写一遍，数到第${sn[1]}笔停下来。`;
    return tip;
  }

  // ---- 思维题：只给方法，不给结果 ----
  if (q.subj === '思维') {
    const nums = (q.q.match(/\d+/g) || []).map(Number);
    if (kp === '找规律' && nums.length >= 3) { const d = nums.slice(1).map((x, i) => x - nums[i]); if (d.every(x => x === d[0]) && d[0]) return `看看后一个数比前一个数${d[0] > 0 ? '多' : '少'}几，然后照着这个规律接着往下数。`; return '看看这些数是怎么变的：两个两个比一比，多了还是少了？'; }
    if (kp === '找规律') return '先找出几个一组在重复，再看括号前面是这一组里的第几个。';
    if (kp === '排队问题') return '画一排小圆圈当作排队的人，别忘了把题目里说的那个也画上，再数一数。';
    if (kp === '比较推理') return '按题目说的，一个一个排好队：谁比谁高（多），排完再看两头。';
    const first = String(q.exp || '').split(/[。；]/).filter(s => s.trim())[0] || '';
    if (first && !ansText.some(a => strip(a) && first.includes(strip(a))) && info(first, q) >= 3) return '想一想：' + first + '。';
    const n = parseFloat(right);
    if (!isNaN(n) && q.opts.every(o => !isNaN(parseFloat(o)))) { const others = q.opts.map(parseFloat).filter(x => x !== n); const bigger = others.filter(x => x > n).length, smaller = others.filter(x => x < n).length; return bigger && smaller ? '答案不是最大的，也不是最小的。动手画一画、数一数。' : bigger ? '答案是几个选项里比较小的那个。画一画再数一数。' : '答案是几个选项里比较大的那个。画一画再数一数。'; }
    return '拿出手指或者在纸上画一画，一步一步来。';
  }

  // ---- 诗人、诗文：讲人的特点、讲诗的意思 ----
  { const D = window.QJ_HINT_DATA || {}, P = D.PEOPLE || {}, W = D.WORKS || {};
    const pair = right.split(/和|与|、/).map(x => x.trim()).filter(Boolean);
    if (pair.length === 2 && P[pair[0]] && P[pair[1]]) return `是两位诗人：一位是${P[pair[0]].split('，')[0]}，另一位是${P[pair[1]].split('，')[0]}。`;
    if (P[right] && /是谁|作者|哪位|谁写|谁说|谁的|哪个人|主人公|故事/.test(q.q)) return (/诗|词/.test(q.q + kp) ? '写这首诗的人：' : '这个人：') + P[right];
    if (W[right]) { const book = /三字经|论语|千字文|西游记|唐诗三百首|列子/.test(right), essay = /说$|记$|序$/.test(right), story = /愚公|夸父/.test(right); return (book ? '这本书：' : essay ? '这篇文章：' : story ? '这个故事：' : '这首诗写的是：') + W[right]; }
  }
  // ---- 知识题：讲解里挖掉答案当线索 ----
  const words = [];
  ansText.forEach(a => { const s = strip(a); words.push(s, '《' + s + '》', '“' + s + '”'); s.split(/[\s、，]+/).forEach(w => w.length >= 2 && words.push(w)); });
  if (q.exp) {
    const sentences = String(q.exp).split(/(?<=[。！？；])/).map(s => s.trim()).filter(Boolean);
    let best = null;
    for (const s of sentences) { const m = mask(s, words); if (m.includes('□') || !ansText.some(a => s.includes(strip(a)))) { const sc = info(m, q); if (sc >= 4 && (!best || sc > best.sc)) best = { m, sc }; } }
    if (best) return '线索：' + best.m;
    // 读音题：讲解里一般会说这个字在这里是什么意思
    if (kp === '字音辨析') { const s2 = sentences.map(x => mask(x, words)).find(x => x.includes('□') && x.length >= 6); if (s2) return '线索：' + s2; return ch ? `想想“${ch}”在这里是什么意思，读音跟着意思走。` : null; }
  }
  // ---- 实在没有：给一个字 ----
  const u = uniqueChar(q);
  if (u) {
    const isTitle = /《/.test(ansText[0]) || /哪首|诗题|题目|诗名|哪篇|哪本/.test(q.q);
    if (isTitle) return `${/哪本|典籍|书/.test(q.q) ? '书名' : /哪篇|文章/.test(q.q) ? '文章题目' : /诗/.test(kp + q.q) ? '诗的题目' : '名字'}里有「${u}」字。`;
    if (/是谁|作者是|哪位|谁写|谁说|哪个人/.test(q.q) && right.length <= 4 && right[0] === u) return `这个人姓「${u}」。`;
    return `答案里有一个「${u}」字。`;
  }
  return '火眼金睛已经帮你烧掉了一个错的，剩下的再仔细读一遍题目。';
}
window.QJ_HINT = { make };
})();

/* 取经小英雄 · 主程序（一）：存储、题库、复习算法、音效、装备计算 */
(function(){
'use strict';
const C = window.QJ_CHARS, MV = window.QJ_MOVES, G = window.QJ_GEAR, DATA = window.QJ_DATA;
const { Arena, an, clear, sleep, rnd } = window.QJ_FX;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); };
const dayOf = ms => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / 86400000);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const clone = o => JSON.parse(JSON.stringify(o));

// ================= 存储 =================
const DEF_SETTINGS = { daily: 18, name: '小悟空', sound: true, focusKp: [], raceSec: 60, banks: [],
  duel: { kid: 10, dad: 14, dadSrc: 'hard', dadPenalty: 1, face: false, dadName: '爸爸', dadAvatar: 'niumowang' } };
const DEF_STATE = { xp: 0, gold: 0, spirit: 0, cleared: {}, allies: [], codex: {}, inv: { staff0: { lv: 0 } }, eq: { weapon: 'staff0' },
  frags: {}, cards: {}, pity: {}, buff: {}, raceBest: 0, hist: [], seenTut: false, ts: 0 };
const Store = {
  db: null, cloud: false, state: clone(DEF_STATE), prog: { q: {}, ts: 0 }, settings: clone(DEF_SETTINGS),
  packs: {}, custom: {}, bankReady: false, onBank: [], onRemote: [], timers: {}, chains: {}, dirty: {},
  ls(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem('qj_' + k) || 'null'); localStorage.setItem('qj_' + k, JSON.stringify(v)); } catch (e) { return null; } },
  async init() {
    try { this.db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { this.db = null; }
    this.cloud = !!this.db;
    if (this.cloud) {
      const get = async p => { try { const s = await this.db.doc(p).get(); return s.exists ? s.data() : null; } catch (e) { return null; } };
      const [st, pr, se] = await Promise.all([get('game/state'), get('game/progress'), get('game/settings')]);
      if (st) this.state = Object.assign(clone(DEF_STATE), clone(st));
      if (pr) this.prog = Object.assign({ q: {}, ts: 0 }, clone(pr));
      if (se) this.settings = deepMerge(clone(DEF_SETTINGS), clone(se));
      this.watch();
    } else {
      const st = this.ls('state'), pr = this.ls('progress'), se = this.ls('settings'), cu = this.ls('custom');
      if (st) this.state = Object.assign(clone(DEF_STATE), st);
      if (pr) this.prog = Object.assign({ q: {}, ts: 0 }, pr);
      if (se) this.settings = deepMerge(clone(DEF_SETTINGS), se);
      if (cu) this.custom = cu;
      // 独立网页版：内置题库放在 bank.json 里（离线时由缓存提供）
      if (window.QJ_BANK_URL) {
        try { const r = await fetch(window.QJ_BANK_URL, { cache: 'no-cache' }); const j = await r.json(); this.packs = j.packs || {}; this.ls('packs', this.packs); }
        catch (e) { this.packs = this.ls('packs') || {}; }
      }
      this.bankReady = true;
      this.listenLocal();
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    }
  },
  // 同一台设备上另一个页面（家长端）改了数据，这边跟着刷新
  listenLocal() {
    addEventListener('storage', e => {
      if (!e.key || !e.key.startsWith('qj_')) return;
      const k = e.key.slice(3);
      if (k === 'custom') { this.custom = this.ls('custom') || {}; this.onBank.forEach(f => f()); return; }
      const map = { state: 'state', progress: 'prog', settings: 'settings' }; if (!map[k] || this.dirty[k]) return;
      const v = this.ls(k); if (!v) return;
      this[map[k]] = k === 'settings' ? deepMerge(clone(DEF_SETTINGS), v) : Object.assign(k === 'state' ? clone(DEF_STATE) : { q: {} }, v);
      this.onRemote.forEach(f => f(k));
    });
  },
  // 备份：导出 / 导入全部数据
  backup() { ['state', 'progress', 'settings'].forEach(n => { if (this.dirty[n]) { clearTimeout(this.timers[n]); this.flush(n); } }); return { app: 'qujing', v: 1, at: Date.now(), state: clone(this.state), progress: clone(this.prog), settings: clone(this.settings), custom: clone(this.custom) }; },
  async restore(d, parts = { progress: true, custom: true }) {
    if (!d || d.app !== 'qujing') throw new Error('不是取经小英雄的备份文件');
    if (parts.progress) { if (d.state) this.state = Object.assign(clone(DEF_STATE), d.state); if (d.progress) this.prog = Object.assign({ q: {}, ts: 0 }, d.progress); if (d.settings) this.settings = deepMerge(clone(DEF_SETTINGS), d.settings); ['state', 'progress', 'settings'].forEach(n => this.save(n)); }
    if (parts.custom && d.custom) { for (const id in d.custom) { const mine = this.custom[id]; if (!mine || (d.custom[id].updated || 0) >= (mine.updated || 0)) await this.putQuestion(Object.assign({}, d.custom[id])); } }
    this.onBank.forEach(f => f());
  },
  watch() {
    try {
      this.db.collection('bank').onSnapshot(snap => { const p = {}; snap.docs.forEach(d => p[d.id] = d.data()); this.packs = p; this.bankReady = true; this.onBank.forEach(f => f()); }, () => { this.bankReady = true; this.onBank.forEach(f => f()); });
      this.db.collection('questions').onSnapshot(snap => { const c = {}; snap.docs.forEach(d => c[d.id] = d.data()); this.custom = c; this.onBank.forEach(f => f()); }, () => {});
      const remote = (name, key) => this.db.doc('game/' + name).onSnapshot(snap => {
        if (!snap.exists || snap.metadata.hasPendingWrites) return;
        const d = snap.data(); const local = this[key];
        if ((d.ts || 0) > (local.ts || 0) + 1 && !this.dirty[name]) {
          this[key] = name === 'settings' ? deepMerge(clone(DEF_SETTINGS), clone(d)) : Object.assign(name === 'state' ? clone(DEF_STATE) : { q: {} }, clone(d));
          this.onRemote.forEach(f => f(name));
        }
      }, () => {});
      remote('state', 'state'); remote('progress', 'prog'); remote('settings', 'settings');
    } catch (e) { console.error(e); }
  },
  save(name) {
    const key = { state: 'state', progress: 'prog', settings: 'settings' }[name];
    this[key].ts = Date.now(); this.dirty[name] = true;
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => this.flush(name), 900);
  },
  flush(name) {
    const key = { state: 'state', progress: 'prog', settings: 'settings' }[name];
    const data = clone(this[key]);
    if (!this.cloud) { this.ls(name, data); this.dirty[name] = false; return Promise.resolve(); }
    const prev = this.chains[name] || Promise.resolve();
    this.chains[name] = prev.then(() => this.db.doc('game/' + name).set(data)).then(() => { this.dirty[name] = false; }).catch(e => { console.error(e); if (e && e.code === 'unavailable') setTimeout(() => this.save(name), 2000); else toast('保存失败：' + (e.code || '') + '，请稍后再试'); });
    return this.chains[name];
  },
  async putQuestion(q) {
    q.updated = Date.now();
    if (!this.cloud) { this.custom[q.id] = q; this.ls('custom', this.custom); this.onBank.forEach(f => f()); return; }
    this.custom[q.id] = q; this.onBank.forEach(f => f());
    await this.db.doc('questions/' + q.id).set(clone(q));
  },
};
function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }

// ================= 题库 =================
const Bank = {
  all: [], byId: {},
  rebuild() {
    const m = {};
    Object.keys(Store.packs).sort().forEach(k => (Store.packs[k].items || []).forEach(q => m[q.id] = q));
    for (const id in Store.custom) { const c = Store.custom[id]; m[id] = Object.assign({}, m[id] || {}, c); }
    this.byId = m;
    this.all = Object.values(m).filter(q => !q.deleted && q.q && q.opts && q.opts.length >= 2 && q.ans && q.ans.length);
    this.all.forEach(q => { if (!q.bank) q.bank = '自定义'; });
  },
  banks() { const s = {}; this.all.forEach(q => s[q.bank] = (s[q.bank] || 0) + 1); return s; },
  active(list) { const b = list || Store.settings.banks || []; const have = this.banks(); const ok = b.filter(x => have[x]); return ok.length ? this.all.filter(q => ok.includes(q.bank)) : this.all; },
  activeLabel() { const b = (Store.settings.banks || []).filter(x => this.banks()[x]); return b.length ? b.join('、') : '全部题库'; },
  kps(subj, banks) { const s = {}; this.active(banks).forEach(q => { if (!subj || q.subj === subj) s[q.kp] = (s[q.kp] || 0) + 1; }); return s; },
};
// ================= 复习算法（间隔重复） =================
const INT = [0, 1, 3, 7, 14, 30];
const SRS = {
  rec(id) { return Store.prog.q[id]; },
  isWrongMarked(q) { const r = this.rec(q.id); return q.wrongMark && (!r || dayOf(q.wrongMark) >= (r.t || 0)); },
  isDue(q) { const r = this.rec(q.id); if (this.isWrongMarked(q)) return true; if (!r) return q.src === '错题'; return r.due <= today(); },
  isReview(q) { const r = this.rec(q.id); return this.isWrongMarked(q) || (r ? (r.w > 0 && r.b <= 2 && r.due <= today()) : q.src === '错题'); },
  isMastered(q) { const r = this.rec(q.id); return r && r.b >= 3; },
  reviewLevel(q) { const r = this.rec(q.id); return r ? Math.min(2, Math.max(0, (r.w || 1) - 1)) : 0; },
  record(q, ok) {
    const t = today(); const r = Store.prog.q[q.id] || { b: 0, due: t, c: 0, w: 0, t };
    if (ok) { r.c++; r.b = Math.min(5, (r.b || 0) + 1); r.due = t + INT[r.b]; }
    else { r.w++; r.b = 0; r.due = t + 1; }
    Store.prog.n = (Store.prog.n || 0) + 1;
    r.ls = Store.prog.sess || 0; r.ln = Store.prog.n; r.lok = ok;
    r.t = t; Store.prog.q[q.id] = r; Store.save('progress');
  },
  kpStats(banks) {
    const m = {};
    (banks ? Bank.active(banks) : Bank.all).forEach(q => { const k = q.subj + '·' + q.kp; const s = m[k] || (m[k] = { subj: q.subj, kp: q.kp, n: 0, seen: 0, mastered: 0, wrong: 0, score: 0 });
      s.n++; const r = this.rec(q.id); if (r) { s.seen++; if (r.b >= 3) s.mastered++; if (r.w) s.wrong++; s.score += Math.min(1, r.b / 3); } });
    return Object.values(m).map(s => Object.assign(s, { pct: s.n ? Math.round(s.score / s.n * 100) : 0 }));
  },
  // 答对的题：之后再答 50 道题之内不再出（老记录没有题数，就按 5 关算）
  GAP: 50,
  recentOk(q) { const r = this.rec(q.id); if (!r || !r.lok) return false;
    return r.ln != null ? (Store.prog.n || 0) - r.ln < this.GAP : (Store.prog.sess || 0) - (r.ls || 0) < 5; },
  // 组一局题：最多 30% 复习错题，其余尽量出没做过的新题；新题不够再用很久没见的旧题
  pick(n, o = {}) {
    if (!o.cont) { Store.prog.sess = (Store.prog.sess || 0) + 1; Store.save('progress'); }
    let pool = Bank.active(o.banks).filter(q => !o.subj || q.subj === o.subj).filter(q => !o.kps || !o.kps.length || o.kps.includes(q.kp));
    if (o.only) pool = pool.filter(o.only);
    if (!pool.length) return [];
    const focus = Store.settings.focusKp || [];
    const take = (arr, k, out) => { while (k-- > 0 && arr.length) { const q = arr.shift(); if (!out.includes(q)) out.push(q); } };
    // 从一堆题里按“复习错题 → 新题 → 很久没见的旧题 → 最近答对过的”挑 k 道
    const fill = (P, k, out) => {
      const recent = P.filter(q => this.recentOk(q)).sort((x, y) => (this.rec(x.id).ls || 0) - (this.rec(y.id).ls || 0));
      const rest = P.filter(q => !this.recentOk(q) && !out.includes(q));
      const due = shuffle(rest.filter(q => this.isDue(q) && this.isReview(q))).sort((a, b) => ((this.rec(a.id) || {}).due || 0) - ((this.rec(b.id) || {}).due || 0));
      const fresh = shuffle(rest.filter(q => !this.rec(q.id) && !this.isDue(q))).sort((a, b) => (focus.includes(b.kp) - focus.includes(a.kp)) || ((a.d || 1) - (b.d || 1)));
      // 做过的旧题（包括到期该巩固的）：最久没见的先出
      const known = rest.filter(q => { const r = this.rec(q.id); return r && !due.includes(q); }).sort((a, b) => (this.isDue(b) - this.isDue(a)) || (focus.includes(b.kp) - focus.includes(a.kp)) || ((this.rec(a.id).ln || this.rec(a.id).ls || 0) - (this.rec(b.id).ln || this.rec(b.id).ls || 0)) || (Math.random() - .5));
      const goal = out.length + k;
      take(due, Math.ceil(k * .3), out); take(fresh, goal - out.length, out); take(known, goal - out.length, out);
      take(due, goal - out.length, out); take(recent, goal - out.length, out);
    };
    const out = [];
    // 近期考点（focus）占 70%，其余 30% 照常从整个题库出
    const F = pool.filter(q => q.focus), O = pool.filter(q => !q.focus);
    if (F.length && O.length && !o.noFocus) { fill(F, Math.round(n * .7), out); fill(O, n - out.length, out); fill(F, n - out.length, out); }
    else fill(pool, n, out);
    // 开头放两道最有把握的题
    const easyFirst = out.slice().sort((a, b) => this.ease(b) - this.ease(a)).slice(0, 2);
    const rest = shuffle(out.filter(q => !easyFirst.includes(q)));
    return easyFirst.concat(rest);
  },
  ease(q) { const r = this.rec(q.id); return (r ? r.b * 2 + (r.c - r.w) : 0) - (q.d || 1); },
  variant(q, used) {
    let cands = Bank.all.filter(x => x.kp === q.kp && x.subj === q.subj && x.id !== q.id && !used.has(x.id));
    if (cands.some(x => !this.recentOk(x))) cands = cands.filter(x => !this.recentOk(x));
    if (!cands.length) return null;
    return cands.sort((a, b) => ((this.rec(a.id) || { b: 0 }).b - (this.rec(b.id) || { b: 0 }).b) + (Math.random() - .5))[0];
  },
  easy(used) {
    let c = Bank.active().filter(q => !used.has(q.id)); if (c.some(q => !this.recentOk(q))) c = c.filter(q => !this.recentOk(q));
    c.sort((a, b) => this.ease(b) - this.ease(a));
    return c.length ? c[Math.floor(Math.random() * Math.min(8, c.length))] : null;
  },
};

// ================= 音效（合成，不需要外部文件） =================
// 声音：用 audio.js 的合成引擎（西游中国风 8-bit）。音量是孩子自己在小齿轮里调的，只存在这台设备上
const AU = window.QJ_AUDIO;
const Sfx = {
  ctx: null, combo: 0,
  vol() { const v = Store.ls('vol') || {}; return { music: v.music != null ? v.music : .45, sfx: v.sfx != null ? v.sfx : .8 }; },
  setVol(m, s) { const v = this.vol(); if (m != null) v.music = m; if (s != null) v.sfx = s; Store.ls('vol', v); if (AU) AU.setVol(v.music, v.sfx); },
  on() { return Store.settings.sound !== false; },
  ensure() { if (!AU) return; const c = AU.init(); this.ctx = c; const v = this.vol(); AU.setVol(v.music, v.sfx); AU.setMuted(!this.on()); if (this.want && !AU.curName) AU.play(this.want); },
  ready() { return AU && AU.ctx && AU.ctx.state === 'running' && this.on(); },
  fx(name, ...a) { if (this.ready()) AU.sfx(name, ...a); },
  cry(k, o) { if (!this.ready()) return 0; return AU.cry(k, Object.assign({ size: sizeOf(k) }, o || {})); },
  hurt(k) { if (this.ready()) AU.hurt(k, sizeOf(k)); },
  bgm(name) { this.want = name; if (!AU || !AU.ctx) return; if (!name) AU.stop(); else if (AU.curName !== name) AU.play(name); },
  jingle(name, then) { this.want = then || null; if (!this.ready()) return; AU.stop(.15); AU.play(name); },
  duck(on) { if (AU && AU.ctx) AU.duck(on); },
  play(k) {
    const map = { click: 'click', ok: 'correct', bad: 'wrong', hit: 'normal', crit: 'crit', hurt: 'hurtMe', heal: 'heal', drop: 'drop', finish: null, win: null, lose: null };
    if (k === 'ok') return this.fx('correct', this.combo);
    if (k === 'win') return this.jingle('win');
    if (k === 'lose') return this.jingle('lose');
    if (map[k]) this.fx(map[k]);
  },
};
function sizeOf(k) {
  if (['xiaozuanfeng', 'benbo', 'babo', 'bianfu', 'hujing', 'laoshu', 'yutu', 'xia', 'shancai'].includes(k)) return 'small';
  const e = DATA.E[k]; if (DATA.GODS[k]) return 'god';
  if ((e && e.kind === 'boss') || ['shitou', 'heixiong', 'yezhu'].includes(k)) return 'big';
  return 'mid';
}
// 妖怪出招的声音（按属性）
const ELEM = { honghaier: 'fire', niumowang: 'fire', hujing: 'fire', huli: 'fire', tuolong: 'water', linggan: 'water', xia: 'water', benbo: 'water', babo: 'water', hama: 'water', jiutouchong: 'water', bailong: 'water', shaseng: 'water',
  huangfeng: 'wind', tieshan: 'wind', dapeng: 'wind', luli: 'wind', leigong: 'thunder', dianmu: 'thunder', xiezi: 'poison', baiyan: 'poison', zhizhu: 'poison', shejing: 'poison', bianfu: 'sonic', saitaisui: 'sonic', huangmei: 'sonic', xiaozuanfeng: 'sonic' };
Sfx.elem = k => ELEM[k] || null;


// ================= 装备与属性 =================
const ItemBy = Object.fromEntries(G.ITEMS.map(i => [i.id, i]));
const Gear = {
  look() {
    const L = {};
    for (const s in Store.state.eq) {
      const it = ItemBy[Store.state.eq[s]]; if (!it) continue;
      if (it.id === 'staff0') { if (((Store.state.inv.staff0 || {}).lv || 0) >= 5) L.weapon = { aura: '#ffd54f' }; continue; }
      L[s] = it.look;
    }
    return L;
  },
  stats() {
    const tot = {}; G.STATS.forEach(s => tot[s.k] = s.base);
    const sets = {};
    for (const s in Store.state.eq) {
      const it = ItemBy[Store.state.eq[s]]; if (!it) continue;
      const lv = (Store.state.inv[it.id] || {}).lv || 0;
      for (const k in it.stats) tot[k] += Math.round(it.stats[k] * (1 + .1 * lv));
      if (it.id === 'staff0') tot.atk += lv * 2;
      if (it.set) sets[it.set] = (sets[it.set] || 0) + 1;
    }
    const four = {};
    for (const k in sets) { if (sets[k] >= 2) for (const kk in G.SETS[k].b2) tot[kk] += G.SETS[k].b2[kk]; if (sets[k] >= 4) four[k] = true; }
    if (four.niumo) tot.atk = Math.round(tot.atk * 1.3);
    const acc = Store.state.eq.acc;
    return { tot, sets, four, acc };
  },
  wukong(extra = {}) { return C.wukong(Object.assign({ gear: this.look() }, extra)); },
  add(id) {
    const it = ItemBy[id]; if (!it) return null;
    if (Store.state.inv[id]) { const sp = [1, 1, 2, 3, 5][it.r]; Store.state.spirit += sp; return { it, dup: true, sp }; }
    Store.state.inv[id] = { lv: 0 };
    if (!Store.state.eq[it.slot]) Store.state.eq[it.slot] = id;
    return { it, dup: false };
  },
  title() { let t = DATA.TITLES[0]; for (const x of DATA.TITLES) if (Store.state.xp >= x[0]) t = x; const i = DATA.TITLES.indexOf(t), nx = DATA.TITLES[i + 1]; return { name: t[1], next: nx ? nx[0] : null, cur: t[0] }; },
};

// ================= 小工具 =================
let toastT;
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
function stageList() { const out = []; DATA.CH.forEach((ch, ci) => ch.stages.forEach(s => out.push(Object.assign({ ch: ci + 1, set: ch.set, chName: ch.n }, s)))); return out; }
const STAGES = stageList();
function stageUnlocked(i) { return i === 0 || !!Store.state.cleared[STAGES[i - 1].id]; }
const ENEMY_KEYS = Object.keys(DATA.E);
function name(k) { return (DATA.E[k] || {}).n || DATA.GODS[k] || k; }

window.QJ_DEF_STATE = DEF_STATE;
window.QJ = { AU, C, MV, G, DATA, Arena, an, clear, sleep, rnd, $, $$, esc, today, shuffle, pick, clone, Store, Bank, SRS, Sfx, Gear, ItemBy, toast, STAGES, stageUnlocked, name, ENEMY_KEYS, dayOf };
})();

/* 取经小英雄 · 云同步（离线网页版用）
   数据放在一个私有 GitHub 仓库里（默认 pp99bb/qujing-data），用只能改这个仓库的令牌读写：
   data/custom.json   家长加的题、改的题（家长端写，孩子端读）
   data/settings.json 题量、题库等设置（家长端写，孩子端读）
   data/kid.json      孩子的进度和复习记录（孩子端写，家长端读，用来出学习报告）
   data/cmd.json      家长发给孩子端的指令，比如“重置进度”
   没联网时一切照常，下次联网再同步。 */
(function(){
'use strict';
const Q = window.QJ;
const { Store, toast } = Q;
const DEF_REPO = 'pp99bb/qujing-data';
const b64e = s => { const b = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(t); };
const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const clone = o => JSON.parse(JSON.stringify(o));

const Sync = {
  sha: {}, last: 0, busy: false, err: '', kidAt: 0, timers: {},
  get token() { return Store.ls('sync_token') || ''; },
  get repo() { return Store.ls('sync_repo') || DEF_REPO; },
  get on() { return !!this.token && !Store.cloud; },
  configure(token, repo) { Store.ls('sync_token', (token || '').trim()); Store.ls('sync_repo', (repo || DEF_REPO).trim()); this.sha = {}; },
  async req(path, opt = {}) {
    const r = await fetch(`https://api.github.com/repos/${this.repo}/contents/${path}`, Object.assign({ cache: 'no-store' }, opt, {
      headers: Object.assign({ Authorization: 'Bearer ' + this.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, opt.headers || {}) }));
    return r;
  },
  async get(path) {
    const r = await this.req(path + '?t=' + Date.now());
    if (r.status === 404) { delete this.sha[path]; return null; }
    if (!r.ok) throw new Error(r.status === 401 ? '同步码不对或已过期' : r.status === 403 ? '同步码没有这个仓库的权限' : 'GitHub ' + r.status);
    const j = await r.json(); this.sha[path] = j.sha;
    try { return JSON.parse(b64d(j.content || '')); } catch (e) { return null; }
  },
  // 写文件；merge(remote) 返回要写的内容，冲突时会拿最新的远端内容重新合并一次
  async put(path, merge, msg) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let remote = null;
      if (merge.length || !(path in this.sha)) remote = await this.get(path);
      const data = merge(remote);
      const body = { message: msg || 'update ' + path, content: b64e(JSON.stringify(data)) };
      if (this.sha[path]) body.sha = this.sha[path];
      const r = await this.req(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) { const j = await r.json(); this.sha[path] = j.content.sha; return true; }
      if (r.status === 409 || r.status === 422) { delete this.sha[path]; continue; }
      throw new Error(r.status === 401 ? '同步码不对或已过期' : r.status === 403 ? '同步码没有写入权限' : 'GitHub ' + r.status);
    }
    throw new Error('同步冲突，稍后再试');
  },
  async test() { const r = await fetch(`https://api.github.com/repos/${this.repo}`, { cache: 'no-store', headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/vnd.github+json' } }); if (!r.ok) throw new Error(r.status === 401 ? '同步码不对或已过期' : r.status === 404 ? '找不到仓库 ' + this.repo + '（或同步码没有它的权限）' : 'GitHub ' + r.status); const j = await r.json(); if (!j.private) toast('提醒：数据仓库是公开的，建议改成私有', 4000); return true; },

  // ---------- 多台设备合并取经之路 ----------
  // 规则：谁后“重置进度”以谁为准；通关、影神图、装备、同伴、修为取两边的并集/最大值；
  // 灵蕴、碎片、援军卡这些会花掉的东西，以最近玩过的那台为准；每道题的记录取答得多的那份
  mergeKid(L, R) {
    if (!R || !R.state) return L;
    const ls = L.state, rs = R.state, lr = ls.resetAt || 0, rr = rs.resetAt || 0;
    if (rr > lr) return { state: clone(rs), progress: Object.assign({ q: {}, ts: 0 }, clone(R.progress || {})) };
    if (lr > rr) return L;
    const act = P => Object.keys((P || {}).q || {}).length, la = act(L.progress), ra = act(R.progress);
    // 一边还没答过题（比如刚装好的新设备），会花掉的东西就以玩过的那边为准
    const newer = !la && ra ? rs : !ra && la ? ls : (rs.ts || 0) > (ls.ts || 0) ? rs : ls, older = newer === rs ? ls : rs;
    const st = clone(newer);
    st.xp = Math.max(ls.xp || 0, rs.xp || 0); st.raceBest = Math.max(ls.raceBest || 0, rs.raceBest || 0);
    st.seenTut = !!(ls.seenTut || rs.seenTut);
    const maxMap = k => { const o = Object.assign({}, older[k] || {}); for (const [a, v] of Object.entries(newer[k] || {})) o[a] = Math.max(v || 0, o[a] || 0); return o; };
    st.cleared = maxMap('cleared'); st.codex = maxMap('codex');
    st.allies = [...new Set([...(ls.allies || []), ...(rs.allies || [])])];
    st.inv = Object.assign({}, older.inv || {}); for (const [id, v] of Object.entries(newer.inv || {})) st.inv[id] = { lv: Math.max(v.lv || 0, (st.inv[id] || {}).lv || 0) };
    const lp = L.progress || { q: {} }, rp = R.progress || { q: {} }, q = Object.assign({}, rp.q || {});
    for (const [id, a] of Object.entries(lp.q || {})) { const b = q[id]; if (!b || ((a.c || 0) + (a.w || 0)) > ((b.c || 0) + (b.w || 0)) || (((a.c || 0) + (a.w || 0)) === ((b.c || 0) + (b.w || 0)) && (a.t || 0) >= (b.t || 0))) q[id] = a; }
    const pr = Object.assign({}, rp, lp, { q, n: Math.max(lp.n || 0, rp.n || 0), sess: Math.max(lp.sess || 0, rp.sess || 0), ts: Math.max(lp.ts || 0, rp.ts || 0) });
    return { state: st, progress: pr };
  },
  // 把合并结果放回这台设备（原地改，正在打的这一关不受影响）
  applyKid(M) {
    const before = JSON.stringify([Store.state, Store.prog]);
    for (const k of Object.keys(Store.state)) if (!(k in M.state)) delete Store.state[k];
    Object.assign(Store.state, M.state); Object.assign(Store.prog, M.progress);
    if (JSON.stringify([Store.state, Store.prog]) === before) return false;
    Store.ls('state', Store.state); Store.ls('progress', Store.prog);
    Store.onRemote.forEach(f => f('state')); return true;
  },
  // 小齿轮里的“同步取经之路”按钮：马上拉下来合并，再推上去
  async syncKid() {
    if (!this.on || window.QJ_APP === 'parent') throw new Error('还没有填同步码');
    clearTimeout(this.timers.kid); let changed = false;
    await this.put('data/kid.json', remote => { const M = this.mergeKid({ state: clone(Store.state), progress: clone(Store.prog) }, remote); changed = this.applyKid(M); return { at: Date.now(), state: Store.state, progress: Store.prog }; }, 'kid progress');
    this.last = Date.now(); this.err = ''; Sync.onStatus.forEach(f => f()); return changed;
  },
  // ---------- 拉取 ----------
  mergeCustom(remote) {
    if (!remote) return false; let changed = false;
    for (const id in remote) { const r = remote[id], l = Store.custom[id]; if (!l || (r.updated || 0) > (l.updated || 0)) { Store.custom[id] = r; changed = true; } }
    if (changed) { Store.ls('custom', Store.custom); Store.onBank.forEach(f => f()); }
    return changed;
  },
  async pull() {
    if (!this.on || this.busy) return; this.busy = true;
    try {
      const isParent = window.QJ_APP === 'parent';
      const [cu, se, kid, cmd] = await Promise.all([this.get('data/custom.json'), this.get('data/settings.json'), this.get('data/kid.json'), isParent ? null : this.get('data/cmd.json')]);
      this.mergeCustom(cu);
      if (se && (se.ts || 0) > (Store.ls('sync_settings_ts') || 0)) {
        Store.settings = Object.assign(Store.settings, se); Store.ls('settings', Store.settings); Store.ls('sync_settings_ts', se.ts || 0);
        Store.onRemote.forEach(f => f('settings'));
      }
      if (isParent && kid) {
        this.kidAt = kid.at || 0;
        if (kid.state) Store.state = Object.assign(clone(window.QJ_DEF_STATE), kid.state);
        if (kid.progress) Store.prog = Object.assign({ q: {}, ts: 0 }, kid.progress);
        Store.onRemote.forEach(f => f('state'));
      }
      // 别的设备玩过：把那边的取经之路合并进来
      if (!isParent && kid) this.applyKid(this.mergeKid({ state: clone(Store.state), progress: clone(Store.prog) }, kid));
      if (!isParent && cmd && cmd.reset && cmd.reset > (Store.state.resetAt || 0)) {
        Store.state = Object.assign(clone(window.QJ_DEF_STATE), { resetAt: cmd.reset }); Store.prog = { q: {}, ts: 0 };
        Store.ls('state', Store.state); Store.ls('progress', Store.prog); this.pushKid(0);
        Store.onRemote.forEach(f => f('state'));
      }
      this.last = Date.now(); this.err = '';
    } catch (e) { this.err = e.message || String(e); }
    finally { this.busy = false; Sync.onStatus.forEach(f => f()); }
  },
  // ---------- 推送 ----------
  pushKid(delay = 5000) {
    if (!this.on || window.QJ_APP === 'parent') return;
    clearTimeout(this.timers.kid);
    this.timers.kid = setTimeout(() => this.put('data/kid.json', remote => { this.applyKid(this.mergeKid({ state: clone(Store.state), progress: clone(Store.prog) }, remote)); return { at: Date.now(), state: Store.state, progress: Store.prog }; }, 'kid progress').then(() => { this.err = ''; }).catch(e => { this.err = e.message; }), delay);
  },
  async pushQuestion(q) { if (!this.on) return; await this.put('data/custom.json', remote => Object.assign(remote || {}, { [q.id]: q }), 'question ' + q.id); },
  async pushQuestions(list) { if (!this.on || !list.length) return; await this.put('data/custom.json', remote => { const r = remote || {}; list.forEach(q => r[q.id] = q); return r; }, `add ${list.length} questions`); },
  async pushSettings() { if (!this.on) return; const s = Object.assign({}, Store.settings, { ts: Date.now() }); Store.ls('sync_settings_ts', s.ts); await this.put('data/settings.json', () => s, 'settings'); },
  async pushReset() { if (!this.on) return; await this.put('data/cmd.json', () => ({ reset: Date.now() }), 'reset progress'); },
  onStatus: [],
};
Q.Sync = Sync;

// 孩子端：进度一保存就（稍后）推上去；回到前台、每 5 分钟拉一次家长的改动
const origFlush = Store.flush.bind(Store);
Store.flush = function (name) {
  const p = origFlush(name);
  if (Sync.on && window.QJ_APP === 'kid' && (name === 'state' || name === 'progress')) Sync.pushKid();
  if (Sync.on && window.QJ_APP === 'parent' && name === 'settings') Sync.pushSettings().catch(e => toast('设置没有同步上去：' + e.message, 3500));
  return p;
};
// 家长端：家长端里的进度只是孩子进度的“镜像”，本地不保存，避免盖掉孩子的
if (window.QJ_APP === 'parent') {
  const f2 = Store.flush;
  Store.flush = function (name) { if (name === 'state' || name === 'progress') { this.dirty[name] = false; return Promise.resolve(); } return f2.call(this, name); };
}
const origPut = Store.putQuestion.bind(Store);
Store.putQuestion = async function (q) {
  await origPut(q);
  if (Sync.batch) { Sync.batch.push(clone(Store.custom[q.id] || q)); return; }
  if (Sync.on && window.QJ_APP === 'parent') { try { await Sync.pushQuestion(clone(Store.custom[q.id] || q)); } catch (e) { toast('题目已存在这台电脑，但没同步上去：' + e.message, 4000); } }
};
addEventListener('visibilitychange', () => {
  if (!Sync.on) return;
  if (document.hidden && window.QJ_APP === 'kid') { clearTimeout(Sync.timers.kid); Sync.pushKid(0); }
  if (!document.hidden && Date.now() - Sync.last > 30000) Sync.pull();
});
setInterval(() => { if (Sync.on && !document.hidden) Sync.pull(); }, 5 * 60 * 1000);
addEventListener('online', () => { if (Sync.on) Sync.pull(); });
})();

/* 取经小英雄 · 主程序（二）：战斗 */
(function(){
'use strict';
const { C, MV, G, DATA, Arena, an, clear, sleep, rnd, $, $$, esc, today, shuffle, pick, Store, Bank, SRS, Sfx, Gear, ItemBy, toast, name } = window.QJ;

// ---------- 演武场工具 ----------
function makeArena(root) {
  const ar = new Arena(root);
  ar.fit = () => { const w = root.clientWidth, h = root.clientHeight; if (!w || !h) return; root.style.setProperty('--s', Math.max(.45, Math.min(1.6, w / (w < 600 ? 540 : 700), (h - 84) / 220)).toFixed(3)); };
  if (window.ResizeObserver) new ResizeObserver(() => ar.fit()).observe(root);
  // 换角色时直接换一套新的容器，彻底甩掉上一个招式残留的位移
  ar.put = (f, html) => { f.reset(); const m = document.createElement('div'), fl = document.createElement('div'); m.className = 'mover'; fl.className = 'flip'; m.appendChild(fl); f.mover.replaceWith(m); f.mover = m; f.flip = fl; fl.innerHTML = html; f._t = null; };
  ar.enter = (f, from = 1, dur = 520) => an(f.mover, [{ transform: `translateX(${f.dir * -from * 260}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], dur, { easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'none' });
  addEventListener('resize', () => ar.fit());
  return ar;
}
const enemySvg = k => (C[k] ? C[k]() : C.dummy());
window.QJ.makeArena = makeArena;

// ---------- 技能图标 ----------
const ICON = {
  eye: `<svg viewBox="0 0 40 40"><path d="M2 20 Q20 2 38 20 Q20 38 2 20 Z" fill="#fff" stroke="#3a2618" stroke-width="2.5"/><circle cx="20" cy="20" r="8" fill="#f5b800" stroke="#3a2618" stroke-width="2"/><circle cx="20" cy="20" r="4" fill="#3a2618"/><path d="M8 8 l4 4 M32 8 l-4 4 M20 2 v5" stroke="#e53935" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  ding: `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#fff8dc" stroke="#e8b33a" stroke-width="3"/><text x="20" y="27" text-anchor="middle" font-size="20" font-weight="900" fill="#d1452f" font-family="serif">定</text></svg>`,
  gourd: `<svg viewBox="0 0 40 40"><path d="M20 38 C8 36 8 22 15 19 C11 15 13 8 20 8 C27 8 29 15 25 19 C32 22 32 36 20 38 Z" fill="#e7a54a" stroke="#3a2618" stroke-width="2.5"/><path d="M17 8 v-5 h6 v5" fill="#8d6e63" stroke="#3a2618" stroke-width="2"/><path d="M14 20 h12" stroke="#c0392b" stroke-width="3"/></svg>`,
  card: `<svg viewBox="0 0 40 40"><rect x="7" y="4" width="26" height="34" rx="4" fill="#fff1c7" stroke="#3a2618" stroke-width="2.5"/><circle cx="20" cy="17" r="7" fill="#f6d36b" stroke="#3a2618" stroke-width="2"/><path d="M12 30 h16" stroke="#d1452f" stroke-width="3"/></svg>`,
};
const allyIcon = k => `<svg viewBox="30 10 140 140">${(C[k]() || '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`;

const Q_Guest = () => window.QJ.Guest;
// 平板横屏左右分栏：选项有折行时，把题目往左压窄，尽量让每个选项一行写完
function optWraps() {
  return $$('#bt-q .opt').filter(b => { const t = b.lastElementChild; if (!t) return false; const r = document.createRange(); r.selectNodeContents(t);
    return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1; }).length;
}
function fitSplit() {
  const box = $('#bt-q'), opts = $('#opts'); if (!box || !opts) return;
  box.style.removeProperty('--qr'); opts.classList.remove('one');
  if (getComputedStyle(box).display !== 'grid' || opts.classList.contains('wide')) return;
  // 先试两列、题目逐步变窄；还折行就改成一列一个选项（放得下才用）
  const tries = [['1.15fr', 0], ['1.45fr', 0], ['1.8fr', 0], ['2.2fr', 0], ['1.15fr', 1], ['1.5fr', 1], ['2fr', 1], ['2.7fr', 0]];
  let best = null;
  for (const [fr, one] of tries) {
    box.style.setProperty('--qr', fr); opts.classList.toggle('one', !!one);
    const w = optWraps(), over = box.scrollHeight > box.clientHeight + 2;
    if (!w && !over) return;
    const score = w * 10 + (over ? 5 : 0); if (!best || score < best.score) best = { fr, one, score };
  }
  box.style.setProperty('--qr', best.fr); opts.classList.toggle('one', !!best.one);
}
addEventListener('resize', () => requestAnimationFrame(fitSplit)); document.fonts && document.fonts.ready.then(() => fitSplit());
// 古诗题答错时，在黑板上把整首诗写出来
function poemBlock(q) {
  const P = (window.QJ_HINT_DATA || {}).POEMS || {};
  const titles = [q.q, ...q.ans.map(a => q.opts[a])].join('').match(/《([^》]+)》/g) || [];
  let t = titles.map(x => x.slice(1, -1)).find(x => P[x]);
  if (!t) { const right = q.ans.map(a => q.opts[a]).join(''); t = Object.keys(P).find(k => q.q.includes(k) || right === k); }
  if (!t) return '';
  const p = P[t], lines = p.text.match(/[^，。？！]+[，。？！]/g) || [p.text];
  const pairs = []; for (let i = 0; i < lines.length; i += 2) pairs.push(lines.slice(i, i + 2).join(''));
  return `<div class="bk-poem"><div class="bk-pt">《${esc(t)}》<small>${esc(p.era)} · ${esc(p.poet)}</small></div>${pairs.map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
}
// ================= 连对火焰（像 MOBA 的连杀） =================
const STREAK_NAME = { 3: '三连对！', 4: '势如破竹！', 5: '所向披靡！', 6: '大杀四方！', 7: '无人能挡！', 8: '天下无敌！', 10: '齐天大圣！' };
const streakTier = n => n >= 10 ? 5 : n >= 8 ? 4 : n >= 6 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0;
const FLAME = `<svg class="flm" viewBox="0 0 160 70" preserveAspectRatio="none" aria-hidden="true">${[[14, 46, 0], [38, 62, .25], [62, 54, .5], [86, 66, .1], [110, 52, .35], [134, 60, .6], [150, 40, .2]].map(([x, h, dl]) => `<g class="tg" style="animation-delay:-${dl}s;transform-origin:${x}px 70px"><path d="M${x} 70 C${x - 16} 70 ${x - 18} ${70 - h * .45} ${x - 6} ${70 - h * .7} C${x - 4} ${70 - h * .5} ${x + 2} ${70 - h * .5} ${x} ${70 - h} C${x + 14} ${70 - h * .7} ${x + 18} ${70 - h * .35} ${x + 12} 70 Z" class="f1"/><path d="M${x} 70 C${x - 8} 70 ${x - 9} ${70 - h * .3} ${x - 2} ${70 - h * .48} C${x} ${70 - h * .36} ${x + 3} ${70 - h * .36} ${x + 2} ${70 - h * .62} C${x + 9} ${70 - h * .42} ${x + 10} ${70 - h * .2} ${x + 6} 70 Z" class="f2"/></g>`).join('')}</svg>`;
function streakHTML(n, pop) {
  const t = streakTier(n); if (!t) return '';
  return `<span class="streak t${t}${pop ? ' pop' : ''}">${FLAME}${t >= 2 ? '<i class="emb"></i><i class="emb"></i><i class="emb"></i><i class="emb"></i>' : ''}<b>连对 <em>×${n}</em></b></span>`;
}
// 连对火焰放在战场右下角（压在对战画面上），不占题目区的位置，换题换妖怪也不会消失
function setStreak(n, pop) {
  const dock = $('#bt-streak'); if (!dock) return;
  if (dock.dataset.n === String(n) && !pop) return;
  dock.dataset.n = n; dock.innerHTML = streakHTML(n, pop);
}
function dropStreak() { const dock = $('#bt-streak'), st = dock && dock.querySelector('.streak'); if (!st) return; st.classList.add('out'); dock.dataset.n = '0'; setTimeout(() => { if (dock.dataset.n === '0') dock.innerHTML = ''; }, 450); }
function Battle_streakFx() {
  const n = this.streak; setStreak(n, true);
  const name = STREAK_NAME[n] || (n >= 12 && n % 2 === 0 ? `超神·${n} 连对！` : null);
  if (!name) return;
  const t = streakTier(n); Sfx.fx('streak', t);
  const b = document.createElement('div'); b.className = `streak-banner t${t}`;
  b.innerHTML = `${FLAME}<b>${name}</b><small>连续答对 ${n} 题</small>`;
  $('#bt-arena').appendChild(b); setTimeout(() => b.remove(), 2300);
};

// ================= 战斗 =================
class Battle {
  constructor(cfg) {
    this.cfg = cfg; this.mode = cfg.mode; this.root = $('#battle');
    this.ar = Battle.ar || (Battle.ar = makeArena($('#bt-arena')));
    const st = Gear.stats(); this.st = st; this.tot = st.tot;
    this.maxhp = st.tot.hp; this.hp = this.maxhp;
    this.q = cfg.questions.slice(); this.i = 0; this.used = new Set(this.q.map(q => q.id));
    this.correct = 0; this.answered = 0; this.streak = 0; this.bestStreak = 0; this.wrongRow = 0; this.extra = 0;
    this.focus = st.four.jinyin ? 4 : 0;
    const allies = Store.state.allies || [];
    const spell = st.four.leiyin ? 1 : 0;
    const bf = Store.state.buff || {}; this.buffUsed = cfg.mode === 'story' && (bf.gourd || bf.eye);
    this.sk = { eye: 2 + spell + (cfg.mode === 'story' ? bf.eye || 0 : 0), ding: 1 + spell, gourd: 3 + (st.acc === 'acc_renshen' ? 1 : 0) + (cfg.mode === 'story' ? bf.gourd || 0 : 0),
      bailong: allies.includes('bailong') ? 1 : 0, bajie: allies.includes('bajie') ? 1 : 0, shaseng: allies.includes('shaseng') ? 1 : 0, card: 1 };
    this.flags = {}; this.loot = []; this.kills = []; this.newCodex = []; this.busy = false; this.miniKey = null; this.wrongIds = new Set();
    this.foes = (cfg.enemies || []).map(f => Object.assign({ hp: f.max }, f));
    this.fi = 0; this.done = false; this.firstTry = new Map();
    if (this.buffUsed) Store.state.buff = {};
  }
  get foe() { return this.foes[this.fi]; }
  streakFx() { Battle_streakFx.call(this); }
  music() { Sfx.bgm(this.foe && this.foe.boss ? 'boss' : 'battle'); }
  // 字幕留够时间让孩子读完；新字幕会顶掉旧的计时
  capT(ms) { clearTimeout(this._capT); const ar = this.ar; this._capT = setTimeout(() => { if (this.live) ar.caption(''); }, ms); }
  async start() {
    const ar = this.ar; show('battle'); ar.fit(); ar.caption(''); this.music();
    $('#bt-title').textContent = this.cfg.title;
    ar.put(ar.L, Gear.wukong());
    this.renderHP(); this.renderSkills();
    $('#bt-q').innerHTML = ''; { const d = $('#bt-streak'); if (d) { d.innerHTML = ''; d.dataset.n = '0'; } }
    if (this.foe) { ar.put(ar.R, enemySvg(this.foe.k)); ar.enter(ar.R); setTimeout(() => this.live && Sfx.cry(this.foe.k), 300); }
    ar.onHit = D => { if (!this.live) return; if (D === ar.L) Sfx.fx('hurtMe'); else { const k = this.miniKey || (this.foe && this.foe.k); if (k && !this.chest) Sfx.hurt(k); } };
    ar.enter(ar.L, 1);
    await sleep(600);
    if (this.foe) ar.caption(this.foe.intro || `${name(this.foe.k)} 拦住了去路！`);
    if (this.st.four.qitian && this.foe && this.mode !== 'free') { await sleep(600); await this.strike('heavy', Math.round(this.tot.atk * 2), '齐天分身！'); }
    await sleep(500); ar.caption('');
    this.next();
  }
  // ---------- 血条 ----------
  get live() { return window.QJ.curBattle === this; }
  renderHP() {
    if (!this.live) return;
    const L = $('#hp-L'), R = $('#hp-R');
    const pct = v => Math.max(0, Math.min(100, v * 100)).toFixed(1) + '%';
    L.innerHTML = `<div class="nm">${esc(Store.settings.name || '孙悟空')}</div><div class="hpbar"><i class="lag" style="width:${pct(this.hp / this.maxhp)}"></i><i class="cur" style="width:${pct(this.hp / this.maxhp)}"></i><span>${Math.max(0, Math.round(this.hp))} / ${this.maxhp}</span></div>`;
    if (this.chest) { R.innerHTML = '<div class="nm">宝箱 · 答对就能打开</div>'; $('#bt-prog').textContent = `第 ${Math.min(this.i + 1, this.q.length)} / ${this.q.length} 题`; $('#bt-gold').innerHTML = `<i></i>${Store.state.gold}`; return; }
    const f = this.miniKey ? { k: this.miniKey, hp: 1, max: 1 } : this.foe;
    if (!f || this.mode === 'free') { R.innerHTML = f ? `<div class="nm">${name(f.k)}</div>` : ''; }
    else R.innerHTML = `<div class="nm">${name(f.k)}${this.miniKey ? '（错题小妖）' : f.boss ? ' · 头目' : ''}</div><div class="hpbar"><i class="lag" style="width:${pct(f.hp / f.max)}"></i><i class="cur" style="width:${pct(f.hp / f.max)}"></i><span>${Math.max(0, Math.round(f.hp))} / ${f.max}</span></div>` +
      (this.foes.length > 1 ? `<div class="enemy-q">${this.foes.map((x, i) => `<span class="${x.hp <= 0 ? 'dead' : ''}" title="${name(x.k)}">${enemySvg(x.k)}</span>`).join('')}</div>` : '');
    $('#bt-prog').textContent = this.mode === 'free' ? `已答 ${this.answered}` : `第 ${Math.min(this.i + 1, this.q.length)} / ${this.q.length} 题`;
    $('#bt-gold').innerHTML = `<i></i>${Store.state.gold}`;
  }
  // ---------- 技能栏 ----------
  renderSkills() {
    if (!this.live) return;
    const s = this.sk, b = this.busy || this.done;
    const btn = (k, label, icon, n, title) => `<button type="button" class="sk${this.flags[k + 'Armed'] ? ' armed' : ''}" data-k="${k}" ${!n || b ? 'disabled' : ''} aria-label="${label}：${title}">${icon}<span>${label}</span><small class="sd">${title}</small>${n != null ? `<span class="n">${n}</span>` : ''}</button>`;
    const segs = Array.from({ length: 4 }, (_, i) => `<i class="${i < this.focus ? 'on' : ''}"></i>`).join('');
    const hv = this.focus >= 4 && !b && !this.chest && !this.rEmpty && (this.miniKey || (this.foe && this.foe.hp > 0));
    let h = this.mode === 'free' ? '' : `<div class="focus"><div class="segs">${segs}</div><button type="button" data-k="heavy" class="${hv ? 'ready' : ''}" ${hv ? '' : 'disabled'} title="${this.chest ? '开宝箱的时候不能用重棍' : ''}">重棍<small class="sd">${this.focus >= 4 ? '狠狠打一下' : '连续答对攒满 4 格'}</small></button></div>`;
    h += btn('eye', '火眼金睛', ICON.eye, s.eye, '看一条提示');
    h += btn('ding', '定身术', ICON.ding, s.ding, '答错能再选一次');
    if (this.mode !== 'free') {
      h += btn('gourd', '喝葫芦', ICON.gourd, s.gourd, '加血');
      if (s.bajie != null && (Store.state.allies || []).includes('bajie')) h += btn('bajie', '钉耙一扫', allyIcon('bajie'), s.bajie, '去掉一个错的');
      if ((Store.state.allies || []).includes('shaseng')) h += btn('shaseng', '宝杖助阵', allyIcon('shaseng'), s.shaseng, '这题打两倍');
      if ((Store.state.allies || []).includes('bailong')) h += btn('bailong', '白龙冲撞', allyIcon('bailong'), s.bailong, '直接打一下');
      const nCards = Object.values(Store.state.cards || {}).filter(v => v > 0).length;
      if (nCards) h += btn('card', '援军卡', ICON.card, s.card, '请神仙帮忙');
    }
    $('#bt-skills').innerHTML = h;
  }
  // ---------- 出题 ----------
  async next() {
    if (this.done || !this.live) return;
    const ar = this.ar;
    if (this.mode !== 'free' && this.hp <= 0) return;
    // 换题、换妖怪的过渡里题目先清掉，但连对火焰留在原地
    this.busy = true; $('#bt-q').innerHTML = '';
    if (this.mode !== 'free' && this.foes.every(f => f.hp <= 0)) {
      if (this.i >= this.q.length) { if (this.chest) await this.chestFinale(); if (!this.live) return; return this.finish('win'); }
      if (!this.chest) {
        this.chest = true; this.rEmpty = false; this.chestTotal = this.q.length - this.i; this.chestHits = 0; this.chestItems = []; this.chestGold = 0;
        ar.put(ar.L, Gear.wukong()); ar.put(ar.R, C.chest()); await ar.enter(ar.R, 1, 900);
        ar.caption('妖怪留下了一个上锁的宝箱！每答对一题，锁就裂开一点'); await sleep(2400); ar.caption('');
      }
    }
    if (this.i >= this.q.length) {
      if (this.mode === 'free') { const more = SRS.pick(10, Object.assign({ cont: true }, this.cfg.filter || {})); more.forEach(q => this.q.push(q)); if (!more.length) return this.finish('win'); }
      else if (this.foe && this.foe.hp > 0 && this.extra < 12) { const q = SRS.easy(this.used) || pick(Bank.all); this.q.push(q); this.used.add(q.id); this.extra++; if (this.extra === 1) toast('妖怪还没倒下，再来几题！'); }
      else return this.finish(this.foes.every(f => f.hp <= 0) ? 'win' : 'escape');
    }
    this.cur = this.q[this.i]; this.tries = 0; this.selected = new Set();
    this.flags.dingArmed = false; this.flags.shasengArmed = this.flags.shasengArmed || false;
    // 错题小妖拦路
    if (this.mode === 'story' && !this.chest && SRS.isReview(this.cur) && this.foe && this.foe.hp > 0) {
      const mk = ['xiaozuanfeng', 'benbo', 'babo'][SRS.reviewLevel(this.cur)];
      if (this.miniKey !== mk) {
        this.miniKey = mk; this.rEmpty = false; this.renderHP();
        // 题目先显示出来（小妖站稳前先不让点），小妖一边说话孩子一边读题
        this.renderQ(); this.qShown = true; $('#opts').classList.add('lock');
        ar.caption(`错题小妖 ${name(mk)} 跳出来拦路：“上次做错的题，再考考你！”`); this.capT(3200);
        ar.put(ar.R, C[mk]()); setTimeout(() => this.live && Sfx.cry(mk), 400); await ar.enter(ar.R, 1.4, 1100);
        await an(ar.R.mover, [{ transform: 'none' }, { transform: 'translateY(-30px)' }, { transform: 'none' }, { transform: 'translateY(-18px)' }, { transform: 'none' }], 700, { fill: 'none' });
        if (!this.live) return;
        if ($('#opts')) $('#opts').classList.remove('lock');
      }
    } else if (this.miniKey || this.rEmpty) {
      this.miniKey = null; this.rEmpty = false; ar.put(ar.R, enemySvg(this.foe.k)); await ar.enter(ar.R, 1, 800);
      ar.caption(`${name(this.foe.k)} 又挡在了前面！`); await sleep(1000); ar.caption('');
      if (!this.live) return;
    }
    this.busy = false; this.renderHP(); this.renderSkills(); if (!this.qShown) this.renderQ(); this.qShown = false;
    if (this.cfg.tut && this.i === 0 && !Store.state.seenTut) toast('读一读题目，点你觉得对的答案，悟空就会出招！', 4000);
  }
  renderQ() {
    if (!this.live) return;
    const q = this.cur; this.order = shuffle(q.opts.map((_, i) => i));
    const multi = q.ans.length > 1;
    const long = q.opts.some(o => o.length > 14), short = q.opts.length === 3 && q.opts.every(o => o.length <= 10);
    const rev = SRS.isReview(q);
    $('#bt-q').innerHTML = `<div class="qL"><div class="qtags"><span class="tag subj">${esc(q.subj)}</span><span class="tag">${esc(q.kp)}</span>${rev ? '<span class="tag rev">错题复习</span>' : ''}${multi ? '<span class="tag multi">多选</span>' : ''}</div>
      <div class="qtext">${esc(q.q)}</div>${q.img ? `<img class="qimg" src="${esc(q.img)}" alt="题目图片">` : ''}</div>
      <div class="qR"><div class="opts${long ? ' wide' : short ? ' short' : ''}" id="opts">${this.order.map((oi, k) => `<button type="button" class="opt" data-i="${oi}"><span class="lt">${'ABCDEF'[k]}</span><span>${esc(q.opts[oi])}</span></button>`).join('')}</div>
      ${multi ? '<div class="confirm-bar"><button type="button" class="btn gold confirm" id="confirm" disabled>选好了</button></div>' : ''}</div>`;
    setStreak(this.streak); fitSplit();
    // 黄风怪的三昧神风：只在和黄风怪本人打的时候吹，迷住一个错选项一小会儿，并且说清楚
    if (this.cfg.wind && !this.chest && !this.miniKey && this.foe && this.foe.k === 'huangfeng' && this.foe.hp > 0 && Math.random() < .5) {
      const wrongs = $$('.opt').filter(b => !q.ans.includes(+b.dataset.i)); const w = pick(wrongs);
      if (w) { w.classList.add('hide'); w.insertAdjacentHTML('beforeend', '<i class="sand">黄沙迷眼…</i>'); Sfx.fx && Sfx.fx('wind');
        this.ar.caption('黄风怪吹起三昧神风，黄沙迷住了一个选项！');
        setTimeout(() => { w.classList.remove('hide'); const x = w.querySelector('.sand'); if (x) x.remove(); }, 2500); }
    }
  }
  // ---------- 作答 ----------
  async pickOpt(btn) {
    if (this.busy || this.done) return;
    const q = this.cur, i = +btn.dataset.i;
    if (q.ans.length > 1) { btn.classList.toggle('sel'); this.selected.has(i) ? this.selected.delete(i) : this.selected.add(i); $('#confirm').disabled = !this.selected.size; Sfx.play('click'); return; }
    this.selected = new Set([i]); this.judge();
  }
  async judge() {
    const q = this.cur, sel = this.selected;
    const ok = sel.size === q.ans.length && q.ans.every(a => sel.has(a));
    this.busy = true; this.renderSkills();
    const opts = $('#opts'); opts.classList.add('lock');
    const first = this.tries === 0; this.tries++;
    if (first) { SRS.record(q, ok); this.answered++; if (ok) { this.correct++; Store.state.xp += 1; Store.save('state'); } else this.wrongIds.add(q.id); }
    if (ok) {
      $$('.opt').forEach(b => { if (q.ans.includes(+b.dataset.i)) b.classList.add('ok'); });
      Sfx.combo = this.streak; Sfx.play('ok');
      this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak); this.wrongRow = 0;
      if (this.mode !== 'free') { const f0 = this.focus; this.focus = Math.min(4, this.focus + (this.tot.focus || 1)); if (this.focus >= 4 && f0 < 4) setTimeout(() => Sfx.fx('ready'), 250); }
      this.streakFx();
      if (this.st.four.binghe && this.mode !== 'free') this.heal(3, true);
      if (this.chest) await this.openChest();
      else await this.hitEnemy();
      if (this.done) return;
      this.i++; await sleep(120); this.next();
    } else {
      $$('.opt').forEach(b => { if (sel.has(+b.dataset.i)) b.classList.add('bad'); });
      Sfx.play('bad'); this.streak = 0; this.wrongRow++; dropStreak();
      if (this.flags.dingArmed) {
        this.flags.dingArmed = false; this.ar.caption('定身术！妖怪被定住了，再选一次吧'); Sfx.fx('ding');
        $$('.opt.bad').forEach(b => { b.classList.remove('bad'); b.classList.add('gone'); });
        $$('.opt.dinged').forEach(b => b.classList.remove('dinged'));
        an(this.ar.R.mover, [{ filter: 'none' }, { filter: 'grayscale(1) brightness(1.3)' }, { filter: 'none' }], 1200, { fill: 'none' });
        opts.classList.remove('lock'); this.selected = new Set(); if ($('#confirm')) $('#confirm').disabled = true;
        this.busy = false; this.renderSkills(); this.capT(3500); return;
      }
      $$('.opt').forEach(b => { if (q.ans.includes(+b.dataset.i)) b.classList.add('ok'); });
      if (this.mode !== 'free' && !this.chest) await this.enemyHits();
      if (this.done) return;
      // 同考点的变式题 3 题后出现，原题在最后再考一次
      // 同一道错题在这一关里最多再出 2 次：一道同考点的变式题 + 最后再考一次原题
      this.rootOf = this.rootOf || new Map(); this.rep = this.rep || {};
      const root = this.rootOf.get(q.id) || q.id, left = 2 - (this.rep[root] || 0);
      const v = left > 0 ? SRS.variant(q, this.used) : null;
      if (v) { this.q.splice(Math.min(this.q.length, this.i + 4), 0, v); this.used.add(v.id); this.rootOf.set(v.id, root); this.rep[root] = (this.rep[root] || 0) + 1; }
      if (first && this.mode !== 'free' && 2 - (this.rep[root] || 0) > 0) { this.q.push(q); this.rep[root] = (this.rep[root] || 0) + 1; }
      if (this.wrongRow >= 2) { const e = SRS.easy(this.used); if (e) { this.q.splice(this.i + 1, 0, e); this.used.add(e.id); } this.wrongRow = 0; }
      this.explain(q);
    }
  }
  // 答错了：唐僧拿着教鞭在小黑板上讲这个知识点，至少停 5 秒才能关
  explain(q) {
    const right = q.ans.map(a => q.opts[a]).join('、');
    const SEC = window.QJ_FAST ? 1 : 5;
    const box = document.createElement('div'); box.className = 'teach'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '唐僧讲知识点');
    box.innerHTML = `<div class="teach-in">
      <div class="teach-who"><div class="teach-ts">${C.tangseng()}</div><i class="teach-stick"></i>
        <p class="teach-say">${this.miniKey ? `${esc(name(this.miniKey))}拦住了你！别急，` : '悟空，'}师父给你讲一讲：</p></div>
      <div class="board"><div class="board-in">
        <div class="bk-kp">知识点 · ${esc(q.kp || q.subj)}</div>
        <div class="bk-q">${esc(q.q)}</div>
        <div class="bk-a"><span>正确答案</span><b>${esc(right)}</b></div>
        ${q.exp ? `<div class="bk-exp">${esc(q.exp)}</div>` : ''}
        ${poemBlock(q)}
        <i class="chalk"></i></div></div>
      <button type="button" class="btn gold teach-ok" disabled>请认真看（${SEC}）</button></div>`;
    document.body.appendChild(box);
    Sfx.fx('ding');
    const btn = box.querySelector('.teach-ok'); let left = SEC;
    const tm = setInterval(() => { left--; if (left > 0) btn.textContent = `请认真看（${left}）`; else { clearInterval(tm); btn.disabled = false; btn.textContent = '我记住了！'; btn.classList.add('ready'); } }, 1000);
    btn.onclick = () => { if (btn.disabled) return; Sfx.play('click'); clearInterval(tm); box.remove(); this.i++; this.next(); };
    this._teach = box;
  }
  // ---------- 伤害 ----------
  dmg(mult = 1) {
    let d = this.tot.atk * mult; let crit = Math.random() * 100 < this.tot.crit;
    if (this.flags.shasengArmed) { d *= 2; this.flags.shasengArmed = false; }
    if (crit) d *= this.st.four.baigu ? 3 : 2;
    if (this.st.four.tuoluo && this.foe && this.foe.boss) d *= 1.3;
    return { d: Math.max(1, Math.round(d)), crit };
  }
  async strike(kind, fixed, label) {
    const ar = this.ar, f = this.foe; if (!f) return;
    let { d, crit } = fixed ? { d: fixed, crit: false } : this.dmg(kind === 'heavy' ? (f.boss ? 2 : 3) : 1);
    if (kind === 'heavy' && f.boss) d = Math.min(d, Math.max(1, Math.round(f.max * .3)));
    const lethal = f.hp - d <= 0;
    ar.nextDmg = { text: (crit ? '暴击 ' : '') + '-' + d, crit };
    if (label) ar.caption(label);
    if (kind === 'heavy') Sfx.fx('heavy'); else if (!lethal) Sfx.fx(crit ? 'crit' : 'normal');
    // 头目用最炫的“如意金箍棒·变”，小怪用跳劈收尾，节奏快一些
    if (lethal && kind !== 'heavy' && f.boss) { Sfx.fx('finish'); await MV.wk_finish.run(ar, ar.L, ar.R); }
    else if (lethal && kind !== 'heavy') { Sfx.fx('crit'); await MV.wk_normal.run(ar, ar.L, ar.R); }
    else await (kind === 'heavy' ? MV.wk_heavy : MV.wk_normal).run(ar, ar.L, ar.R);
    ar.L.fresh();
    f.hp = Math.max(0, f.hp - d); this.renderHP();
    if (label) ar.caption('');
    if (f.hp <= 0) await this.defeat();
  }
  async hitEnemy() {
    const ar = this.ar;
    if (this.mode === 'free') { ar.nextDmg = { text: '好！', crit: false }; Sfx.fx('normal'); await MV.wk_normal.run(ar, ar.L, ar.R); ar.L.fresh(); ar.R.fresh(); Store.state.gold += 1; return; }
    if (this.miniKey) {
      const { d } = this.dmg(1); ar.nextDmg = { text: '-' + d, crit: false }; Sfx.fx('normal');
      await MV.wk_normal.run(ar, ar.L, ar.R); ar.L.fresh();
      const mk = this.miniKey; await sleep(300);
      ar.caption(`${name(mk)}被打得哇哇叫，慌慌张张跑去给大王报信了！`);
      ar.R.reset(); const fl = ar.R.flip; fl.style.transform = 'scaleX(-1)';
      await an(ar.R.mover, Array.from({ length: 9 }, (_, i) => ({ transform: `translateX(${-ar.R.dir * i * 45}px) translateY(${i % 2 ? -14 : 0}px)`, opacity: i > 6 ? (8 - i) / 2 : 1 })), 1800, { easing: 'linear' });
      ar.R.mover.style.visibility = 'hidden'; fl.style.transform = '';
      await sleep(900); ar.caption('');
      this.markCodex(mk); this.rollMini();
      this.miniKey = null; this.rEmpty = true;
      this.renderHP(); return;
    }
    await this.strike('normal');
    if (this.st.four.huoyun && this.streak > 0 && this.streak % 3 === 0 && this.foe && this.foe.hp > 0) {
      ar.caption('火云套：三昧真火！'); const fx = ar.pt(ar.L, 100, 110, true), tx = ar.pt(ar.R, 100, 100);
      await ar.stream(fx, tx, { n: 14, colors: ['#ff7043', '#ffab40', '#ffd54f'] }); ar.nextDmg = { text: '-' + this.tot.atk, crit: false };
      await ar.hurt(ar.R, { power: 1, kind: 'fire' }); this.foe.hp = Math.max(0, this.foe.hp - this.tot.atk); this.renderHP(); ar.caption('');
      if (this.foe.hp <= 0) await this.defeat();
    }
  }
  async enemyHits() {
    const ar = this.ar, k = this.miniKey || (this.foe && this.foe.k); if (!k || !MV[k]) return;
    if (this.flags.stunned && !this.miniKey) { this.flags.stunned = false; ar.caption(`${name(k)}还被定着，动不了！`); await sleep(1400); ar.caption(''); return; }
    const f = this.foe; let atk = this.miniKey ? Math.max(7, Math.round((f ? f.atk : 9) * .7)) : f.atk;
    if (this.st.acc === 'acc_dingfeng' && k === 'huangfeng') atk = Math.round(atk / 2);
    // 防御最多挡掉一大半，但总会掉血，装备再好也得认真答题
    let d = Math.max(Math.round(atk * .35), atk - (this.tot.def || 0));
    if (this.st.four.heifeng && !this.flags.heifengUsed) { this.flags.heifengUsed = true; d = 0; ar.caption('黑风护体！这一下不疼'); }
    ar.nextDmg = { text: d ? '-' + d : '挡住了', crit: false };
    { const el = Sfx.elem(k); Sfx.cry(k, { short: true }); if (el) setTimeout(() => Sfx.fx(el), 350); else setTimeout(() => Sfx.fx('swing'), 300); }
    await MV[k].run(ar, ar.R, ar.L);
    ar.L.fresh(); ar.R.fresh();
    this.hp = Math.max(0, this.hp - d); this.renderHP(); ar.caption('');
    if (this.hp <= 0) await this.knockout();
  }
  heal(n, quiet) { const before = this.hp; this.hp = Math.min(this.maxhp, this.hp + n); if (!quiet) { const p = this.ar.pt(this.ar.L, 100, 60); this.ar.pop(p.x, p.y, '+' + Math.round(this.hp - before), { color: '#b9f6ca', stroke: '#1b5e20', size: 32 }); this.ar.particles(p.x, p.y + 40, { kind: 'spark', color: ['#b9f6ca', '#fff'], n: 12, spread: 3.1, speed: 70, gravity: -40, size: 14 }); Sfx.play('heal'); } this.renderHP(); }
  async knockout() {
    const ar = this.ar;
    if (this.st.acc === 'acc_hair' && !this.flags.revived) {
      this.flags.revived = true; ar.caption('救命毫毛发光了！悟空原地复活！'); await sleep(600);
      this.heal(Math.round(this.maxhp * .6)); await sleep(1200); ar.caption(''); return;
    }
    ar.caption('悟空累倒了……土地公赶来把他救回了土地庙');
    Sfx.play('lose');
    await an(ar.L.mover, [{ transform: 'none' }, { transform: 'rotate(-80deg) translateY(20px)', opacity: .6 }], 700);
    await sleep(1600);
    this.finish('ko');
  }
  // ---------- 打败妖怪 ----------
  async defeat() {
    if (!this.live) return;
    const ar = this.ar, f = this.foe, E = DATA.E[f.k] || {};
    this.kills.push(f.k); this.markCodex(f.k);
    if (E.kind === 'ally') {
      ar.caption(`${E.n}：${E.end}`); Sfx.fx('drop');
      await sleep(900);
      await an(ar.R.mover, [{ transform: 'none' }, { transform: 'translateY(-40px) scale(1.1)', offset: .3 }, { transform: `translateX(${ar.R.dir * 280}px) scale(.6)`, opacity: 0 }], 1200, { easing: 'ease-in-out' });
      if (this.mode === 'story' && !(Store.state.allies || []).includes(f.k)) { Store.state.allies.push(f.k); this.loot.push({ ally: f.k }); }
    } else {
      Sfx.fx('capture'); if (E.owner && f.boss) setTimeout(() => this.live && Sfx.fx('god'), 1500);
      await ar.capture(ar.R, { key: f.k, beast: E.yx || null, owner: E.owner || null, text: E.end || '逃走了', quick: !f.boss && !E.owner }, C);
    }
    await sleep(f.boss ? 1600 : 150);
    if (f.boss) this.rollBoss(f.k); else this.rollMob();
    // 下一个妖怪
    if (!this.live) return;
    if (this.fi < this.foes.length - 1) {
      this.fi++; ar.caption(''); ar.put(ar.L, Gear.wukong());
      ar.put(ar.R, enemySvg(this.foe.k)); this.music(); setTimeout(() => this.live && Sfx.cry(this.foe.k), 250); if (this.foe.boss) await ar.enter(ar.R); else ar.enter(ar.R);
      ar.caption(this.foe.boss ? `头目 ${name(this.foe.k)} 出现了！` : `${name(this.foe.k)} 冲了过来！`); if (this.foe.boss) await sleep(900); this.capT(this.foe.boss ? 900 : 1600);
      this.renderHP();
    } else { this.renderHP(); }
  }
  markCodex(k) { if (!Store.state.codex[k]) { Store.state.codex[k] = 1; this.newCodex.push(k); } else Store.state.codex[k]++; }
  // ---------- 掉落 ----------
  luck() { return 1 + (this.tot.luck || 0) / 100; }
  give(id) { const r = Gear.add(id); if (r) { this.loot.push(r); Sfx.play('drop'); } }
  frag(god) { Store.state.frags[god] = (Store.state.frags[god] || 0) + 1; this.loot.push({ frag: god }); if (Store.state.frags[god] >= 3) { Store.state.frags[god] -= 3; Store.state.cards[god] = (Store.state.cards[god] || 0) + 3; this.loot.push({ card: god }); } }
  rollMob() {
    const ch = this.cfg.ch || 1, L = this.luck();
    if (Math.random() < .05 * L) { const pool = G.ITEMS.filter(i => i.drop === 'mob' && (i.r === 0 || ch >= 2)); this.give(pick(pool).id); }
    else if (Math.random() < .01 * L && this.cfg.set) { this.give(pick(G.ITEMS.filter(i => i.set === this.cfg.set)).id); }
  }
  rollMini() { Store.state.gold += 5; if (Math.random() < .1 * this.luck()) this.frag(pick(DATA.GOD_COMMON)); }
  rollBoss(k) {
    if (this.mode !== 'story' && this.mode !== 'mirror') return;
    const st = this.cfg.stage, first = st && !Store.state.cleared[st.id], L = this.luck(), drops = DATA.BOSS_DROP[k] || {};
    const setItems = this.cfg.set ? G.ITEMS.filter(i => i.set === this.cfg.set) : [];
    let got = false;
    if (first && setItems.length) { const missing = setItems.filter(i => !Store.state.inv[i.id]); this.give((missing.length ? pick(missing) : pick(setItems)).id); got = true; }
    else {
      if (setItems.length && Math.random() < .25 * L) { this.give(pick(setItems).id); got = true; }
      if (drops.staff && Math.random() < .10 * L) { this.give(drops.staff); got = true; }
      if (drops.acc && Math.random() < .05 * L) { this.give(drops.acc); got = true; }
      const p = Store.state.pity; if (!got) { p[k] = (p[k] || 0) + 1; if (p[k] >= 4 && setItems.length) { p[k] = 0; this.give(pick(setItems).id); this.loot[this.loot.length - 1].pity = true; } } else p[k] = 0;
    }
    if (first && drops.staff && k === 'liuer') this.give(drops.staff);
    const owner = (DATA.E[k] || {}).owner;
    if (first) this.frag(owner && DATA.GODS[owner] ? owner : pick(DATA.GOD_COMMON));
    else if (Math.random() < .3 * L) this.frag(pick(DATA.GOD_COMMON));
    if (first && st && st.gift) this.give(st.gift);
  }
  async openChest() {
    const ar = this.ar, sv = ar.R.svg; this.chestHits++;
    const lv = Math.min(4, Math.ceil(4 * this.chestHits / Math.max(1, this.chestTotal)));
    // 偷偷决定箱子里有什么，最后一起揭晓
    this.chestGold += 5; if (Math.random() < .2 * this.luck()) { const pool = G.ITEMS.filter(i => i.drop === 'mob' || (i.set && i.set === this.cfg.set)); this.chestItems.push(pick(pool).id); }
    const p = ar.pt(ar.R, 100, 150);
    ar.nextDmg = { text: '咔！', crit: false }; Sfx.fx('swing'); setTimeout(() => Sfx.fx('crack', lv), 150);
    await MV.wk_normal.run(ar, ar.L, ar.R); ar.L.fresh();
    if (sv) for (let i = 1; i <= 4; i++) { const c = sv.querySelector('.ck' + i); if (c) c.setAttribute('opacity', i <= lv ? '1' : '0'); }
    const lock = sv && sv.querySelector('.lock');
    if (lock) an(lock, [{ transform: 'none' }, { transform: 'translateX(-5px) rotate(-6deg)' }, { transform: 'translateX(5px) rotate(6deg)' }, { transform: 'none' }], 360, { fill: 'none' });
    ar.particles(p.x, p.y, { kind: 'spark', color: ['#fff59d', '#bdbdbd'], n: 8, spread: 1.4, angle: -90, speed: 90, size: 10 });
    ar.pop(p.x, p.y - 80 * ar.s, ['锁裂开了一点！', '裂得更大了！', '快要断了！', '马上就开了！'][lv - 1], { size: 24, color: '#fff59d' });
    await sleep(500);
  }
  async chestFinale() {
    const ar = this.ar, sv = ar.R.svg; if (!sv) return;
    await sleep(400); ar.put(ar.L, Gear.wukong());
    const lock = sv.querySelector('.lock'), p = ar.pt(ar.R, 100, 150);
    if (!this.chestHits) { this.chestGold = 3; }
    ar.caption(this.chestHits ? '咔嚓！锁彻底断开了！' : '宝箱的锁太结实了……只从缝里抖出来一点灵蕴');
    if (this.chestHits && lock) {
      Sfx.fx('shatter'); ar.shake(8, 300);
      await an(lock, [{ transform: 'none' }, { transform: 'translate(-30px,80px) rotate(-70deg)', opacity: 0 }], 600, { easing: 'ease-in' });
      ar.particles(p.x, p.y, { kind: 'rock', color: ['#f2c94c', '#bdbdbd'], n: 10, spread: 3.1, speed: 120, size: 10 });
      await sleep(300); sv.classList.add('open'); Sfx.jingle('chest', 'battle');
      const gl = sv.querySelector('.glow'); if (gl) an(gl, [{ opacity: 0 }, { opacity: 1 }, { opacity: .6 }], 900);
    }
    await sleep(700);
    Store.state.gold += this.chestGold;
    const q = ar.pt(ar.R, 100, 90);
    ar.pop(q.x, q.y - 40 * ar.s, '灵蕴 +' + this.chestGold, { size: 28, color: '#fff59d' });
    ar.particles(q.x, q.y, { kind: 'spark', color: ['#fff59d', '#ffd54f', '#fff'], n: 20, spread: 1.2, angle: -90, speed: 140, size: 14 });
    for (const id of this.chestItems) {
      await sleep(700); this.give(id); const it = ItemBy[id];
      const el = document.createElement('div'); el.className = 'chest-pop'; el.innerHTML = `${C.gearIcon(it.slot, it.look)}<b>${esc(it.n)}</b>`;
      el.style.setProperty('--rc', G.RARITY[it.r].c); $('#bt-arena').appendChild(el);
      an(el, [{ transform: 'translate(-50%,40px) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-20px) scale(1.15)', opacity: 1, offset: .5 }, { transform: 'translate(-50%,0) scale(1)', opacity: 1 }], 700);
      setTimeout(() => el.remove(), 2600);
    }
    await sleep(this.chestItems.length ? 2200 : 1400); ar.caption('');
  }
  // ---------- 技能 ----------
  async useSkill(k) {
    if (this.busy || this.done) return;
    const ar = this.ar, q = this.cur; Sfx.play('click');
    if (k === 'eye' && this.sk.eye > 0) {
      this.sk.eye--; Sfx.fx('ready');
      const h = (window.QJ_HINT && window.QJ_HINT.make(q)) || DATA.KP_HINT[q.kp] || '仔细再读一遍题目。';
      // 火眼金睛先烧掉一个假答案
      const wrongs = $$('.opt').filter(b => !q.ans.includes(+b.dataset.i) && !b.classList.contains('gone') && !b.classList.contains('burn'));
      if (wrongs.length > 1 || (wrongs.length === 1 && q.opts.length > 2)) { const w = pick(wrongs); w.classList.add('burn'); setTimeout(() => w.classList.add('gone'), 900); }
      if (!$('#bt-q .hint')) { const d = document.createElement('div'); d.className = 'hint'; d.innerHTML = `<b>火眼金睛</b><span>${esc(h)}</span>`; $('#bt-q .qtext').after(d); }
      // 大大的弹窗：悟空两眼冒火，旁边是提示
      const FIRE = `<svg class="eye-fire" viewBox="0 0 200 220" aria-hidden="true">${[83, 117].map(x => `<g class="ef" style="transform-origin:${x}px 86px"><ellipse cx="${x}" cy="84" rx="13" ry="11" fill="#ffeb3b" opacity=".85"/><path d="M${x - 12} 86 C${x - 14} 70 ${x - 4} 66 ${x - 2} 54 C${x + 2} 62 ${x + 6} 58 ${x + 6} 50 C${x + 14} 62 ${x + 16} 74 ${x + 12} 86 Z" fill="#ff7043" opacity=".9"/><path d="M${x - 6} 86 C${x - 7} 76 ${x - 1} 72 ${x} 66 C${x + 3} 72 ${x + 8} 76 ${x + 6} 86 Z" fill="#ffd54f"/></g>`).join('')}</svg>`;
      const pop = document.createElement('div'); pop.className = 'eyepop'; pop.setAttribute('role', 'dialog');
      pop.innerHTML = `<div class="eye-in"><div class="eye-wk">${Gear.wukong()}${FIRE}<i class="eye-beam"></i></div>
        <div class="eye-card"><div class="eye-title">火眼金睛</div><p class="eye-text">${esc(h)}</p><small>还烧掉了一个假答案，剩下的里面找一找！</small><button type="button" class="btn gold eye-ok">知道了</button></div></div>`;
      document.body.appendChild(pop);
      pop.querySelector('.eye-ok').onclick = () => { Sfx.play('click'); pop.remove(); };
      pop.addEventListener('click', e => { if (e.target === pop) pop.remove(); });
      an(ar.L.svg, [{ filter: 'none' }, { filter: 'drop-shadow(0 0 12px #f5b800)' }, { filter: 'none' }], 900, { fill: 'none' });
    }
    if (k === 'ding' && this.sk.ding > 0 && !this.flags.dingArmed) {
      this.sk.ding--; this.flags.dingArmed = true; Sfx.fx('ding');
      const d = document.createElement('div'); d.className = 'dingpop';
      d.innerHTML = `<div class="dp-wk">${Gear.wukong()}<i class="dp-hand"></i></div><div class="dp-seal"><b>定</b></div><p>定身法！这题答错了，还能再选一次</p>`;
      document.body.appendChild(d); setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 350); }, window.QJ_FAST ? 100 : 1700);
      $$('#bt-q .opt').forEach((o, i) => { o.style.animationDelay = (i * .12) + 's'; o.classList.add('dinged'); });
      ar.caption('定身术准备好了：这题答错可以再选一次'); this.capT(3500);
      an(ar.R.mover, [{ filter: 'none' }, { filter: 'drop-shadow(0 0 10px #ffd54f) grayscale(.6)' }, { filter: 'none' }], 1600, { fill: 'none' });
    }
    if (k === 'gourd' && this.sk.gourd > 0) {
      if (this.hp >= this.maxhp) { toast('气血是满的，先留着吧'); return; }
      this.sk.gourd--; this.heal(Math.round(this.maxhp * .4));
    }
    if (k === 'bajie' && this.sk.bajie > 0) {
      const wrong = $$('.opt').filter(b => !q.ans.includes(+b.dataset.i) && !b.classList.contains('gone'));
      if (wrong.length < 2 && q.ans.length === 1 && wrong.length < 1) return;
      this.sk.bajie--; this.busy = true; await this.cutin('bajie', '悟空：呆子，快来帮忙！'); this.busy = false; const w = pick(wrong); w.classList.add('gone');
      const r = w.getBoundingClientRect(); this.flyText(r, '八戒：钉耙一扫！');
    }
    if (k === 'shaseng' && this.sk.shaseng > 0) { this.sk.shaseng--; this.busy = true; await this.cutin('shaseng', '悟空：沙师弟，助我一阵！'); this.busy = false; this.flags.shasengArmed = true; ar.caption('沙僧：宝杖助阵！这题答对伤害翻倍'); this.capT(3500); }
    if (k === 'heavy' && this.focus >= 4) {
      if (this.chest || this.rEmpty || (!this.miniKey && !(this.foe && this.foe.hp > 0))) { toast(this.chest ? '开宝箱的时候不能用重棍哦' : '现在没有可以打的妖怪'); return; }
      this.focus = 0; this.busy = true; this.renderSkills();
      if (this.miniKey) { await this.hitEnemy(); } else await this.strike('heavy', null, '重棍！');
      this.busy = false; if (this.foes.every(f => f.hp <= 0) && !this.chest) { this.renderSkills(); return this.next(); }
    }
    if (k === 'bailong' && this.sk.bailong > 0) { this.sk.bailong--; await this.helper('bailong', 1.5, '小白龙：白龙出水！', '悟空：小白龙，快来帮我一把！'); }
    if (k === 'card' && this.sk.card > 0) return this.pickCard();
    this.renderSkills();
  }
  // 召唤特写：画面变暗 → “悟空呼叫……” → 伙伴/神仙大特写
  async cutin(k, line) {
    const GI = (window.QJ_GODINFO || {})[k], god = !!DATA.GODS[k];
    const d = document.createElement('div'); d.className = 'cutin' + (god ? ' god' : '');
    d.innerHTML = `<div class="ci-call"><span class="ci-wk">${Gear.wukong()}</span><p>${esc(line)}</p></div>
      <div class="ci-band"><i class="ci-lines"></i><span class="ci-hero">${C[k]()}</span><div class="ci-name"><b>${esc(name(k))}</b>${GI ? `<small>${esc(GI.tag)}</small>` : ''}</div></div>`;
    document.body.appendChild(d);
    if (god) Sfx.fx('god'); else Sfx.cry(k);
    await sleep(window.QJ_FAST ? 200 : 2100); d.classList.add('out'); await sleep(window.QJ_FAST ? 50 : 300); d.remove();
  }
  flyText(r, t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; d.style.position = 'fixed'; d.style.left = (r.left + r.width / 2) + 'px'; d.style.top = r.top + 'px'; d.style.bottom = 'auto'; document.body.appendChild(d); setTimeout(() => d.remove(), 1200); }
  async helper(k, mult, label, call, fx = {}) {
    const ar = this.ar; if (!this.foe || this.foe.hp <= 0 || this.miniKey) { toast('现在没有可以打的妖怪'); return; }
    this.busy = true; this.renderSkills();
    await this.cutin(k, call || `悟空：${name(k)}，快来帮忙！`); if (!this.live) return;
    ar.caption(label); ar.put(ar.L, C[k]()); await ar.enter(ar.L);
    if (fx.heal) { this.heal(Math.round(this.maxhp * fx.heal)); await sleep(500); }
    const d = Math.round(this.tot.atk * mult); ar.nextDmg = { text: '-' + d, crit: false };
    await MV[k].run(ar, ar.L, ar.R); ar.L.fresh(); ar.R.fresh();
    this.foe.hp = Math.max(0, this.foe.hp - d); this.renderHP();
    if (fx.stun && this.foe.hp > 0) { this.flags.stunned = true; ar.caption(`${name(this.foe.k)}被定住了！下次答错它也打不了你`); await sleep(1400); }
    if (fx.focus) { this.focus = 4; Sfx.fx('ready'); }
    await an(ar.L.mover, [{ transform: 'none', opacity: 1 }, { transform: `translateX(${-200}px)`, opacity: 0 }], 400);
    ar.put(ar.L, Gear.wukong()); await ar.enter(ar.L); ar.caption('');
    if (this.foe.hp <= 0) await this.defeat();
    if (!this.live) return;
    this.busy = false; this.renderSkills();
    if (this.foes.every(f => f.hp <= 0)) this.next();
  }
  pickCard() {
    const cards = Object.entries(Store.state.cards || {}).filter(([, v]) => v > 0);
    const m = $('#modal'); m.hidden = false;
    $('#modal .mbox').innerHTML = `<button type="button" class="x" aria-label="关闭">×</button><h2>召唤援军</h2><p>每场战斗可以召唤一位神仙。召唤后这张卡的次数减 1。</p>
      <div class="grid">${cards.map(([k, v]) => `<button type="button" class="card" data-g="${k}">${C[k]()}<b>${DATA.GODS[k]}</b><small>还能用 ${v} 次 · ${MV[k] ? MV[k].name : ''}</small>${(window.QJ_GODINFO || {})[k] ? `<small class="pw">${esc(window.QJ_GODINFO[k].power.split('：')[1] || '')}</small>` : ''}</button>`).join('')}</div>`;
    $('#modal .x').onclick = () => m.hidden = true;
    $$('#modal [data-g]').forEach(b => b.onclick = async () => {
      m.hidden = true; const g = b.dataset.g; Store.state.cards[g]--; this.sk.card--; Store.save('state');
      const GI = (window.QJ_GODINFO || {})[g] || { fx: { dmg: 3 } };
      await this.helper(g, GI.fx.dmg || 3, `${DATA.GODS[g]} 前来助阵！`, `悟空：请${DATA.GODS[g]}助我一臂之力！`, GI.fx);
    });
  }
  // ---------- 结束 ----------
  async finish(outcome) {
    if (this.done || !this.live) return; this.done = true; this.renderSkills();
    if (this.mode === 'story' && Q_Guest()) Q_Guest().countStage();
    const st = this.cfg.stage, S = Store.state, gm = 1 + (this.tot.gold || 0) / 100;
    let gold = Math.round(this.correct * 3 * gm);
    const win = outcome === 'win';
    if (this.mode === 'story' && st) {
      if (win) { gold += Math.round((S.cleared[st.id] ? 20 : 60) * gm); S.cleared[st.id] = (S.cleared[st.id] || 0) + 1; if (this.cfg.tut) S.seenTut = true; }
      if (outcome === 'ko') gold = Math.round(gold / 2);
    }
    if (this.mode === 'mirror' && win) gold += 40;
    S.gold += gold; // 修为在每次答对时就已经加过了，中途退出也算数
    S.hist.unshift({ d: Date.now(), mode: this.mode, t: this.cfg.title, n: this.answered, c: this.correct, w: [...this.wrongIds], r: outcome });
    S.hist = S.hist.slice(0, 120);
    Store.save('state'); Store.save('progress');
    await sleep(400);
    window.QJ.showResult({ outcome, title: this.cfg.title, correct: this.correct, answered: this.answered, best: this.bestStreak, gold, loot: this.loot, codex: this.newCodex, mode: this.mode, stage: st });
  }
  quit() { if (this.done) return show('home'); const m = $('#modal'); m.hidden = false;
    $('#modal .mbox').innerHTML = `<h2>要离开战斗吗？</h2><p>已经答过的题会记下来，但这一关不算通过。</p><div class="row"><button type="button" class="btn ghost" id="mq-no">继续战斗</button><button type="button" class="btn red" id="mq-yes">离开</button></div>`;
    $('#mq-no').onclick = () => m.hidden = true; $('#mq-yes').onclick = () => { m.hidden = true; this.done = true; if (this._teach) this._teach.remove(); Store.save('state'); Store.save('progress'); window.QJ.goHome(); };
  }
}
window.QJ.Battle = Battle;
const BGM = { home: 'home', map: 'map', intro: 'map', bag: 'home', codex: 'home', cards: 'home', free: 'home', shop: 'shop', race: 'race', duel: 'duel', parent: null };
function show(id) { $$('.screen').forEach(s => s.classList.toggle('on', s.id === id)); if (id in BGM) Sfx.bgm(BGM[id]); document.body.dataset.screen = id; }
window.QJ.show = show;

// 战斗界面事件
document.addEventListener('click', e => {
  const B = window.QJ.curBattle; if (!B || !$('#battle').classList.contains('on')) return;
  const o = e.target.closest('#bt-q .opt'); if (o) return B.pickOpt(o);
  if (e.target.closest('#confirm')) return B.judge();
  const s = e.target.closest('#bt-skills [data-k]'); if (s) return B.useSkill(s.dataset.k);
  if (e.target.closest('#bt-back')) return B.quit();
});
})();

/* 取经小英雄 · 主程序（三）：首页、地图、结算、背包、影神图、援军、各模式 */
(function(){
'use strict';
const Q = window.QJ;
const { C, MV, G, DATA, an, sleep, rnd, $, $$, esc, today, shuffle, pick, Store, Bank, SRS, Sfx, Gear, ItemBy, toast, STAGES, stageUnlocked, name, show, Battle, makeArena } = Q;
const S = () => Store.state;
const mini = (html, vb = '20 0 160 220') => html.replace(/viewBox="0 0 200 220"/, `viewBox="${vb}"`);

// ================= 首页 =================
function goHome() {
  Q.curBattle = null; show('home');
  const t = Gear.title(), st = S();
  $('#home-hero').innerHTML = Gear.wukong();
  const pct = t.next ? Math.round((st.xp - t.cur) / (t.next - t.cur) * 100) : 100;
  $('#home-rank').innerHTML = `<b>${esc(Store.settings.name)} · ${t.name}</b><div class="bar"><i style="width:${pct}%"></i></div><small>修为 ${st.xp}${t.next ? ` / ${t.next}，再答对 ${t.next - st.xp} 题升级` : '（已到最高称号）'}</small>`;
  $('#home-gold').innerHTML = `<i></i>灵蕴 ${st.gold}`;
  const ni = STAGES.findIndex((s, i) => stageUnlocked(i) && !st.cleared[s.id]);
  const nextSt = STAGES[ni >= 0 ? ni : STAGES.length - 1];
  const due = Bank.active().filter(q => SRS.isDue(q)).length;
  const wrongEver = Bank.active().filter(q => (SRS.rec(q.id) || {}).w > 0).length;
  const nCards = Object.values(st.cards).reduce((a, b) => a + b, 0);
  const modes = [
    { id: 'story', big: true, icon: mini(C.tangseng()), t: '取经之路', s: `下一关：${nextSt.chName.split(' · ')[0]} · ${nextSt.n} ｜ 题库：${Bank.activeLabel()}${due ? ` ｜ 今天有 ${due} 道题该复习了` : ''}` },
    { id: 'duel', icon: mini(C.niumowang()), t: '擂台斗法', s: '和爸爸妈妈比赛，看谁先答够题' },
    { id: 'free', icon: mini(C.tudi()), t: '自由修行', s: '挑一个考点慢慢练，不扣血' },
    { id: 'race', icon: mini(C.wukong()), t: '筋斗云竞速', s: `${Store.settings.raceSec} 秒能答对几题？最好成绩 ${st.raceBest}` },
    { id: 'mirror', icon: mini(C.liuer()), t: '真假美猴王', s: wrongEver >= 5 ? `专打错题：${wrongEver} 道错过的题` : `答错过 5 道题后开放（现在 ${wrongEver} 道）`, lock: wrongEver < 5 },
    { id: 'bag', icon: `<svg viewBox="40 0 120 120">${C.gearIcon('head', { t: 'helm', c1: '#3a3436', c2: '#b8892e', plume: '#222' }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`, t: '装备', s: `精魄 ${st.spirit} · 已有 ${Object.keys(st.inv).length} 件` },
    { id: 'codex', icon: mini(C.heixiong()), t: '影神图', s: `已收录 ${Object.keys(st.codex).length} 个妖怪` },
    { id: 'shop', icon: mini(C.tudi()), t: '土地庙小铺', s: '用灵蕴换仙丹、碎片' },
    { id: 'cards', icon: mini(C.guanyin()), t: '援军卡', s: nCards ? `可召唤 ${nCards} 次` : '攒够 3 个碎片合成一张' },
  ];
  $('#home-modes').innerHTML = modes.map(m => `<button type="button" class="mode${m.big ? ' big' : ''}${m.lock ? ' lock' : ''}" data-m="${m.id}"><span class="mi">${m.icon}</span><span><b>${m.t}</b><small>${esc(m.s)}</small></span></button>`).join('');
  $('#cloud-note').textContent = Store.cloud || window.QJ_APP ? '' : '未登录：进度只存在这台设备上';
}
Q.goHome = goHome;
document.addEventListener('click', e => {
  const m = e.target.closest('#home-modes .mode'); if (!m) return; Sfx.ensure(); Sfx.play('click');
  if (!Bank.all.length && ['story', 'duel', 'free', 'race', 'mirror'].includes(m.dataset.m)) return toast('题库还是空的，请家长先在“家长”里导入题目');
  ({ story: openMap, duel: openDuelSetup, free: openFree, race: startRace, mirror: () => startMirror(), bag: openBag, codex: openCodex, cards: openCards, shop: openShop })[m.dataset.m]();
});

// ================= 地图 =================
function openMap() { return Q.worldMap(); }
document.addEventListener('click', e => { const b = e.target.closest('#map-list .stage'); if (b) { Sfx.play('click'); openIntro(STAGES.find(s => s.id === b.dataset.s)); } });

// ================= 关卡开场 =================
Q.openIntro = st => openIntro(st);
function openIntro(st) {
  show('intro');
  const foes = st.mobs.map(k => `<div>${C[k]()}${name(k)}</div>`).join('') + `<div class="more"><span>＋</span>路上的小妖</div>` + `<div class="boss">${C[st.boss]()}${name(st.boss)}</div>`;
  const n = st.q || Store.settings.daily;
  const tips = st.tut ? `<div class="intro-line">${C.tudi()}<p>土地公：大圣，答对题目你就出招，答错了妖怪会打你一下，下面会告诉你正确答案。连续答对，棍势攒满可以放“重棍”；答不出来，就点“火眼金睛”看看提示！</p></div>` : '';
  $('#intro-box').innerHTML = `<h2>${esc(st.chName.split(' · ')[0])} · ${esc(st.n)}</h2>
    <div class="intro-line">${C.tangseng()}<p>${esc(st.intro)}</p></div>${tips}
    <div class="intro-foes">${foes}</div>
    ${(S().buff || {}).gourd || (S().buff || {}).eye ? `<p style="text-align:center;margin:0;color:#2f7d6b">这次带上了：${[(S().buff.gourd ? '仙丹 ×' + S().buff.gourd : ''), (S().buff.eye ? '锦囊 ×' + S().buff.eye : '')].filter(Boolean).join('，')}</p>` : ''}<p style="text-align:center;margin:0;color:var(--mute)">这一关大约 ${n} 道题${S().cleared[st.id] ? ' · 已经通关过，可以再来刷装备' : ''}</p>
    <div class="intro-actions"><button type="button" class="btn ghost" id="intro-back">返回地图</button><button type="button" class="btn gold" id="intro-go">出发！</button></div>`;
  $('#intro-back').onclick = openMap;
  $('#intro-go').onclick = () => { Sfx.ensure(); startStage(st); };
}
function foeStats(k, ch, boss, tut) {
  const exp = 10 + 4 * (ch - 1);
  const max = tut && boss ? 40 : Math.round((boss ? 7 : 2.5) * exp);
  return { k, max, hp: max, atk: tut && boss ? 24 : boss ? 28 + 6 * ch : 18 + 4 * ch, boss };
}
// 根据题量决定头目前面有几只小怪：剧情小怪一定出场，不够再从本章小怪里补
function stageMobs(st, n) {
  const B = st.tut ? 4 : 7;
  const M = Math.max(1, Math.min(5, Math.floor((n * .85 - B) / 2.5)));
  const list = st.mobs.slice();
  const pool = shuffle((DATA.MOB_POOL[st.ch] || DATA.MOB_POOL[1]).slice());
  let j = 0;
  while (list.length < M) { const k = pool[j++ % pool.length]; if (list[list.length - 1] !== k || pool.length === 1) list.push(k); }
  return list;
}
function startStage(st) {
  const n = st.q || Store.settings.daily;
  const qs = SRS.pick(n);
  if (!qs.length) return toast('题库还是空的');
  const mobs = stageMobs(st, qs.length);
  const enemies = mobs.map(k => foeStats(k, st.ch, false)).concat([foeStats(st.boss, st.ch, true, st.tut)]);
  enemies[0].intro = mobs.length ? `${name(mobs[0])} 跳出来拦路！后面还有 ${mobs.length - 1 ? mobs.length - 1 + ' 只小妖和' : ''}头目 ${name(st.boss)}` : null;
  enemies[enemies.length - 1].intro = `${name(st.boss)}：${st.final ? '我才是真的孙悟空！' : '哪里来的猴子，敢闯我的地盘？'}`;
  Q.curBattle = new Battle({ mode: 'story', title: `${st.chName.split(' · ')[0]} · ${st.n}`, stage: st, ch: st.ch, set: st.set, tut: st.tut, wind: true, questions: qs, enemies });
  Q.curBattle.start();
}

// ================= 结算 =================
Q.showResult = function (r) {
  show('result');
  const head = { win: r.mode === 'free' ? '修行结束' : '大获全胜！', ko: '下次再来！', escape: '妖怪逃跑了！' }[r.outcome] || '结束';
  const sub = { win: '', ko: '悟空累倒了，被土地公救回土地庙。错题都记下了，下次一定能赢！', escape: '妖怪趁乱逃走了，这一关没有通过，明天再来抓它！' }[r.outcome] || '';
  const loot = r.loot.map(l => {
    if (l.ally) return `<div class="it" style="--rc:#2f7d6b">${mini(C[l.ally]())}<b>${name(l.ally)}</b>加入队伍！</div>`;
    if (l.card) return `<div class="it" style="--rc:#e8b33a">${mini(C[l.card]())}<b>援军卡</b>${DATA.GODS[l.card]}（可用 3 次）</div>`;
    if (l.frag) return `<div class="it" style="--rc:#8e24aa">${mini(C[l.frag]())}<b>援军碎片</b>${DATA.GODS[l.frag]} ${S().frags[l.frag] || 0}/3</div>`;
    if (l.it) return `<div class="it" style="--rc:${G.RARITY[l.it.r].c}">${C.gearIcon(l.it.slot, l.it.look)}<b>${esc(l.it.n)}</b>${G.RARITY[l.it.r].n}${l.dup ? `<br>重复，化成精魄 +${l.sp}` : ''}${l.pity ? '<br>（保底）' : ''}</div>`;
    return '';
  }).join('');
  const cx = r.codex.filter(k => DATA.E[k]).map(k => `<div class="it" style="--rc:#5c6bc0">${mini(C[k]())}<b>${name(k)}</b>影神图新收录</div>`).join('');
  const acc = r.answered ? Math.round(r.correct / r.answered * 100) : 0;
  $('#result-box').innerHTML = `<h2>${head}</h2>${sub ? `<p style="text-align:center;margin:0">${sub}</p>` : ''}
    <div class="res-stats"><div><b>${r.correct}/${r.answered}</b>答对</div><div><b>${r.best}</b>最多连对</div><div><b>+${r.gold}</b>灵蕴</div></div>
    ${loot || cx ? `<h3 style="text-align:center">获得</h3><div class="loot">${loot}${cx}</div>` : ''}
    <p style="text-align:center;margin:0;color:var(--mute)">正确率 ${acc}%${r.outcome === 'win' && acc >= 90 ? ' · 太厉害了！' : ''}</p>
    <div class="intro-actions"><button type="button" class="btn ghost" id="res-home">回花果山</button>${r.mode === 'story' ? '<button type="button" class="btn" id="res-map">取经地图</button>' : ''}</div>`;
  if (r.outcome === 'win') Sfx.play('win');
  $('#res-home').onclick = goHome; if ($('#res-map')) $('#res-map').onclick = openMap;
};

// ================= 背包 =================
let bagTab = 'head';
function openBag() { show('bag'); renderBag(); }
function renderBag() {
  const st = S(), gs = Gear.stats();
  $('#bag-stage').innerHTML = Gear.wukong();
  $('#bag-stats').innerHTML = G.STATS.map(s => `<tr><th>${s.n}</th><td>${gs.tot[s.k]}${s.pct ? '%' : ''}</td></tr>`).join('');
  $('#bag-sets').innerHTML = Object.entries(gs.sets).map(([k, n]) => { const s = G.SETS[k]; return `<div class="set"><b>${s.n} ${n}/4</b><span class="${n >= 2 ? 'on' : ''}">2 件：${s.b2t}</span><span class="${n >= 4 ? 'on' : ''}">4 件：${s.b4t}</span></div>`; }).join('');
  $('#bag-spirit').textContent = `精魄 ${st.spirit}（重复装备会化成精魄，用来强化）`;
  $('#bag-tabs').innerHTML = G.SLOTS.map(s => `<button type="button" role="tab" aria-selected="${s.k === bagTab}" data-k="${s.k}">${s.n}</button>`).join('');
  const items = G.ITEMS.filter(i => i.slot === bagTab).sort((a, b) => (!!st.inv[b.id] - !!st.inv[a.id]) || a.r - b.r);
  $('#bag-items').innerHTML = items.map(i => {
    const own = st.inv[i.id], lv = own ? own.lv : 0, on = st.eq[i.slot] === i.id;
    const stats = Object.entries(i.stats).filter(([, v]) => v).map(([k, v]) => { const s = G.STATS.find(x => x.k === k); return `${s.n} +${Math.round(v * (1 + .1 * lv))}${s.pct ? '%' : ''}`; }).join('，');
    const cost = lv + 1;
    return `<div class="item${on ? ' on' : ''}${own ? '' : ' locked'}" style="--rc:${G.RARITY[i.r].c}"><span class="ic">${C.gearIcon(i.slot, i.look)}</span><span class="tx"><b>${esc(i.n)}${lv ? ` <span class="lv">+${lv}</span>` : ''}</b><em>${G.RARITY[i.r].n}${i.set ? ' · ' + G.SETS[i.set].n : ''}</em><small>${[stats, i.fx].filter(Boolean).join('；') || '—'}</small><small style="color:var(--mute)">${own ? '' : '来源：' + esc(i.src)}</small>
      ${own ? `<span class="row"><button type="button" class="mini-btn${on ? '' : ' pri'}" data-eq="${i.id}">${on ? '卸下' : '穿上'}</button>${lv < 5 ? `<button type="button" class="mini-btn" data-up="${i.id}" ${st.spirit >= cost && st.gold >= cost * 40 ? '' : 'disabled'}>强化（精魄 ${cost} + 灵蕴 ${cost * 40}）</button>` : '<small>已满级</small>'}</span>` : ''}</span></div>`;
  }).join('');
}
document.addEventListener('click', e => {
  if (!$('#bag').classList.contains('on')) return;
  const t = e.target.closest('#bag-tabs button'); if (t) { bagTab = t.dataset.k; renderBag(); return; }
  const eq = e.target.closest('[data-eq]'); if (eq) { const it = ItemBy[eq.dataset.eq], st = S(); if (st.eq[it.slot] === it.id) { if (it.slot === 'weapon') return toast('悟空不能没有棍子！'); delete st.eq[it.slot]; } else st.eq[it.slot] = it.id; Sfx.play('click'); Store.save('state'); renderBag(); return; }
  const up = e.target.closest('[data-up]'); if (up) { const st = S(), inv = st.inv[up.dataset.up], cost = inv.lv + 1; if (st.spirit < cost || st.gold < cost * 40) return; st.spirit -= cost; st.gold -= cost * 40; inv.lv++; Sfx.play('drop'); toast(`${ItemBy[up.dataset.up].n} 强化到 +${inv.lv}`); Store.save('state'); renderBag(); }
});

// ================= 影神图 =================
function openCodex() {
  show('codex');
  const keys = Object.keys(DATA.E).filter(k => !['dummy', 'chest'].includes(k));
  $('#codex-grid').innerHTML = keys.map(k => { const n = S().codex[k]; return `<button type="button" class="card${n ? '' : ' lock'}" data-c="${k}">${C[k]()}<b>${n ? name(k) : '？？？'}</b><small>${n ? `打败 ${n} 次` : (DATA.E[k].place || '')}</small></button>`; }).join('');
  $('#codex-count').textContent = `${keys.filter(k => S().codex[k]).length} / ${keys.length}`;
}
// 详情页：平板横屏左右两栏（左边大舞台 + 按钮，右边简短大字介绍）；竖屏/手机上下排，按钮紧跟在舞台下面
function demoModal(title, body, playA, playD, extra, opt = {}) {
  const m = $('#modal'); m.hidden = false;
  $('#modal .mbox').innerHTML = `<button type="button" class="x" aria-label="关闭">×</button>
    <div class="det"><div class="det-L"><h2>${title}${opt.tag ? `<span class="god-tag">${esc(opt.tag)}</span>` : ''}</h2>
    <div class="arena mini-arena" id="m-arena"><div class="hill"></div><div class="gnd"></div><div class="slot L"><div class="mover"><div class="flip"></div></div></div><div class="slot R"><div class="mover"><div class="flip"></div></div></div><div class="fx"></div><div class="capbar"></div></div>
    <div class="row det-btns">${playA ? `<button type="button" class="btn" id="m-play">▶ 看招式${opt.move ? '：' + esc(opt.move) : ''}</button>` : ''}${extra || ''}</div></div>
    <div class="det-R">${body}</div></div>`;
  const ar = makeArena($('#m-arena'));
  ar.fit = () => { const r = $('#m-arena'); if (!r) return; const w = r.clientWidth, h = r.clientHeight; if (!w || !h) return; r.style.setProperty('--s', Math.max(.5, Math.min(1.7, w / 430, (h - 50) / 235)).toFixed(3)); };
  ar.fit();
  ar.put(ar.L, playA === 'wukong' ? Gear.wukong() : C[playA]()); ar.put(ar.R, playD === 'wukong' ? Gear.wukong() : C[playD]());
  let busy = false;
  $('#modal .x').onclick = () => { m.hidden = true; };
  if ($('#m-play')) $('#m-play').onclick = async () => { if (busy) return; busy = true; try { await MV[playA].run(ar, ar.L, ar.R); ar.L.fresh(); ar.R.fresh(); } catch (e) { } ar.L.reset(); ar.R.reset(); ar.put(ar.R, playD === 'wukong' ? Gear.wukong() : C[playD]()); busy = false; };
  return ar;
}
document.addEventListener('click', e => {
  const c = e.target.closest('#codex-grid .card'); if (!c) return; const k = c.dataset.c, E = DATA.E[k];
  if (!S().codex[k]) return toast('还没遇到过这个妖怪');
  const ar = demoModal(E.n, `<div class="god-sec"><b>它的故事</b><p>${esc(E.story)}</p></div>${E.end ? `<div class="god-sec pw"><b>最后的结局</b><p>${esc(E.end)}</p></div>` : ''}<p class="det-note">打败过 ${S().codex[k]} 次</p>`, MV[k] ? k : null, 'wukong',
    E.kind !== 'mini' && E.kind !== 'ally' ? '<button type="button" class="btn gold" id="m-cap">看收服</button>' : '', { tag: '出没：' + (E.place || '取经路上'), move: MV[k] && MV[k].name });
  if ($('#m-cap')) $('#m-cap').onclick = async () => { ar.put(ar.L, Gear.wukong()); ar.put(ar.R, C[k]()); await MV.wk_finish.run(ar, ar.L, ar.R); await ar.capture(ar.R, { key: k, beast: E.yx || null, owner: E.owner || null, text: E.end }, C); };
  if (MV[k]) { ar.put(ar.L, C[k]()); ar.put(ar.R, Gear.wukong()); }
});

// 弹窗：点空白处（深色背景）就关掉，和点右上角 × 一样；没有 × 的弹窗（比如必须输密码的）不受影响
document.addEventListener('click', e => {
  const m = $('#modal'); if (!m || m.hidden || e.target !== m) return;
  const x = m.querySelector('.mbox > .x'); if (x) x.click();
});
// ================= 援军卡 =================
function openCards() {
  show('cards');
  $('#cards-grid').innerHTML = Object.keys(DATA.GODS).map(k => { const f = S().frags[k] || 0, u = S().cards[k] || 0, seen = f || u;
    return `<button type="button" class="card${seen ? '' : ' lock'}" data-g="${k}">${C[k]()}<b>${seen ? DATA.GODS[k] : '？？？'}</b><span class="frag">${[0, 1, 2].map(i => `<i class="${i < f ? 'on' : ''}"></i>`).join('')}</span><small>${u ? `可用 ${u} 次` : `碎片 ${f}/3`}</small></button>`; }).join('');
}
document.addEventListener('click', e => {
  const c = e.target.closest('#cards-grid .card'); if (!c) return; Sfx.play('click'); godDetail(c.dataset.g, false);
});
// 神仙详情：援军卡页面和土地庙小铺共用；小铺里要在详情页点“确认兑换”才会扣灵蕴
function godDetail(k, buy) {
  const f = S().frags[k] || 0, u = S().cards[k] || 0, GI = (window.QJ_GODINFO || {})[k] || {}, gold = S().gold;
  const mine = f || u ? `碎片 <b>${f}/3</b>　·　还能召唤 <b>${u}</b> 次` : '还没有碎片';
  const extra = buy ? `<button type="button" class="btn gold" id="g-buy" ${gold >= FRAG_PRICE ? '' : 'disabled'}>确认兑换碎片（${FRAG_PRICE} 灵蕴）</button><span class="det-note">现在有 ${gold} 灵蕴${gold < FRAG_PRICE ? '，还不够哦' : ''}</span>` : '';
  demoModal(DATA.GODS[k], `${GI.story ? `<div class="god-sec"><b>在《西游记》里</b><p>${esc(GI.story)}</p></div>` : ''}
      ${GI.power ? `<div class="god-sec pw"><b>召唤能力</b><p>${esc(GI.power)}</p></div>` : ''}
      <div class="god-sec mine"><b>我的援军卡</b><p>${mine}</p><small>3 个碎片 = 召唤 3 次 · 碎片靠打头目、复习错题掉落，也能在土地庙换</small></div>`, MV[k] ? k : null, 'heixiong', extra, { tag: GI.tag, move: MV[k] && MV[k].name });
  if (buy && $('#g-buy')) $('#g-buy').onclick = () => {
    const st = S(); if (st.gold < FRAG_PRICE) return;
    st.gold -= FRAG_PRICE; st.frags[k] = (st.frags[k] || 0) + 1; let msg = `得到 ${DATA.GODS[k]} 碎片`;
    if (st.frags[k] >= 3) { st.frags[k] -= 3; st.cards[k] = (st.cards[k] || 0) + 3; msg = `${DATA.GODS[k]} 援军卡 +3 次！`; }
    Sfx.play('drop'); Store.save('state'); toast(msg); renderShop(); godDetail(k, true);
  };
}

// ================= 左下角小齿轮：声音、同步码、重置进度 =================
function syncBlock() {
  const SY = Q.Sync; if (!SY || Store.cloud || window.QJ_APP !== 'kid') return '';
  return SY.on
    ? `<div class="pcard" style="gap:6px"><b>同步</b><small style="color:var(--mute)">已和家长端同步${SY.last ? '（上次 ' + new Date(SY.last).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '）' : ''}。</small><div class="row"><button type="button" class="mini-btn pri" id="g-syncnow">🔄 同步取经之路</button><button type="button" class="mini-btn" id="g-unsync">不再同步（改成游客）</button></div><small id="g-syncnow-msg" style="color:var(--mute)">iPad、手机用同一个同步码，通关、装备、影神图、复习记录都会合到一起。</small></div>`
    : `<div class="pcard" style="gap:6px"><b>同步码</b><small style="color:var(--mute)">现在是游客模式，进度只存在这台设备上。有同步码的话填在这里：</small>
        <input type="password" id="g-token" placeholder="github_pat_……" style="width:100%"><div class="row"><button type="button" class="mini-btn pri" id="g-sync">保存同步码</button><span id="g-sync-msg" style="color:var(--mute)"></span></div></div>`;
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-gear]')) return;
  Sfx.ensure(); Sfx.play('click');
  const v = Sfx.vol(), m = $('#modal'); m.hidden = false;
  $('#modal .mbox').innerHTML = `<button type="button" class="x" aria-label="关闭">×</button><h2>设置</h2>
    <div class="volrow"><label for="g-music">音乐</label><input type="range" id="g-music" min="0" max="100" value="${Math.round(v.music * 100)}"><b id="g-music-n">${Math.round(v.music * 100)}</b>
    <label for="g-sfx">音效</label><input type="range" id="g-sfx" min="0" max="100" value="${Math.round(v.sfx * 100)}"><b id="g-sfx-n">${Math.round(v.sfx * 100)}</b></div>
    ${syncBlock()}
    <div class="pcard" style="gap:6px"><b>重新开始</b><small style="color:var(--mute)">清空修为、灵蕴、装备、通关记录和复习记录。题库不会删。</small>
      <div class="row"><button type="button" class="mini-btn dng" id="g-reset">重置进度</button><span id="g-reset-msg" style="color:var(--mute)"></span></div></div>
    <div class="row"><button type="button" class="btn" id="g-ok">好了</button></div>`;
  const close = () => { m.hidden = true; clearTimeout(resetT); };
  let resetT = null, resetArmed = false;
  $('#g-reset').onclick = () => {
    if (!resetArmed) { resetArmed = true; $('#g-reset').textContent = '真的要清空吗？再点一次'; $('#g-reset-msg').textContent = '5 秒内再点一次才会清空'; resetT = setTimeout(() => { resetArmed = false; if ($('#g-reset')) { $('#g-reset').textContent = '重置进度'; $('#g-reset-msg').textContent = ''; } }, 5000); return; }
    clearTimeout(resetT); const keep = { resetAt: Date.now() };
    Store.state = Object.assign(JSON.parse(JSON.stringify(window.QJ_DEF_STATE)), keep); Store.prog = { q: {}, ts: 0 };
    Store.save('state'); Store.save('progress'); ['state', 'progress'].forEach(n => { clearTimeout(Store.timers[n]); Store.flush(n); });
    toast('进度已清空，重新出发！'); close(); goHome();
  };
  if ($('#g-syncnow')) $('#g-syncnow').onclick = async () => {
    const b = $('#g-syncnow'), msg = $('#g-syncnow-msg'); b.disabled = true; msg.textContent = '正在同步……';
    try { await Store.flush('state'); await Store.flush('progress'); const ch = await Q.Sync.syncKid(); const st = Store.state;
      msg.textContent = `同步好了${ch ? '，已合并别的设备的进度' : ''}：通关 ${Object.keys(st.cleared || {}).length} 关 · 修为 ${st.xp} · 灵蕴 ${st.gold}`; Sfx.play('drop'); }
    catch (e) { msg.textContent = '没同步上：' + (e.message || e) + '（检查一下网络）'; }
    b.disabled = false;
  };
  if ($('#g-sync')) $('#g-sync').onclick = async () => {
    const SY = Q.Sync, tok = $('#g-token').value.trim(); if (!tok) return;
    $('#g-sync-msg').textContent = '测试中……'; SY.configure(tok);
    try { await SY.test(); await SY.pull(); Bank.rebuild(); SY.pushKid(0); Store.ls('sync_skip', 1); $('#g-sync-msg').textContent = '同步已打开'; toast('同步已打开'); goHome(); }
    catch (er) { SY.configure(''); $('#g-sync-msg').textContent = er.message; }
  };
  if ($('#g-unsync')) $('#g-unsync').onclick = () => { Q.Sync.configure(''); toast('已改成游客模式：以后不再同步'); m.hidden = true; goHome(); };
  $('#modal .x').onclick = close; $('#g-ok').onclick = close;
  $('#g-music').oninput = ev => { $('#g-music-n').textContent = ev.target.value; Sfx.setVol(ev.target.value / 100, null); };
  $('#g-sfx').oninput = ev => { $('#g-sfx-n').textContent = ev.target.value; Sfx.setVol(null, ev.target.value / 100); };
  $('#g-sfx').onchange = () => Sfx.fx('correct', 2);
});

// ================= 土地庙小铺 =================
const SHOP = [
  { k: 'gourd', n: '仙丹', icon: () => `<svg viewBox="0 0 40 40"><path d="M20 38 C8 36 8 22 15 19 C11 15 13 8 20 8 C27 8 29 15 25 19 C32 22 32 36 20 38 Z" fill="#e7a54a" stroke="#3a2618" stroke-width="2.5"/><path d="M17 8 v-5 h6 v5" fill="#8d6e63" stroke="#3a2618" stroke-width="2"/></svg>`, d: '下一关多带 1 个葫芦（回血）', price: 40, max: 2 },
  { k: 'eye', n: '锦囊', icon: () => `<svg viewBox="0 0 40 40"><path d="M10 14 Q20 4 30 14 L32 34 Q20 40 8 34 Z" fill="#d1452f" stroke="#3a2618" stroke-width="2.5"/><path d="M12 14 h16" stroke="#f2b632" stroke-width="3"/><circle cx="20" cy="25" r="4" fill="#f2b632"/></svg>`, d: '下一关火眼金睛多用 1 次', price: 40, max: 2 },
  { k: 'spirit', n: '精魄', icon: () => `<svg viewBox="0 0 40 40"><path d="M20 4 L32 18 L20 36 L8 18 Z" fill="#b39ddb" stroke="#3a2618" stroke-width="2.5"/><path d="M8 18 h24 M20 4 v32" stroke="#ede7f6" stroke-width="2"/></svg>`, d: '用来强化装备', price: 100 },
];
const FRAG_PRICE = 150;
function openShop() { show('shop'); renderShop(); }
function renderShop() {
  const st = S(); st.buff = st.buff || {};
  $('#shop-gold').innerHTML = `<i></i>灵蕴 ${st.gold}`;
  const goods = SHOP.map(g => { const have = g.k === 'spirit' ? st.spirit : st.buff[g.k] || 0, full = g.max && have >= g.max;
    return `<div class="good"><span class="ic">${g.icon()}</span><span class="tx"><b>${g.n}</b><small>${g.d}</small><small style="color:var(--mute)">${g.k === 'spirit' ? '现有 ' + have : `已备好 ${have}${g.max ? ' / ' + g.max : ''}`}</small></span><button type="button" class="mini-btn pri" data-buy="${g.k}" ${st.gold >= g.price && !full ? '' : 'disabled'}>${full ? '带满了' : g.price + ' 灵蕴'}</button></div>`; }).join('');
  const gods = Object.keys(DATA.GODS).map(k => { const f = st.frags[k] || 0, u = st.cards[k] || 0;
    return `<button type="button" class="card" data-bf="${k}">${C[k]()}<b>${DATA.GODS[k]}</b><span class="frag">${[0, 1, 2].map(i => `<i class="${i < f ? 'on' : ''}"></i>`).join('')}</span><small>${u ? `可用 ${u} 次` : '碎片 ' + f + '/3'}</small></button>`; }).join('');
  $('#shop-body').innerHTML = `<div class="shop-line">${mini(C.tudi())}<p>土地公：大圣，攒下的灵蕴可以在我这儿换东西。仙丹和锦囊只管下一次闯关，用完就没了哦！</p></div>
    <div class="goods">${goods}</div>
    <h3 style="margin:14px 0 6px">指定神仙碎片 · 每个 ${FRAG_PRICE} 灵蕴</h3><p style="margin:0 0 8px;color:var(--mute)">想要哪位神仙来帮忙，就攒灵蕴换他的碎片，3 个碎片合成 3 次召唤。</p>
    <div class="grid">${gods}</div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-buy]'), f = e.target.closest('[data-bf]'); if (!b && !f) return;
  const st = S(); st.buff = st.buff || {};
  if (b) { const g = SHOP.find(x => x.k === b.dataset.buy); if (st.gold < g.price) return; st.gold -= g.price; if (g.k === 'spirit') st.spirit++; else st.buff[g.k] = (st.buff[g.k] || 0) + 1; toast(`换到了 ${g.n}！`); }
  if (f) { Sfx.play('click'); godDetail(f.dataset.bf, true); return; }
  if (false) { const k = f.dataset.bf; if (st.gold < FRAG_PRICE) return; st.gold -= FRAG_PRICE; st.frags[k] = (st.frags[k] || 0) + 1; let msg = `得到 ${DATA.GODS[k]} 碎片`; if (st.frags[k] >= 3) { st.frags[k] -= 3; st.cards[k] = (st.cards[k] || 0) + 3; msg = `${DATA.GODS[k]} 援军卡 +3 次！`; } toast(msg); }
  Sfx.play('drop'); Store.save('state'); renderShop();
});

// ================= 自由修行 =================
function openFree() {
  show('free');
  const subs = ['人文', '思维'];
  const allBanks = Object.keys(Bank.banks());
  let sel = { subj: '', kps: [], banks: (Store.settings.banks || []).filter(b => allBanks.includes(b)) };
  const render = () => {
    const kps = Bank.kps(sel.subj, sel.banks);
    $('#free-body').innerHTML = `<div class="pcard"><h3>选题库（可以多选，不选就是全部）</h3><div class="row">${allBanks.map(b => `<button type="button" class="mini-btn${sel.banks.includes(b) ? ' pri' : ''}" data-bk="${esc(b)}">${esc(b)} · ${Bank.banks()[b]}</button>`).join('')}</div><h3>选科目</h3><div class="row">${['', ...subs].map(s => `<button type="button" class="mini-btn${sel.subj === s ? ' pri' : ''}" data-sub="${s}">${s || '全部'}</button>`).join('')}</div>
      <h3>选考点（可以多选，不选就是全部）</h3><div class="row">${Object.entries(kps).map(([k, n]) => `<button type="button" class="mini-btn${sel.kps.includes(k) ? ' pri' : ''}" data-kp="${esc(k)}">${esc(k)} · ${n}</button>`).join('')}</div>
      <button type="button" class="btn gold" id="free-go" style="justify-self:start">开始修行</button><p>自由修行不扣血，答对一题得 2 灵蕴。练到想停就点左上角返回。</p></div>`;
  };
  render();
  $('#free-body').onclick = e => {
    const bk = e.target.closest('[data-bk]'); if (bk) { const v = bk.dataset.bk; sel.banks = sel.banks.includes(v) ? sel.banks.filter(x => x !== v) : sel.banks.concat(v); sel.kps = []; render(); return; }
    const s = e.target.closest('[data-sub]'); if (s) { sel = { subj: s.dataset.sub, kps: [], banks: sel.banks }; render(); return; }
    const k = e.target.closest('[data-kp]'); if (k) { const v = k.dataset.kp; sel.kps = sel.kps.includes(v) ? sel.kps.filter(x => x !== v) : sel.kps.concat(v); render(); return; }
    if (e.target.closest('#free-go')) {
      const filter = { subj: sel.subj || null, kps: sel.kps, banks: sel.banks.length ? sel.banks : allBanks }; const qs = SRS.pick(10, filter);
      if (!qs.length) return toast('这个考点还没有题');
      Q.curBattle = new Battle({ mode: 'free', title: '自由修行', questions: qs, filter, enemies: [{ k: 'dummy', max: 1e9, hp: 1e9, atk: 0 }] }); Q.curBattle.start();
    }
  };
}

// ================= 真假美猴王 =================
function startMirror(banks) {
  const all = Object.keys(Bank.banks());
  if (!banks && all.length > 1) { const m = $('#modal'); m.hidden = false; const cnt = b => Bank.active([b]).filter(q => (SRS.rec(q.id) || {}).w > 0).length;
    $('#modal .mbox').innerHTML = `<button type="button" class="x" aria-label="关闭">×</button><h2>真假美猴王</h2><p>选一个题库，专门打这个题库里的错题：</p><div class="row">${all.map(b => `<button type="button" class="btn ghost" data-mb="${esc(b)}" ${cnt(b) < 5 ? 'disabled' : ''}>${esc(b)} · 错题 ${cnt(b)}</button>`).join('')}<button type="button" class="btn gold" data-mb="">全部题库</button></div>`;
    $('#modal .x').onclick = () => m.hidden = true; $$('#modal [data-mb]').forEach(b => b.onclick = () => { m.hidden = true; startMirror(b.dataset.mb ? [b.dataset.mb] : all); }); return; }
  const wrong = Bank.active(banks || all).filter(q => (SRS.rec(q.id) || {}).w > 0);
  if (wrong.length < 5) return toast('这个题库答错过的题还不到 5 道');
  const qs = wrong.sort((a, b) => (SRS.rec(a.id).b - SRS.rec(b.id).b) || (SRS.rec(b.id).w - SRS.rec(a.id).w)).slice(0, Store.settings.daily);
  const atk = Gear.stats().tot.atk, max = Math.max(30, Math.round(qs.length * .7 * atk));
  Q.curBattle = new Battle({ mode: 'mirror', title: '真假美猴王', ch: 6, questions: shuffle(qs), enemies: [{ k: 'liuer', max, hp: max, atk: 12, boss: true, intro: '六耳猕猴：我才是真的孙悟空！用你的错题来分辨吧！' }] });
  Q.curBattle.start();
}

// ================= 筋斗云竞速 =================
function startRace() {
  show('race'); Sfx.ensure();
  const sec = Store.settings.raceSec || 60; let left = sec, score = 0, qs = SRS.pick(60), i = 0, timer = null, cur = null, lock = false;
  $('#race-body').innerHTML = `<div class="row" style="justify-content:space-between"><span class="timer" id="r-time">${sec}</span><span class="pill">答对 <b id="r-score">0</b> · 最好 ${S().raceBest}</span></div>
    <div class="race-track"><div class="cloud" id="r-cloud" style="left:0">${Gear.wukong()}</div><div class="flag">灵山</div></div><div id="r-q" class="qpanel"></div>`;
  const draw = () => {
    if (i >= qs.length) qs = qs.concat(SRS.pick(30, { cont: true }));
    cur = qs[i++]; const ord = shuffle(cur.opts.map((_, k) => k));
    $('#r-q').innerHTML = `<div class="qtags"><span class="tag subj">${esc(cur.subj)}</span><span class="tag">${esc(cur.kp)}</span>${cur.ans.length > 1 ? '<span class="tag multi">多选</span>' : ''}</div><div class="qtext">${esc(cur.q)}</div>
      <div class="opts${cur.opts.some(o => o.length > 14) ? ' wide' : ''}">${ord.map((k, j) => `<button type="button" class="opt" data-i="${k}"><span class="lt">${'ABCDEF'[j]}</span><span>${esc(cur.opts[k])}</span></button>`).join('')}</div>${cur.ans.length > 1 ? '<button type="button" class="btn gold confirm" id="r-ok">选好了</button>' : ''}`;
    lock = false;
  };
  const sel = new Set();
  const judge = () => {
    lock = true; const ok = sel.size === cur.ans.length && cur.ans.every(a => sel.has(a)); SRS.record(cur, ok);
    $$('#r-q .opt').forEach(b => { const k = +b.dataset.i; if (cur.ans.includes(k)) b.classList.add('ok'); else if (sel.has(k)) b.classList.add('bad'); });
    if (ok) { score++; Sfx.play('ok'); $('#r-score').textContent = score; $('#r-cloud').style.left = `calc(${Math.min(88, score * 4)}% )`; }
    else Sfx.play('bad');
    sel.clear(); setTimeout(draw, ok ? 350 : 1100);
  };
  $('#r-q').onclick = e => { if (lock) return; const o = e.target.closest('.opt'); if (o) { const k = +o.dataset.i; if (cur.ans.length > 1) { o.classList.toggle('sel'); sel.has(k) ? sel.delete(k) : sel.add(k); return; } sel.add(k); judge(); } if (e.target.closest('#r-ok') && sel.size) judge(); };
  draw();
  timer = setInterval(() => {
    left--; $('#r-time').textContent = left;
    if (left <= 0 || !$('#race').classList.contains('on')) {
      clearInterval(timer); if (!$('#race').classList.contains('on')) return;
      const best = score > S().raceBest; if (best) S().raceBest = score; const g = score; S().gold += g; S().xp += score;
      S().hist.unshift({ d: Date.now(), mode: 'race', t: '筋斗云竞速', n: i, c: score }); Store.save('state'); Store.save('progress');
      Q.showResult({ outcome: 'win', title: '筋斗云竞速', correct: score, answered: i, best: score, gold: g, loot: [], codex: [], mode: 'race' });
      if (best) toast('新纪录！', 3000);
    }
  }, 1000);
}

// ================= 擂台斗法 =================
function openDuelSetup() {
  const d = Store.settings.duel, m = $('#modal'); m.hidden = false;
  const bosses = Object.keys(DATA.E).filter(k => DATA.E[k].kind === 'boss' && k !== 'liuer');
  $('#modal .mbox').innerHTML = `<button type="button" class="x" aria-label="关闭">×</button><h2>擂台斗法</h2>
    <p>两个人同时在一台 iPad 上答题，各答各的，谁先答对够数谁赢。</p>
    <div class="row"><label>对手名字 <input type="text" id="d-name" value="${esc(d.dadName)}" style="width:8em"></label>
      <label>对手扮成 <select id="d-av">${bosses.map(k => `<option value="${k}" ${k === d.dadAvatar ? 'selected' : ''}>${name(k)}</option>`).join('')}</select></label></div>
    <div class="row"><label>悟空要答对 <input type="number" id="d-kid" min="3" max="30" value="${d.kid}" style="width:5em"> 题</label>
      <label>对手要答对 <input type="number" id="d-dad" min="3" max="40" value="${d.dad}" style="width:5em"> 题</label></div>
    <div class="row"><label>对手的题目 <select id="d-src"><option value="same" ${d.dadSrc === 'same' ? 'selected' : ''}>和孩子一样的题库</option><option value="hard" ${d.dadSrc === 'hard' ? 'selected' : ''}>更难的题（难度 2 以上）</option><option value="think" ${d.dadSrc === 'think' ? 'selected' : ''}>只出思维题</option></select></label>
      <label>对手答错扣 <input type="number" id="d-pen" min="0" max="3" value="${d.dadPenalty}" style="width:4em"> 分</label></div>
    <label class="row"><input type="checkbox" id="d-face" ${d.face ? 'checked' : ''}> 面对面坐（上下分屏，对手那一半倒过来）</label>
    <button type="button" class="btn gold" id="d-go">开始比赛</button>`;
  $('#modal .x').onclick = () => m.hidden = true;
  $('#d-go').onclick = () => {
    Object.assign(d, { dadName: $('#d-name').value || '爸爸', dadAvatar: $('#d-av').value, kid: +$('#d-kid').value || 10, dad: +$('#d-dad').value || 14, dadSrc: $('#d-src').value, dadPenalty: +$('#d-pen').value || 0, face: $('#d-face').checked });
    Store.save('settings'); m.hidden = true; startDuel();
  };
}
function startDuel() {
  const d = Store.settings.duel; show('duel'); Sfx.ensure();
  $('#duel-wrap').classList.toggle('face', !!d.face);
  const ar = Q.duelAr || (Q.duelAr = makeArena($('#duel-arena'))); ar.fit(); ar.caption('');
  ar.put(ar.L, Gear.wukong()); ar.put(ar.R, C[d.dadAvatar]());
  const kidQs = SRS.pick(80);
  let dadPool = Bank.active().filter(q => d.dadSrc === 'think' ? q.subj === '思维' : d.dadSrc === 'hard' ? (q.d || 1) >= 2 : true);
  if (dadPool.length < 10) dadPool = Bank.active().slice();
  const P = [{ id: 'p1', nm: Store.settings.name, av: 'wukong', target: d.kid, score: 0, qs: kidQs, i: 0, pen: 0 }, { id: 'p2', nm: d.dadName, av: d.dadAvatar, target: d.dad, score: 0, qs: shuffle(dadPool), i: 0, pen: d.dadPenalty }];
  let over = false, animBusy = false;
  const head = p => `<div class="side-head">${p.av === 'wukong' ? Gear.wukong() : C[p.av]()}<b>${esc(p.nm)}</b><span class="score">${p.score}/${p.target}</span></div><div class="bar"><i style="width:${Math.min(100, p.score / p.target * 100)}%"></i></div>`;
  const draw = p => {
    const el = $('#duel-' + p.id); if (p.i >= p.qs.length) p.qs = p.qs.concat(shuffle(p.qs)); const q = p.cur = p.qs[p.i++]; p.sel = new Set(); p.lock = false;
    const ord = shuffle(q.opts.map((_, k) => k));
    el.innerHTML = head(p) + `<div class="qtags"><span class="tag">${esc(q.kp)}</span>${q.ans.length > 1 ? '<span class="tag multi">多选</span>' : ''}</div><div class="qtext">${esc(q.q)}</div><div class="opts wide">${ord.map((k, j) => `<button type="button" class="opt" data-i="${k}"><span class="lt">${'ABCDEF'[j]}</span><span>${esc(q.opts[k])}</span></button>`).join('')}</div>${q.ans.length > 1 ? '<button type="button" class="btn gold confirm" data-ok="1">选好了</button>' : ''}`;
  };
  const anim = async (atkL) => { if (animBusy) return; animBusy = true; try { if (atkL) await MV.wk_normal.run(ar, ar.L, ar.R); else await MV[d.dadAvatar].run(ar, ar.R, ar.L); } catch (e) { } ar.L.fresh(); ar.R.fresh(); animBusy = false; };
  const judge = async p => {
    const q = p.cur, ok = p.sel.size === q.ans.length && q.ans.every(a => p.sel.has(a)); p.lock = true;
    const el = $('#duel-' + p.id);
    $$('.opt', el).forEach(b => { const k = +b.dataset.i; if (q.ans.includes(k)) b.classList.add('ok'); else if (p.sel.has(k)) b.classList.add('bad'); });
    if (p.id === 'p1') SRS.record(q, ok);
    if (ok) { p.score++; Sfx.play('ok'); el.classList.remove('flash-ok'); void el.offsetWidth; el.classList.add('flash-ok'); anim(p.id === 'p1'); }
    else { p.score = Math.max(0, p.score - p.pen); Sfx.play('bad'); el.classList.remove('flash-bad'); void el.offsetWidth; el.classList.add('flash-bad'); }
    if (p.score >= p.target && !over) { over = true; return end(p); }
    setTimeout(() => !over && draw(p), ok ? 450 : 1300);
  };
  const end = async w => {
    $('#duel-mid').textContent = `${w.nm} 赢了！`;
    while (animBusy) await sleep(100);
    if (w.id === 'p1') { Sfx.play('finish'); await MV.wk_finish.run(ar, ar.L, ar.R); ar.caption(`${name(d.dadAvatar)}（${d.dadName}）被收服了！`); S().gold += 20; S().xp += P[0].score; Sfx.play('win'); }
    else { await MV[d.dadAvatar].run(ar, ar.R, ar.L); ar.caption(`${d.dadName} 赢了这一局，再来一局吧！`); }
    S().hist.unshift({ d: Date.now(), mode: 'duel', t: '擂台斗法', n: P[0].i, c: P[0].score, r: w.id === 'p1' ? 'win' : 'lose' }); Store.save('state'); Store.save('progress');
    ['p1', 'p2'].forEach(id => { const el = $('#duel-' + id); el.innerHTML = head(P.find(x => x.id === id)) + `<div class="row" style="justify-content:center;margin-top:20px"><button type="button" class="btn gold" data-again="1">再来一局</button><button type="button" class="btn ghost" data-home="1">回花果山</button></div>`; });
  };
  P.forEach(draw); $('#duel-mid').textContent = `先答对 ${d.kid} 题的悟空 VS 先答对 ${d.dad} 题的${d.dadName}`;
  P.forEach(p => { $('#duel-' + p.id).onclick = e => {
    if (e.target.closest('[data-again]')) return startDuel(); if (e.target.closest('[data-home]')) return goHome();
    if (over || p.lock) return; const o = e.target.closest('.opt');
    if (o) { const k = +o.dataset.i; if (p.cur.ans.length > 1) { o.classList.toggle('sel'); p.sel.has(k) ? p.sel.delete(k) : p.sel.add(k); return; } p.sel.add(k); judge(p); }
    if (e.target.closest('[data-ok]') && p.sel.size) judge(p);
  }; });
}

// ================= 返回按钮 =================
document.addEventListener('click', e => { if (e.target.closest('[data-home-btn]')) { Sfx.play('click'); goHome(); } });
Object.assign(Q, { openMap, openBag, openCodex, openCards, startStage });
})();

/* 取经小英雄 · 取经路世界地图：一整张横向卷轴，每章一种地貌，通关一关师徒往前走一步 */
(function(){
'use strict';
const Q = window.QJ;
const { C, DATA, an, sleep, $, esc, Store, Sfx, STAGES, stageUnlocked, name, show } = Q;
const S = () => Store.state;
const H = 600, STEP = 230, PADX = 150;
const O = '#3a2618';

// ---------- 地貌小零件 ----------
const hill = (x, y, w, h, c, c2) => `<path d="M${x - w / 2} ${y} Q${x - w / 4} ${y - h * 1.05} ${x} ${y - h} Q${x + w / 4} ${y - h * 1.05} ${x + w / 2} ${y} Z" fill="${c}" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>${c2 ? `<path d="M${x - w * .12} ${y - h * .82} Q${x} ${y - h * 1.02} ${x + w * .14} ${y - h * .8} L${x + w * .06} ${y - h * .7} L${x} ${y - h * .78} L${x - w * .06} ${y - h * .68} Z" fill="${c2}"/>` : ''}`;
const peak = (x, y, w, h, c, snow) => `<path d="M${x - w / 2} ${y} L${x - w * .08} ${y - h} L${x + w * .06} ${y - h * .9} L${x + w / 2} ${y} Z" fill="${c}" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>${snow ? `<path d="M${x - w * .19} ${y - h * .72} L${x - w * .08} ${y - h} L${x + w * .06} ${y - h * .9} L${x + w * .16} ${y - h * .7} L${x + w * .04} ${y - h * .76} L${x - w * .06} ${y - h * .66} Z" fill="${snow}"/>` : ''}`;
const tree = (x, y, s = 1, c = '#4caf50') => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-4" y="-18" width="8" height="20" fill="#795548" stroke="${O}" stroke-width="2"/><circle cx="0" cy="-30" r="18" fill="${c}" stroke="${O}" stroke-width="2.5"/><circle cx="-6" cy="-36" r="5" fill="#fff" opacity=".25"/></g>`;
const pine = (x, y, s = 1, c = '#2e7d32') => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-3" y="-12" width="6" height="14" fill="#6d4c41"/><path d="M0 -60 L18 -26 L8 -26 L22 -6 L-22 -6 L-8 -26 L-18 -26 Z" fill="${c}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/></g>`;
const cloud = (x, y, s = 1, c = '#fff') => `<g transform="translate(${x} ${y}) scale(${s})" opacity=".92"><path d="M-40 10 C-56 10 -56 -10 -38 -10 C-36 -26 -12 -28 -6 -16 C2 -32 30 -28 30 -12 C46 -14 52 10 34 10 Z" fill="${c}" stroke="#b0c4d4" stroke-width="2.5"/></g>`;
const house = (x, y, s = 1, roof = '#c0392b', wall = '#fff3e0') => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-26" y="-34" width="52" height="34" fill="${wall}" stroke="${O}" stroke-width="2.5"/><rect x="-7" y="-20" width="14" height="20" fill="#8d6e63" stroke="${O}" stroke-width="2"/><path d="M-36 -32 Q0 -44 36 -32 L26 -52 L-26 -52 Z" fill="${roof}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/></g>`;
const city = (x, y, s = 1, roof = '#c0392b') => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-90" y="-50" width="180" height="50" fill="#d7ccc8" stroke="${O}" stroke-width="3"/>${[-80, -56, -32, -8, 16, 40, 64].map(i => `<rect x="${i}" y="-60" width="14" height="12" fill="#d7ccc8" stroke="${O}" stroke-width="2"/>`).join('')}<path d="M-18 0 v-30 a18 18 0 0 1 36 0 v30 Z" fill="#5d4037" stroke="${O}" stroke-width="2.5"/><rect x="-44" y="-92" width="88" height="34" fill="#fff3e0" stroke="${O}" stroke-width="2.5"/><path d="M-60 -88 Q0 -104 60 -88 L44 -112 L-44 -112 Z" fill="${roof}" stroke="${O}" stroke-width="3" stroke-linejoin="round"/></g>`;
const temple = (x, y, s = 1, roof = '#f2b632', wall = '#d1452f') => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-60" y="-8" width="120" height="8" fill="#e0e0e0" stroke="${O}" stroke-width="2"/><rect x="-44" y="-56" width="88" height="48" fill="${wall}" stroke="${O}" stroke-width="2.5"/>${[-30, -10, 10, 30].map(i => `<rect x="${i - 3}" y="-56" width="6" height="48" fill="#8d2c1f"/>`).join('')}<path d="M-62 -54 Q0 -70 62 -54 L46 -78 L-46 -78 Z" fill="${roof}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/><rect x="-26" y="-96" width="52" height="20" fill="${wall}" stroke="${O}" stroke-width="2.5"/><path d="M-40 -94 Q0 -106 40 -94 L28 -112 L-28 -112 Z" fill="${roof}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="0" cy="-118" r="6" fill="${roof}" stroke="${O}" stroke-width="2"/></g>`;
const pagoda = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">${[0, 1, 2, 3, 4].map(i => `<rect x="${-20 + i * 2.5}" y="${-26 - i * 26}" width="${40 - i * 5}" height="22" fill="#fff3e0" stroke="${O}" stroke-width="2"/><path d="M${-30 + i * 3} ${-24 - i * 26} Q0 ${-32 - i * 26} ${30 - i * 3} ${-24 - i * 26} L${22 - i * 3} ${-32 - i * 26} L${-22 + i * 3} ${-32 - i * 26} Z" fill="#6d4c41" stroke="${O}" stroke-width="2"/>`).join('')}<path d="M0 -160 v-18" stroke="${O}" stroke-width="3"/></g>`;
const flame = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0 C-22 0 -26 -26 -10 -40 C-12 -26 -2 -24 -2 -34 C-2 -52 10 -58 8 -76 C26 -60 30 -30 22 -14 C20 -4 12 0 0 0 Z" fill="#ff7043" stroke="#bf360c" stroke-width="2.5"/><path d="M0 -4 C-12 -4 -12 -20 -4 -26 C-4 -18 4 -18 4 -24 C14 -16 12 -4 0 -4 Z" fill="#ffd54f"/></g>`;
const web = (x, y, r) => `<g transform="translate(${x} ${y})" stroke="#fff" stroke-width="1.6" fill="none" opacity=".85">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<path d="M0 0 L${Math.cos(i * Math.PI / 4) * r} ${Math.sin(i * Math.PI / 4) * r}"/>`).join('')}${[.35, .65, .95].map(k => `<polygon points="${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `${Math.cos(i * Math.PI / 4) * r * k},${Math.sin(i * Math.PI / 4) * r * k}`).join(' ')}"/>`).join('')}</g>`;
const bones = (x, y) => `<g transform="translate(${x} ${y})" fill="#fafafa" stroke="${O}" stroke-width="2"><path d="M-20 0 h40 M-24 -4 a4 4 0 1 0 0 8 M24 -4 a4 4 0 1 1 0 8" /><circle cx="-34" cy="-12" r="10"/><circle cx="-37" cy="-13" r="2.4" fill="${O}"/><circle cx="-31" cy="-13" r="2.4" fill="${O}"/></g>`;
const water = (x1, x2, y, h, c = '#64b5f6', ice) => `<path d="M${x1} ${y} Q${(x1 + x2) / 2} ${y - 14} ${x2} ${y} L${x2} ${y + h} Q${(x1 + x2) / 2} ${y + h + 14} ${x1} ${y + h} Z" fill="${c}" stroke="${O}" stroke-width="3"/>${Array.from({ length: Math.floor((x2 - x1) / 70) }, (_, i) => ice ? `<path d="M${x1 + 30 + i * 70} ${y + h * .3} l18 10 l-8 14 l20 6" fill="none" stroke="#fff" stroke-width="2.5"/>` : `<path d="M${x1 + 24 + i * 70} ${y + h * .45} q10 -8 20 0 t20 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`).join('')}`;
const dune = (x, y, w, h, c = '#ffe082') => `<path d="M${x - w / 2} ${y} Q${x} ${y - h * 2} ${x + w / 2} ${y} Z" fill="${c}" stroke="${O}" stroke-width="2.5"/>`;
const rock = (x, y, s = 1, c = '#9e9e9e') => `<path transform="translate(${x} ${y}) scale(${s})" d="M-24 0 L-18 -20 L4 -28 L22 -14 L26 0 Z" fill="${c}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>`;
const lotus = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">${[-2, -1, 0, 1, 2].map(i => `<path d="M0 0 C${i * 10 - 10} -14 ${i * 12 - 4} -34 ${i * 10} -40 C${i * 12 + 4} -34 ${i * 10 + 10} -14 0 0 Z" fill="${i ? '#f8bbd0' : '#f48fb1'}" stroke="${O}" stroke-width="2"/>`).join('')}</g>`;

// ---------- 每章的风景 ----------
// 背景颜色 [天空上, 天空下, 远山, 地面]
const THEME = [
  { sky: ['#bfe6ff', '#e8f6ff'], far: '#a5d6a7', gnd: '#c5e1a5', deco(w) { return peak(w * .14, 330, 300, 220, '#8d6e63', '#bcaaa4') + `<text x="${w * .14}" y="230" font-size="22" text-anchor="middle" fill="#fff" font-family="ZCOOL KuaiLe">五行山</text>` + water(w * .28, w * .44, 470, 46) + hill(w * .55, 330, 260, 120, '#66bb6a', '#a5d6a7') + house(w * .64, 330, 1) + house(w * .7, 336, .8, '#8d6e63') + dune(w * .86, 340, 280, 80) + dune(w * .95, 345, 200, 60, '#ffd54f') + tree(w * .4, 330) + tree(w * .46, 336, .8) + pine(w * .58, 520, 1.1) + tree(w * .03, 520, 1.2); } },
  { sky: ['#cfd8dc', '#eceff1'], far: '#b0bec5', gnd: '#d7ccc8', deco(w) { return peak(w * .15, 330, 260, 180, '#90a4ae', '#eceff1') + peak(w * .3, 330, 200, 140, '#78909c') + bones(w * .22, 520) + bones(w * .36, 530) + cloud(w * .2, 170, 1.2, '#eceff1') + city(w * .74, 340, 1.1, '#5c6bc0') + pine(w * .5, 330, 1.2, '#455a64') + pine(w * .55, 334, 1, '#546e7a'); } },
  { sky: ['#ffe0b2', '#fff8e1'], far: '#bcaaa4', gnd: '#d7ccc8', deco(w) { return peak(w * .2, 330, 340, 200, '#a1887f') + peak(w * .62, 330, 380, 240, '#8d6e63', '#d7ccc8') + `<path d="M${w * .62 - 30} 330 v-40 a30 30 0 0 1 60 0 v40 Z" fill="#3e2723" stroke="${O}" stroke-width="3"/>` + lotus(w * .62, 286, .8) + lotus(w * .36, 520, .9) + pine(w * .42, 334) + pine(w * .9, 334, 1.2); } },
  { sky: ['#ffccbc', '#fff3e0'], far: '#ffab91', gnd: '#e6c89c', deco(w) { return city(w * .2, 340, 1, '#ffb300') + `<ellipse cx="${w * .34}" cy="520" rx="30" ry="12" fill="#5d4037" stroke="${O}" stroke-width="3"/>` + peak(w * .55, 330, 260, 180, '#e64a19') + flame(w * .55, 220, .7) + flame(w * .5, 330, .8) + flame(w * .6, 332, .6) + water(w * .74, w * .98, 470, 50, '#37474f'); } },
  { sky: ['#e1f5fe', '#ffffff'], far: '#b3e5fc', gnd: '#e3f2fd', deco(w) { return city(w * .2, 340, 1.1, '#7e57c2') + pagoda(w * .36, 340, .8) + water(w * .55, w * .98, 460, 70, '#b3e5fc', true) + peak(w * .7, 330, 240, 170, '#90caf9', '#fff') + peak(w * .88, 330, 220, 150, '#64b5f6', '#fff') + pine(w * .47, 336, 1, '#1b5e20'); } },
  { sky: ['#ffab91', '#ffe0b2'], far: '#ef9a9a', gnd: '#ffcc80', deco(w) { return peak(w * .14, 330, 260, 190, '#8d6e63', '#d7ccc8') + `<path d="M${w * .3} 330 v-46 a26 26 0 0 1 52 0 v46 Z" fill="#4e342e" stroke="${O}" stroke-width="3"/>` + [0, 1, 2, 3, 4].map(i => flame(w * (.48 + i * .055), 336 + (i % 2) * 6, .9 + (i % 2) * .3)).join('') + peak(w * .78, 330, 260, 170, '#6d4c41') + water(w * .86, w * .99, 480, 46, '#4db6ac'); } },
  { sky: ['#fff9c4', '#fffde7'], far: '#c5e1a5', gnd: '#dcedc8', deco(w) { return temple(w * .16, 340, 1.1, '#9e9e9e', '#6d4c41') + city(w * .42, 340, 1, '#8e24aa') + `<path d="M${w * .66} 330 v-60 a40 40 0 0 1 80 0 v60 Z" fill="#5d4037" stroke="${O}" stroke-width="3"/>` + web(w * .66 + 40, 270, 50) + house(w * .88, 334, 1, '#ffb300') + tree(w * .54, 334, 1.1) + tree(w * .97, 520); } },
  { sky: ['#b39ddb', '#d1c4e9'], far: '#7e57c2', gnd: '#bcaaa4', deco(w) { return peak(w * .12, 330, 300, 230, '#4e342e', '#8d6e63') + peak(w * .36, 330, 320, 260, '#3e2723', '#6d4c41') + city(w * .74, 340, 1.2, '#311b92') + bones(w * .24, 530) + bones(w * .5, 524) + rock(w * .6, 520, 1.2, '#795548') + cloud(w * .45, 150, 1.1, '#ede7f6'); } },
  { sky: ['#fff59d', '#fffde7'], far: '#ffe082', gnd: '#fff3c4', deco(w) { return city(w * .12, 340, 1, '#ef6c00') + `<path d="M${w * .34} 330 v-30 a18 18 0 0 1 36 0 v30 Z" fill="#212121" stroke="${O}" stroke-width="3"/>` + city(w * .52, 340, 1, '#c2185b') + temple(w * .84, 340, 1.6) + cloud(w * .76, 300, 1.3) + cloud(w * .92, 290, 1.1) + cloud(w * .84, 140, 1.4, '#fffde7') + `<circle cx="${w * .84}" cy="170" r="90" fill="#fff59d" opacity=".45"/>` + lotus(w * .7, 520, 1) + lotus(w * .96, 526, .8); } },
];

// 白龙马（小白龙变的白马，配红鞍）
const HORSE = `<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg"><g stroke="${O}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
  <path d="M46 128 C30 132 22 150 26 172 C34 160 40 150 50 144 Z" fill="#eceff1"/>
  <rect x="58" y="160" width="14" height="46" rx="6" fill="#fafafa"/><rect x="80" y="164" width="14" height="42" rx="6" fill="#eceff1"/>
  <rect x="118" y="164" width="14" height="42" rx="6" fill="#eceff1"/><rect x="140" y="160" width="14" height="46" rx="6" fill="#fafafa"/>
  <path d="M58 202 h14 M80 202 h14 M118 202 h14 M140 202 h14" stroke-width="7"/>
  <ellipse cx="104" cy="148" rx="58" ry="30" fill="#fafafa"/>
  <path d="M138 138 C146 112 150 96 158 84 L180 92 C176 108 166 126 156 150 Z" fill="#fafafa"/>
  <path d="M150 78 C160 62 184 62 192 76 C198 88 194 100 184 104 L162 102 C154 96 150 88 150 78 Z" fill="#fafafa"/>
  <path d="M158 66 L162 50 L170 64 Z" fill="#fafafa"/>
  <path d="M154 74 C146 86 142 100 136 116 C142 104 146 96 152 92 C146 104 142 116 140 126" fill="none" stroke="#b0bec5" stroke-width="6"/>
  <path d="M80 122 h48 l6 26 h-60 Z" fill="#c62828"/><path d="M78 148 h58" stroke="#f2b632" stroke-width="5"/>
  <path d="M104 148 v20" stroke="#f2b632" stroke-width="3"/>
</g><circle cx="180" cy="80" r="4" fill="${O}"/><circle cx="181" cy="79" r="1.4" fill="#fff"/><ellipse cx="190" cy="94" rx="2.4" ry="2" fill="${O}"/><ellipse cx="176" cy="90" rx="5" ry="3" fill="#ffcdd2"/></svg>`;

// ---------- 布局 ----------
function layout() {
  const chs = []; let x = 0, gi = 0;
  DATA.CH.forEach((ch, ci) => {
    const w = PADX * 2 + STEP * (ch.stages.length - 1) + 120;
    const nodes = ch.stages.map((s, j) => { const nx = x + PADX + 60 + j * STEP, ny = 410 + Math.sin((gi + j) * 1.25) * 42; return { s, x: nx, y: ny, gi: gi + j }; });
    chs.push({ ch, ci, x, w, nodes }); x += w; gi += ch.stages.length;
  });
  return { chs, W: x, nodes: chs.flatMap(c => c.nodes) };
}
const strip = svg => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const sprite = (html, x, y, w, cls = '') => `<svg class="${cls}" x="${x - w / 2}" y="${y - w * 1.1}" width="${w}" height="${w * 1.1}" viewBox="0 0 200 220" overflow="visible">${strip(html)}</svg>`;

function curIndex() {
  let i = STAGES.findIndex((s, k) => stageUnlocked(k) && !S().cleared[s.id]);
  return i < 0 ? STAGES.length - 1 : i;
}

function render() {
  const L = layout(), st = S(), cur = curIndex();
  let firstLocked = DATA.CH.findIndex((ch, ci) => !stageUnlocked(STAGES.findIndex(s => s.id === ch.stages[0].id)));
  if (firstLocked < 0) firstLocked = 99;
  let g = `<defs><filter id="wm-gray"><feColorMatrix type="saturate" values="0.05"/></filter><filter id="wm-sil"><feFlood flood-color="#23232b"/><feComposite in2="SourceAlpha" operator="in"/></filter>
    <pattern id="wm-grass" width="40" height="30" patternUnits="userSpaceOnUse"><path d="M6 24 q2 -8 4 0 M24 16 q2 -8 4 0" stroke="#000" stroke-opacity=".08" stroke-width="2" fill="none"/></pattern></defs>`;
  L.chs.forEach(c => {
    const T = THEME[c.ci] || THEME[0], locked = c.ci >= firstLocked;
    g += `<g class="wm-ch${locked ? ' locked' : ''}" ${locked ? 'filter="url(#wm-gray)"' : ''}>
      <defs><linearGradient id="wm-sky${c.ci}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.sky[0]}"/><stop offset="1" stop-color="${T.sky[1]}"/></linearGradient></defs>
      <rect x="${c.x}" y="0" width="${c.w + 2}" height="${H}" fill="url(#wm-sky${c.ci})"/>
      <path d="M${c.x} 330 ${Array.from({ length: 8 }, (_, i) => `Q${c.x + c.w * (i + .5) / 8} ${250 + (i % 2) * 40} ${c.x + c.w * (i + 1) / 8} 330`).join(' ')} V${H} H${c.x} Z" fill="${T.far}" opacity=".7"/>
      <rect x="${c.x}" y="330" width="${c.w + 2}" height="${H - 330}" fill="${T.gnd}"/><rect x="${c.x}" y="330" width="${c.w + 2}" height="${H - 330}" fill="url(#wm-grass)"/>
      <g transform="translate(${c.x} 0)">${T.deco(c.w)}</g>
      ${cloud(c.x + c.w * .35, 70, .9)}${cloud(c.x + c.w * .8, 110, .7)}
    </g>`;
  });
  // 章节之间的分界和章名
  L.chs.forEach(c => {
    const locked = c.ci >= firstLocked, [num, nm] = c.ch.n.split(' · ');
    g += `<g class="wm-banner"><path d="M${c.x + 20} 22 h${Math.min(c.w - 40, 330)} l-14 22 l14 22 h-${Math.min(c.w - 40, 330)} Z" fill="${locked ? '#9e9e9e' : '#8d2c1f'}" stroke="${O}" stroke-width="3"/>
      <text x="${c.x + 36}" y="53" font-size="24" fill="#fff8dc" font-family="ZCOOL KuaiLe, sans-serif">${esc(num)} · ${esc(nm)}</text></g>`;
    if (c.ci) g += `<path d="M${c.x} 0 V${H}" stroke="#fff" stroke-width="3" stroke-dasharray="10 10" opacity=".7"/>`;
    if (locked) g += `<g class="wm-lock"><rect x="${c.x}" y="0" width="${c.w}" height="${H}" fill="#fff" opacity=".25"/><g filter="url(#wm-sil)" opacity=".35">${sprite(C[c.ch.stages[c.ch.stages.length - 1].boss](), c.x + c.w / 2, 330, 300)}</g>${cloud(c.x + c.w / 2 - 80, 180, 1.6, '#f5f5f5')}${cloud(c.x + c.w / 2 + 90, 200, 1.4, '#f5f5f5')}
      <g transform="translate(${c.x + c.w / 2} 180)"><rect x="-80" y="-28" width="160" height="56" rx="28" fill="#616161" stroke="${O}" stroke-width="3"/><text x="0" y="10" text-anchor="middle" font-size="26" fill="#fff" font-family="ZCOOL KuaiLe, sans-serif">未解锁</text></g></g>`;
  });
  // 取经路
  const pts = L.nodes;
  let d = `M${pts[0].x - 120} ${pts[0].y + 30}`;
  pts.forEach((p, i) => { const q = pts[i - 1] || { x: p.x - 120, y: p.y + 30 }; const mx = (q.x + p.x) / 2; d += ` C${mx} ${q.y} ${mx} ${p.y} ${p.x} ${p.y}`; });
  g += `<path d="${d}" fill="none" stroke="#a1785a" stroke-width="30" stroke-linecap="round" opacity=".9"/><path d="${d}" fill="none" stroke="#e8cfa0" stroke-width="20" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff8e1" stroke-width="3" stroke-dasharray="4 14" stroke-linecap="round"/>`;
  // 关卡点
  pts.forEach(p => {
    const i = STAGES.findIndex(x => x.id === p.s.id), un = stageUnlocked(i), done = st.cleared[p.s.id], isCur = i === cur && !done;
    const boss = C[p.s.boss] ? C[p.s.boss]() : C.dummy();
    g += `<g class="wm-node${un ? '' : ' lock'}${isCur ? ' cur' : ''}${done ? ' done' : ''}" data-s="${p.s.id}" role="button" aria-label="${esc(p.s.n)}" tabindex="${un ? 0 : -1}">
      <ellipse cx="${p.x}" cy="${p.y + 6}" rx="44" ry="18" fill="#000" opacity=".15"/>
      <circle cx="${p.x}" cy="${p.y}" r="30" fill="${done ? '#2f7d6b' : un ? '#f2b632' : '#9e9e9e'}" stroke="${O}" stroke-width="4"/>
      ${done ? `<path d="M${p.x - 12} ${p.y} l8 9 l16 -18" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` : un ? `<text x="${p.x}" y="${p.y + 9}" text-anchor="middle" font-size="26" font-weight="900" fill="${O}">${i + 1}</text>` : `<path d="M${p.x - 9} ${p.y - 2} v-7 a9 9 0 0 1 18 0 v7" fill="none" stroke="#fff" stroke-width="4"/><rect x="${p.x - 13}" y="${p.y - 3}" width="26" height="18" rx="4" fill="#fff"/>`}
      ${done && (st.allies || []).includes(p.s.boss) ? '' : un ? sprite(boss, p.x, p.y - 34, 100, 'wm-boss') :`<g filter="url(#wm-sil)" opacity=".75">${sprite(boss, p.x, p.y - 34, 100, 'wm-boss')}</g>`}
      <rect x="${p.x - 62}" y="${p.y + 40}" width="124" height="30" rx="15" fill="${un ? '#fffaf0' : '#e0e0e0'}" stroke="${O}" stroke-width="2.5"/>
      <text x="${p.x}" y="${p.y + 62}" text-anchor="middle" font-size="18" fill="${O}" font-family="ZCOOL KuaiLe, sans-serif">${esc(p.s.n.length > 6 ? p.s.n.slice(0, 6) : p.s.n)}</text>
      ${done > 1 ? `<text x="${p.x + 34}" y="${p.y - 22}" font-size="15" font-weight="700" fill="#2f7d6b">×${done}</text>` : ''}
    </g>`;
  });
  // 师徒
  // 取经队伍：悟空打头；收了白龙马，唐僧就骑上马；收了八戒、沙僧，他们跟在后面
  const al = S().allies || [];
  const mem = (html, x, w, dl) => `<g class="wm-bob" style="animation-delay:-${dl}s">${sprite(html, x, 0, w)}</g>`;
  let tm = mem(Q.Gear.wukong(), 30, 100, 0);
  if (al.includes('bailong')) tm += `<g class="wm-bob" style="animation-delay:-.3s">${sprite(HORSE, -52, 0, 112)}${sprite(C.tangseng(), -46, -40, 84)}</g>`;
  else tm += mem(C.tangseng(), -40, 92, .3);
  let bx = al.includes('bailong') ? -140 : -112;
  if (al.includes("bajie")) { tm += mem(C.bajie(), bx, 86, .6); bx -= 70; }
  if (al.includes("shaseng")) tm += mem(C.shaseng(), bx, 86, .9);
  const team = `<g class="wm-team">${tm}</g>`;
  g += team;
  return { svg: `<svg class="wm" viewBox="0 0 ${L.W} ${H}" width="${L.W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`, L, cur };
}

function teamAt(L, i) { const p = L.nodes[Math.max(0, Math.min(L.nodes.length - 1, i))]; return { x: p.x - 118, y: p.y + 4 }; }

async function openMap() {
  show('map');
  const box = $('#map-list'); box.classList.add('wm-wrap');
  const { svg, L, cur } = render();
  box.innerHTML = svg;
  const sv = box.querySelector('svg.wm'), team = sv.querySelector('.wm-team');
  const fit = () => { const bh = box.clientHeight || 500, h = Math.min(bh, innerWidth < 600 ? 520 : 720), sc = h / H; sv.style.height = h + 'px'; sv.style.width = (L.W * sc) + 'px'; sv.style.marginTop = Math.max(0, (bh - h) / 2) + 'px'; return sc; };
  let sc = fit();
  let from = S().mapPos; if (from == null || from > cur) from = cur;
  const place = i => { const t = teamAt(L, i); team.setAttribute('transform', `translate(${t.x} ${t.y})`); };
  const scrollTo = (i, smooth) => { const t = teamAt(L, i); box.scrollTo({ left: Math.max(0, t.x * sc - box.clientWidth * .4), behavior: smooth ? 'smooth' : 'auto' }); };
  place(from); scrollTo(from, false);
  const token = openMap.tok = {};
  if (from < cur) {
    await sleep(600);
    for (let i = from; i < cur; i++) {
      if (openMap.tok !== token) return;
      const a = teamAt(L, i), b = teamAt(L, i + 1);
      scrollTo(i + 1, true);
      team.classList.add('walking'); Sfx.play('click');
      await an(team, [{ transform: `translate(${a.x}px,${a.y}px)` }, { transform: `translate(${(a.x + b.x) / 2}px,${Math.min(a.y, b.y) - 30}px)` }, { transform: `translate(${b.x}px,${b.y}px)` }], 1300, { easing: 'ease-in-out', fill: 'none' });
      place(i + 1); team.classList.remove('walking');
      const nd = sv.querySelector(`.wm-node[data-s="${STAGES[i + 1].id}"]`);
      if (nd) an(nd, [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], 500, { fill: 'none' });
    }
    if (STAGES[cur] && STAGES[from] && STAGES[cur].ch !== STAGES[from].ch) Q.toast(`新的一章解锁了：${DATA.CH[STAGES[cur].ch - 1].n}`, 3000);
  }
  S().mapPos = cur; Store.save('state');
  addEventListener('resize', () => { if ($('#map').classList.contains('on')) { sc = fit(); } }, { once: true });
}
document.addEventListener('click', e => {
  const b = e.target.closest('#map-list .wm-node'); if (!b || b.classList.contains('lock')) return;
  Sfx.play('click'); Q.openIntro(STAGES.find(s => s.id === b.dataset.s));
});
Q.worldMap = openMap;
})();

/* 取经小英雄 · 主程序（四）：家长中心、启动 */
(function(){
'use strict';
const Q = window.QJ;
const { C, G, DATA, $, $$, esc, today, Store, Bank, SRS, Sfx, toast, show, goHome, dayOf } = Q;

const TPL = `请针对这道题的同一知识点，出 5 道类似的选择题。题目要适合 5 岁、已经认识很多字的孩子。
严格按下面的格式输出，每题之间用 --- 分隔，不要输出别的内容：

科目：人文
考点：汉字结构
题目：汉字“明”是什么结构的汉字？
A. 独体字
B. 左右结构
C. 上下结构
答案：B
讲解：“明”= 日 + 月，左右两部分，是左右结构。
---`;

// ---------- 解析导入文本 ----------
function parseImport(text) {
  const out = [], errs = [];
  let blocks = text.replace(/\r/g, '').split(/\n\s*[-—–=]{3,}\s*(?:\n|$)/);
  if (blocks.length === 1) blocks = text.replace(/\r/g, '').split(/\n(?=\s*(?:\d+[\.、]\s*)?科目[:：])/);
  blocks.forEach((b, bi) => {
    const lines = b.split('\n').map(l => l.trim()).filter(Boolean); if (!lines.length) return;
    const q = { subj: '人文', kp: '未分类', q: '', opts: [], ans: [], exp: '', src: '妈妈出题', d: 1 }; let last = null;
    for (const l of lines) {
      let m;
      if ((m = l.match(/^(?:\d+[\.、]\s*)?(科目|考点|题目|答案|讲解|解析|提示|来源|难度|图片|题库)[:：]\s*(.*)$/))) {
        const [, k, v] = m; last = k;
        if (k === '科目') q.subj = /思|数/.test(v) ? '思维' : '人文';
        if (k === '考点') q.kp = v || '未分类';
        if (k === '题目') q.q = v;
        if (k === '答案') q.ansRaw = v;
        if (k === '讲解' || k === '解析') q.exp = v;
        if (k === '提示') q.hint = v;
        if (k === '来源') q.src = v;
        if (k === '难度') q.d = Math.max(1, Math.min(3, parseInt(v) || 1));
        if (k === '图片') q.img = v;
        if (k === '题库') q.bank = v;
      } else if ((m = l.match(/^[(（]?([A-Fa-f])[)）]?[\.．、:：\s]\s*(.+)$/))) { q.opts.push(m[2].trim()); last = 'opt'; }
      else if (last === '题目') q.q += l; else if (last === '讲解' || last === '解析') q.exp += l; else if (!q.q) q.q = l;
    }
    const letters = (q.ansRaw || '').toUpperCase().match(/[A-F]/g) || [];
    q.ans = [...new Set(letters.map(c => c.charCodeAt(0) - 65))].filter(i => i < q.opts.length).sort();
    delete q.ansRaw;
    const why = [];
    if (!q.q) why.push('没找到题目'); if (q.opts.length < 2) why.push('选项少于 2 个'); if (!q.ans.length) why.push('没找到答案');
    if (why.length) errs.push({ i: bi + 1, why: why.join('，'), text: lines.slice(0, 2).join(' ') }); else out.push(q);
  });
  return { out, errs };
}

// ---------- 家长中心 ----------
let ptab = 'import', pfilter = { bank: '', subj: '', kp: '', src: '', s: '', page: 0, only: '' }, pending = [];
function openParent() { show('parent'); renderParent(); }
function renderParent() {
  $('#ptabs').innerHTML = [['import', '导入题目'], ['bank', '题库'], ['check', '待核对'], ['report', '学习报告'], ['settings', '设置']].concat(Store.cloud ? [] : window.QJ_APP === 'parent' ? [['sync', '同步'], ['backup', '备份']] : [['backup', '备份 / 换设备']]).map(([k, n]) => `<button type="button" role="tab" aria-selected="${ptab === k}" data-t="${k}">${n}</button>`).join('');
  const b = $('#pbody');
  if (ptab === 'import') b.innerHTML = importHTML();
  if (ptab === 'bank') b.innerHTML = bankHTML();
  if (ptab === 'check') b.innerHTML = checkHTML();
  if (ptab === 'report') b.innerHTML = reportHTML();
  if (ptab === 'settings') b.innerHTML = settingsHTML();
  if (ptab === 'backup') b.innerHTML = backupHTML();
  if (ptab === 'sync') b.innerHTML = syncHTML();
  const SY = Q.Sync;
  $('#p-status').textContent = Store.cloud ? `云端同步 · 题库 ${Bank.all.length} 道` : SY && SY.on ? `${SY.err ? '同步出错：' + SY.err : SY.last ? '已同步' : '同步中……'}${SY.kidAt ? ' · 孩子上次练习 ' + new Date(SY.kidAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''} · 题库 ${Bank.all.length} 道` : `未开同步 · 题库 ${Bank.all.length} 道`;
}
function importHTML() {
  return `<div class="pcard"><h3>第一步：让 AI 出题</h3><p>把错题拍照发给任意一个 AI（也可以发给 Claude），再附上下面这段要求，AI 就会按这个格式出同类题。</p><pre class="tpl" id="tpl">${esc(TPL)}</pre><button type="button" class="mini-btn pri" id="copy-tpl" style="justify-self:start">复制这段要求</button></div>
  <div class="pcard"><h3>第二步：把 AI 的回答粘贴进来</h3><p>可以一次粘贴很多题。多选题的答案写成“答案：AB”。如果这道题本身就是孩子的错题，加一行“来源：错题”，系统会优先安排复习。</p>
    <div class="row"><label>加入到题库 <select id="imp-bank">${Object.keys(Bank.banks()).map(b => `<option>${esc(b)}</option>`).join('')}<option value="__new">新建题库……</option></select></label><input type="text" id="imp-newbank" placeholder="新题库名字，例如：大班·冬" style="max-width:14em" hidden></div>
    <textarea id="imp-text" placeholder="把 AI 输出的题目粘贴到这里……"></textarea><div class="row"><button type="button" class="mini-btn pri" id="imp-parse">预览</button><span id="imp-msg"></span></div></div>
  <div id="imp-preview"></div>`;
}
function qCard(q, actions = '') {
  const r = SRS.rec(q.id);
  return `<div class="qrow" data-id="${q.id || ''}"><div class="meta">${q.bank ? `<span>${esc(q.bank)}</span>` : ''}<span>${esc(q.subj)}</span><span>${esc(q.kp)}</span><span>${esc(q.src || '')}</span>${q.chk ? '<span class="warn">答案待核对</span>' : ''}${r ? `<span>练过 ${r.c + r.w} 次 · 错 ${r.w} 次${r.b >= 3 ? ' · 已掌握' : ''}</span>` : '<span>还没练过</span>'}</div>
    <div class="qq">${esc(q.q)}</div><ol type="A">${q.opts.map((o, i) => `<li class="${q.ans.includes(i) ? 'ok' : ''}">${esc(o)}</li>`).join('')}</ol>${q.exp ? `<div class="ex">讲解：${esc(q.exp)}</div>` : ''}${actions ? `<div class="row">${actions}</div>` : ''}</div>`;
}
function bankHTML() {
  const kps = Bank.kps(pfilter.subj);
  let list = Bank.all.filter(q => (!pfilter.bank || q.bank === pfilter.bank) && (!pfilter.subj || q.subj === pfilter.subj) && (!pfilter.kp || q.kp === pfilter.kp) && (!pfilter.src || q.src === pfilter.src) && (!pfilter.s || (q.q + q.opts.join('')).includes(pfilter.s)));
  if (pfilter.only === 'wrong') list = list.filter(q => (SRS.rec(q.id) || {}).w > 0).sort((a, b) => SRS.rec(b.id).w - SRS.rec(a.id).w);
  const per = 30, pages = Math.max(1, Math.ceil(list.length / per)); pfilter.page = Math.min(pfilter.page, pages - 1);
  const srcs = [...new Set(Bank.all.map(q => q.src))];
  return `<div class="pcard"><div class="row">
      <select id="f-bank"><option value="">全部题库</option>${Object.keys(Bank.banks()).map(b => `<option ${pfilter.bank === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <select id="f-subj"><option value="">全部科目</option>${['人文', '思维'].map(s => `<option ${pfilter.subj === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="f-kp"><option value="">全部考点</option>${Object.keys(kps).map(k => `<option ${pfilter.kp === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <select id="f-src"><option value="">全部来源</option>${srcs.map(s => `<option ${pfilter.src === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="f-only"><option value="">所有题</option><option value="wrong" ${pfilter.only === 'wrong' ? 'selected' : ''}>只看答错过的</option></select>
      <input type="text" id="f-s" placeholder="搜索题目文字" value="${esc(pfilter.s)}" style="max-width:14em">
      <button type="button" class="mini-btn pri" id="q-new">新建一道题</button></div><p>共 ${list.length} 道 · 第 ${pfilter.page + 1}/${pages} 页</p></div>
    ${list.slice(pfilter.page * per, pfilter.page * per + per).map(q => qCard(q, `<button type="button" class="mini-btn" data-edit="${q.id}">编辑</button><button type="button" class="mini-btn" data-wrong="${q.id}">标为错题</button><button type="button" class="mini-btn dng" data-del="${q.id}">删除</button>`)).join('')}
    <div class="row"><button type="button" class="mini-btn" id="pg-prev" ${pfilter.page ? '' : 'disabled'}>上一页</button><button type="button" class="mini-btn" id="pg-next" ${pfilter.page < pages - 1 ? '' : 'disabled'}>下一页</button></div>`;
}
function checkHTML() {
  const list = Bank.all.filter(q => q.chk);
  return `<div class="pcard"><h3>答案需要核对的题（${list.length} 道）</h3><p>这些题我不能完全确定课堂上的标准答案。绿色是现在设定的答案；如果不对，点“编辑”改一下；如果对，点“答案没问题”。</p></div>` +
    (list.length ? list.map(q => qCard(q, `<button type="button" class="mini-btn pri" data-ok="${q.id}">答案没问题</button><button type="button" class="mini-btn" data-edit="${q.id}">编辑</button>`)).join('') : '<div class="pcard"><p>没有需要核对的题了。</p></div>');
}
function reportHTML() {
  const rb = pfilter.rbank ? [pfilter.rbank] : null;
  const ks = SRS.kpStats(rb).sort((a, b) => a.subj.localeCompare(b.subj) || b.n - a.n);
  const RB = rb ? Bank.active(rb) : Bank.all;
  const seen = RB.filter(q => SRS.rec(q.id)).length, mastered = RB.filter(q => SRS.isMastered(q)).length, due = RB.filter(q => SRS.isDue(q)).length;
  const hist = Store.state.hist.slice(0, 20);
  const wrongTop = RB.filter(q => (SRS.rec(q.id) || {}).w > 0).sort((a, b) => SRS.rec(b.id).w - SRS.rec(a.id).w).slice(0, 8);
  const modeN = { story: '取经', free: '修行', mirror: '真假美猴王', race: '竞速', duel: '擂台' };
  return `<div class="pcard"><div class="row"><b>看哪个题库</b><select id="f-rbank"><option value="">全部题库</option>${Object.keys(Bank.banks()).map(b => `<option ${pfilter.rbank === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div></div><div class="pcard"><h3>总览</h3><div class="row" style="gap:20px"><span>题目 <b>${RB.length}</b> 道</span><span>练过 <b>${seen}</b> 道</span><span>已掌握 <b>${mastered}</b> 道</span><span>今天该复习 <b>${due}</b> 道</span><span>修为 <b>${Store.state.xp}</b></span></div></div>
  <div class="pcard"><h3>各考点掌握情况</h3><p>掌握度按每道题的复习进度计算：连续答对 3 次以上算掌握。</p>${ks.map(k => `<div class="kpbar"><span>${esc(k.kp)}<small style="color:var(--mute)"> ${k.subj}</small></span><div class="bar"><i style="width:${k.pct}%"></i></div><span>${k.pct}%${k.wrong ? ` · 错${k.wrong}` : ''}</span></div>`).join('')}</div>
  <div class="pcard"><h3>最常错的题</h3>${wrongTop.length ? wrongTop.map(q => qCard(q)).join('') : '<p>还没有答错过的题。</p>'}</div>
  <div class="pcard"><h3>最近练习</h3>${hist.length ? `<table class="stats">${hist.map(h => `<tr><th>${new Date(h.d).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</th><td>${modeN[h.mode] || h.mode} · ${esc(h.t || '')}</td><td>${h.c}/${h.n}</td><td>${h.r === 'ko' ? '倒下' : h.r === 'escape' ? '未通过' : ''}</td></tr>`).join('')}</table>` : '<p>还没有练习记录。</p>'}</div>`;
}
function settingsHTML() {
  const s = Store.settings, kps = Object.keys(Bank.kps());
  const bk = Bank.banks();
  return `<div class="pcard"><h3>用哪些题库</h3><p>“取经之路”“筋斗云竞速”“擂台斗法”从选中的题库出题；一个都不选就是全部题库。“自由修行”和“真假美猴王”开始前还可以临时换题库。</p><div class="row">${Object.keys(bk).map(b => `<button type="button" class="mini-btn${(s.banks || []).includes(b) ? ' pri' : ''}" data-sb="${esc(b)}">${esc(b)} · ${bk[b]} 道</button>`).join('')}</div></div>
  <div class="pcard"><h3>每天的题量</h3><p>“取经之路”每一关出多少道题（教学关固定 8 道）。</p><div class="row"><input type="range" id="s-daily" min="10" max="25" value="${s.daily}" style="max-width:300px"><b id="s-daily-v">${s.daily}</b> 道</div></div>
  <div class="pcard"><h3>孩子的称呼</h3><input type="text" id="s-name" value="${esc(s.name)}" style="max-width:14em"></div>
  <div class="pcard"><h3>本周重点考点</h3><p>选中的考点会更多地出现在新题里。</p><div class="row">${kps.map(k => `<button type="button" class="mini-btn${s.focusKp.includes(k) ? ' pri' : ''}" data-fk="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>
  <div class="pcard"><h3>其他</h3><label class="row"><input type="checkbox" id="s-sound" ${s.sound ? 'checked' : ''}> 打开音效</label><label class="row">筋斗云竞速时长 <input type="number" id="s-race" min="30" max="180" step="10" value="${s.raceSec}" style="width:6em"> 秒</label><p>擂台斗法的让分，在开始比赛前的设置里调。</p></div>
  <div class="pcard"><h3>重置</h3><p>清空孩子的所有进度（修为、装备、复习记录）。题库不会被删除。</p><div class="row"><input type="text" id="s-reset-in" placeholder="输入“重置”两个字确认" style="max-width:14em"><button type="button" class="mini-btn dng" id="s-reset">重置进度</button></div></div>`;
}
function backupHTML() {
  const nCustom = Object.keys(Store.custom).length;
  return `<div class="pcard"><h3>为什么要备份</h3><p>${Store.cloud ? '现在是 Claude 里的版本，数据存在云端。' : '离线网页版的进度和自己加的题，都只保存在这台设备的浏览器里。'}换 iPad、清理 Safari 网站数据之前，先在这里导出一个备份文件，存到“文件”App 或发给自己。</p></div>
  <div class="pcard"><h3>导出</h3><div class="row"><button type="button" class="mini-btn pri" id="bk-all">导出全部（进度 + 自己加的题）</button><button type="button" class="mini-btn" id="bk-q">只导出自己加的题（${nCustom} 道）</button></div>
    <p style="color:var(--mute)">在电脑上加好的题，导出“只含题目”的文件，用微信/隔空投送发到 iPad，再在 iPad 的家长端点“导入备份文件”，题就过去了，孩子的进度不受影响。</p></div>
  <div class="pcard"><h3>导入</h3><div class="row"><label class="mini-btn" style="cursor:pointer">选择备份文件<input type="file" id="bk-file" accept=".json,application/json" hidden></label><span id="bk-msg"></span></div><p style="color:var(--mute)">文件里有进度，就会用文件里的进度替换这台设备上的进度；文件里的题会合并进来（同一道题保留较新的版本）。</p></div>`;
}
function syncHTML() {
  const SY = Q.Sync;
  return `<div class="pcard"><h3>云同步</h3><p>打开后：在这里加的题、改的设置会自动同步到孩子的 iPad；孩子的进度会传回来，“学习报告”里就能看到。数据存在你自己的私有 GitHub 仓库里。</p>
    <div class="row"><label>数据仓库 <input type="text" id="sy-repo" value="${esc(SY.repo)}" style="max-width:16em"></label></div>
    <div class="row"><label style="flex:1">同步码（GitHub 令牌） <input type="password" id="sy-token" value="${esc(SY.token)}" placeholder="github_pat_……" style="width:100%"></label></div>
    <div class="row"><button type="button" class="mini-btn pri" id="sy-save">保存并测试</button><button type="button" class="mini-btn" id="sy-now" ${SY.on ? '' : 'disabled'}>立刻同步</button><span id="sy-msg">${SY.on ? (SY.err ? '<span class="note-bad">' + esc(SY.err) + '</span>' : SY.last ? '上次同步：' + new Date(SY.last).toLocaleTimeString('zh-CN') : '') : '还没打开'}</span></div></div>
  <div class="pcard"><h3>孩子的 iPad 怎么设置</h3><p>在 iPad 上第一次打开游戏时，会出现“家长设置：同步码”的框，把同一个同步码粘贴进去就好（可以用微信、备忘录或隔空投送发到 iPad）。以后孩子那边看不到任何家长入口。</p>
    <p style="color:var(--mute)">如果当时点了“跳过”，之后要补设置：在游戏首页的“取经小英雄”标题上长按 3 秒，会再次弹出这个框。</p></div>`;
}
function download(name, data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function editModal(q) {
  const isNew = !q; q = q ? JSON.parse(JSON.stringify(q)) : { id: 'u' + Date.now().toString(36), bank: (Store.settings.banks || [])[0] || Object.keys(Bank.banks())[0] || '自定义', subj: '人文', kp: '', q: '', opts: ['', '', ''], ans: [0], exp: '', src: '妈妈出题', d: 1 };
  const m = $('#modal'); m.hidden = false;
  const render = () => {
    $('#modal .mbox').innerHTML = `<button type="button" class="x" aria-label="关闭">×</button><h2>${isNew ? '新建题目' : '编辑题目'}</h2>
    <div class="row"><select id="e-subj">${['人文', '思维'].map(s => `<option ${q.subj === s ? 'selected' : ''}>${s}</option>`).join('')}</select><input type="text" id="e-kp" placeholder="考点" value="${esc(q.kp)}" style="max-width:12em"><select id="e-d">${[1, 2, 3].map(d => `<option value="${d}" ${q.d == d ? 'selected' : ''}>难度 ${d}</option>`).join('')}</select><input type="text" id="e-src" value="${esc(q.src || '')}" placeholder="来源" style="max-width:9em"><input type="text" id="e-bank" value="${esc(q.bank || '')}" placeholder="题库" list="bank-list" style="max-width:10em"><datalist id="bank-list">${Object.keys(Bank.banks()).map(b => `<option value="${esc(b)}">`).join('')}</datalist></div>
    <textarea id="e-q" style="min-height:70px">${esc(q.q)}</textarea>
    <p>选项（勾上的是正确答案，可以勾多个）：</p>${q.opts.map((o, i) => `<div class="row"><input type="checkbox" data-a="${i}" ${q.ans.includes(i) ? 'checked' : ''}><b>${'ABCDEF'[i]}</b><input type="text" data-o="${i}" value="${esc(o)}" style="flex:1"><button type="button" class="mini-btn dng" data-rm="${i}" ${q.opts.length <= 2 ? 'disabled' : ''}>删</button></div>`).join('')}
    ${q.opts.length < 6 ? '<button type="button" class="mini-btn" id="e-add" style="justify-self:start">加一个选项</button>' : ''}
    <textarea id="e-exp" style="min-height:60px" placeholder="讲解（答错时给孩子看）">${esc(q.exp || '')}</textarea>
    <input type="text" id="e-hint" placeholder="提示（火眼金睛时显示，可不填）" value="${esc(q.hint || '')}">
    <div class="row"><button type="button" class="btn" id="e-save">保存</button><span id="e-msg" class="note-bad"></span></div>`;
    const read = () => { q.subj = $('#e-subj').value; q.kp = $('#e-kp').value.trim() || '未分类'; q.d = +$('#e-d').value; q.src = $('#e-src').value.trim(); q.bank = $('#e-bank').value.trim() || '自定义'; q.q = $('#e-q').value.trim(); q.exp = $('#e-exp').value.trim(); q.hint = $('#e-hint').value.trim() || undefined;
      q.opts = $$('[data-o]').map(i => i.value.trim()); q.ans = $$('[data-a]').filter(c => c.checked).map(c => +c.dataset.a); };
    $('#modal .x').onclick = () => m.hidden = true;
    if ($('#e-add')) $('#e-add').onclick = () => { read(); q.opts.push(''); render(); };
    $$('[data-rm]').forEach(b => b.onclick = () => { read(); const i = +b.dataset.rm; q.opts.splice(i, 1); q.ans = q.ans.filter(a => a !== i).map(a => a > i ? a - 1 : a); render(); });
    $('#e-save').onclick = async () => { read();
      if (!q.q) return $('#e-msg').textContent = '请填写题目'; if (q.opts.filter(Boolean).length < 2 || q.opts.some(o => !o)) return $('#e-msg').textContent = '每个选项都要填，至少 2 个';
      if (!q.ans.length) return $('#e-msg').textContent = '请勾选正确答案';
      q.chk = false; try { await Store.putQuestion(q); m.hidden = true; toast('已保存'); renderParent(); } catch (e) { $('#e-msg').textContent = '保存失败：' + (e.code || e.message); } };
  };
  render();
}
document.addEventListener('click', async e => {
  if (!$('#parent').classList.contains('on')) return;
  const t = e.target.closest('#ptabs [data-t]'); if (t) { ptab = t.dataset.t; renderParent(); return; }
  if (e.target.closest('#copy-tpl')) { try { await navigator.clipboard.writeText(TPL); toast('已复制'); } catch (er) { const r = document.createRange(); r.selectNodeContents($('#tpl')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('已选中，按“拷贝”即可'); } return; }
  if (e.target.closest('#imp-parse')) {
    const { out, errs } = parseImport($('#imp-text').value); pending = out;
    $('#imp-msg').innerHTML = `识别出 <b>${out.length}</b> 道题${errs.length ? `，<span class="note-bad">${errs.length} 段没识别</span>` : ''}`;
    $('#imp-preview').innerHTML = (errs.length ? `<div class="pcard"><h3>这些段落没识别出来</h3>${errs.map(x => `<p>第 ${x.i} 段：${esc(x.why)}（${esc(x.text)}）</p>`).join('')}</div>` : '') + (out.length ? `<div class="pcard"><div class="row"><b>预览</b><button type="button" class="mini-btn pri" id="imp-save">全部加入题库</button></div></div>` + out.map(q => qCard(q)).join('') : '');
    return;
  }
  if (e.target.closest('#imp-save')) {
    const btn = e.target.closest('#imp-save'); btn.disabled = true; let n = 0;
    const selB = $('#imp-bank').value, nb = $('#imp-newbank').value.trim(); const bankName = selB === '__new' ? nb : selB;
    if (!bankName) { btn.disabled = false; return toast('请填写新题库的名字'); }
    const SY = Q.Sync; if (SY && SY.on) SY.batch = [];
    try { for (const [i, q] of pending.entries()) { q.bank = q.bank || bankName; q.id = 'u' + Date.now().toString(36) + i; if (q.src === '错题') q.wrongMark = Date.now(); await Store.putQuestion(q); n++; }
      if (SY && SY.batch) { const list = SY.batch; SY.batch = null; try { await SY.pushQuestions(list); toast(`已加入 ${n} 道题，已同步到 iPad`); } catch (er) { toast(`已加入 ${n} 道题，但没同步上去：${er.message}`, 4000); } } else toast(`已加入 ${n} 道题`); pending = []; $('#imp-text').value = ''; $('#imp-preview').innerHTML = ''; renderParent(); }
    catch (er) { if (SY) SY.batch = null; toast('保存失败：' + (er.code || er.message)); btn.disabled = false; }
    return;
  }
  const ed = e.target.closest('[data-edit]'); if (ed) return editModal(Bank.byId[ed.dataset.edit]);
  if (e.target.closest('#q-new')) return editModal(null);
  const wr = e.target.closest('[data-wrong]'); if (wr) { const q = Object.assign({}, Bank.byId[wr.dataset.wrong]); q.wrongMark = Date.now(); await Store.putQuestion(q); toast('已标为错题，会优先安排复习'); return; }
  const del = e.target.closest('[data-del]'); if (del) { if (del.dataset.sure) { const q = Object.assign({}, Bank.byId[del.dataset.del], { deleted: true }); await Store.putQuestion(q); toast('已删除'); renderParent(); } else { del.dataset.sure = 1; del.textContent = '再点一次确认删除'; } return; }
  const ok = e.target.closest('[data-ok]'); if (ok && ptab === 'check') { const q = Object.assign({}, Bank.byId[ok.dataset.ok], { chk: false }); await Store.putQuestion(q); toast('好的'); renderParent(); return; }
  const stamp = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  if (e.target.closest('#bk-all')) { download(`qujing-backup-${stamp()}.json`, Store.backup()); toast('已导出'); return; }
  if (e.target.closest('#bk-q')) { const d = Store.backup(); delete d.state; delete d.progress; delete d.settings; download(`qujing-questions-${stamp()}.json`, d); toast('已导出'); return; }
  if (e.target.closest('#sy-save')) { const SY = Q.Sync; SY.configure($('#sy-token').value, $('#sy-repo').value); $('#sy-msg').textContent = '测试中……';
    try { await SY.test(); await SY.pull(); toast('同步已打开'); Bank.rebuild(); renderParent(); } catch (er) { $('#sy-msg').innerHTML = '<span class="note-bad">' + esc(er.message) + '</span>'; } return; }
  if (e.target.closest('#sy-now')) { await Q.Sync.pull(); Bank.rebuild(); renderParent(); toast(Q.Sync.err ? '同步出错：' + Q.Sync.err : '已同步'); return; }
  if (e.target.closest('#pg-prev')) { pfilter.page--; renderParent(); } if (e.target.closest('#pg-next')) { pfilter.page++; renderParent(); }
  const sb = e.target.closest('[data-sb]'); if (sb) { const s = Store.settings, k = sb.dataset.sb; s.banks = (s.banks || []).includes(k) ? s.banks.filter(x => x !== k) : (s.banks || []).concat(k); Store.save('settings'); renderParent(); return; }
  const fk = e.target.closest('[data-fk]'); if (fk) { const s = Store.settings, k = fk.dataset.fk; s.focusKp = s.focusKp.includes(k) ? s.focusKp.filter(x => x !== k) : s.focusKp.concat(k); Store.save('settings'); renderParent(); }
  if (e.target.closest('#s-reset')) { if ($('#s-reset-in').value.trim() !== '重置') return toast('请先输入“重置”两个字'); Store.state = JSON.parse(JSON.stringify(window.QJ_DEF_STATE)); Store.prog = { q: {}, ts: 0 }; Store.save('state'); Store.save('progress'); if (Q.Sync && Q.Sync.on && window.QJ_APP === 'parent') { Q.Sync.pushReset().then(() => toast('已通知孩子的 iPad 清空进度（下次联网打开时生效）', 4000)).catch(er => toast('没同步上去：' + er.message)); } else toast('进度已清空'); renderParent(); }
});
document.addEventListener('change', e => {
  if (!$('#parent').classList.contains('on')) return;
  const id = e.target.id, s = Store.settings;
  if (id === 'bk-file') { const f = e.target.files[0]; if (!f) return; f.text().then(t => { const d = JSON.parse(t); const hasProg = !!d.state; if (hasProg && !confirm('这个文件里有孩子的进度，会替换这台设备上现在的进度。继续吗？')) return; return Store.restore(d, { progress: hasProg, custom: true }).then(() => { $('#bk-msg').textContent = `导入成功${d.custom ? `：题目 ${Object.keys(d.custom).length} 道` : ''}${hasProg ? '，进度已恢复' : ''}`; Bank.rebuild(); }); }).catch(er => { $('#bk-msg').textContent = '导入失败：' + er.message; }); return; }
  if (id === 'imp-bank') $('#imp-newbank').hidden = e.target.value !== '__new';
  if (['f-bank', 'f-subj', 'f-kp', 'f-src', 'f-only'].includes(id)) { pfilter[id.slice(2)] = e.target.value; if (id === 'f-subj') pfilter.kp = ''; pfilter.page = 0; renderParent(); }
  if (id === 'f-rbank') { pfilter.rbank = e.target.value; renderParent(); }
  if (id === 'f-s') { pfilter.s = e.target.value.trim(); pfilter.page = 0; renderParent(); }
  if (id === 's-name') { s.name = e.target.value.trim() || '小悟空'; Store.save('settings'); }
  if (id === 's-sound') { s.sound = e.target.checked; Store.save('settings'); }
  if (id === 's-race') { s.raceSec = Math.max(30, Math.min(180, +e.target.value || 60)); Store.save('settings'); }
  if (id === 's-daily') { s.daily = +e.target.value; Store.save('settings'); }
});
document.addEventListener('input', e => { if (e.target.id === 's-daily') $('#s-daily-v').textContent = e.target.value; });

// ---------- 家长入口：长按 1.2 秒 ----------
(function () {
  const b = $('#parent-btn'); let t = null;
  if (window.QJ_APP === 'kid') { b.remove(); return; }
  // 独立网页版：家长端是单独的页面（parent.html），孩子这边只留一个长按入口
  const go = () => { if (window.QJ_APP === 'kid') { ['state', 'progress', 'settings'].forEach(n => { if (Store.dirty[n]) { clearTimeout(Store.timers[n]); Store.flush(n); } }); location.href = 'parent.html'; } else openParent(); };
  const start = e => { e.preventDefault(); const f = b.querySelector('.fill'); f.style.transition = 'transform 1.2s linear'; f.style.transform = 'scaleX(1)'; t = setTimeout(() => { cancel(); go(); }, 1200); };
  const cancel = () => { clearTimeout(t); const f = b.querySelector('.fill'); f.style.transition = 'none'; f.style.transform = 'scaleX(0)'; };
  b.addEventListener('pointerdown', start); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, cancel));
  b.addEventListener('click', e => e.preventDefault());
})();

// ---------- 启动 ----------
(async function boot() {
  $('#boot').hidden = false;
  await Store.init();
  Bank.rebuild();
  Store.onBank.push(() => { Bank.rebuild(); if ($('#home').classList.contains('on')) goHome(); if ($('#parent').classList.contains('on') && !$('#modal:not([hidden])')) renderParent(); });
  Store.onRemote.push(name => { if (window.QJ_APP === 'parent') { if (!$('#modal:not([hidden])')) renderParent(); return; } if (!Q.curBattle || Q.curBattle.done) { if ($('#home').classList.contains('on')) goHome(); } });
  const SY = Q.Sync;
  if (SY && SY.on) { await Promise.race([SY.pull(), Q.sleep(5000)]); Bank.rebuild(); }
  if (SY) SY.onStatus.push(() => { if (window.QJ_APP === 'parent' && $('#parent').classList.contains('on') && !$('#modal:not([hidden])')) renderParent(); });
  if (Store.cloud) { const t0 = Date.now(); while (!Store.bankReady && Date.now() - t0 < 6000) await Q.sleep(100); Bank.rebuild(); }
  $('#boot').hidden = true;
  if (window.QJ_APP === 'parent') {
    document.body.classList.add('parent-app');
    const back = $('#parent .back'); back.textContent = '← 回到游戏'; back.removeAttribute('data-home-btn'); back.onclick = () => { ['state', 'progress', 'settings'].forEach(n => { if (Store.dirty[n]) { clearTimeout(Store.timers[n]); Store.flush(n); } }); location.href = './'; };
    if (!(SY && SY.on)) ptab = 'sync';
    openParent();
  } else { goHome(); if (window.QJ_APP === 'kid') kidSetup(); }
  document.addEventListener('pointerdown', () => Sfx.ensure(), { once: true });
  addEventListener('visibilitychange', () => { if (document.hidden) ['state', 'progress', 'settings'].forEach(n => { if (Store.dirty[n]) { clearTimeout(Store.timers[n]); Store.flush(n); } }); });
})();
// ---------- 孩子端：第一次打开时，家长粘贴同步码 ----------
function kidSetup(force) {
  const SY = Q.Sync; if (!SY || (!force && (SY.on || Store.ls('sync_skip')))) return;
  const m = $('#modal'); m.hidden = false;
  $('#modal .mbox').innerHTML = `<h2>欢迎来到取经小英雄</h2><p>家里人第一次打开：粘贴家长给的同步码，进度会和家长端同步，家长新加的题也会自动出现。</p>
    <input type="password" id="ks-token" placeholder="同步码 github_pat_……" style="width:100%"><p id="ks-msg" class="note-bad"></p>
    <div class="row"><button type="button" class="btn" id="ks-ok">保存同步码</button></div>
    <hr style="border:none;border-top:1px solid var(--line);margin:4px 0">
    <p style="margin:0"><b>没有同步码？</b>点下面直接玩。游客的进度只存在这台设备上，和家里的记录没有关系。以后也可以在左下角的小齿轮里再填同步码。</p>
    <div class="row"><button type="button" class="btn gold" id="ks-skip">我是游客，直接玩</button></div>`;
  $('#ks-skip').onclick = () => { Store.ls('sync_skip', 1); m.hidden = true; };
  $('#ks-ok').onclick = async () => { const tok = $('#ks-token').value.trim(); if (!tok) return; SY.configure(tok); $('#ks-msg').textContent = '测试中……';
    try { await SY.test(); await SY.pull(); Bank.rebuild(); SY.pushKid(0); m.hidden = true; toast('同步已打开'); goHome(); } catch (er) { SY.configure(''); $('#ks-msg').textContent = er.message; } };
}
(function () {
  const t = $('.home-title'); if (!t) return; let h = null;
  t.addEventListener('pointerdown', () => { if (window.QJ_APP !== 'kid') return; h = setTimeout(() => kidSetup(true), 3000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => t.addEventListener(ev, () => clearTimeout(h)));
})();
window.QJ.openParent = openParent;
window.QJ.kidSetup = kidSetup;
})();

/* 取经小英雄 · 游客试玩限制（只在离线网页版的孩子端生效）
   没填同步码的“游客”：打完 4 关，或者所有模式累计答满 100 题，就要输入作者给的密码才能继续玩。
   计数单独存，重置进度也不会清掉。 */
(function(){
'use strict';
const Q = window.QJ;
const { Store, SRS, $ } = Q;
const LIMIT_Q = 100, LIMIT_STAGE = 4;
const H = '1dvtc05'; // 密码的指纹（不直接写明文）
const hash = s => { let x = 2166136261; for (const c of 'qj-salt:' + s) { x ^= c.codePointAt(0); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };

const Guest = {
  get active() { return window.QJ_APP === 'kid' && !Store.cloud && !(Q.Sync && Q.Sync.on) && !Store.ls('unlocked'); },
  get n() { return Store.ls('guest_q') || 0; },
  get stages() { return Store.ls('guest_s') || 0; },
  over() { return this.active && (this.n >= LIMIT_Q || this.stages >= LIMIT_STAGE); },
  countQ() { if (!this.active) return; Store.ls('guest_q', this.n + 1); if (this.over()) this.lock(); },
  countStage() { if (!this.active) return; Store.ls('guest_s', this.stages + 1); if (this.over()) setTimeout(() => this.lock(), 2500); },
  lock() {
    if ($('#guest-lock')) return;
    try { if (Q.AU) Q.AU.stop(.5); } catch (e) {}
    const d = document.createElement('div'); d.id = 'guest-lock'; d.className = 'guest-lock';
    d.innerHTML = `<div class="gl-box"><h2>试玩结束啦</h2>
      <p>游客最多可以玩 ${LIMIT_STAGE} 关或答 ${LIMIT_Q} 道题。想继续玩，请联系作者要密码。</p>
      <input type="password" id="gl-pw" placeholder="输入密码" autocomplete="off" style="width:100%">
      <p id="gl-msg" class="note-bad"></p>
      <button type="button" class="btn gold" id="gl-ok">解锁</button>
      <p style="color:var(--mute);font-size:13px;margin:0">家里人：如果有家长给的同步码，也可以填在这里。</p></div>`;
    document.body.appendChild(d);
    const tryIt = async () => {
      const v = $('#gl-pw').value.trim(); if (!v) return;
      if (hash(v) === H) { Store.ls('unlocked', 1); d.remove(); Q.toast('解锁成功，继续取经吧！', 3000); return; }
      if (/^g(ithub_pat_|hp_)/.test(v) && Q.Sync) {
        $('#gl-msg').textContent = '正在检查同步码……'; Q.Sync.configure(v);
        try { await Q.Sync.test(); await Q.Sync.pull(); Q.Bank.rebuild(); Q.Sync.pushKid(0); d.remove(); Q.toast('同步已打开', 3000); Q.goHome(); return; }
        catch (er) { Q.Sync.configure(''); $('#gl-msg').textContent = er.message; return; }
      }
      $('#gl-msg').textContent = '密码不对，请再问问作者';
    };
    $('#gl-ok').onclick = tryIt; $('#gl-pw').onkeydown = e => { if (e.key === 'Enter') tryIt(); };
    // 正在进行的战斗停下来
    if (Q.curBattle && !Q.curBattle.done) Q.curBattle.busy = true;
  },
};
Q.Guest = Guest;
// 所有模式答题都会经过 SRS.record（每道题第一次作答）
const rec = SRS.record.bind(SRS);
SRS.record = function (q, ok) { rec(q, ok); Guest.countQ(); };
// 启动时已经超了就直接锁
setTimeout(() => { if (Guest.over()) Guest.lock(); }, 1500);
})();
