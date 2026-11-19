// AudioWorklet: hosts the WebAssembly sampler and dispatches timed note events.
// The main thread owns the transport: it says "from frame F the song is at position P and runs at rate R"
// (optionally after silencing everything), and both sides compute the song position from that.
// process() allocates nothing: all state is numbers and views made ahead of time.
const PEDAL_DOWN_FROM = 0.5, EV_OFF = 0, EV_ON = 1, KEYS = 128;
class PianoProcessor extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const mod = new WebAssembly.Module(o.processorOptions.wasm);
    this.x = new WebAssembly.Instance(mod, { env: { abort() { throw new Error('sampler abort'); } } }).exports;
    this.x.init(sampleRate);
    this.pL = this.x.outL(); this.pR = this.x.outR();
    this.buf = null; this.vL = null; this.vR = null;
    this.t = null; this.ty = null; this.a = null; this.b = null; this.N = 0; this.i = 0;
    this.run = false; this.pos = 0; this.rate = 1;                        // song position in seconds at the next frame to render
    this.dueFrame = -1; this.duePos = 0; this.dueRate = 1; this.dueSeek = false; this.dueIndex = 0; this.duePedal = 0;
    this.dueSound = false; this.dueVel = new Float32Array(KEYS);        // a seek can strike the notes held at its place: their loudness by pitch
    this.port.onmessage = e => this.msg(e.data);
  }
  views() {
    const m = this.x.memory.buffer;
    if (m !== this.buf) { this.buf = m; this.vL = new Float32Array(m, this.pL, 128); this.vR = new Float32Array(m, this.pR, 128); }
  }
  msg(d) {
    if (d.type === 'sample') {
      const src = new Int16Array(d.data), ptr = this.x.alloc(src.byteLength + 8);
      new Int16Array(this.x.memory.buffer, ptr, src.length).set(src);
      this.x.setSample(d.idx, ptr, d.frames);
    } else if (d.type === 'map') {
      for (const m of d.entries) this.x.setMap(m[0], m[1], m[2], m[3]);
    } else if (d.type === 'events') {
      this.t = d.t; this.ty = d.ty; this.a = d.a; this.b = d.b; this.N = d.t.length;
    } else if (d.type === 'transport') {
      // worked out here, off the audio path: where in the event list the position falls and whether the pedal is down there
      let i = 0, pedal = 0; const vel = this.dueVel; vel.fill(0);
      if (d.seek) for (; i < this.N && this.t[i] < d.pos; i++) {
        const ty = this.ty[i];
        if (ty === EV_ON) vel[this.a[i]] = this.b[i]; else if (ty === EV_OFF) vel[this.a[i]] = 0; else pedal = this.b[i] >= PEDAL_DOWN_FROM ? 1 : 0;
      }
      // where the song will stand still, the notes about to begin are struck too
      if (d.seek && d.sound && d.ahead > 0) for (let k = i; k < this.N && this.t[k] < d.pos + d.ahead; k++) if (this.ty[k] === EV_ON) vel[this.a[k]] = this.b[k];
      this.dueSound = !!(d.seek && d.sound);
      this.dueFrame = d.frame; this.duePos = d.pos; this.dueRate = d.rate; this.dueSeek = !!d.seek; this.dueIndex = i; this.duePedal = pedal;
    } else if (d.type === 'stop') {
      this.x.allOff(); this.run = false; this.dueFrame = -1;
    } else if (d.type === 'note') {
      if (d.on) this.x.noteOn(d.midi, d.vel); else this.x.noteOff(d.midi);
    } else if (d.type === 'pedal') {
      this.x.setPedal(d.down ? 1 : 0);
    } else if (d.type === 'stat') {
      this.port.postMessage({ type: 'stat', voices: this.x.activeVoices(), i: this.i, bytes: this.x.memory.buffer.byteLength });
    }
  }
  process(_, outputs) {
    const L = outputs[0][0], R = outputs[0][1] || L, n = L.length;
    let done = 0;
    while (done < n) {
      let seg = n - done;
      if (this.dueFrame >= 0) {
        const wait = this.dueFrame - (currentFrame + done);
        if (wait <= 0) {
          if (this.dueSeek) {
            this.x.allOff(); this.i = this.dueIndex; this.x.setPedal(this.duePedal);
            if (this.dueSound) { const vel = this.dueVel; for (let m = 0; m < KEYS; m++) if (vel[m] > 0) this.x.noteOn(m, vel[m]); }
          }
          this.pos = this.duePos; this.rate = this.dueRate; this.run = true; this.dueFrame = -1;
        } else if (wait < seg) seg = wait;
      }
      if (this.run && this.i < this.N) {
        const rel = this.rate > 0 ? Math.ceil((this.t[this.i] - this.pos) / this.rate * sampleRate) : Infinity;      // standing still: nothing comes due
        if (rel <= 0) {
          const ty = this.ty[this.i], a = this.a[this.i], b = this.b[this.i];
          if (ty === EV_ON) this.x.noteOn(a, b); else if (ty === EV_OFF) this.x.noteOff(a); else this.x.setPedal(b >= PEDAL_DOWN_FROM ? 1 : 0);
          this.i++; continue;
        }
        if (rel < seg) seg = rel;
      }
      this.x.render(seg); this.views();
      const vL = this.vL, vR = this.vR;
      for (let k = 0; k < seg; k++) L[done + k] = vL[k];
      if (R !== L) for (let k = 0; k < seg; k++) R[done + k] = vR[k];
      if (this.run) this.pos += seg * this.rate / sampleRate;
      done += seg;
    }
    return true;
  }
}
registerProcessor('gpt-piano', PianoProcessor);
