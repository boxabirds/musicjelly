// One octave of piano keys as numbers: where each key is, how far down it is, and the solid shapes a jelly stands on.
// Nothing here draws; src/keys3d.mjs builds the meshes from the same numbers and tools/terrain-test.mjs checks them.
//
// The key sizes are the piano's (greatpianoteachers src/main.js: KW, WHITE_KEY, BLACK_KEY, BLACK_TOP_Y - KEY_TOP_Y,
// KEY_SWING), in metres, multiplied by `scale` so a jelly letter of the size its physics was tuned for fits on a key.
// Axes: x along the keys (C on the left), y up with the white keys' tops at 0 when up, z towards the player. The line
// z = 0 is where letters stand, STAND_BACK behind the keys' front edge.
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
export const WHITES = 7, KEYS = 12;
export const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11], LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const BLACK_AFTER_WHITE = [0, 1, 3, 4, 5];                 // a black key sits to the right of these white keys
export const BLACK_PITCH_CLASSES = [1, 3, 6, 8, 10];
export const pitchClass = midi => ((midi % KEYS) + KEYS) % KEYS;
// how fast a key goes down and comes back (seconds for the whole way), and the fastest the surface under a jelly may
// come back up (jelly units a second): a real key's return would throw a jelly lying on it into the air. A letter
// standing at home on its own key is not thrown: it is moved with the key (`carrying`, JellyWorld.ride).
export const KEY_DOWN_S = 0.03, KEY_UP_S = 0.06, FLOOR_RISE_MOST = 0.22;

// The octave at `scale`. `down` (0..1 per pitch class) is where each key is drawn; `floor` is where a jelly feels it.
// levelFrom: how far behind the home line a letter's feet reach (see `sink`).
export function createOctave(scale, levelFrom = 0) {
  const s = scale, pitch = KEY.pitch * s, front = STAND_BACK * s, back = front - KEY.whiteLong * s, dip = KEY.swing * KEY.whiteLong * s;
  const left = -WHITES / 2 * pitch, right = WHITES / 2 * pitch;
  const whiteX = w => left + (w + 0.5) * pitch;
  const keys = [];
  WHITE_PITCH_CLASSES.forEach((pc, w) => { keys[pc] = { pc, black: false, x: whiteX(w), wide: (KEY.pitch - KEY.gap) * s, x0: left + w * pitch, x1: left + (w + 1) * pitch, z0: back, z1: front, top: 0 }; });
  BLACK_AFTER_WHITE.forEach((w, i) => {
    const x = left + (w + 1) * pitch, half = KEY.blackWide * s / 2, z0 = back + KEY.blackBack * s;
    keys[BLACK_PITCH_CLASSES[i]] = { pc: BLACK_PITCH_CLASSES[i], black: true, x, wide: KEY.blackWide * s, x0: x - half, x1: x + half, z0, z1: z0 + KEY.blackLong * s, top: KEY.blackTop * s };
  });
  const rail = { x0: left, x1: right, z0: back - KEY.bedDeep * s, z1: front - KEY.railFront * s, top: KEY.railHigh * s };
  const tableY = -(KEY.whiteHigh + KEY.bedDeep) * s;
  const down = new Float32Array(KEYS), floor = new Float32Array(KEYS), held = new Uint8Array(KEYS);
  const carrying = new Uint8Array(KEYS);      // set by the page for a key whose own letter stands on it: that letter is moved with the key, so the ground there is the key itself
  // how far below its resting height a key's top is at z: nothing at the back end it turns about, `dip` at the front
  // For a jelly the key's top is level from `levelFrom` behind the home line to the front edge, at the depth the home line
  // goes to: a letter standing there goes down and up with that one height (JellyWorld.ride), and a top that sloped
  // under its feet would tip it forwards a little at every press until it fell off. The drawn key still slopes; under
  // a letter's feet the two differ by about a millimetre.
  const level = -levelFrom, homeShare = (0 - back) / (front - back);
  const sink = (k, z, amount) => amount * dip * homeShare * Math.min(1, Math.max(0, (z - back) / (level - back)));
  const topOf = (k, z) => k.top - sink(k, z, floor[k.pc]);
  // the height a jelly can stand on at (x, z): the highest solid thing there, or the table
  function heightAt(x, z) {
    let h = tableY;
    if (x >= rail.x0 && x <= rail.x1 && z >= rail.z0 && z <= rail.z1) h = rail.top;
    for (let i = 0; i < KEYS; i++) { const k = keys[i]; if (x >= k.x0 && x <= k.x1 && z >= k.z0 && z <= k.z1) { const t = topOf(k, z); if (t > h) h = t; } }
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
    const tryBox = b => {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return;
      const out = [[b.x0 - EDGE, z, x - b.x0], [b.x1 + EDGE, z, b.x1 - x], [x, b.z0 - EDGE, z - b.z0], [x, b.z1 + EDGE, b.z1 - z]];
      for (const [ox, oz, d] of out) if (d < best && heightAt(ox, oz) <= y) { best = d; bx = ox; bz = oz; side = true; }
    };
    tryBox(rail); for (let i = 0; i < KEYS; i++) tryBox(keys[i]);
    if (side) { p[j] = bx; p[j + 2] = bz; return 0; }
    p[j + 1] = h; return best;
  }
  // press and release: `held` counts the keys down in any octave for each pitch class
  const press = pc => { held[pc]++; }, release = pc => { if (held[pc] > 0) held[pc]--; };
  // move the keys on by dt seconds: drawn keys at a key's own speed; the floor follows down at once and up slowly
  function step(dt) {
    for (let i = 0; i < KEYS; i++) {
      const to = held[i] ? 1 : 0;
      if (to > down[i]) down[i] = Math.min(1, down[i] + dt / KEY_DOWN_S); else if (to < down[i]) down[i] = Math.max(0, down[i] - dt / KEY_UP_S);
      floor[i] = carrying[i] || down[i] >= floor[i] ? down[i] : Math.max(down[i], floor[i] - FLOOR_RISE_MOST * dt / dip);
    }
  }
  return { scale: s, pitch, front, back, left, right, dip, keys, rail, tableY, down, floor, held, carrying, heightAt, resolve, press, release, step, whiteX,
    homeX: letter => whiteX(LETTERS.indexOf(letter)) };
}
