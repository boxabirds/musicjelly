// Sound: the piano's sampler for the learner's own notes, and the jelly's noises.
// The sampler is greatpianoteachers' (worklet.js hosting sampler.wasm, Salamander Grand Piano samples in smp/, one
// sample every three semitones in three loudness layers); the loading code is ported from its src/main.js.
// The jelly noises are Unix Jelly's `boing`, plus a squeak.
// A browser only lets sound start after a tap or a key on the computer, so `start()` is called from the first of those;
// a MIDI key does not count. Until then every call here is silently dropped.
const LAYER_NAMES = [5, 9, 13], LAYERS = 3;                  // the three loudness layers' file names (v5 soft, v9, v13 loud); the sampler picks the layer from how hard a key is struck
const MIDI_LOWEST = 21, MIDI_HIGHEST = 108, ROOT_EVERY = 3, ROOT_LOWEST = 27, ROOT_HIGHEST = 99;
const ROOT_NAMES = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' }, FIRST_LAYER = 1, SAMPLE_FETCHES = 4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rootOf = m => clamp(MIDI_LOWEST + ROOT_EVERY * Math.round((m - MIDI_LOWEST) / ROOT_EVERY), ROOT_LOWEST, ROOT_HIGHEST);
const sampleName = (r, layer) => ROOT_NAMES[r % 12] + (Math.floor(r / 12) - 1) + 'v' + LAYER_NAMES[layer];
const MIX = { dry: 0.85, wet: 0.16, limitAt: -5, ratio: 6, attack: 0.003, release: 0.2 }, REVERB_S = 1.9;
const SILENCE = 0.003, LEAD_FRAMES = 48, FADE_S = 0.4;
const sampleSeconds = root => (root < 48 ? 7 : root < 72 ? 5 : 3.5);

// a sample as the sampler wants it: 16-bit stereo, leading silence trimmed, cut to length with a fade
function toInt16(ab, root) {
  const sr = ab.sampleRate, L = ab.getChannelData(0), R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L;
  let st = 0; while (st < L.length && Math.abs(L[st]) < SILENCE && Math.abs(R[st]) < SILENCE) st++;
  st = Math.max(0, st - LEAD_FRAMES);
  const cap = Math.round(sampleSeconds(root) * sr), frames = Math.min(L.length - st, cap), out = new Int16Array(frames * 2 + 2);
  const fade = Math.round(FADE_S * sr), cut = frames < L.length - st;
  for (let i = 0; i < frames; i++) {
    const g = (cut && i > frames - fade ? (frames - i) / fade : 1) * 32767;
    out[i * 2] = clamp(L[st + i] * g, -32768, 32767); out[i * 2 + 1] = clamp(R[st + i] * g, -32768, 32767);
  }
  return { out, frames };
}
function makeReverb(ctx) {
  const len = Math.round(ctx.sampleRate * REVERB_S), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const t = i / len; lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * t); d[i] = lp * Math.pow(1 - t, 2.4) * (i < 400 ? i / 400 : 1); } }
  const cv = ctx.createConvolver(); cv.buffer = ir; return cv;
}

export function createSound() {
  const S = { ctx: null, node: null, starting: null, idxOf: {}, count: 0, ready: false, layersLoaded: 0, error: null, squeaks: 0, hushed: false, notes: 0 };      // hushed: the jellies' noises are off (the microphone would hear them); notes: piano notes begun
  const post = (msg, transfer = []) => { if (S.node) S.node.port.postMessage(msg, transfer); };
  async function loadLayer(layer) {
    const roots = []; for (let r = ROOT_LOWEST; r <= ROOT_HIGHEST; r += ROOT_EVERY) roots.push(r);
    let next = 0;
    const one = async r => {
      const ab = await S.ctx.decodeAudioData(await fetch('smp/' + sampleName(r, layer) + '.mp3').then(x => x.arrayBuffer()));
      const { out, frames } = toInt16(ab, r), idx = S.count++;
      post({ type: 'sample', idx, frames, data: out.buffer }, [out.buffer]); S.idxOf[r + '_' + layer] = idx;
    };
    await Promise.all(Array.from({ length: SAMPLE_FETCHES }, async () => { while (next < roots.length) await one(roots[next++]); }));
    // every key and loudness gets the nearest layer that has arrived
    const entries = [];
    for (let m = MIDI_LOWEST; m <= MIDI_HIGHEST; m++) for (let l = 0; l < LAYERS; l++) {
      const r = rootOf(m); let idx = S.idxOf[r + '_' + l];
      if (idx === undefined) for (const alt of [1, 0, 2]) if (S.idxOf[r + '_' + alt] !== undefined) { idx = S.idxOf[r + '_' + alt]; break; }
      if (idx !== undefined) entries.push([m, l, idx, Math.pow(2, (m - r) / 12)]);
    }
    post({ type: 'map', entries }); S.layersLoaded++;
  }
  async function begin() {
    const ctx = S.ctx = new AudioContext({ latencyHint: 'interactive' });
    const wasm = await fetch('sampler.wasm').then(x => x.arrayBuffer());
    await ctx.audioWorklet.addModule('worklet.js');
    const node = new AudioWorkletNode(ctx, 'gpt-piano', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { wasm } });
    node.onprocessorerror = () => { S.error = 'processor'; };
    const dry = ctx.createGain(), wet = ctx.createGain(), rev = makeReverb(ctx), lim = ctx.createDynamicsCompressor();
    dry.gain.value = MIX.dry; wet.gain.value = MIX.wet; lim.threshold.value = MIX.limitAt; lim.ratio.value = MIX.ratio; lim.attack.value = MIX.attack; lim.release.value = MIX.release;
    node.connect(dry).connect(lim); node.connect(rev).connect(wet).connect(lim); lim.connect(ctx.destination);
    S.node = node;
    // the middle loudness of every note first, so any key sounds soon; the soft and loud layers follow
    await loadLayer(FIRST_LAYER); S.ready = true;
    for (let l = 0; l < LAYERS; l++) if (l !== FIRST_LAYER) await loadLayer(l);
  }
  // Unix Jelly's boing: a sine that falls in pitch with a wobble on it
  function boing(f = 320, len = 0.35, vol = 0.18) {
    const c = S.ctx; if (!c || c.state !== 'running' || S.hushed) return;
    const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(), t = c.currentTime;
    o.type = 'sine'; o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + len);
    lfo.frequency.value = 18; lg.gain.value = f * 0.08; lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(c.destination); o.start(t); lfo.start(t); o.stop(t + len + 0.05); lfo.stop(t + len + 0.05);
  }
  // A small squeak: a short high note that slides up and back, like a toy being pinched.
  const SQUEAK = { from: 1250, to: 2300, back: 1700, upS: 0.05, lenS: 0.13, vol: 0.07, attackS: 0.008 };
  function squeak() {
    S.squeaks++; const c = S.ctx; if (!c || c.state !== 'running' || S.hushed) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime, Q = SQUEAK;
    o.type = 'triangle'; o.frequency.setValueAtTime(Q.from, t); o.frequency.exponentialRampToValueAtTime(Q.to, t + Q.upS); o.frequency.exponentialRampToValueAtTime(Q.back, t + Q.lenS);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Q.vol, t + Q.attackS); g.gain.exponentialRampToValueAtTime(0.0001, t + Q.lenS);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + Q.lenS + 0.02);
  }
  return {
    state: S,
    // call from a tap or a computer key; safe to call again
    start() { if (!S.starting) S.starting = begin().catch(e => { S.error = String(e && e.message || e); }); else if (S.ctx && S.ctx.state === 'suspended') S.ctx.resume(); return S.starting; },
    noteOn(midi, vel) { if (S.ready && midi >= MIDI_LOWEST && midi <= MIDI_HIGHEST) { S.notes++; post({ type: 'note', on: true, midi, vel }); } },
    // the context, made at the first start() (the microphone needs it)
    context: () => S.ctx,
    // the jellies' boings and squeaks off or on (the piano is not affected)
    hush(on) { S.hushed = on; },
    noteOff(midi) { if (S.ready) post({ type: 'note', on: false, midi }); },
    pedal(down) { if (S.ready) post({ type: 'pedal', down }); },
    boing, squeak,
    // how many notes the sampler is sounding now (asked of the audio thread; for the tests)
    voices: () => new Promise(done => { if (!S.node) return done(0); S.node.port.onmessage = e => { if (e.data.type === 'stat') done(e.data.voices); }; post({ type: 'stat' }); }),
    ding() { [660, 880, 1320].forEach((f, i) => setTimeout(() => boing(f, 0.22, 0.12), i * 90)); },
  };
}
