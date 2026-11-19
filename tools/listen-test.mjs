// The listener on real piano notes: node tools/listen-test.mjs
// The notes are the app's own piano samples (Salamander Grand, studio recordings), turned into sound files by macOS's
// afconvert, shifted in pitch where a note has no sample of its own, laid end to end with room noise under them, and
// given to the listener in windows as the page gives them. This is clean studio sound: it shows the method works, not
// that it works through an iPad's microphone in a kitchen.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { createListener } from '../src/listen.mjs'; import { checker } from './check.mjs';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), RATE = 48000, SIZE = 2048, FRAME_S = 1 / 60, TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-listen-'));
const T = checker('listening to single notes');
const ROOTS = { 36: 'C2', 48: 'C3', 60: 'C4', 63: 'Ds4', 66: 'Fs4', 69: 'A4', 72: 'C5', 84: 'C6' }, cache = new Map();
function sample(root, layer = 9) {
  const key = root + '_' + layer; if (cache.has(key)) return cache.get(key);
  const wav = path.join(TMP, key + '.wav'); execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', path.join(ROOT, 'smp', `${ROOTS[root]}v${layer}.mp3`), wav]);
  const b = fs.readFileSync(wav), at = b.indexOf('data') + 8, n = (b.length - at) >> 1, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = b.readInt16LE(at + i * 2) / 32768;
  let start = 0; while (start < n && Math.abs(x[start]) < 0.003) start++;
  const out = x.subarray(start); cache.set(key, out); return out;
}
// a note of the piano: the nearest sample, played faster or slower to the pitch, let go after `held` seconds
function note(midi, held, gain = 1, layer = 9) {
  const root = Object.keys(ROOTS).map(Number).reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a)), src = sample(root, layer), rate = 2 ** ((midi - root) / 12);
  const RELEASE_S = 0.12, n = Math.round((held + RELEASE_S) * RATE), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * rate, k = Math.floor(p); if (k + 1 >= src.length) break; const t = i / RATE; out[i] = gain * (src[k] + (src[k + 1] - src[k]) * (p - k)) * (t < held ? 1 : Math.max(0, 1 - (t - held) / RELEASE_S)); }
  return out;
}
// a tune: [[midi, at seconds, held seconds, gain?], ...] over room noise
function tune(notes, seconds, noise = 0.0015) {
  const x = new Float32Array(Math.round(seconds * RATE)); let seed = 1;
  for (let i = 0; i < x.length; i++) { seed = (seed * 16807) % 2147483647; x[i] = (seed / 2147483647 - 0.5) * 2 * noise * Math.SQRT2 * 1.2; }
  for (const [m, at, held, gain = 1] of notes) { const s = note(m, held, gain), o = Math.round(at * RATE); for (let i = 0; i < s.length && o + i < x.length; i++) x[o + i] += s[i]; }
  return x;
}
// hear a tune as the page does: the newest SIZE samples, every frame
function hear(x) {
  const L = createListener(RATE, SIZE), out = [], win = new Float32Array(SIZE);
  for (let t = SIZE / RATE; t * RATE < x.length; t += FRAME_S) { const end = Math.round(t * RATE); win.set(x.subarray(end - SIZE, end)); for (const e of L.hear(win, t)) out.push({ ...e, t }); }
  return out;
}
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], name = m => NAMES[m % 12] + (Math.floor(m / 12) - 1), ons = ev => ev.filter(e => e.type === 'on');
const letters = ev => ons(ev).map(e => NAMES[e.midi % 12]).join(' ');
{ // every white key of the octave shown, half a second each
  const keys = [60, 62, 64, 65, 67, 69, 71], ev = hear(tune(keys.map((m, i) => [m, 0.5 + i * 0.6, 0.45]), 5.2));
  T.ok(letters(ev) === 'C D E F G A B', 'C D E F G A B, one after another, are heard as those letters', letters(ev));
  if (process.env.DEBUG) console.log(ev.map(e => `${e.t.toFixed(3)} ${e.type} ${name(e.midi)}`).join('\n'));
  T.ok(ons(ev).every((e, i) => e.midi === keys[i]), 'in the right octave too', ons(ev).map(e => name(e.midi)).join(' '));
  const late = ons(ev).map((e, i) => (e.t - (0.5 + i * 0.6)) * 1000);
  T.ok(Math.max(...late) < 120, 'each within 120 ms of being struck', late.map(v => v.toFixed(0)).join(' ') + ' ms');
  const offs = ev.filter(e => e.type === 'off'); T.ok(offs.length === 7 && offs.every((e, i) => e.t > 0.5 + i * 0.6 + 0.3 && e.t < 0.5 + i * 0.6 + 0.6 + 0.2), 'and each is let go when its key is', offs.map((e, i) => ((e.t - (0.5 + i * 0.6)) * 1000).toFixed(0)).join(' ') + ' ms after its start');
}
{ // the game's rounds at 120 beats a minute
  const round = [60, 62, 64, 65, 67, 65, 64, 62, 60], ev = hear(tune(round.map((m, i) => [m, 0.5 + i * 0.5, 0.4]), 5.5));
  T.ok(letters(ev) === 'C D E F G F E D C', 'a note every half second, up and down', letters(ev));
}
{ // joined notes: the next begins as the last is let go
  const ev = hear(tune([[60, 0.5, 0.5], [62, 1.0, 0.5], [64, 1.5, 0.5]], 2.6));
  T.ok(letters(ev) === 'C D E', 'notes joined end to end are still three notes', letters(ev));
}
{ // the same key twice
  const ev = hear(tune([[60, 0.5, 0.35], [60, 1.0, 0.35], [60, 1.5, 0.35]], 2.5));
  T.ok(letters(ev) === 'C C C', 'the same key three times is three notes', letters(ev));
  const held = hear(tune([[60, 0.5, 2.5]], 3.5));
  T.ok(ons(held).length === 1, 'one long note is one note, not several as it fades', String(ons(held).length));
}
{ // other octaves, soft and loud: the letter is what the lessons need
  const keys = [36, 48, 72, 84, 96], ev = hear(tune(keys.map((m, i) => [m, 0.5 + i * 0.8, 0.6]), 5));
  if (process.env.DEBUG) console.log(ev.map(e => `${e.t.toFixed(3)} ${e.type} ${name(e.midi)}`).join('\n'));
  T.ok(letters(ev) === 'C C C C C', 'C in five octaves is heard as C each time', ons(ev).map(e => name(e.midi)).join(' ') + ' (played ' + keys.map(name).join(' ') + ')');
  const soft = hear(tune([[60, 0.5, 0.5, 0.08], [64, 1.2, 0.5, 0.08]], 2.2));
  T.ok(letters(soft) === 'C E', 'played very softly, still heard', letters(soft));
  const v = ons(hear(tune([[60, 0.5, 0.5, 0.1], [60, 1.4, 0.5, 1]], 2.4))).map(e => e.vel);
  T.ok(v.length === 2 && v[1] > v[0] + 0.2, 'a loud note is reported as harder than a soft one', v.map(x => x.toFixed(2)).join(' '));
}
{ // nothing played
  T.ok(ons(hear(tune([], 3))).length === 0, 'room noise alone is no note');
  T.ok(ons(hear(tune([], 3, 0.02))).length === 0, 'nor is loud hiss');
  const noisy = hear(tune([[60, 0.6, 0.5], [62, 1.3, 0.5]], 2.4, 0.01));
  T.ok(letters(noisy) === 'C D', 'in a noisier room (hiss at a fifth of a soft note) the notes are still heard', letters(noisy));
}
{ // what it is NOT for: two keys at once
  const ev = hear(tune([[60, 0.5, 0.8], [64, 0.5, 0.8], [67, 0.5, 0.8]], 1.8));
  console.log(`  --    a chord (C E G together) is heard as: ${ons(ev).map(e => name(e.midi)).join(' ') || 'nothing'} (version 1 hears one note at a time)`);
}
fs.rmSync(TMP, { recursive: true, force: true });
T.done();
