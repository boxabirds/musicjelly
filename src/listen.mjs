// Listening: single notes heard through a microphone, turned into the same "key down, key up" events a MIDI keyboard
// gives. Version 1: one note at a time. The lesson then judges each note against what it expects, as it does for MIDI.
// Pure: it is given windows of sound and the time, and returns events. src/mic.mjs feeds it; tools/listen-test.mjs
// plays recorded piano notes through it.
//
// How a window is read (the McLeod pitch method): the sound is compared with itself shifted by every lag; the first
// lag at which it matches nearly as well as it ever does is one period of the note. `clarity` (0..1) is how well it
// matched there: a clean note is near 1, noise and the thump of a hammer are low.
// What it cannot tell: how long a note is held (a piano note fades while the key is still down), how hard it was
// struck beyond a rough guess, two notes at once, or the pedal. An octave may be heard wrongly (a piano's low notes
// have weak fundamentals); the lessons accept any octave.
export const LISTEN = {
  lowest: 60, highest: 2200,           // hertz: the pitches looked for (about B1 to C7)
  clarity: 0.82,                       // a window must match itself this well to count as a note
  firstPeak: 0.9,                      // the first match within this share of the best is taken (the best may be two periods)
  stable: 2,                           // windows in a row that agree before a note is announced
  gateLeast: 0.004, gateOverFloor: 4,  // the quietest a note can be: this, or this many times the room's own noise
  floorRiseS: 3, floorMost: 0.02,      // the room's noise is the quietest the microphone has been lately: it creeps up over this long, and is never taken to be louder than this
  offShare: 0.12, offWindows: 3,       // a note is over when it has sunk to this share of its loudest, for this many windows
  restrike: 1.7, restrikeAfterS: 0.11, faded: 0.75, reborn: 0.3,      // the same note struck again: louder by this factor than its quietest since its loudest, no sooner than this, and only once it had faded to this share of its loudest; reborn: a note that died away must come back to this share of its loudest to count as struck again
  loudDb: -8, softDb: -42,             // loudness that counts as the hardest and the softest blow (decibels of full scale)
};
const A4 = 440, A4_MIDI = 69, SEMITONES = 12;
export const midiOf = hz => A4_MIDI + SEMITONES * Math.log2(hz / A4);

// sampleRate: of the windows given to hear(). size: the length of each window (2048 is about 43 ms at 48 kHz).
export function createListener(sampleRate, size = 2048) {
  const minLag = Math.max(2, Math.floor(sampleRate / LISTEN.highest)), maxLag = Math.min(size >> 1, Math.ceil(sampleRate / LISTEN.lowest));
  const nsdf = new Float32Array(maxLag + 2), events = [];
  const S = { note: -1, cand: -1, count: 0, peak: 0, least: 0, quiet: 0, onAt: -1, floor: LISTEN.gateLeast / LISTEN.gateOverFloor, rms: 0, was: 0, pitch: 0, clarity: 0, heardAt: -1, faded: -1, fadedAt: 0, fadedPeak: 0, again: 0 };      // faded: the note that last died away (it may still be ringing), and how quiet it was then
  // the pitch of a window: fills S.pitch (a MIDI number with a fraction, 0 if none) and S.clarity
  function pitchOf(x) {
    let peakLag = 0, peakVal = 0, best = 0, positive = false, started = false;
    for (let lag = 1; lag <= maxLag; lag++) {
      let r = 0, m = 0; const n = size - lag;
      for (let i = 0; i < n; i++) { const a = x[i], b = x[i + lag]; r += a * b; m += a * a + b * b; }
      nsdf[lag] = m > 0 ? 2 * r / m : 0;
    }
    nsdf[maxLag + 1] = 0;
    // the highest point of each stretch above zero, after the curve has first dipped below it
    let pick = 0, pickVal = 0;
    for (let lag = 1; lag <= maxLag; lag++) if (nsdf[lag] > best && started) best = nsdf[lag]; else if (nsdf[lag] < 0) started = true;
    if (best <= 0) { S.pitch = 0; S.clarity = 0; return; }
    started = false;
    for (let lag = 1; lag <= maxLag; lag++) {
      const v = nsdf[lag];
      if (v < 0) { if (positive && peakVal >= LISTEN.firstPeak * best && peakLag >= minLag) { pick = peakLag; pickVal = peakVal; break; } started = true; positive = false; peakVal = 0; continue; }
      if (!started) continue;
      positive = true; if (v > peakVal) { peakVal = v; peakLag = lag; }
    }
    if (!pick && positive && peakVal >= LISTEN.firstPeak * best && peakLag >= minLag) { pick = peakLag; pickVal = peakVal; }
    if (!pick) { S.pitch = 0; S.clarity = 0; return; }
    // between samples: the top of the curve through the peak and its two neighbours
    const a = nsdf[pick - 1], b = nsdf[pick], c = nsdf[pick + 1], bend = a - 2 * b + c, shift = bend < 0 ? 0.5 * (a - c) / bend : 0;
    S.pitch = midiOf(sampleRate / (pick + shift)); S.clarity = pickVal;
  }
  const velOf = rms => Math.min(1, Math.max(0.15, (20 * Math.log10(Math.max(rms, 1e-6)) - LISTEN.softDb) / (LISTEN.loudDb - LISTEN.softDb)));
  const on = (midi, t) => { S.again = 0; S.note = midi; S.peak = S.least = S.rms; S.quiet = 0; S.onAt = t; events.push({ type: 'on', midi, vel: velOf(S.rms), down: true }); };
  const off = () => { if (S.note >= 0) events.push({ type: 'off', midi: S.note, vel: 0, down: false }); S.note = -1; S.cand = -1; S.count = 0; };
  return {
    state: S, size,
    // x: `size` samples, the newest sound. t: the time in seconds (any clock that only goes forward).
    // Returns the events of this window (an array that is reused: read it before the next call).
    hear(x, t) {
      events.length = 0;
      let sum = 0; for (let i = 0; i < size; i++) sum += x[i] * x[i];
      const rms = Math.sqrt(sum / size), dt = S.heardAt < 0 ? 0 : t - S.heardAt; S.heardAt = t; S.was = S.rms; S.rms = rms;
      const gate = Math.max(LISTEN.gateLeast, S.floor * LISTEN.gateOverFloor);
      if (rms < gate) { S.pitch = 0; S.clarity = 0; } else pitchOf(x);
      // The room's own noise: the quietest the microphone has been while no note was sounding, forgetting slowly. A note
      // that is held is not the room (taken as the room, a fading note raised its own gate and cut itself off).
      if (S.note < 0 && S.clarity < LISTEN.clarity) S.floor = Math.min(LISTEN.floorMost, Math.min(rms, S.floor * (1 + dt / LISTEN.floorRiseS)));
      const voiced = S.pitch > 0 && S.clarity >= LISTEN.clarity, m = voiced ? Math.round(S.pitch) : -1;
      if (S.note < 0) {
        // a note that faded away is still ringing: it is not a new note unless it is struck again (louder than it faded to)
        // (a high note's strings beat against each other as it rings, so it swells a little on its own: it must also come
        // back to a fair share of how loud it was). Once the room is silent again the note is forgotten.
        if (rms < gate) S.faded = -1;
        if (m >= 0 && S.faded >= 0 && (m - S.faded) % SEMITONES === 0 && rms < Math.max(S.fadedAt * LISTEN.restrike, S.fadedPeak * LISTEN.reborn)) { S.fadedAt = Math.min(S.fadedAt, rms); return events; }
        if (m < 0) { S.cand = -1; S.count = 0; } else { if (m === S.cand) S.count++; else { S.cand = m; S.count = 1; } if (S.count >= LISTEN.stable) { S.faded = -1; on(m, t); } }
        return events;
      }
      // its loudest so far, and its quietest since then (a new loudest starts the quietest again: the swell of the
      // attack is not a fade)
      if (rms > S.peak) S.peak = S.least = rms; else if (rms < S.least) S.least = rms;
      // over: it has died away
      S.quiet = rms < Math.max(gate, S.peak * LISTEN.offShare) ? S.quiet + 1 : 0;
      if (S.quiet >= LISTEN.offWindows) { S.faded = S.note; S.fadedAt = rms; S.fadedPeak = S.peak; off(); return events; }
      // another note: a different letter, steadily (the same letter an octave off is the ear changing its mind, not the player)
      if (m >= 0 && (m - S.note) % SEMITONES !== 0) { if (m === S.cand) S.count++; else { S.cand = m; S.count = 1; } if (S.count >= LISTEN.stable) { off(); S.rms = rms; on(m, t); return events; } }
      else { S.cand = -1; S.count = 0; }
      // The same note struck again: it had faded and is suddenly louder. Not announced at once: the swell may be the
      // NEXT note beginning while the window still reads as the old one, so the pitch must stay the same for a few
      // windows more (if it changes, the lines above have already called it another note).
      if (S.again === 0 && t - S.onAt >= LISTEN.restrikeAfterS && rms > S.was && rms > S.least * LISTEN.restrike && S.least < S.peak * LISTEN.faded) S.again = 1;
      else if (S.again > 0) { if (m >= 0 && (m - S.note) % SEMITONES === 0) S.again++; else if (m >= 0) S.again = 0; }
      if (S.again > LISTEN.stable) { const again = S.note; off(); on(again, t); }
      return events;
    },
    // let go of everything (the microphone was stopped)
    reset() { events.length = 0; off(); S.heardAt = -1; return events; },
  };
}
