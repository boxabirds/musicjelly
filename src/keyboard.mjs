// The piano keyboard as numbers: where each of the 88 keys is, how far down it is, and the solid shapes a jelly stands
// on. Only the keys in the current `range` exist (are drawn, are solid): the lesson starts with one octave and later
// opens out to all 88. Nothing here draws; src/keys3d.mjs builds the meshes from the same numbers and
// tools/terrain-test.mjs checks them.
//
// The key sizes are the piano's (greatpianoteachers src/main.js: KW, WHITE_KEY, BLACK_KEY, BLACK_TOP_Y - KEY_TOP_Y,
// KEY_SWING), in metres, multiplied by `scale` so a jelly letter of the size its physics was tuned for fits on a key.
// Axes: x along the keys (low notes on the left, the first octave shown centred on 0), y up with the white keys' tops at
// 0 when up, z towards the player. The line z = 0 is where letters stand, STAND_BACK behind the keys' front edge.
export const KEY = {
  pitch: 0.0236,                       // one white key and its gap
  gap: 0.0016,                         // between two white keys
  whiteHigh: 0.022, whiteLong: 0.19,
  blackWide: 0.0125, blackHigh: 0.017, blackLong: 0.105,
  blackTop: 0.016,                     // a black key's top above the white keys' tops
  blackBack: 0.02,                     // a black key starts this far in front of the white keys' back ends
  swing: 0.06,                         // radians a key turns when fully down: about 10 mm at the front edge
  railFront: 0.165,                    // the rail behind the keys hides them from here back (measured from the front edge)
  railHigh: 0.03,                      // its top above the white keys' tops
  bedDeep: 0.012,                      // the block the keys rest on, below their undersides
};
export const STAND_BACK = 0.012;       // metres (before scaling) from the keys' front edge to the line letters stand on
export const MIDI_LOW = 21, MIDI_HIGH = 108, MIDI_SLOTS = 128, SEMITONES = 12;      // A0 to C8: the 88 keys
export const FIRST_OCTAVE = [60, 71];  // the octave the lesson opens on: middle C to the B above
export const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11], LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const pitchClass = midi => ((midi % SEMITONES) + SEMITONES) % SEMITONES;
export const isBlack = midi => !WHITE_PITCH_CLASSES.includes(pitchClass(midi));
export const letterOf = midi => LETTERS[WHITE_PITCH_CLASSES.indexOf(pitchClass(midi))] || null;      // a white key's letter
// every key of the 88 that bears a letter, lowest first
export const keysNamed = letter => { const out = []; for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) if (letterOf(m) === letter) out.push(m); return out; };
// how fast a key goes down and comes back (seconds for the whole way), and the fastest the surface under a jelly may
// come back up (jelly units a second): a real key's return would throw a jelly lying on it into the air. A letter
// standing at home on its own key is not thrown: it is moved with the key (`carrying`, JellyWorld.ride).
export const KEY_DOWN_S = 0.03, KEY_UP_S = 0.06, FLOOR_RISE_MOST = 0.22;
const whitesBelow = midi => { let n = 0; for (let m = 0; m < midi; m++) if (!isBlack(m)) n++; return n; };      // white keys below a key, counted from MIDI 0

// The keyboard at `scale`. `down` (0..1 per key, by MIDI number) is where each key is drawn; `floor` is where a jelly
// feels it. levelFrom: how far behind the home line a letter's feet reach (see `sink`).
export function createKeyboard(scale, levelFrom = 0, range = FIRST_OCTAVE) {
  const s = scale, pitch = KEY.pitch * s, front = STAND_BACK * s, back = front - KEY.whiteLong * s, dip = KEY.swing * KEY.whiteLong * s;
  // x of the left edge of white key number w (counted from MIDI 0): the first octave's seven keys straddle x = 0
  const firstWhite = whitesBelow(FIRST_OCTAVE[0]), octaveWhites = WHITE_PITCH_CLASSES.length, edge = w => (w - firstWhite - octaveWhites / 2) * pitch;
  const keys = new Array(MIDI_SLOTS).fill(null), whiteAt = [], blackAfter = [];      // whiteAt[w]: the white key numbered w; blackAfter[w]: the black key on its right edge
  for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) {
    const w = whitesBelow(m);
    if (!isBlack(m)) { keys[m] = { midi: m, black: false, w, x: edge(w) + pitch / 2, wide: (KEY.pitch - KEY.gap) * s, x0: edge(w), x1: edge(w + 1), z0: back, z1: front, top: 0 }; whiteAt[w] = keys[m]; }
    else { const x = edge(w), half = KEY.blackWide * s / 2, z0 = back + KEY.blackBack * s; keys[m] = { midi: m, black: true, w: w - 1, x, wide: KEY.blackWide * s, x0: x - half, x1: x + half, z0, z1: z0 + KEY.blackLong * s, top: KEY.blackTop * s }; blackAfter[w - 1] = keys[m]; }
  }
  const rail = { x0: 0, x1: 0, z0: back - KEY.bedDeep * s, z1: front - KEY.railFront * s, top: KEY.railHigh * s };
  const tableY = -(KEY.whiteHigh + KEY.bedDeep) * s;
  const down = new Float32Array(MIDI_SLOTS), floor = new Float32Array(MIDI_SLOTS), held = new Uint8Array(MIDI_SLOTS);
  const carrying = new Uint8Array(MIDI_SLOTS);      // set by the page for a key whose own letter stands on it: that letter is moved with the key, so the ground there is the key itself
  const K = { scale: s, pitch, front, back, dip, keys, rail, tableY, down, floor, held, carrying, lo: 0, hi: 0, left: 0, right: 0 };
  // which keys exist: lo and hi are MIDI numbers of white keys
  K.setRange = (lo, hi) => {
    K.lo = lo; K.hi = hi; K.left = rail.x0 = keys[lo].x0; K.right = rail.x1 = keys[hi].x1;
    for (let m = 0; m < MIDI_SLOTS; m++) if (m < lo || m > hi) down[m] = floor[m] = held[m] = 0;      // a key that no longer exists is not down
  };
  K.setRange(range[0], range[1]);
  const exists = k => k && k.midi >= K.lo && k.midi <= K.hi;
  // For a jelly the key's top is level from `levelFrom` behind the home line to the front edge, at the depth the home line
  // goes to: a letter standing there goes down and up with that one height (JellyWorld.ride), and a top that sloped
  // under its feet would tip it forwards a little at every press until it fell off. The drawn key still slopes; under
  // a letter's feet the two differ by about a millimetre.
  const level = -levelFrom, homeShare = (0 - back) / (front - back);
  const topOf = (k, z) => (k.support ? k.top - floor[k.key] * dip * homeShare * k.follow : k.top - floor[k.midi] * dip * homeShare * Math.min(1, Math.max(0, (z - back) / (level - back))));
  // Supports: other flat things a jelly can stand on, put there by the page (the invisible ledges over the fingers of
  // the hand). Each is a solid block from the table up: { x0, x1, z0, z1, top, key, follow }: its top goes down by
  // `follow` of what the home line of key `key` goes down.
  const supports = [];
  K.setSupports = list => { supports.length = 0; for (const b of list) supports.push({ ...b, support: true }); near.length = mine.length = FIXED_THINGS + supports.length; };
  K.supports = supports;
  const within = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  // The few solid things that can be at x: the rail, the white key there, and the black keys on its two edges.
  // Looked up, not searched: every point of every jelly asks several times a step.
  const FIXED_THINGS = 4, near = [null, null, null, null], mine = [null, null, null, null];
  function thingsAt(x) {
    const w = Math.floor((x - edge(0)) / pitch), white = whiteAt[w], b0 = blackAfter[w - 1], b1 = blackAfter[w];
    near[0] = x >= rail.x0 && x <= rail.x1 ? rail : null; near[1] = exists(white) ? white : null; near[2] = exists(b0) ? b0 : null; near[3] = exists(b1) ? b1 : null;
    for (let i = 0; i < supports.length; i++) near[FIXED_THINGS + i] = x >= supports[i].x0 && x <= supports[i].x1 ? supports[i] : null;
    return near;
  }
  // the height a jelly can stand on at (x, z): the highest solid thing there, or the table
  function heightAt(x, z) {
    let h = tableY; const T = thingsAt(x);
    for (let i = 0; i < T.length; i++) { const b = T[i]; if (b && within(b, x, z)) { const t = b === rail ? rail.top : topOf(b, z); if (t > h) h = t; } }
    return h;
  }
  // Keep a point out of the solid things. p: Float64Array, j: offset of x. Returns how far it was pushed UP (0 if it was
  // free or was pushed sideways), which is what friction needs. A point under a surface goes up, unless a side of the
  // thing it is in is nearer and open (the ground beside it is below the point): then it goes out of that side.
  const EDGE = 1e-5;
  function resolve(p, j) {
    const x = p[j], y = p[j + 1], z = p[j + 2], h = heightAt(x, z);
    if (y >= h) return 0;
    let best = h - y, bx = x, bz = z, side = false;
    const T = thingsAt(x); for (let i = 0; i < T.length; i++) mine[i] = T[i];      // heightAt below reuses the list
    for (let i = 0; i < mine.length; i++) {
      const b = mine[i]; if (!b || !within(b, x, z)) continue;
      let d = x - b.x0; if (d < best && heightAt(b.x0 - EDGE, z) <= y) { best = d; bx = b.x0 - EDGE; bz = z; side = true; }
      d = b.x1 - x; if (d < best && heightAt(b.x1 + EDGE, z) <= y) { best = d; bx = b.x1 + EDGE; bz = z; side = true; }
      d = z - b.z0; if (d < best && heightAt(x, b.z0 - EDGE) <= y) { best = d; bx = x; bz = b.z0 - EDGE; side = true; }
      d = b.z1 - z; if (d < best && heightAt(x, b.z1 + EDGE) <= y) { best = d; bx = x; bz = b.z1 + EDGE; side = true; }
    }
    if (side) { p[j] = bx; p[j + 2] = bz; return 0; }
    p[j + 1] = h; return best;
  }
  // press and release: `held` counts the presses on a key (in the first octave, one key stands for its note in every octave)
  K.press = m => { held[m]++; }; K.release = m => { if (held[m] > 0) held[m]--; };
  // move the keys on by dt seconds: drawn keys at a key's own speed; the floor follows down at once and up slowly
  K.step = dt => {
    for (let i = K.lo; i <= K.hi; i++) {
      const to = held[i] ? 1 : 0;
      if (to > down[i]) down[i] = Math.min(1, down[i] + dt / KEY_DOWN_S); else if (to < down[i]) down[i] = Math.max(0, down[i] - dt / KEY_UP_S);
      floor[i] = carrying[i] || down[i] >= floor[i] ? down[i] : Math.max(down[i], floor[i] - FLOOR_RISE_MOST * dt / dip);
    }
  };
  // every key up and let go (a lesson begins afresh)
  K.letGo = () => { down.fill(0); floor.fill(0); held.fill(0); };
  K.heightAt = heightAt; K.resolve = resolve; K.homeX = m => keys[m].x;
  // The key shown for a note the learner plays: while only one octave exists, its key of the same name; with all 88,
  // the key itself. null: no such key is shown.
  K.shown = midi => { if (K.hi - K.lo < SEMITONES) return K.lo + pitchClass(midi - K.lo); return midi >= K.lo && midi <= K.hi ? midi : null; };
  return K;
}
