// Fingering and hand position for one hand.
//
// planHand() chooses a finger for every note with a beam search over a cost model taken from
// Parncutt, Sloboda, Clarke, Raekallio and Desain (1997), "An ergonomic model of keyboard fingering
// for melodic fragments" (stretch, small-span, large-span, weak-finger and black-key rules), extended
// to chords and held notes. It then lays out where the hand sits for each group of notes and when each
// key must be let go so the hand has time to travel to the next one.
//
// Everything here works in "u" space: u = side * x, so the thumb is always on the low side and both
// hands can be planned as a right hand. Fingers are numbered a = 0 thumb .. 4 little.

export const KEY_PITCH = 0.0236;                                  // width of a white key, metres
// where each fingertip rests relative to the hand's centre line: neighbouring fingers on neighbouring white keys
export const HOME = [-2, -1, 0, 1, 2].map(k => k * KEY_PITCH);
// how far a fingertip may be from its home while it holds a key [towards the thumb side, towards the little finger side]
export const REACH = [[-0.053, 0.066], [-0.030, 0.023], [-0.022, 0.022], [-0.022, 0.024], [-0.020, 0.030]];
// on a black key the short fingers are already reaching forward, so they stretch less far sideways
const REACH_BLACK = [[-0.036, 0.062], REACH[1], REACH[2], REACH[3], [-0.019, 0.024]];
const share = k => HOME.map(() => [k, k]);
export const FULL = share(1);
export const HOLD = share(0.75);                                  // the share of that reach a held key may use while the hand moves on
// the share the hand uses before it prefers to move. The thumb opens out far more easily than the little finger,
// so in a wide stretch the hand sits towards the little finger and the thumb does the reaching.
const COMFORT = [[0.85, 0.45], [0.45, 0.45], [0.45, 0.45], [0.45, 0.45], [0.45, 0.35]];
const HURRY_PASSES = 60, HURRY_SLACK = 1e-4;                       // see planHand: easing trips the music leaves too little time for
const CHORD_WINDOW = 0.05;                                        // onsets closer than this are one group
const LEGATO = 0.06;                                              // a note that ends this soon after the next begins is not "held"
const MIN_HOLD = 0.07, FINGER_HOP = 0.06;                         // shortest key hold; time a finger needs to get to its next key
const FINGER_SWAP = 0.075;                                        // a finger leaves a key this long before another finger repeats it
const HOLD_SHARE_OF_GAP = 0.20, HOLD_LEAST = 0.04;                // in quick notes a key is held for this share of the gap to the next (never less than HOLD_LEAST)
const BEAM = 96;

// Spans in semitones from the lower finger to the higher finger: [MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac].
// From Table 1 of Parncutt et al., with the upper side of seven pairs corrected from what nine elite pianists play
// (FürElise, `node tools/fingering-fit.mjs --spans`): between neighbouring fingers their relaxed stretch is about a
// semitone wider than the table's (index to middle: up to a minor third, not a tone), and thumb to little finger is
// relaxed up to an octave. MaxRel is the 75th percentile of the spans they play together, MaxComf the 95th, MaxPrac the
// 99th or the published value if that is larger. The published rows are kept beside the corrected ones.
// On pianists the correction was not measured on, agreement with their fingering went from 69.7% to 70.2%; on scale
// recordings from 48.5% to 53.9%. Fitting the rule weights as well gained nothing on unseen pianists and was dropped.
export const SPAN = {
  '01': [-5, -3, 1, 5, 8, 10], '02': [-4, -2, 3, 8, 10, 12] /* was 7 10 12 */, '03': [-3, -1, 5, 9, 12, 14], '04': [-1, 1, 7, 12, 13, 15] /* was 10 13 15 */,
  '12': [1, 1, 1, 3, 5, 5] /* was 2 3 5 */, '13': [1, 1, 3, 5, 5, 7] /* was 4 5 7 */, '14': [2, 2, 5, 8, 9, 10] /* was 6 8 10 */,
  '23': [1, 1, 1, 3, 4, 4] /* was 2 2 4 */, '24': [1, 1, 3, 4, 5, 7], '34': [1, 1, 1, 3, 4, 5] /* was 2 3 5 */,
};
const IMPOSSIBLE_POINTS = 40;                                     // per semitone a chord goes beyond what a hand can hold
const OUT_OF_REACH_POINTS = 12;                                   // per white key width this hand model cannot span
// The weights of the fingering rules, in points of difficulty. They are in one object so that tools/fingering-fit.mjs
// can try other values against the fingers pianists actually used (FürElise). These are the published values: fitting
// them gained nothing on pianists the fit had not seen (docs/reports/20261117-playback-audit.md), so they stand.
export const COST = {
  STRETCH_POINTS: 2, THUMB_SPAN_POINTS: 1, FINGER_SPAN_POINTS: 2,      // spans beyond the comfortable and the relaxed range, per semitone
  LET_GO_POINTS: 5,                                                    // giving up a note that is written as held
  JUMP_BASE: 6, JUMP_PER_SEMITONE: 0.4,                                // leaving the hand position altogether
  SAME_FINGER_BASE: 3, SAME_FINGER_PER_SEMITONE: 0.6,                  // one finger hopping to a different key
  WEAK_RING: 0.7, WEAK_LITTLE: 0.5, THUMB_ON_BLACK: 3, LITTLE_ON_BLACK: 0.5, CHORD_RULE_SHARE: 0.35,
  MOVE_POINTS_PER_KEY: 0.35, SPEED_POINTS: 1.5,                        // moving the hand, and moving it fast
  REPEAT_SAME_FINGER: 4, LEGATO_WEIGHT: 2,                             // a quickly repeated note changes finger; legato notes are joined by the fingers
};
const MOVE_KEYS_CAP = 12;
// a quickly repeated note changes finger; notes joined legato must be connected by the fingers, not by a hop or a jump
const REPEAT_FAST = 0.45, LEGATO_GAP = 0.04;
const URGENCY_TIME = 0.5, URGENCY_MIN = 0.3;                      // spans matter less when there is time to reposition

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// difficulty of two fingers a1, a2 on (mirrored) pitches p1, p2; `out` is semitones beyond the practical limit
function pairCost(a1, p1, a2, p2) {
  const lo = Math.min(a1, a2), hi = Math.max(a1, a2), d = a1 < a2 ? p2 - p1 : p1 - p2, T = SPAN['' + lo + hi];
  const per = lo === 0 ? COST.THUMB_SPAN_POINTS : COST.FINGER_SPAN_POINTS; let cost = 0;
  if (d < T[2]) cost += (T[2] - d) * per; if (d > T[3]) cost += (d - T[3]) * per;
  if (d < T[1]) cost += (T[1] - d) * COST.STRETCH_POINTS; if (d > T[4]) cost += (d - T[4]) * COST.STRETCH_POINTS;
  return { cost, out: d < T[0] ? T[0] - d : d > T[5] ? d - T[5] : 0 };
}
// the range of hand centres from which every listed finger {a, u} can hold its key; k scales the reach
export function centreRange(list, k = FULL) {
  let lo = -1e9, hi = 1e9;
  for (const n of list) { const R = n.black ? REACH_BLACK[n.a] : REACH[n.a]; lo = Math.max(lo, n.u - HOME[n.a] - R[1] * k[n.a][1]); hi = Math.min(hi, n.u - HOME[n.a] - R[0] * k[n.a][0]); }
  return [lo, hi];
}
const within = (r, c) => (r[0] > r[1] ? (r[0] + r[1]) / 2 : clamp(c, r[0], r[1]));
// the comfortable range for a set of sounding notes, never outside what the hand can actually span
function comfortRange(list) {
  const r = centreRange(list, COMFORT), full = centreRange(list);
  if (r[0] <= r[1]) return r;
  const mid = within(full, (r[0] + r[1]) / 2); return [mid, mid];
}
const idealCentre = list => list.reduce((s, n) => s + n.u - HOME[n.a], 0) / list.length;
// all ways to give k notes (low to high) increasing fingers from those that are free
function combos(k, free) {
  const out = [], pick = (start, acc) => { if (acc.length === k) { out.push(acc.slice()); return; } for (let i = start; i < free.length; i++) { acc.push(free[i]); pick(i + 1, acc); acc.pop(); } };
  pick(0, []); return out;
}
// Marks the notes whose finger an edited score prescribes. table[midi pitch] = [[occurrence, finger], ...] where
// occurrence counts that pitch through the piece in this hand (see tools/pins.mjs). Returns how many were marked.
export function applyPins(notes, table) {
  const seen = {}, want = {}; let count = 0;
  for (const m in table || {}) { want[m] = new Map(table[m]); }
  for (const n of notes) { const occ = seen[n.m] = (seen[n.m] ?? -1) + 1; delete n.pin; if (want[n.m] && want[n.m].has(occ)) { n.pin = want[n.m].get(occ); count++; } }
  return count;
}
// ---- how long a key has to stay down for its sound
// A note sounds for as long as its key is down or the pedal holds it. Sets n.keep on every note: the moment from which
// the finger may leave without cutting the sound short, which is the note's written end unless the pedal is down by
// then and stays down past it. pedal: [[time, down], ...] in order. The hand uses this to know when it is free to go.
const PEDAL_CATCHES = 0.03, HELD_AT_LEAST = 0.07;
export function keepUntil(notes, pedal) {
  for (const n of notes) {
    n.keep = n.e; let since = null;
    for (const [t, down] of pedal) { if (t > n.e) break; since = down ? (since === null ? t : since) : null; }
    if (since !== null) n.keep = Math.min(n.e, Math.max(n.t + HELD_AT_LEAST, since + PEDAL_CATCHES));
  }
}
// ---- how long the hand takes over a trip of d metres along the keys
// A smooth trip (minimum jerk) of d metres in T seconds peaks at 5.77 d / T^2 of acceleration, so a hand that keeps to
// one comfortable effort takes a time that grows with the square root of the distance. Unhurried (about 11 m/s2):
// a third 0.19 s, an octave 0.32 s, two octaves 0.44 s. The quickest a hand can manage (about 45 m/s2, my estimate, not
// a measured figure) is half that. The hand takes the unhurried time whenever the music leaves room for it, so it sets
// off earlier for a longer trip; with less room it takes what there is.
const TRAVEL_BASE = 0.03, TRAVEL_PER_ROOT_METRE = 0.72, QUICKEST_PER_ROOT_METRE = 0.36;
export const travelTime = d => TRAVEL_BASE + TRAVEL_PER_ROOT_METRE * Math.sqrt(Math.max(0, d));
export const quickestTime = d => QUICKEST_PER_ROOT_METRE * Math.sqrt(Math.max(0, d));
const TRIP_LEAST = 0.03, ARRIVE_EARLY = 0.02;                     // shortest trip; the hand likes to arrive this early
const GLIDE_SHARE = 0.85, GLIDE_MAX = 0.5, GLIDE_BELOW = 0.025, LEAP_ABOVE = 0.06;      // a small shift is spread over most of the gap between notes
const smooth = u => u * u * (3 - 2 * u), minJerk = u => u * u * u * (u * (u * 6 - 15) + 10);
// A leap does not ease away from rest as it eases into its landing: the hand pushes off the keys it has played. Measured
// (tools/leap-table.mjs, 1,121 leaps of 60 mm or more by 13 pianists): 33 ms after the note sounds the hand is 10% of the
// way, it is half way at about 100 ms and 90% of the way at about 170 to 200 ms, however long the gap; a hand that eased
// away from rest would be 10% gone only a quarter of the way through its trip. pushOff is the smoothest trip (least
// jerk) that starts with no speed but whatever acceleration it likes and comes to rest at the end; with the unhurried
// travelTime it gives 10%, half and 90% at 53, 116 and 184 ms for the pianists' 87 mm. `push` (0..1) is how much of a
// leap a trip is: small shifts keep the gentle start.
const PUSH = [10 / 3, -5, 8 / 3];                                  // u^2 (PUSH[0] + PUSH[1] u^2 + PUSH[2] u^3): the least-jerk polynomial with its starting acceleration free
const pushOff = u => u * u * (PUSH[0] + u * u * (PUSH[1] + PUSH[2] * u)), ease = (u, push) => (push ? minJerk(u) + (pushOff(u) - minJerk(u)) * push : minJerk(u));
const EASE_SOLVE_STEPS = 30, halfOf = push => { let lo = 0, hi = 1; for (let i = 0; i < EASE_SOLVE_STEPS; i++) { const mid = (lo + hi) / 2; if (ease(mid, push) < 0.5) lo = mid; else hi = mid; } return lo; };      // the share of a trip's time at which the hand is half way
const REST_GAP = 0.6;                                             // silence in a hand for at least this long is a rest: the hand travels during it, not before
const HALF_WAY_WITH = 0.6;                                         // the share of the gap between two groups still to go when the hand is half way
const AFTER_STRIKE = 0.01, TRIP_SOLVE_STEPS = 20;                 // the hand does not set off sooner than this after a strike
const leapOf = dist => smooth(clamp((dist - GLIDE_BELOW) / (LEAP_ABOVE - GLIDE_BELOW), 0, 1));      // how much of a leap a trip of `dist` metres is (0..1)
// The keys a hand leaps away from are let go sooner than other keys. Measured over the same leaps: 33 ms after the note
// sounds the fingertips that played have begun to move (3 mm), and the key is back up past its sensor 56 to 67 ms after
// (the pianists' own note lengths, the same whatever the gap). Our key takes KEY_RETURN to come up, so the finger lets go:
const LEAP_HOLD = 0.03;
const _trip = { T: 0, early: 0, push: 0 };
// A trip of `dist` metres between two groups `span` seconds apart: T how long it takes, early how long before the second
// group it is over. Small shifts glide; leaps take travelTime, or whatever the gap allows. The keys of the first group
// are held for `dwell` seconds, and while they are the hand may drift no more than `slack` metres towards the second
// (as far as the fingers on those keys can reach back): if the smooth trip would carry it further by then, it starts
// later and goes faster. In a run the fingers reach back and the hand never stops; after a wide chord it must wait.
// `trail` is that drift with the fingers at full stretch: a leaping hand leaves its fingers behind on their keys like
// that (pianists' knuckles are 10 to 16 mm gone 33 ms after the note, when the fingertips that played have moved 3 mm).
// Also returns push, how much of a leap the trip is (pathPos).
export function trip(dist, span, dwell, slack, free = Infinity, trail = slack) {
  const room = Math.max(TRIP_LEAST, span - AFTER_STRIKE), glide = Math.min(GLIDE_MAX, GLIDE_SHARE * span), leap = leapOf(dist);
  slack += (Math.max(slack, trail) - slack) * leap;
  const drift = (T, e) => dist * ease(clamp((dwell - (span - e - T)) / T, 0, 1), leap);      // how far the hand has gone when the keys are let go
  let T = clamp(glide + (travelTime(dist) - glide) * leap, TRIP_LEAST, room), early = clamp(room - T, 0, ARRIVE_EARLY);
  // Pianists do not wait and then travel just in time: measured (FürElise, 22 hands) they are half way through a shift
  // with about 60% of the gap between the notes still to go. So the trip is placed with its middle there, as long as
  // the keys of the first group may be let go by then (`free` seconds after it: the note has ended, or the pedal holds it).
  early = clamp(HALF_WAY_WITH * span - (1 - halfOf(leap)) * T, early, Math.max(early, span - T - Math.max(free, AFTER_STRIKE)));
  if (drift(T, early) > slack) {
    if (drift(T, 0) <= slack) {                            // arriving just in time is enough
      let lo = 0, hi = early; for (let i = 0; i < TRIP_SOLVE_STEPS; i++) { const mid = (lo + hi) / 2; if (drift(T, mid) > slack) hi = mid; else lo = mid; }
      early = lo;
    } else {                                               // it has to set off later still, and go faster
      let lo = Math.min(T, Math.max(TRIP_LEAST, span - dwell)), hi = T;      // lo: setting off only once the keys are let go
      for (let i = 0; i < TRIP_SOLVE_STEPS; i++) { const mid = (lo + hi) / 2; if (drift(mid, 0) > slack) hi = mid; else lo = mid; }
      T = lo; early = 0;
    }
  }
  _trip.T = T; _trip.early = early; _trip.push = leap; return _trip;
}
// Where the hand is at time t between two neighbouring groups a and b (each {t, c, T, early, m, push}).
// In a run or an arpeggio the hand does not stop at every note: it sweeps through, and each finger plays as its key
// goes by. m is the speed at which the hand passes a group (0 where it turns round or stops). Between two groups it
// stops at, the hand makes the trip planned by trip(); otherwise it follows a smooth curve with those passing speeds.
// Before a rest (a.free: when the last key of group a is let go, set only where a rest follows) the hand stays on its
// keys until they are let go and travels during the rest; it does not drift off under a key it is still holding.
export function pathPos(a, b, t) {
  if (a.m === 0 && b.m === 0) return a.c + (b.c - a.c) * ease(clamp((t - (b.t - a.early - a.T)) / a.T, 0, 1), a.push);
  const from = a.free === undefined ? a.t : a.free, h = b.t - from;
  const u = clamp((t - from) / h, 0, 1), u2 = u * u, u3 = u2 * u;
  const swept = (2 * u3 - 3 * u2 + 1) * a.c + (u3 - 2 * u2 + u) * h * a.m + (-2 * u3 + 3 * u2) * b.c + (u3 - u2) * h * b.m;
  // A leap that the hand comes into or goes out of with only a little speed is still a leap, and pushes off like one:
  // over the same time as before, the way itself is covered in a leap's shape as far as the passing speeds do not
  // account for the distance (in a true run they account for all of it and nothing changes). The speeds at the two
  // groups stay exactly a.m and b.m.
  const dist = b.c - a.c, leapt = a.push && dist ? a.push * (1 - clamp((Math.abs(a.m) + Math.abs(b.m)) * h / (2 * Math.abs(dist)), 0, 1)) : 0;
  return leapt ? swept + leapt * dist * (pushOff(u) - (3 * u2 - 2 * u3)) : swept;
}
// how long before group b the hand still has `left` metres to go on its way from group a
function lead(left, a, b) {
  const dist = Math.abs(b.c - a.c); if (left >= dist) return b.t - a.t;
  let lo = a.t, hi = b.t; for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (Math.abs(b.c - pathPos(a, b, mid)) > left) lo = mid; else hi = mid; }
  return b.t - lo;
}

// ---- the key under a finger
// A key goes down before its note sounds: the hammer meets the string as the key reaches the bottom, so the finger meets
// the key earlier, by the time the key takes to travel. That time depends on loudness. Measured on grand pianos it runs
// from about 25 ms for a loud note to about 160 ms for a soft one (reported from Goebl, Bresin and Galembo 2005; their
// 2004 paper shows a pressed mezzo note taking about 50 ms and the sound beginning as the key's speed peaks). Between
// those ends the curve is my interpolation. A key let go comes back up in KEY_RETURN.
const KEY_TRAVEL_LOUD = 0.025, KEY_TRAVEL_SOFT = 0.16, SOFTEST = 0.1, KEY_GATHERS = 2;      // seconds; the loudness (0..1) at and below which travel is slowest; a pressed key gathers speed all the way down
export const KEY_RETURN = 0.06;
export const keyTravel = v => KEY_TRAVEL_LOUD * (KEY_TRAVEL_SOFT / KEY_TRAVEL_LOUD) ** (1 - clamp((v - SOFTEST) / (1 - SOFTEST), 0, 1));
// how far down (0..1) a key is at song time st, for a note whose finger meets the key at `touched`, which sounds at
// `sounds` and is let go at `off`
// `struck` (0..1): how much of the key's speed it has from the first moment, because the finger arrived moving. A pressed
// key (0) starts from rest and gathers speed; a fully struck one (1) goes down at one speed.
export function keyDown(st, touched, sounds, off, struck = 0) {
  if (st >= off) { const u = (st - off) / KEY_RETURN; return u >= 1 ? 0 : 1 - u * u * (3 - 2 * u); }
  if (st >= sounds) return 1;
  if (st <= touched) return 0;
  const u = (st - touched) / (sounds - touched); return struck * u + (1 - struck) * u ** KEY_GATHERS;
}
// When each finger meets its key: writes n.tc for every note of the planned groups (a note's t stays the moment it
// sounds). A finger would take the key's natural travel time, but three things can make it meet the key later, and the
// key then goes down faster than it would at that loudness (never faster than a loud note's):
// - in quick notes keys are struck, not pressed: the travel is at most STRUCK_SHARE of the time since the last group
//   (measured pianists strike nearly every key at fast tempi; Goebl and Palmer 2009);
// - the finger was just on another key: it holds that one a moment after it sounds, then needs time to get across;
// - the hand has not arrived: the finger cannot meet a key it cannot yet reach;
// - the finger arrives moving (n.arrive, metres a second, set by the hand model from how high the finger lifts): the
//   key cannot take longer than its depth at KEY_SLOWS times that speed. Measured, pianists' fingertips are fastest as
//   they reach the key and cover their last 8 mm in about 40 ms at a medium loudness and in scales, 50 to 60 ms soft,
//   25 ms loud (audit section 14).
const STRUCK_SHARE = 0.4, SAME_KEY_AGAIN = 0.02, KEY_SLOWS = 0.75;      // KEY_SLOWS: the share of its arriving speed a finger keeps as it takes the key down
export const KEY_DEPTH = 0.008;                            // how far a key goes down where fingers usually play it (metres)
function touch(groups) {
  const lastOf = [null, null, null, null, null], lastOn = {};
  groups.forEach((g, i) => {
    const a = groups[i - 1];
    for (const n of g.notes) {
      let tc = n.t - keyTravel(n.v === undefined ? 1 : n.v);
      if (n.arrive) tc = Math.max(tc, n.t - KEY_DEPTH / (KEY_SLOWS * n.arrive));
      if (a) {
        tc = Math.max(tc, n.t - STRUCK_SHARE * (g.t - a.t));
        const r = centreRange([n], HOLD), left = g.c > a.c ? g.c - r[0] : r[1] - g.c;      // how far short of its place the hand may be with this finger already on its key
        tc = Math.max(tc, g.t - lead(Math.max(0, left), a, g));
      }
      const q = lastOf[n.a], was = lastOn[n.m];
      if (q && q.m !== n.m) { q.ev = Math.max(q.t + Math.min(MIN_HOLD, q.ev - q.t), Math.min(q.ev, tc - FINGER_HOP)); tc = Math.max(tc, q.ev + FINGER_HOP); }
      else if (q) { q.ev = Math.max(q.t + Math.min(HOLD_LEAST, q.ev - q.t), Math.min(q.ev, tc - SAME_KEY_AGAIN)); tc = Math.max(tc, q.ev + SAME_KEY_AGAIN); }
      if (was && was.a !== n.a) { was.ev = Math.max(was.t + Math.min(HOLD_LEAST, was.ev - was.t), Math.min(was.ev, tc - FINGER_SWAP)); tc = Math.max(tc, was.ev + FINGER_SWAP); }
      n.tc = Math.min(n.t - Math.min(KEY_TRAVEL_LOUD, n.t - (q && q.m === n.m ? q.ev : -Infinity)), tc);
      lastOf[n.a] = n; lastOn[n.m] = n;
    }
  });
}

// notes: [{t, e, x, m, black}] sorted by t. Adds to each note: a (finger), u, ev (when the finger leaves the key).
// and c (the hand centre planned for its group). Returns the groups [{t, c, T, early}]: c the hand centre in u space,
// T how long the trip to the next group takes and early how long before that group it is over.
// fingersOnly: stop once the fingers are chosen (for tools that only study the fingering)
export function planHand(notes, side, usePins = true, fingersOnly = false) {
  notes.forEach(n => { n.u = side * n.x; n.p = side * n.m; n.ev = n.e; });
  const groups = [];
  for (let i = 0; i < notes.length;) {
    let j = i; while (j < notes.length && notes[j].t - notes[i].t < CHORD_WINDOW) j++;
    groups.push({ t: notes[i].t, notes: notes.slice(i, j).sort((a, b) => a.p - b.p), c: 0 }); i = j;
  }
  // ---- beam search for the fingers
  let beam = [{ cost: 0, prev: null, fingers: null, on: [null, null, null, null, null], last: [], c: null, t: -10 }];
  for (const g of groups) {
    const next = [], k = g.notes.length;
    for (const S of beam) {
      const held = []; for (let a = 0; a < 5; a++) if (S.on[a] && S.on[a].e > g.t + LEGATO && !g.notes.includes(S.on[a])) held.push({ a, n: S.on[a] });
      const dt = Math.max(0.03, g.t - S.t), urgency = clamp(URGENCY_TIME / dt, URGENCY_MIN, 1);
      const tryWith = (keep, pinned) => {
        const free = [0, 1, 2, 3, 4].filter(a => !keep.some(h => h.a === a)); let found = 0;
        const cands = k <= free.length ? combos(k, free) : [g.notes.map((_, i) => free[Math.min(free.length - 1, Math.round(i * (free.length - 1) / Math.max(1, k - 1)))])];
        for (const A of cands) {
          if (pinned && g.notes.some((n, i) => n.pin !== undefined && n.pin !== A[i])) continue;      // the edition's fingering is obeyed
          // a finger cannot cross a finger that is holding a key
          let ok = true; for (const h of keep) for (let i = 0; i < k && ok; i++) if (g.notes[i].p !== h.n.p && Math.sign(A[i] - h.a) !== Math.sign(g.notes[i].p - h.n.p)) ok = false;
          if (!ok) continue;
          let cost = 0; const sounding = keep.map(h => ({ a: h.a, p: h.n.p, u: h.n.u, black: h.n.black })); g.notes.forEach((n, i) => sounding.push({ a: A[i], p: n.p, u: n.u, black: n.black }));
          for (let i = 0; i < sounding.length; i++) for (let j = i + 1; j < sounding.length; j++) {
            if (sounding[i].a === sounding[j].a) { cost += IMPOSSIBLE_POINTS; continue; }
            const r = pairCost(sounding[i].a, sounding[i].p, sounding[j].a, sounding[j].p); cost += r.cost + r.out * IMPOSSIBLE_POINTS;
          }
          // from the previous group to this one
          let seq = 0, pairs = 0;
          for (const q of S.last) { if (keep.some(h => h.n === q.n)) continue; for (let i = 0; i < k; i++) {
            const n = g.notes[i], d = Math.abs(n.p - q.n.p); pairs++;
            const joined = q.n.e > n.t - LEGATO_GAP;          // played legato: the fingers have to connect the two notes
            if (A[i] === q.a) seq += d === 0 ? (dt < REPEAT_FAST ? COST.REPEAT_SAME_FINGER : 0) : (COST.SAME_FINGER_BASE + COST.SAME_FINGER_PER_SEMITONE * d) * (joined ? COST.LEGATO_WEIGHT : 1);
            else { const r = pairCost(q.a, q.n.p, A[i], n.p); seq += r.out > 0 ? Math.min(r.cost, (COST.JUMP_BASE + COST.JUMP_PER_SEMITONE * r.out) * (joined ? COST.LEGATO_WEIGHT : 1)) : r.cost; }
          } }
          if (pairs) cost += urgency * seq / pairs;
          const share = k === 1 ? 1 : COST.CHORD_RULE_SHARE;
          g.notes.forEach((n, i) => { const a = A[i]; if (a === 3) cost += COST.WEAK_RING * share; if (a === 4) cost += COST.WEAK_LITTLE * share; if (n.black && a === 0) cost += COST.THUMB_ON_BLACK * share; if (n.black && a === 4) cost += COST.LITTLE_ON_BLACK * share; });
          const full = centreRange(sounding); if (full[0] > full[1]) cost += OUT_OF_REACH_POINTS * (full[0] - full[1]) / KEY_PITCH;
          cost += COST.LET_GO_POINTS * (held.length - keep.length);
          const c = within(comfortRange(sounding), S.c === null ? idealCentre(sounding) : S.c);
          if (S.c !== null) { const move = Math.abs(c - S.c); cost += Math.min(MOVE_KEYS_CAP, move / KEY_PITCH) * COST.MOVE_POINTS_PER_KEY + COST.SPEED_POINTS * move / dt; }
          const on = S.on.slice(); for (let a = 0; a < 5; a++) if (on[a] && !keep.some(h => h.a === a)) on[a] = null;
          g.notes.forEach((n, i) => { on[A[i]] = n; });
          next.push({ cost: S.cost + cost, prev: S, fingers: A, on, last: g.notes.map((n, i) => ({ a: A[i], n })), c, t: g.t }); found++;
        }
        return found;
      };
      // if the held notes leave no way to play the group, let go of the oldest ones
      // also consider letting go of held notes, oldest first, in case they cannot be held together with this group
      const keep = held.slice().sort((p, q) => q.n.t - p.n.t);
      let found = 0; for (const k2 = keep.slice(); ;) { found += tryWith(k2, usePins); if (!k2.length) break; k2.pop(); }
      if (!found) for (;;) { tryWith(keep, false); if (!keep.length) break; keep.pop(); }      // the pins cannot be met here: plan without them
    }
    next.sort((p, q) => p.cost - q.cost);
    const seen = new Set(); beam = [];
    for (const S of next) { const key = S.fingers.join('') + '|' + S.on.map(n => (n ? n.p : '.')).join(','); if (seen.has(key)) continue; seen.add(key); beam.push(S); if (beam.length >= BEAM) break; }
  }
  let S = beam[0]; for (let gi = groups.length - 1; gi >= 0; gi--) { groups[gi].notes.forEach((n, i) => { n.a = S.fingers[i]; }); S = S.prev; }
  if (fingersOnly) return null;

  // ---- when each key is let go: before the same finger is needed elsewhere
  const lastOf = [null, null, null, null, null], lastOn = {};
  for (const g of groups) for (const n of g.notes) {
    const q = lastOf[n.a]; if (q && q.m !== n.m) q.ev = Math.min(q.ev, Math.max(q.t + MIN_HOLD, n.t - FINGER_HOP)); else if (q) q.ev = Math.min(q.ev, n.t - 0.02);
    // a key repeated by a different finger: the first finger gets out of the way in time for the next to come onto the key
    { const was = lastOn[n.m]; if (was && was.a !== n.a) was.ev = Math.min(was.ev, Math.max(was.t + HOLD_LEAST, n.t - FINGER_SWAP)); lastOn[n.m] = n; }
    lastOf[n.a] = n;
  }
  // ---- where the hand sits for each group: inside the range its sounding notes allow, moving as little as possible
  const ranges = groups.map((g, gi) => {
    const list = g.notes.slice();
    for (let b = gi - 1; b >= 0 && b > gi - 12; b--) for (const n of groups[b].notes) if (n.ev > g.t + LEGATO && !list.some(q => q.a === n.a)) list.push(n);
    list.sort((p, q) => q.t - p.t);
    while (list.length > g.notes.length) { const r = centreRange(list); if (r[0] <= r[1]) break; list.pop(); }      // cannot hold them all: the oldest go
    g.sound = list; return comfortRange(list);
  });
  groups.forEach((g, i) => { g.c = within(ranges[i], i ? groups[i - 1].c : idealCentre(g.sound)); });
  for (let it = 0; it < 400; it++) for (let i = 0; i < groups.length; i++) {       // taut string through the ranges, weighted by time
    const a = groups[i - 1], b = groups[i + 1]; if (!a && !b) continue;
    const wa = a ? 1 / Math.max(0.03, groups[i].t - a.t) : 0, wb = b ? 1 / Math.max(0.03, b.t - groups[i].t) : 0;
    groups[i].c = within(ranges[i], ((a ? a.c * wa : 0) + (b ? b.c * wb : 0)) / (wa + wb));
  }
  // ---- where the music leaves less time for a trip than the quickest hand needs, shorten the trip: the two groups
  // give up comfort and are played from as near one another as the fingers can reach
  // every key is held a moment before the hand may leave it (less in quick notes), and a chord is rolled a little
  groups.forEach((g, i) => { const b = groups[i + 1]; g.hold = b ? clamp(HOLD_SHARE_OF_GAP * (b.t - g.t), HOLD_LEAST, MIN_HOLD) : MIN_HOLD; g.dwell = Math.max(...g.notes.map(n => n.t)) - g.t + g.hold; });
  // how far the hand may drift from group a towards group b while a's keys are still held
  const slackTo = (a, b, k = HOLD) => { const r = centreRange(a.notes, k); return r[0] > r[1] ? 0 : Math.max(0, b.c > a.c ? r[1] - a.c : a.c - r[0]); };
  const wide = groups.map((g, i) => { const r = centreRange(g.sound); return r[0] <= r[1] ? [Math.min(r[0], ranges[i][0]), Math.max(r[1], ranges[i][1])] : ranges[i]; });
  for (let it = 0; it < HURRY_PASSES; it++) {
    let moved = 0;
    for (let i = 0; i + 1 < groups.length; i++) {
      const a = groups[i], b = groups[i + 1], d = b.c - a.c, can = slackTo(a, b) + (Math.max(TRIP_LEAST, b.t - a.t - a.dwell) / QUICKEST_PER_ROOT_METRE) ** 2, over = Math.abs(d) - can;
      if (over <= HURRY_SLACK) continue;
      const na = within(wide[i], a.c + Math.sign(d) * over / 2), nb = within(wide[i + 1], b.c - Math.sign(d) * over / 2);
      moved += Math.abs(na - a.c) + Math.abs(nb - b.c); a.c = na; b.c = nb;
    }
    if (moved < HURRY_SLACK) break;
  }
  // ---- when the hand sets off for each next group
  groups.forEach((g, i) => { const b = groups[i + 1]; if (!b) return; const hold = g.hold + (Math.min(g.hold, LEAP_HOLD) - g.hold) * leapOf(Math.abs(b.c - g.c)); g.dwell -= g.hold - hold; g.hold = hold; });      // before a leap the keys are let go sooner
  groups.forEach((g, i) => { const b = groups[i + 1]; g.T = g.early = g.push = 0; if (b) { const t = trip(Math.abs(b.c - g.c), b.t - g.t, g.dwell, slackTo(g, b), Math.max(...g.sound.map(n => (n.keep === undefined ? n.e : n.keep))) - g.t, slackTo(g, b, FULL)); g.T = t.T; g.early = t.early; g.push = t.push; } });
  // ---- the speed at which the hand passes each group: where it keeps going the same way it does not stop (the harmonic
  // mean of the speeds either side, which never overshoots), but no faster than the fingers on that group's keys can
  // reach back while the keys are held. It only sweeps through a run: before a rest it stops.
  groups.forEach((g, i) => { const b = groups[i + 1]; if (!b) return; const free = Math.max(g.t, ...g.sound.map(n => n.ev)); if (free <= b.t - REST_GAP) g.free = free; });
  const speedTo = i => (groups[i + 1].c - groups[i].c) / (groups[i + 1].t - groups[i].t);
  groups.forEach((g, i) => {
    g.m = 0; if (i === 0 || i + 1 >= groups.length) return;
    const before = speedTo(i - 1), after = speedTo(i); if (before * after <= 0) return;
    if (g.free !== undefined) return;                      // a rest follows: the hand stops here
    const pass = 2 * before * after / (before + after), most = slackTo(g, groups[i + 1]) / g.hold;
    g.m = Math.sign(pass) * Math.min(Math.abs(pass), most);
  });
  // ---- let go early where the hand has to leave before the written note ends
  for (let gi = 1; gi < groups.length; gi++) {
    const g = groups[gi], from = groups[gi - 1];
    for (let b = gi - 1; b >= 0 && b > gi - 12; b--) for (const n of groups[b].notes) {
      if (n.ev <= from.t) continue;                        // already let go before this trip could begin
      const r = centreRange([n], HOLD), far = g.c < r[0] ? r[0] - g.c : g.c > r[1] ? g.c - r[1] : 0;
      if (far > 0) n.ev = Math.min(n.ev, Math.max(n.t + groups[b].hold, g.t - lead(far, from, g)));
    }
  }
  groups.forEach(g => g.notes.forEach(n => { n.c = g.c; }));
  touch(groups);
  return groups.map(g => ({ t: g.t, c: g.c, T: g.T, early: g.early, push: g.push, m: g.m, free: g.free, n: g.notes.map(n => n.m + ':' + (n.a + 1)).join(' ') }));      // n: midi pitch and finger of each note, for reports
}
