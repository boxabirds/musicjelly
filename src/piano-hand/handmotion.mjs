// How a hand moves: where it sits, how it travels, and how each finger prepares, strikes and lets go.
// Positions are in the piano frame (x along the keyboard, y up, z towards the player, key fronts at z = 0).
import * as THREE from 'three';
import { buildHand, placeHand, poseHand, archThumb, setPalm, METACARPAL_RANGE, METACARPAL_SIDE, skinHand, toHand, FOREARM, ELBOW_BALL, chain, KN, PH, FR, MIDDLE_X, endBend, MIN_BEND, MAX_BEND, SPLAY } from './hand.mjs';
import { planHand, applyPins, centreRange, pathPos, HOME, HOLD, REACH, keyTravel, keyDown, KEY_RETURN, KEY_DEPTH, KEY_PITCH } from './fingering.mjs';

// ---- the keyboard
export const KEYTOP = 0.74, BLACK_RISE = 0.016;            // white key top; how far a black key stands above it
export const KEY_SWING = 0.06;                             // radians a key turns when fully down: about 10 mm at the front edge
const KEY_SETTLED = 0.02;                                  // below this a key counts as up
const WHITE_PIVOT_Z = -0.19, BLACK_PIVOT_Z = -0.17, BLACK_FRONT_Z = -0.065;
const keyDip = (z, black) => KEY_SWING * Math.max(0, z - (black ? BLACK_PIVOT_Z : WHITE_PIVOT_Z));
export { keyTravel, keyDown, KEY_RETURN };

// ---- the playing position
// Measured on elite pianists (FürElise, tools/pianist.mjs; eight hands in four recordings): the wrist joint rides about
// level with the knuckle of the middle finger, a little below it on average. Above a fingertip that has a white key
// down, their wrists sit 26 to 74 mm up (median about 47) and their middle knuckles 34 to 70 (median about 50). So the
// back of the hand is close to level; it does not climb steeply from a low wrist, which is what this model did before
// (wrist 24 mm up, knuckle 55). With the values below ours are about 41 and 49.
// Wrist joint above the white keys. At the strike, pianists' wrists and knuckles ride 26% and 27% of the hand's length
// above the end of the playing fingertip on white keys; at 0.040 ours were at 24% and 25% (audit section 14).
const WRIST_RISE = 0.045;
// On black keys the pianists' hands ride higher: wrist and knuckle are still 23% and 22% of the hand's length above the
// fingertip there. Ours stayed at its white-key height (14% and 16%), so a finger on a black key lay flat. The hand now
// rises by BLACK_LIFT when all the keys it is on or about to play are black, and by that share of it when some are.
// The wrist rises more than the knuckles do (BLACK_TILT, radians the hand tips towards its fingers at the full lift).
// Not while the thumb has a key or is about to: from higher our thumb cannot reach down (with the rise always on,
// fingertips off their keys went from 3.5% to 8.2% of held frames in Clair de lune's right hand, nearly all thumbs).
const BLACK_LIFT = 0.019, BLACK_TILT = 0.05, W_BLACK = 7;   // metres; radians; how quickly the hand takes up that height (rad/s): slowly, so it does not bob in a run of mixed keys
export const WRIST_Y = KEYTOP + WRIST_RISE;
// The hand's own frame has its knuckles above the wrist (KN in hand.mjs), by about 8 degrees at the middle finger. Tilting
// the frame down by a little less than that leaves the line from wrist to middle knuckle rising a few degrees.
const HAND_PITCH = -0.06;                                  // tilt of the hand's frame about the wrist: positive lifts the knuckles (rad)
const TIP_SEAT = 1.03;                                     // fingertip centre sits this many tip radii above the key
// The natural curve, set with the key fully down: middle joint bent by PLAY_BEND, knuckle bent as far as it
// takes to reach the key bed. A finger resting on top of its key is a little more curled than that, and it
// opens slightly as it plays, which is what measured keystrokes show: the knuckle does the work.
const PLAY_BEND = [0, 0.44, 0.50, 0.50, 0.42];
const THUMB_AHEAD = 0.118;                                 // the thumb lies forward along the index side, only gently bent, its tip about 2 cm in from the key front
const MIDDLE_LAND_Z = -0.053;                              // where the middle finger lands on a white key
// where a fingertip may land: on a white key in front of the black keys, on a black key, or in the slot between black keys
const FRONT_Z = -0.007, WHITE_DEEP_Z = -0.055, SLOT_Z = -0.076, DEEPEST_Z = -0.150;
const WHITE_SIDE_PLAY = 0.004, BLACK_SIDE_PLAY = 0.0015;   // a tip need not land dead centre on a key
const MIN_TIP_GAP = 0.0155;                                // fingertips do not overlap sideways
const FORWARD_PER_RISE = [0.2, 0.3, 0.3, 0.3, 0.3];        // a finger lifts mostly from the knuckle, so a raised tip is also further forward
// reaching: a finger that has to stretch sideways cannot also reach as far forward, so the hand moves in
// towards the fallboard and sinks until every playing finger can get to its key
const REACH_BEND = 1.25, REACH_USE = 0.97;                 // keep this much more than the least bend; use this share of the forward reach
const MIN_FORWARD = [0.022, 0.012, 0.012, 0.012, 0.012];   // a tip stays at least this far ahead of its base joint
const SPLAY_USE = 1.1;                                     // margin on the sideways swing
// no claw: the last bone of a finger never slopes more steeply than this, so a tip is kept far enough ahead of its knuckle
const TIP_SLOPE_MAX = 1.36, SLOPE_STEPS = 12;
// the black keys as solid things a fingertip cannot enter: where each is across the keyboard and which note it is, half
// its width at the bottom and at the top (as drawn in main.js: BLACK_KEY and BLACK_TOP_NARROWS), and how far a
// fingertip's flesh gives against a key's side (two black keys are 11 mm apart at the bottom, a fingertip 15 mm wide)
const BLACK_X = [], BLACK_M = []; { let white = 0; for (let m = 21; m <= 108; m++) { if ([1, 3, 6, 8, 10].includes(m % 12)) { BLACK_X.push((white - 0.5 - 51 / 2) * KEY_PITCH); BLACK_M.push(m); } else white++; } }
const BLACK_HALF_BASE = 0.00625, BLACK_HALF_TOP = 0.0046, FLESH_GIVES = 0.0025;
const BLACK_FACE_GAP = 0.001, SLOT_ALIGN = 0.0045;                                 // how nearly over its white key a tip must be before it goes down between the black keys
const DROP_MAX = 0.020, DEPTH_MAX = 0.095, SAME_PLACE = 0.03;

// ---- muscles
// The fingers are worked from the forearm. A long flexor and a long extensor send one tendon to each finger across the
// wrist, and those tendons are not independent: the flexor to the middle, ring and little fingers is largely one muscle,
// and the extensor tendons are tied to one another on the back of the hand, most of all the ring finger's to its
// neighbours'. So an effort meant for one finger reaches the others too. ENSLAVE_FLEX[a][b] is the share of finger b's
// flexing effort that finger a feels, ENSLAVE_LIFT the same for lifting (0 thumb .. 4 little; the thumb has its own
// muscles). The pattern is anatomical; the sizes are my estimates from the finger-enslaving literature, not measurements.
const ENSLAVE_FLEX = [[1, 0, 0, 0, 0], [0, 1, 0.12, 0.04, 0.02], [0, 0.14, 1, 0.22, 0.06], [0, 0.05, 0.28, 1, 0.30], [0, 0.02, 0.08, 0.32, 1]];
const ENSLAVE_LIFT = [[1, 0, 0, 0, 0], [0, 1, 0.08, 0.02, 0], [0, 0.10, 1, 0.25, 0.04], [0, 0.04, 0.45, 1, 0.40], [0, 0, 0.05, 0.20, 1]];
const MUSCLE_ON = 28, MUSCLE_OFF = 14;                     // a muscle tightens faster than it lets go (1/s)
const TONE = 0.06, HOLD_EFFORT = [0.30, 0.20], STRIKE_EFFORT = [0.50, 0.50], STRIKE_LASTS = 0.12, LIFT_EFFORT = [0.25, 0.75];      // [base, extra per unit loudness]
// What the muscles do to the palm. Flexing the ring or little finger also draws its metacarpal towards the palm (the
// hand cups, the knuckle sinks); lifting a finger, or spreading the hand over a wide chord, flattens the arch. Each
// metacarpal moves within METACARPAL_RANGE (hand.mjs).
const SPREAD_FROM = 0.11, SPREAD_FULL = 0.19, LIFT_FLATTENS = 0.5, W_PALM = 30;
const PALM_USE = 0.45;                                     // playing uses this share of each joint's range: the knuckles move a little, not to their limits
// A hand stretched to its span is at the end of its joints' travel, not part of the way: a wide chord flattens the arch
// by the whole of each metacarpal's range (SPREAD_USE). And a finger that swings sideways takes its metacarpal with it:
// the metacarpal fans out by its whole sideways range as the finger reaches its own sideways limit (hand.mjs METACARPAL_SIDE).
// How much of this pianists use is not measured: the capture's hand model has a rigid palm. The ranges are anatomy's.
const SPREAD_USE = 1;
// What they do to the other fingers: a finger is carried up a little with a neighbour that lifts, and the ring finger
// cannot lift far by itself (RING_ALONE is the share of a full lift it manages when its neighbours stay down).
const CARRIED_UP = 0.006, RING_ALONE = 1;                 // was 0.5 (the ring finger lifting half as far alone): measured, pianists' ring fingers fall as far as their others (audit section 14)
const _flex = [0, 0, 0, 0, 0], _liftCmd = [0, 0, 0, 0, 0], _mc = [0, 0, 0, 0, 0];

// ---- timing and springs (rad/s for critically damped springs)
const PREP = 0.21, PREP_ARRIVE = 0.05, STRIKE = 0.075;     // start preparing; be over the key; start the downstroke
const HOVER = 0.0012, HOVER_REST = 0.008, SYMPATHY = 0.0015;
// loudness shows in the movement. A soft note is played from the key surface with the finger alone; a loud one
// from higher, with the wrist rising before it and giving more under it.
// The stroke, measured on 13 pianists (audit section 14, `node tools/pianist.mjs <id>` prints TOUCH):
// - in pieces the fingertip falls 11 mm into a soft note and 29 mm into a loud one, key depth included (ours fell 10 to 19);
// - in scales and exercises it falls 33 to 39 mm whatever the loudness: high fingers (n.exercise, LIFT_EXERCISE);
// - it is fastest (0.11 m/s soft, 0.41 loud, 0.31 in scales) as it reaches the key, not before: it arrives moving, and
//   the key goes down with it (ARRIVES, and `struck` in keyDown). Ours used to slow to rest on the key and then press.
const LIFT_SOFT = 0, LIFT_LOUD = 0.035, LIFT_CURVE = 1.25;      // how high a finger lifts before it strikes (metres above its hover)
// Scales and exercises (notes marked `exercise`). The four pianists recorded playing scales lift high: their fingertips
// fall 32 to 50 mm on white keys alone, whatever the loudness, and scale mode copied that for a while (0.028). The owner,
// who plays, found it about twice what is needed, and teaching advice agrees with him: fingers stay close to the keys,
// lifted no more than it takes (audit section 17). So a scale is now played like a piece: 0 extra. The number is kept
// so the recorded behaviour can be put back.
const LIFT_EXERCISE = 0;
// After a pause a pianist's finger hardly lifts, whatever the loudness: with 0.6 s or more since the hand's last note
// the fingertip falls 13 to 15 mm (21 when loud) where in running notes it falls 17 to 28. The lift shrinks to
// SLOW_LIFT of itself as the gap grows from SLOW_FROM to SLOW_FULL seconds. Notes of one chord (within CHORD_WITHIN) count as one.
const SLOW_FROM = 0.3, SLOW_FULL = 0.7, SLOW_LIFT = 0.42, CHORD_WITHIN = 0.03;
const STRIKE_LEAST = 0.06, STRIKE_PER_LIFT = 1.6, RISE = 0.135, RISE_PER_LIFT = 4;      // the downstroke's length from no height (seconds); a higher lift takes longer to fall and to raise (seconds for each metre of lift)
const ARRIVES = 1.2;                                                   // the fingertip's speed as it meets the key, as a multiple of its mean speed over the downstroke
const WIND_UP = 0.19, WIND_UP_LIFT = 0.013, WIND_UP_FROM = 0.40;       // the wrist rises before a loud attack
const JUST_STRUCK = 0.12;                                              // how long after its onset a note still counts as just struck
const LOOKAHEAD = 0.45, REST_AFTER = 1.1;
const PLAN_STEP = 1 / 480, PLAN_BREAK_ACCEL = 140, PLAN_BREAK_SLIP = 0.006;
const W_CENTRE = 26, W_DEPTH = 20, W_YAW = 9, W_ROLL = 11, W_PITCH = 12, W_LIFT = 26, W_DROP = 18, W_DIP = 15;
const W_TIP_HELD = 70, W_TIP_PREP = 42, W_TIP_IDLE = 22, W_HEIGHT = 85, W_HEIGHT_UP = 34, W_SURFACE = 45, W_SURFACE_UP = 95;
const HEIGHT_LAG = 2 / W_HEIGHT;                           // a spring of that stiffness runs this far behind what it follows (seconds)
// following the plan: the step used to read its speed; a change of plan speed (m/s2) or place (m) too abrupt to be the plan's own
const ARC_FROM = 0.03, ARC_PER_METRE = 0.14, ARC_MAX = 0.034;      // a leap rises in a low arc
const ARC_PITCH = 2.6, PITCH_MAX = 0.16;                   // and the fingers hang slightly as the wrist leads
const STRIKE_DIP = 0.11, DIP_MAX = 0.008, DIP_HITS = 5;    // the wrist gives under each strike, with the square of its loudness
// Seen from above, pianists' hands point nearly straight at the fallboard (medians from 18 degrees inwards to 7 outwards
// over eight hands, FürElise); following the forearm by more than this turned ours inwards 5 to 18 degrees further.
const YAW_FOLLOW = 0.3, YAW_MAX = 0.5;                     // the share of the forearm's angle the hand takes up
// but turns to bring a short finger forward when the thumb or little finger has a black key or a wide stretch
const YAW_THUMB = 0.30, YAW_LITTLE = 0.22, TURN_FOR_BLACK = 0.6, TURN_FREE = 0.012, TURN_FULL = 0.03;
export const UPPER_ARM = 0.30, ELBOW_OUT = 0.22, ELBOW_BACK = 0.35;   // the elbow hangs down, a little out and back
const ROLL_GAIN = 0.07, ROLL_MAX = 0.09;                   // and leans slightly towards the fingers that are playing
const REST_FLOAT = 0.012;
// when the hands come together one passes over the other: the upper hand rises and plays further in, the lower stays low
// with its wrist high and the hand tilted down to the keys, so that it clears the hand underneath
const CROWD_FROM = 0.19, CROWD_FULL = 0.10, OVER_LIFT = 0.046, OVER_TILT = 0.30, OVER_KNUCKLE_RISE = 0.018, OVER_IN = 0.040, UNDER_DROP = 0.016;
const STACK_OVER = 0.06, STACK_IN = 0.03, STACK_LIFT = 0.016;      // wrists this much closer than CROWD_FULL are stacked: the upper hand goes further in and higher still
const TUCK_WHEN = 0.9, TUCK_BACK = 0.03, TUCK_FRONT = 0.012;      // share of HAND_GAP at which an idle tip gives up its place; how far it draws back; the furthest towards the player it goes (m, past the key fronts)
const _tuck = [false, false, false, false, false], _shoved = [false, false, false, false, false];      // _shoved: an idle tip moved aside by a neighbour this frame
const LINGER = 1.5, LINGER_EASES = 0.5, STAY_FOR = 4, STAY_KEYS = 2;      // seconds a finger stays over the key it left, the last part of that over which it eases home; seconds it stays when it will play there again, and how near (in keys) counts as there
const FINGERS_COME_UP = 0.85;                              // the share of that lift its idle fingertips take with them, so they hang under the hand and do not reach down to the keys
const YIELD_AFTER = 0.35, YIELD_LIFT = 0.045;              // a hand free for longer than this (seconds) makes room; how much higher than an ordinary crossing it lifts (metres)
const MOVER_MARGIN = 1.2, UNDER_STAYS_LOW = 0.8, HAND_GAP = 0.018;      // how much faster the left must travel to be the one that crosses; how far the lower hand's lifts are cut; room an idle fingertip leaves the other hand's busy one
// phrasing: at the end of a phrase the wrist lifts off the keys and settles into the next one
const PHRASE_REST = 0.16, PHRASE_FULL = 0.55, PHRASE_LIFT = 0.009;
// sway: a hand with little to do is not a statue. Measured on three pianists holding long notes (audit section 23): with
// the fingertips still on their keys, the wrist rises and falls 5 to 24 mm and the hand rolls 3 to 6 degrees over a
// second or so, turning back about once a second, and the knuckles go about half as far as the wrist. Ours is set to
// the low end of that: the owner asked for subtle. It is a function of song time alone, so every speed shows the same
// movement and a pause is a still frame.
const SWAY = {
  rise: 0.005, roll: 0.045, along: 0.002, inOut: 0.002,     // the most the wrist goes up or down (m), the hand rolls (rad), the wrist goes along the keys and in and out (m)
  knuckleShare: 0.5,                                        // of the wrist's rise the knuckles take this share: the hand hinges about its fingertips
  periods: [2.4, 3.9], mix: [0.65, 0.35],                   // two slow waves, so the movement does not repeat: their lengths (seconds) and shares
  starts: [0, 1.3, 2.9, 4.4], handsApart: 2.1,              // where in the wave the rise, the roll, along and in-and-out begin (rad), so the wrist goes round and not to and fro on a line; how far the left hand's waves run from the right's (rad)
  calm: 1.0, busy: 2.5, over: 1.5 };                        // full sway where the hand begins this many notes a second or fewer, none at this many or more; counted over so many seconds either side
const TURN = 2 * Math.PI, KNUCKLE_AHEAD = KN[2][2];          // the middle knuckle's distance ahead of the wrist
const wave = (st, k, hand) => SWAY.mix[0] * Math.sin(TURN * st / SWAY.periods[0] + SWAY.starts[k] + hand) + SWAY.mix[1] * Math.sin(TURN * st / SWAY.periods[1] + 2 * SWAY.starts[k] - hand);

const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, k) => a + (b - a) * k;
const smooth = u => u * u * (3 - 2 * u), minJerk = u => u * u * u * (u * (u * 6 - 15) + 10);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// critically damped spring: smooth start and stop, no overshoot, stable at any frame rate
function spr(o, k, target, w, dt) { const x = o[k], v = o[k + 'V'], e = Math.exp(-w * dt), d = x - target, t = (v + w * d) * dt; o[k] = target + (d + t) * e; o[k + 'V'] = (v - w * t) * e; }
function spr1(p, v, k, target, w, dt) { const e = Math.exp(-w * dt), d = p[k] - target, t = (v[k] + w * d) * dt; p[k] = target + (d + t) * e; v[k] = (v[k] - w * t) * e; }

// each finger's base joint relative to the wrist with the hand at its playing pitch: [across, up, ahead]
const CP = Math.cos(HAND_PITCH), SP = Math.sin(HAND_PITCH);
const BASE = KN.map(k => [k[0], k[1] * CP + k[2] * SP, k[2] * CP - k[1] * SP]);
// the longest a finger gets while still keeping a little bend
const R_MAX = PH.map((P, a) => chain(P[0], P[1], P[2], MIN_BEND[a] * REACH_BEND, endBend(a, MIN_BEND[a] * REACH_BEND))[0]);
const NOMINAL_DIP = keyDip(MIDDLE_LAND_Z, false);
// where each fingertip lands with its key down, relative to the wrist: [across, ahead]
const LAND = [0, 1, 2, 3, 4].map(a => {
  if (a === 0) return [MIDDLE_X + HOME[0], THUMB_AHEAD];
  const P = PH[a], b = PLAY_BEND[a], e = endBend(a, b), down = BASE[a][1] + WRIST_RISE + NOMINAL_DIP - FR[a][3] * TIP_SEAT;
  let lo = 0, hi = 1.4;                                    // find the knuckle angle that puts the tip on the key bed
  for (let i = 0; i < 30; i++) { const k = (lo + hi) / 2; if (P[0] * Math.sin(k) + P[1] * Math.sin(k + b) + P[2] * Math.sin(k + b + e) < down) lo = k; else hi = k; }
  const k = (lo + hi) / 2; return [MIDDLE_X + HOME[a], BASE[a][2] + P[0] * Math.cos(k) + P[1] * Math.cos(k + b) + P[2] * Math.cos(k + b + e)];
});
const HOME_AHEAD = LAND[2][1];                             // the point ahead of the wrist that is kept over the hand's centre
const WRIST_Z = MIDDLE_LAND_Z + HOME_AHEAD;                // how far the wrist sits in front of the key fronts on white keys
export const LAND_Z = LAND.map(r => WRIST_Z - r[1]);       // fingertip depth on the key in the white-key position

// how far ahead of its knuckle a fingertip must be, when it is `down` below it, for the last bone to slope no more than TIP_SLOPE_MAX
function leastAhead(a, down) {
  const P = PH[a]; let lo = MIN_BEND[a], hi = MAX_BEND[a], r = 0;
  for (let i = 0; i < SLOPE_STEPS; i++) {
    const b = (lo + hi) / 2, c = chain(P[0], P[1], P[2], b, endBend(a, b));
    if (c[0] > down && Math.asin(down / c[0]) + c[1] + b + endBend(a, b) <= TIP_SLOPE_MAX) lo = b; else hi = b;
  }
  r = chain(P[0], P[1], P[2], lo, endBend(a, lo))[0]; return Math.sqrt(Math.max(0, r * r - down * down));
}
export function createHand(side, skin, nailMat) {
  const M = buildHand(side, skin, nailMat), five = v => [v, v, v, v, v];
  const H = { side, M, notes: [], bySound: [], groups: [], gi: 0, ni: 0, oi: 0, lastSt: -1, started: false,
    heard: [], onsets: [], si: 0, sway: 0, swayRoll: 0, swayPitch: 0, overHand: -1, stack: 0, claimN: 0, claimX: new Float32Array(5),
    firstOf: five(null), lastNote: five(null), nextNote: five(null), waits: five(null), thumbUnder: false, doing: new Uint8Array(5), push: [0, 1, 2, 3, 4].map(() => V(0, 0, 0)), shove: 0, solid: new Float32Array(SOLIDS * SOLID),
    flex: five(TONE), ext: five(0), mc: five(0), mcV: five(0), fan: five(0), fanV: five(0),
    c: 0.2, cV: 0, off: 0, offV: 0, planC: 0.2, planV: 0, depth: 0, depthV: 0, lift: 0, liftV: 0, black: 0, blackV: 0, dip: 0, dipV: 0, drop: 0, dropV: 0, yaw: 0, yawV: 0, roll: 0, rollV: 0, pitch: HAND_PITCH, pitchV: 0,
    tips: [], tipV: [], zb: LAND_Z.slice(), zbV: five(0), h: five(HOVER), hV: five(0), top: five(KEYTOP), topV: five(0), homeU: five(0), deepest: five(DEEPEST_Z), nearest: five(1),
    released: -10, pinned: 0, struck: [], wind: 0, over: 0, under: 0, free: 0, yields: 0, key: five(null), pressed: five(null), coming: five(null), wrist: V(side * 0.2, WRIST_Y, WRIST_Z), elbow: null };
  for (let a = 0; a < 5; a++) { H.tips.push(V(side * (H.c + HOME[a]), KEYTOP + 0.02, LAND_Z[a])); H.tipV.push(V(0, 0, 0)); }
  M.root.position.copy(H.wrist); M.root.rotation.set(H.pitch, 0, 0, 'YXZ'); placeHand(M);
  return H;
}
// notes: [{t, e, x, m, v, black}] for this hand, sorted by t, the time each note sounds. Chooses fingers and plans the
// hand's path. From here on a note's t is when its finger meets the key (the key then travels down under the finger)
// and ts is when it sounds; the groups of the hand's path keep the times the notes sound.
// pins: the fingers an edited score prescribes (see applyPins), or nothing to let the planner choose them all
// How a note is struck: how high its finger lifts first (lift), how long the downstroke (strike) and the whole
// preparation (prep) take, and how fast the fingertip is moving as it meets the key (arrive, m/s). The planner uses
// that speed to say when the finger meets the key.
function stroke(n, i, notes) {
  const loud = lerp(LIFT_SOFT, LIFT_LOUD, (n.v === undefined ? 1 : n.v) ** LIFT_CURVE);
  // the gap since the hand last began a note (notes are in the order they sound here; a chord's notes share its gap)
  const before = notes[i - 1]; n.gap = !before ? Infinity : n.t - before.t < CHORD_WITHIN ? before.gap : n.t - before.t;
  n.lift = (n.exercise ? Math.max(loud, LIFT_EXERCISE) : loud) * lerp(1, SLOW_LIFT, smooth(clamp((n.gap - SLOW_FROM) / (SLOW_FULL - SLOW_FROM), 0, 1)));
  n.strike = STRIKE_LEAST + STRIKE_PER_LIFT * n.lift; n.prep = n.strike + RISE + RISE_PER_LIFT * n.lift;
  n.arrive = ARRIVES * (HOVER + n.lift) / n.strike;
}
export function setNotes(H, notes, pins, usePins = true) {
  H.pinned = applyPins(notes, pins);
  notes.forEach(n => { if (n.ts !== undefined) n.t = n.ts; });      // planning again: back to the times the notes sound
  notes.slice().sort((p, q) => p.t - q.t).forEach(stroke);
  H.groups = planHand(notes, H.side, usePins);             // the hand's path is planned to the moments the notes sound; it also says when each finger meets its key (tc)
  H.bySound = notes.slice();
  H.onsets.length = 0; H.si = 0; for (const n of H.bySound.slice().sort((p, q) => p.t - q.t)) if (!H.onsets.length || n.t - H.onsets[H.onsets.length - 1] > CHORD_WITHIN) H.onsets.push(n.t);      // when the hand begins a note or a chord, for how busy it is (the sway)
  notes.forEach(n => { n.ts = n.t; n.t = n.tc; }); H.notes = notes.sort((p, q) => p.t - q.t); H.gi = H.ni = H.oi = 0; H.started = false;
  { const last = [null, null, null, null, null]; H.firstOf.fill(null); H.lastNote.fill(null); H.nextNote.fill(null); for (const n of H.notes) { n.nextSame = null; if (last[n.a]) last[n.a].nextSame = n; else H.firstOf[n.a] = n; last[n.a] = n; } }      // each finger's notes in turn, for where it waits between them
  notes.forEach(n => { n.struck = clamp(n.arrive * (n.ts - n.t) / KEY_DEPTH, 0, 1); });      // how much of the key's speed the finger brings with it (keyDown)
  if (H.groups.length) { H.c = H.planC = H.groups[0].c; H.cV = H.off = H.offV = H.planV = 0; }
}
const _p = { c: 0, arc: 0 };
// the planned hand centre at time t: hold, then travel so as to arrive just before the next group
function pathAt(G, gi, t) {
  let k = gi; while (k + 1 < G.length && G[k + 1].t <= t) k++;
  const a = G[k], b = G[k + 1]; _p.c = a.c; _p.arc = 0;
  if (t < a.t || !b) return _p;
  const dist = Math.abs(b.c - a.c);
  _p.c = pathPos(a, b, t);
  _p.arc = dist > 0 ? clamp((dist - ARC_FROM) * ARC_PER_METRE, 0, ARC_MAX) * Math.sin(Math.PI * clamp(Math.abs(_p.c - a.c) / dist, 0, 1)) ** 2 : 0;      // a leap rises and falls with the distance covered
  return _p;
}
const SHORT = [0, 4], _k = V(0, 0, 0), _rides = [1, 1, 1, 1, 1], _tu = [0, 0, 0, 0, 0], _pin = [false, false, false, false, false], _held = [];
// st: song time; keyRot[midi]: how far each key is down, 0..1
export function updateHand(H, st, dt, keyRot) {
  const N = H.notes, G = H.groups, s = H.side, M = H.M, pressed = H.pressed, coming = H.coming;
  if (st < H.lastSt - 0.05) { H.gi = H.ni = H.oi = H.si = 0; H.lastNote.fill(null); H.nextNote.fill(null); } H.lastSt = st;
  if (!G.length) return;
  while (H.gi + 1 < G.length && G[H.gi + 1].t <= st) H.gi++;
  while (H.ni < N.length && N[H.ni].ev < st - 0.5 && N[H.ni].t < st - 0.5) H.ni++;
  let nextT = 1e9, hits = 0; pressed.fill(null); coming.fill(null); _held.length = 0;
  for (let k = H.ni; k < N.length && N[k].t < st + LOOKAHEAD; k++) {
    const n = N[k];
    if (n.t > st) { nextT = Math.min(nextT, n.t); if (!coming[n.a]) coming[n.a] = n; } else if (n.ev > st) pressed[n.a] = n;
  }
  for (let a = 0; a < 5; a++) if (pressed[a]) { _held.push(pressed[a]); H.key[a] = pressed[a]; H.lastNote[a] = pressed[a]; }
  if (nextT > 1e8) for (let k = H.ni; k < N.length; k++) if (N[k].t > st) { nextT = N[k].t; break; }
  const resting = !_held.length && nextT - st > REST_AFTER;
  H.free = _held.length ? 0 : nextT - st;                  // how long until this hand next has a key (0 while it holds one): crowd() lets a free hand make room
  // as each key reaches the bottom and sounds, the wrist gives a little, more for louder notes
  H.struck.length = 0;                                     // the notes that sounded on this frame, for anything that wants to mark them
  for (const B = H.bySound; H.oi < B.length && B[H.oi].ts <= st;) { const n = B[H.oi++]; if (!H.started) continue; if (hits++ < DIP_HITS) H.dipV -= STRIKE_DIP * n.v * n.v; if (st - n.ts < JUST_STRUCK) H.struck.push(n); }
  H.started = true;

  // ---- muscles: what each finger is asked to do, what reaches it through the shared tendons, and how the palm answers
  for (let a = 0; a < 5; a++) {
    const p = pressed[a], q = p ? null : coming[a], tau = q ? q.t - st : 1; _flex[a] = TONE; _liftCmd[a] = 0;
    if (p) { const e = st - p.t < STRIKE_LASTS ? STRIKE_EFFORT : HOLD_EFFORT; _flex[a] = e[0] + e[1] * p.v; }
    else if (q && tau < STRIKE) _flex[a] = STRIKE_EFFORT[0] + STRIKE_EFFORT[1] * q.v;
    else if (q && tau < PREP) _liftCmd[a] = smooth((PREP - tau) / (PREP - STRIKE)) * (LIFT_EFFORT[0] + LIFT_EFFORT[1] * q.v ** LIFT_CURVE);
  }
  let spread = 0; if (_held.length > 1) { let lo = 1e9, hi = -1e9; for (const n of _held) { lo = Math.min(lo, n.u); hi = Math.max(hi, n.u); } spread = smooth(clamp((hi - lo - SPREAD_FROM) / (SPREAD_FULL - SPREAD_FROM), 0, 1)); }
  for (let a = 0; a < 5; a++) {
    let f = 0, l = 0; for (let b = 0; b < 5; b++) { f += ENSLAVE_FLEX[a][b] * _flex[b]; l += ENSLAVE_LIFT[a][b] * _liftCmd[b]; }
    f = Math.min(1, f); l = Math.min(1, l);
    H.flex[a] += (f - H.flex[a]) * (1 - Math.exp(-dt * (f > H.flex[a] ? MUSCLE_ON : MUSCLE_OFF))); H.ext[a] += (l - H.ext[a]) * (1 - Math.exp(-dt * (l > H.ext[a] ? MUSCLE_ON : MUSCLE_OFF)));
    if (a > 0) { const R = METACARPAL_RANGE[a]; spr1(H.mc, H.mcV, a, PALM_USE * R[1] * Math.max(0, H.flex[a] - TONE) + R[0] * Math.min(1, SPREAD_USE * spread + PALM_USE * LIFT_FLATTENS * H.ext[a]), W_PALM, dt); _mc[a] = H.mc[a];
      const lean = M.fingers[a].lean; spr1(H.fan, H.fanV, a, METACARPAL_SIDE[a] * (a === 1 ? Math.min(0, lean) : lean), W_PALM, dt); }      // the index finger's metacarpal has room only on the thumb's side
  }
  setPalm(M, _mc, H.fan);

  // ---- where the hand is along the keyboard
  // The hand follows its planned path exactly (the plan is already smooth). Where the plan itself breaks (a seek, the
  // start) the hand does not jump: the difference between where it is and
  // where the plan now wants it is carried as an offset that dies away smoothly.
  const before = pathAt(G, H.gi, st - PLAN_STEP).c, after = pathAt(G, H.gi, st + PLAN_STEP).c, path = pathAt(G, H.gi, st); const cT = path.c, planV = (after - before) / (2 * PLAN_STEP);
  if (dt > 0) {
    const jolt = Math.abs(planV - H.planV) / dt, slip = Math.abs(cT - H.planC - 0.5 * (planV + H.planV) * dt);
    if (jolt > PLAN_BREAK_ACCEL || slip > PLAN_BREAK_SLIP) { H.off = H.c - cT; H.offV = H.cV - planV; }
    spr(H, 'off', 0, W_CENTRE, dt);
    H.c = cT + H.off; H.cV = planV + H.offV; H.planC = cT; H.planV = planV;
  }
  let yawT = 0; if (H.elbow) yawT = -YAW_FOLLOW * Math.atan2(H.wrist.x - H.elbow.x, -(H.wrist.z - H.elbow.z));
  for (const a of SHORT) {
    const n = pressed[a] || coming[a]; if (!n) continue;
    const out = (a === 0 ? -1 : 1) * (n.u - H.c - HOME[a]), turn = Math.min(1, (n.black ? TURN_FOR_BLACK : 0) + TURN_FOR_BLACK * clamp((out - TURN_FREE) / (TURN_FULL - TURN_FREE), 0, 1));
    yawT += (a === 0 ? -YAW_THUMB : YAW_LITTLE) * s * turn;
  }
  spr(H, 'yaw', clamp(yawT, -YAW_MAX, YAW_MAX), W_YAW, dt);
  const cy = Math.cos(H.yaw), sy = Math.sin(H.yaw), mx = s * MIDDLE_X;
  const wristZ0 = WRIST_Z - HOME_AHEAD + mx * sy + HOME_AHEAD * cy;      // wrist depth before the hand moves in

  // ---- reach: how far in and how low the hand must be for the fingers that are playing or about to.
  // A fingertip can be no further from its base joint than the finger is long. Worked out from where the
  // base joints were on the last frame, which turns the two springs below into a feedback loop.
  let depthT = 0, dropT = 0, lean = 0;
  for (let a = 0; a < 5; a++) {
    let n = pressed[a]; H.deepest[a] = DEEPEST_Z; H.nearest[a] = 1;
    // a coming note counts once the hand is free to set up for it, measured from where the hand will be by then
    if (!n && coming[a] && (!_held.length || Math.abs(coming[a].c - H.c) < SAME_PLACE)) n = coming[a];
    if (!n) continue;
    _k.copy(M.fingers[a].K).applyMatrix4(M.root.matrix); if (n !== pressed[a]) _k.x += s * (n.c - H.c);
    const lat = s * n.u - _k.x, free = R_MAX[a] * R_MAX[a] - lat * lat, down = _k.y - H.over * OVER_KNUCKLE_RISE - (KEYTOP + (n.black ? BLACK_RISE : 0) - keyDip(H.zb[a], n.black) + FR[a][3] * TIP_SEAT);
    dropT = Math.max(dropT, H.drop + down - Math.sqrt(Math.max(0, free - MIN_FORWARD[a] * MIN_FORWARD[a])));
    H.deepest[a] = _k.z - Math.sqrt(Math.max(0, free - down * down)) * REACH_USE;
    // a finger that swings sideways has to reach out, not curl under, or the knuckle cannot turn that far
    if (a > 0) { const out = s * lat / (s * lat < 0 ? SPLAY[a][0] : SPLAY[a][1]) * SPLAY_USE; H.nearest[a] = Math.max(H.deepest[a], _k.z - Math.sqrt(Math.max(0, out * out - down * down))); }
    const natural = wristZ0 - H.depth - LAND[a][1] * cy - s * LAND[a][0] * sy, zone = n.black ? SLOT_Z : FRONT_Z;
    depthT = Math.max(depthT, H.depth + Math.max(Math.min(natural, H.nearest[a]), H.deepest[a]) - zone);
    if (pressed[a]) lean += (a - 2) / 2;
  }
  spr(H, 'depth', clamp(Math.max(depthT, H.over * OVER_IN + H.stack * STACK_IN), 0, DEPTH_MAX), W_DEPTH, dt);
  spr(H, 'drop', clamp(Math.max(dropT, H.under * UNDER_DROP), 0, DROP_MAX), W_DROP, dt);
  let breath = 0;
  if (_held.length) H.released = st;
  else if (nextT < 1e8 && nextT - H.released > PHRASE_REST) breath = PHRASE_LIFT * smooth(clamp((nextT - H.released - PHRASE_REST) / (PHRASE_FULL - PHRASE_REST), 0, 1)) * Math.sin(Math.PI * clamp((st - H.released) / (nextT - H.released), 0, 1));
  // the loudest note about to be played decides how far the wrist winds up
  let loud = 0, soonest = WIND_UP;
  for (let a = 0; a < 5; a++) { const q = coming[a]; if (q && q.t - st < WIND_UP) { loud = Math.max(loud, q.v); soonest = Math.min(soonest, q.t - st); } }
  const wind = WIND_UP_LIFT * clamp((loud - WIND_UP_FROM) / (1 - WIND_UP_FROM), 0, 1) * (soonest > STRIKE ? smooth(clamp((WIND_UP - soonest) / (WIND_UP - STRIKE), 0, 1)) : (soonest / STRIKE) ** 1.5);
  H.wind = wind;
  spr(H, 'lift', (Math.max(path.arc, breath) + wind) * (1 - UNDER_STAYS_LOW * H.under) + H.over * OVER_LIFT + H.yields * YIELD_LIFT + H.stack * STACK_LIFT + (resting ? REST_FLOAT : 0), W_LIFT, dt);
  spr(H, 'dip', 0, W_DIP, dt); H.dip = clamp(H.dip, -DIP_MAX, DIP_MAX);
  spr(H, 'roll', _held.length ? clamp(ROLL_GAIN * lean / _held.length, -ROLL_MAX, ROLL_MAX) : 0, W_ROLL, dt);
  spr(H, 'pitch', HAND_PITCH - clamp((H.lift - H.over * OVER_LIFT) * ARC_PITCH, 0, PITCH_MAX) - H.over * OVER_TILT - BLACK_TILT * H.black / BLACK_LIFT, W_PITCH, dt);
  // ---- sway: how busy the hand is (the notes it begins a second, those nearer in time counting for more), and from
  // that how far the slow waves move the wrist and roll the hand. Fingers on their keys stay there: they are solved
  // towards their keys from wherever the hand is.
  { const O = H.onsets, W = SWAY.over; while (H.si < O.length && O[H.si] < st - W) H.si++;
    let begun = 0; for (let k = H.si; k < O.length && O[k] < st + W; k++) begun += Math.max(0, 1 - Math.abs(O[k] - st) / W);
    H.sway = smooth(clamp((SWAY.busy - begun / W) / (SWAY.busy - SWAY.calm), 0, 1)); }
  const hand = s > 0 ? 0 : SWAY.handsApart, swayY = H.sway * SWAY.rise * wave(st, 0, hand), swayX = H.sway * SWAY.along * wave(st, 2, hand), swayZ = H.sway * SWAY.inOut * wave(st, 3, hand);
  H.swayRoll = H.sway * SWAY.roll * wave(st, 1, hand); H.swayPitch = -(1 - SWAY.knuckleShare) * swayY / KNUCKLE_AHEAD;
  // put the wrist so that the point HOME_AHEAD along the middle finger line stays over the hand's centre
  const wasX = H.wrist.x, wasZ = H.wrist.z;
  { let keys = 0, black = 0; for (let a = 0; a < 5; a++) { const n = pressed[a] || coming[a]; if (n) { keys++; if (n.black) black++; } } if (keys) spr(H, 'black', pressed[0] || coming[0] ? 0 : BLACK_LIFT * black / keys, W_BLACK, dt); }      // with nothing to play the hand keeps the height it had
  H.wrist.set(s * H.c - mx * cy + HOME_AHEAD * sy + H.shove + swayX, WRIST_Y + H.lift + H.black + H.dip - H.drop + swayY, wristZ0 - H.depth + swayZ);
  const moveX = H.wrist.x - wasX, moveZ = H.wrist.z - wasZ;
  M.root.position.copy(H.wrist); M.root.rotation.set(H.pitch + H.swayPitch, H.yaw, -s * (H.roll + H.swayRoll), 'YXZ'); placeHand(M);

  // ---- sideways: where each fingertip goes (u = side * x)
  for (let a = 0; a < 5; a++) {
    const homeU = s * (H.wrist.x + s * LAND[a][0] * cy - LAND[a][1] * sy), p = pressed[a], q = p ? null : coming[a];
    H.homeU[a] = homeU; _pin[a] = !!p; if (p) _rides[a] = 0;
    const tight = H.zb[a] < BLACK_FRONT_Z + FR[a][3];                              // between the black keys a tip has no room to sit off centre
    // Where a finger with nothing to do waits. Not at its home in the hand, if it has just played: it stays over the key
    // it left, as far as it can comfortably reach from where the hand is, for LINGER seconds, and for as long as STAY_FOR
    // if its next key is that key or one within STAY_KEYS of it. (It used to go home at once and come out again for the
    // same key. Measured, a pianist's fingertip wanders 4 to 9 mm between two strikes of the same or a neighbouring
    // key; ours 6 to 31: audit section 21.) It does not go over to a different key early: that put it in the other hand's way.
    let wait = homeU; H.waits[a] = null; _rides[a] = 1;
    if (!p) {
      const was = H.lastNote[a]; let next = H.nextNote[a] || (was ? was.nextSame : H.firstOf[a]); while (next && next.t <= st) next = next.nextSame; H.nextNote[a] = next;
      const within = u => clamp(u, homeU + REACH[a][0], homeU + REACH[a][1]);
      const again = was && next && Math.abs(next.u - was.u) <= STAY_KEYS * KEY_PITCH && next.t - was.ev < STAY_FOR;      // it plays here again: it has no reason to leave
      const stay = !was || was.ev > st ? 0 : again ? 1 : smooth(clamp((LINGER - (st - was.ev)) / LINGER_EASES, 0, 1));
      if (stay > 0) { wait = lerp(wait, within(was.u), stay); H.waits[a] = was; }
    }
    if (p) _tu[a] = p.u + clamp((homeU - p.u) / 0.004, -1, 1) * (p.black ? BLACK_SIDE_PLAY : tight ? 0 : WHITE_SIDE_PLAY);
    else if (q && q.t - st < PREP) {
      const k = smooth(clamp((PREP - (q.t - st)) / (PREP - PREP_ARRIVE), 0, 1));
      _tu[a] = lerp(wait, q.u + clamp((homeU - q.u) / 0.004, -1, 1) * (q.black ? BLACK_SIDE_PLAY : tight ? 0 : WHITE_SIDE_PLAY), k); _pin[a] = k > 0.5; _rides[a] *= 1 - k;
    } else _tu[a] = wait;
  }
  for (let a = 0; a < 5; a++) if (!_pin[a]) _tu[a] += s * H.push[a].x;     // an idle fingertip gives way sideways where the contact solver asks
  // fingers with nothing to do open out with their neighbours, and tips never cross
  for (let a = 0; a < 5; a++) if (!_pin[a]) {
    let L = -1, R = -1; for (let b = a - 1; b >= 0; b--) if (pressed[b]) { L = b; break; } for (let b = a + 1; b < 5; b++) if (pressed[b]) { R = b; break; }
    const offL = L >= 0 ? pressed[L].u - H.homeU[L] : 0, offR = R >= 0 ? pressed[R].u - H.homeU[R] : 0;
    if (L >= 0 && R >= 0) _tu[a] += lerp(offL, offR, (a - L) / (R - L)); else if (L >= 0) _tu[a] += offL * 0.5 ** (a - L); else if (R >= 0) _tu[a] += offR * 0.5 ** (R - a);
  }
  // a finger on its way to a key waits beside a finger that is still down in its way (the thumb is left out: it passes under)
  for (let a = 1; a < 5; a++) if (!pressed[a] && _pin[a]) for (let b = 1; b < 5; b++) if (pressed[b]) { if (b < a) _tu[a] = Math.max(_tu[a], _tu[b] + MIN_TIP_GAP); else _tu[a] = Math.min(_tu[a], _tu[b] - MIN_TIP_GAP); }
  // an idle fingertip keeps clear of the keys the other hand is on, moving back towards its own hand
  for (let a = 0; a < 5; a++) if (!_pin[a]) for (let k = 0; k < H.claimN; k++) { const cu = s * H.claimX[k]; if (Math.abs(_tu[a] - cu) < HAND_GAP) _tu[a] = cu + (H.c + HOME[2] >= cu ? HAND_GAP : -HAND_GAP); }
  _shoved.fill(false);
  // (a tip held beside its neighbour goes where that neighbour's place goes: it rides with the hand as much as the neighbour does)
  for (let a = 2; a < 5; a++) if (!_pin[a] && _tu[a] < _tu[a - 1] + MIN_TIP_GAP) { _tu[a] = _tu[a - 1] + MIN_TIP_GAP; _shoved[a] = true; _rides[a] = _rides[a - 1]; }
  for (let a = 3; a >= 1; a--) if (!_pin[a] && _tu[a] > _tu[a + 1] - MIN_TIP_GAP) { _tu[a] = _tu[a + 1] - MIN_TIP_GAP; _shoved[a] = true; _rides[a] = _rides[a + 1]; }
  if (!_pin[0] && _tu[0] > _tu[1] - MIN_TIP_GAP) { _tu[0] = _tu[1] - MIN_TIP_GAP; _rides[0] = _rides[1]; }
  // an idle fingertip that still has no room beside the other hand's busy one draws back towards its own palm instead
  for (let a = 0; a < 5; a++) { _tuck[a] = false; if (!_pin[a]) for (let k = 0; k < H.claimN; k++) if (Math.abs(_tu[a] - s * H.claimX[k]) < HAND_GAP * TUCK_WHEN) _tuck[a] = true; }

  // ---- depth and height, then the springs
  for (let a = 0; a < 5; a++) {
    const p = pressed[a], q = p ? null : (coming[a] && coming[a].t - st < coming[a].prep ? coming[a] : null), n = p || q, R = FR[a][3] * TIP_SEAT, tip = H.tips[a], tv = H.tipV[a];
    H.doing[a] = p ? DOWN : q ? PREPARING : IDLE;
    // (the contact solver may ask a fingertip to sit further in or out along its key: H.push, see separate())
    const natural = Math.max(Math.min(wristZ0 - H.depth - LAND[a][1] * cy - s * LAND[a][0] * sy + H.push[a].z, H.nearest[a]), H.deepest[a]);
    let tz, hT, w, wh = W_HEIGHT;
    if (n && n.black) tz = clamp(natural, DEEPEST_Z, SLOT_Z);
    else tz = natural > WHITE_DEEP_Z ? Math.min(natural, FRONT_Z) : natural > SLOT_Z ? WHITE_DEEP_Z : Math.max(natural, DEEPEST_Z);
    if (!n && a === 0 && tz < WHITE_DEEP_Z) tz = WHITE_DEEP_Z;                    // an idle thumb waits in front of the black keys
    if (_tuck[a]) tz = Math.min(tz + TUCK_BACK, TUCK_FRONT);                      // out of the other hand's way
    if (a > 0) {                                                                 // keep the finger open: reach forward rather than curl under
      _k.copy(M.fingers[a].K).applyMatrix4(M.root.matrix);
      const open = Math.max(_k.z - leastAhead(a, Math.max(0, _k.y - tip.y)), H.deepest[a]);
      if (tz > open) { tz = open; if (n && !n.black && tz < WHITE_DEEP_Z && tz > SLOT_Z) tz = H.deepest[a] <= SLOT_Z ? SLOT_Z : WHITE_DEEP_Z; if (n && n.black) tz = Math.min(tz, SLOT_Z); }
    }
    if (p) { hT = 0; w = W_TIP_HELD; }
    else if (q) {                                                                // glide over the key, lift, then fall and meet the key moving
      // the spring that carries the height runs HEIGHT_LAG behind, so it is told where the tip should be that much later
      // the lift is above the key it will play: a tip already carried high over the black keys does not lift that much again
      const raised = Math.max(0, H.top[a] - (KEYTOP + (q.black ? BLACK_RISE : 0))), tau = q.t - st - HEIGHT_LAG, top = HOVER + Math.max(0, q.lift - raised), u = tau / q.strike;
      // the ring finger shares its extensor with its neighbours: it lifts fully only when they lift with it
      const can = a === 3 ? lerp(RING_ALONE, 1, clamp(Math.max(H.ext[2], H.ext[4]) / LIFT_EFFORT[0], 0, 1)) : 1;
      // the fall starts from rest at the top and ends at ARRIVES times its mean speed (a cubic; past the key it carries on down)
      hT = (u > 1 ? lerp(HOVER, top, smooth(clamp((q.prep - tau) / (q.prep - q.strike), 0, 1))) : top * u * (ARRIVES + u * (3 - 2 * ARRIVES + u * (ARRIVES - 2)))) * can * (1 - UNDER_STAYS_LOW * H.under);      // the hand underneath keeps its fingers low
      w = W_TIP_PREP;
    } else {
      const busy = (pressed[a - 1] ? 1 : 0) + (pressed[a + 1] ? 1 : 0);
      hT = (resting ? HOVER_REST : HOVER) - SYMPATHY * busy + CARRIED_UP * H.ext[a] + H.yields * (OVER_LIFT + YIELD_LIFT) * FINGERS_COME_UP; w = W_TIP_IDLE; wh = W_HEIGHT_UP;      // carried up by a neighbour that lifts
    }
    // and rides higher where it asks. Not a thumb that is under its own palm: there is no room above it, and rising
    // there took it up through the hand (the owner's picture). It stays low and the solver's other freedoms do the work.
    if (a === 0) { _k.copy(M.fingers[1].K).applyMatrix4(M.root.matrix); H.thumbUnder = s * (tip.x - _k.x) > -THUMB_BESIDE_PALM; }
    if (!p && !(a === 0 && H.thumbUnder)) hT += H.push[a].y;
    // A free finger travels with the hand, it does not trail behind it; but only as far as the place it is heading for
    // travels with the hand (_rides). A key stands still: carried on at the hand's speed in a leap, a fingertip on its way
    // to its key was flung 20 to 35 mm past it and came back onto it only as the note sounded.
    // (A finger lingering over the key it left, or opened out between held keys, is still carried as before: its
    // wander between strikes was matched to the pianists' that way, audit section 21.)
    if (!p) { tip.x += moveX * _rides[a]; H.zb[a] += moveZ; }
    // a finger moved aside by its neighbour keeps pace with it (a finger crossing over the thumb takes the others with it)
    spr1(tip, tv, 'x', s * _tu[a], _shoved[a] ? Math.max(w, W_TIP_PREP) : w, dt); spr1(H.zb, H.zbV, a, tz, w, dt);
    if (p) { H.h[a] = 0; H.hV[a] = 0; } else { spr1(H.h, H.hV, a, hT, wh, dt); if (H.h[a] < 0) H.h[a] = 0; }
    // the surface under the tip: the key it is on (following it down and back up), or whatever lies below it
    const k = n || H.key[a], zb = H.zb[a], keyTop = k ? KEYTOP + (k.black ? BLACK_RISE : 0) - keyDip(zb, k.black) * keyRot[k.m] : 0;
    // a finger that has let go rides its key back up only while it is still over that key
    if (p || (!n && k && keyRot[k.m] > KEY_SETTLED && Math.abs(s * tip.x - k.u) < SLOT_ALIGN)) { H.top[a] = keyTop; H.topV[a] = 0; }
    else {
      if (!n) H.key[a] = null;
      // a free tip rides at the height of the black key tops from just in front of them: it is up before it reaches their faces
      const edge = WHITE_DEEP_Z, open = KEYTOP + BLACK_RISE * smooth(clamp((edge - zb) / (edge - (BLACK_FRONT_Z + R - BLACK_FACE_GAP)), 0, 1));
      // on its way to a white key between black keys, a finger stays above them until it is over its key
      const down = n && (n.black || Math.abs(s * tip.x - n.u) < SLOT_ALIGN);
      spr1(H.top, H.topV, a, down ? keyTop : open, down ? W_SURFACE : W_SURFACE_UP, dt);
    }
    tip.y = H.top[a] + R + H.h[a];
    // height above the key bed carries the tip forward
    const onBlack = k ? k.black : zb < SLOT_Z, bed = KEYTOP + (onBlack ? BLACK_RISE : 0) - keyDip(zb, onBlack) + R;
    tip.z = zb - FORWARD_PER_RISE[a] * Math.max(0, tip.y - bed);
    // A fingertip is never inside a black key. Whatever the springs above ask for, the tip is put back outside: over the
    // key's top, or, when it is down on a white key between two black ones, sideways to the middle of its own key.
    for (let i = 0; i < BLACK_X.length; i++) {
      const dx = tip.x - BLACK_X[i]; if (Math.abs(dx) > BLACK_HALF_BASE + R) continue;
      const keyTop = KEYTOP + BLACK_RISE - keyDip(zb, true) * keyRot[BLACK_M[i]], up = keyTop + R - tip.y; if (up <= 0 || tip.z - R >= BLACK_FRONT_Z) continue;      // above it, or in front of it
      const half = lerp(BLACK_HALF_BASE, BLACK_HALF_TOP, clamp((tip.y - R - KEYTOP) / BLACK_RISE, 0, 1)), side = half + R - FLESH_GIVES - Math.abs(dx); if (side <= 0) continue;      // beside it
      if (p && !p.black && (s * p.u - BLACK_X[i]) * dx > 0) tip.x += Math.sign(dx) * side;      // held down beside it, on its own key's side: move over, towards its own key. (On the far side it goes over the top to get there.)
      else { tip.y += up; H.h[a] += up; if (H.hV[a] < 0) H.hV[a] = 0; tip.z = zb - FORWARD_PER_RISE[a] * Math.max(0, tip.y - bed); }
    }
  }
  archThumb(M, H.thumbUnder ? 0 : H.push[0].y / THUMB_ARCH_FULL);                 // a thumb asked to ride higher while it is on its key arches instead
  poseHand(M, H.tips);
}
// ---- one clock
// The hands move in fixed steps of the song's time, whatever the screen's frame rate and whatever speed the song is
// played at. So a slow speed shows exactly the movement of full speed, slowed; a paused song is a still frame.
// clock: { t } the song time the hands have reached. keysAt(t) gives how far down every key is at t (0..1 by MIDI
// number). Each hand's `heard` lists the notes that sounded on the way. Returns the song time covered, or -1 when st
// cannot be reached in steps (a seek, a loop, time running backwards): the caller then moves the hands there with settleHands.
export const MOTION_STEP = 1 / 240, MOTION_STEPS_MOST = 36;
export function advanceHands(hands, clock, st, keysAt, together = true) {
  const from = clock.t; for (const H of hands) H.heard.length = 0;
  if (st < clock.t || st - clock.t > MOTION_STEP * MOTION_STEPS_MOST) return -1;
  while (clock.t + MOTION_STEP <= st) {
    clock.t += MOTION_STEP; const keys = keysAt(clock.t);
    if (together) crowd(hands[0], hands[1]);
    for (const H of hands) { updateHand(H, clock.t, MOTION_STEP, keys); for (const n of H.struck) H.heard.push(n); }
  }
  return clock.t - from;
}
// Bring the hands towards where they belong at st, by dt seconds of settling (after a jump, or to hold a pose).
export function settleHands(hands, clock, st, dt, keys) {
  clock.t = st; crowd(hands[0], hands[1]);
  for (const H of hands) { updateHand(H, st, dt, keys); H.heard.length = 0; for (const n of H.struck) H.heard.push(n); }
}

// Lay the skin over the hand once the arm is solved: the cuff of the skin follows the forearm towards the elbow.
const _fore = V(0, 0, 0);
export { FOREARM, ELBOW_BALL };
export function skinOver(H, elbow) { const far = toHand(H.M, elbow, _fore).length(); skinHand(H.M, _fore.multiplyScalar(1 / far), far / FOREARM); }

// two-bone reach from A towards T, bending towards the pole: writes the joint J and the end E
const _id = V(0, 0, 0), _ip = V(0, 0, 0);
export function reach2(A, T, l1, l2, pole, J, E) {
  _id.subVectors(T, A); const d = Math.max(1e-6, _id.length()), dc = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  _id.multiplyScalar(1 / d);
  const a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _ip.copy(pole).addScaledVector(_id, -pole.dot(_id)); if (_ip.lengthSq() < 1e-8) _ip.set(0, 1, 0); _ip.normalize();
  J.copy(A).addScaledVector(_id, a).addScaledVector(_ip, h); E.copy(A).addScaledVector(_id, dc);
  return d - dc;                                           // how far short the arm falls, if at all
}

// Call once a frame before updating the hands: works out how much they crowd each other. The right hand passes over.
// Two hands in the same place. Call once a frame before updateHand, with the hands as they were left last frame.
// Which hand goes over is settled as they close in: the one that is travelling (it is the one crossing), and it stays so
// until they part. The hand underneath makes room: its wrist sinks, its idle fingers stay low. And each hand is told
// which keys the other's fingers are on or about to take, so that its own idle fingers keep clear of them.
export function crowd(right, left) {
  const u = clamp((CROWD_FROM - (right.wrist.x - left.wrist.x)) / (CROWD_FROM - CROWD_FULL), 0, 1), c = u * u * (3 - 2 * u);
  // A hand with nothing to play for a while makes room for one that is playing: it is the one that goes over, and it
  // lifts well clear. (Before, the hand that was moving went over, so a resting hand stayed down on the keys while the
  // other played an arpeggio through it: the owner's picture at 1:02 of the Fantaisie-Impromptu. Where the hands of the
  // pianist who recorded that piece lap, they are 127 mm apart in height at the median: audit section 16.)
  const rightFree = right.free > YIELD_AFTER, leftFree = left.free > YIELD_AFTER, yields = c > 0 && rightFree !== leftFree;
  right.yields = yields && rightFree ? c : 0; left.yields = yields && leftFree ? c : 0;
  // when both are playing, the hand that is travelling goes over; that is settled as they meet and kept until they part
  // (not settled while one is only making room: when it comes back to play, they meet afresh)
  if (c <= 0) right.overHand = -1; else if (!yields && right.overHand < 0) right.overHand = Math.abs(left.cV) > Math.abs(right.cV) * MOVER_MARGIN ? 1 : 0;
  const leftOver = yields ? leftFree : right.overHand === 1, stack = smooth(clamp((CROWD_FULL - (right.wrist.x - left.wrist.x)) / STACK_OVER, 0, 1));      // one hand right on top of the other
  right.stack = leftOver ? 0 : stack; left.stack = leftOver ? stack : 0;
  right.over = leftOver ? 0 : c; right.under = leftOver && !yields ? c : 0; left.over = leftOver ? c : 0; left.under = leftOver || yields ? 0 : c;      // the hand that plays under a hand that has made room does not have to sink
  claim(right, left); claim(left, right);
  separate(right, left);
}
// ---- contact: the two hands are solid to each other
// One rule for every case. Each hand is a set of balls: five along every finger (base, half way along the first bone,
// two joints, tip) and three in the palm. Each step every ball of one hand is tested against every ball of the other.
// Where two overlap, whatever is free to move gives way, by how free it is:
//   an idle finger        moves any way: sideways, up, in or out along the keys
//   a finger preparing    may ride higher and sit further in or out along its key, but still comes down on its key
//   a finger on its key   stays on its key; it can only sit further in or out along it. A thumb can also arch: its
//                         joints rise with its tip where it was, as far as a thumb turns (hand.mjs archThumb, THUMB_TURN_MOST)
//   the palm              does not give way (its place is the hand's place)
//   the hand itself       where parts that cannot move still overlap, the two hands edge apart along the keys, a little
//                         (CONTACT.shove at most), their fingers staying on their keys
// The same test runs between the fingers of one hand (their joints and tips), so a thumb passing under does not pass
// through the fingers above it.
// Two parts that cannot move apart sideways or up (two thumbs down on neighbouring keys) part in depth: one plays further
// in, the other nearer the edge, as pianists' thumbs do (audit section 16: 7 to 10 mm apart in depth where they meet).
// What a finger is asked for is remembered (H.push) and builds up while the overlap lasts, holds while the parts are
// still within CONTACT.clear of touching, and fades when they have parted; the hand's own springs carry it out, so
// nothing jumps. It replaces a growing list of special cases (idle thumbs, a thumb beside a busy finger, and so on).
const IDLE = 0, PREPARING = 1, DOWN = 2, PALM = -1;
const FINGER_BALLS = 5, PALM_BALLS = 3, SOLIDS = 5 * FINGER_BALLS + PALM_BALLS, SOLID = 5;      // per ball: x, y, z, radius, whose (finger 0..4 or PALM)
const PALM_AT = [[0, 0.004, -0.02], [0, 0.004, -0.05], [0, 0.004, -0.08]], PALM_BALL = 0.018;      // the palm's balls in the hand's frame, and their radius
const CONTACT = { apart: 0.003, clear: 0.004, gain: 0.2, fades: 0.3, most: 0.03, preparingShare: 0.35, shove: 0.010, ownGive: 0.002, rises: 0.6 };      // metres of air kept between two parts; metres more within which what was asked is held; share of the shortfall taken up each step; seconds to fade; most a finger is moved (m); how free a preparing finger is against an idle one; most a hand edges aside (m)
const THUMB_FROM = 3;                                      // of the thumb, its end joint and tip are tested against its own palm (its first joint lies against the index finger's root as a matter of course)
const OWN_FROM = 2;                                        // within one hand, the balls tested: from the first joint outwards (FINGER_BALLS: base, half way, joint, joint, tip)
const THUMB_BESIDE_PALM = 0.004;                           // a thumb whose tip is within this of the index finger's knuckle, across the keys, or beyond it, is under its own palm (metres)
const THUMB_ARCH_FULL = 0.010;                              // a thumb asked to be this much higher (metres) is fully arched
const _ball = V(0, 0, 0), _mid = V(0, 0, 0), _asked = [0, 1].map(() => [0, 1, 2, 3, 4].map(() => V(0, 0, 0))), _touching = [new Uint8Array(5), new Uint8Array(5)];
function solids(H) {
  const S = H.solid, Mx = H.M.root.matrix; let o = 0;
  const put = (p, r, who) => { _ball.copy(p).applyMatrix4(Mx); S[o] = _ball.x; S[o + 1] = _ball.y; S[o + 2] = _ball.z; S[o + 3] = r; S[o + 4] = who; o += SOLID; };
  for (let a = 0; a < 5; a++) { const f = H.M.fingers[a]; put(f.K, FR[a][0], a); put(_mid.addVectors(f.K, f.J1).multiplyScalar(0.5), (FR[a][0] + FR[a][1]) / 2, a); put(f.J1, FR[a][1], a); put(f.J2, FR[a][2], a); put(f.E, FR[a][3], a); }
  for (const at of PALM_AT) put(_mid.set(at[0], at[1], at[2]), PALM_BALL, PALM);
}
// One pair of balls: i of hand P (finger a), j of hand Q (finger b). `gap` is the air to keep between them. Adds what
// each finger is asked for to _asked and marks them in _touching; returns how far two parts that cannot move overlap.
function meet(P, hp, i, Q, hq, j, gap) {
  const A = P.solid, B = Q.solid, dx = A[i] - B[j], dy = A[i + 1] - B[j + 1], dz = A[i + 2] - B[j + 2], d = Math.hypot(dx, dy, dz) || 1e-6, reach = A[i + 3] + B[j + 3] + gap, a = A[i + 4], b = B[j + 4];
  if (d >= reach + CONTACT.clear) return 0;
  if (a !== PALM) _touching[hp][a] = Math.max(_touching[hp][a], 1); if (b !== PALM) _touching[hq][b] = Math.max(_touching[hq][b], 1);      // near enough to hold what was asked
  const fa = freedom(P, a), fb = freedom(Q, b); if (fa + fb === 0) _stuck = true;
  if (d >= reach) return 0;
  if (a !== PALM) _touching[hp][a] = 2; if (b !== PALM) _touching[hq][b] = 2;
  const over = reach - d;
  if (fa + fb > 0) {                                         // something is free: it moves straight out of the overlap (a preparing finger only up and along its key)
    give(P, hp, a, fa / (fa + fb), over / d, dx, dy, dz); give(Q, hq, b, fb / (fa + fb), -over / d, dx, dy, dz); return 0;
  }
  // neither can leave its place: they part in depth, as far as it takes
  const flat = dx * dx + dy * dy; if (flat >= reach * reach) return 0; const need = Math.sqrt(reach * reach - flat) - Math.abs(dz), way = Math.abs(dz) > 1e-4 ? Math.sign(dz) : -1;      // level in depth: the first goes further in
  const pa = a !== PALM, qb = b !== PALM; if (!pa && !qb) return over;
  if (pa) _asked[hp][a].z += way * need * (qb ? 0.5 : 1); if (qb) _asked[hq][b].z -= way * need * (pa ? 0.5 : 1);
  if (a === 0 && (dy >= 0 || b !== 0)) _asked[hp][0].y += over; else if (b === 0) _asked[hq][0].y += over;      // and of two parts one of which is a thumb, the higher thumb arches over
  return over;
}
const freedom = (H, who) => (who === PALM ? 0 : H.doing[who] === IDLE ? 1 : H.doing[who] === PREPARING ? CONTACT.preparingShare : 0);
// what a preparing finger cannot do sideways it does by riding higher
// (an idle finger pushed sideways also rises, by CONTACT.rises of it: caught between two things it can always go over)
function give(H, h, who, share, k, dx, dy, dz) { if (share <= 0) return; const P = _asked[h][who], idle = H.doing[who] === IDLE, m = k * share; if (idle) P.x += m * dx; P.y += Math.max(0, m * dy) + (idle ? CONTACT.rises : 1) * Math.abs(m * dx); P.z += m * dz; }
let _stuck = false;                                      // whether any two parts that cannot move are close this step
function separate(right, left) {
  const hands = [right, left]; solids(right); solids(left); _stuck = false;
  for (let h = 0; h < 2; h++) { _touching[h].fill(0); for (let a = 0; a < 5; a++) _asked[h][a].set(0, 0, 0); }
  // hand against hand: every ball of one against every ball of the other, with a little air between
  let apart = 0;                                           // how far the hands themselves are asked to edge apart this step
  for (let i = 0; i < right.solid.length; i += SOLID) for (let j = 0; j < left.solid.length; j += SOLID) apart = Math.max(apart, meet(right, 0, i, left, 1, j, CONTACT.apart));
  // and the fingers of one hand against each other: the two joints and the tip of each (their roots lie side by side
  // in the palm and always touch); fingers of one hand may touch, but not pass through each other
  for (let h = 0; h < 2; h++) { const H = hands[h]; for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) for (let p = OWN_FROM; p < FINGER_BALLS; p++) for (let q = OWN_FROM; q < FINGER_BALLS; q++) meet(H, h, (a * FINGER_BALLS + p) * SOLID, H, h, (b * FINGER_BALLS + q) * SOLID, -CONTACT.ownGive);
    // and the thumb against the rest of its own hand: the roots of the fingers and the palm. Pushed aside by the other
    // hand it has nowhere to go but under its own palm, and without this it went into it (the owner's picture).
    for (let p = THUMB_FROM; p < FINGER_BALLS; p++) { for (let b = 1; b < 5; b++) for (let q = 0; q < OWN_FROM; q++) meet(H, h, p * SOLID, H, h, (b * FINGER_BALLS + q) * SOLID, -CONTACT.ownGive); for (let k = 0; k < PALM_BALLS; k++) meet(H, h, p * SOLID, H, h, (5 * FINGER_BALLS + k) * SOLID, -CONTACT.ownGive); }
  }
  const fade = Math.exp(-MOTION_STEP / CONTACT.fades);
  for (const H of hands) { const out = H === right ? 1 : -1; if (apart > 0) H.shove = clamp(H.shove + out * CONTACT.gain * apart / 2, -CONTACT.shove, CONTACT.shove); else if (!_stuck) H.shove *= fade; }      // the right hand edges to the right, the left to the left
  for (let h = 0; h < 2; h++) for (let a = 0; a < 5; a++) {
    const P = hands[h].push[a];
    if (_touching[h][a] === 2) P.addScaledVector(_asked[h][a], CONTACT.gain); else if (_touching[h][a] === 0) P.multiplyScalar(fade);
    P.x = clamp(P.x, -CONTACT.most, CONTACT.most); P.y = clamp(P.y, 0, CONTACT.most); P.z = clamp(P.z, -CONTACT.most, CONTACT.most);
  }
}
// tell `to` where the busy fingertips of `from` are (across the keyboard)
function claim(from, to) {
  to.claimN = 0;
  for (let a = 0; a < 5; a++) if (from.pressed[a] || from.coming[a]) to.claimX[to.claimN++] = from.tips[a].x;
}
