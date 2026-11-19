// The right hand, in the playing position over five white keys, one finger a key.
// It is Great Piano Teachers' hand (src/piano-hand: skeleton, finger solver, the rigged skin from /hand), used at its
// lowest level: there is no planner here. Each fingertip is simply held on its key and goes down with it, so the hand
// shows what the learner's own hand should look like and which finger belongs to which key. We cannot know which
// finger the learner really used.
// The hand is made in metres, as the piano's is, inside a group scaled like the keys (src/keyboard.mjs `scale`).
// For the jellies it is a set of balls (`pushers`) that push them aside, and, once it has landed, a flat invisible
// ledge over each finger for a letter to stand on (`ledges`): a finger itself is round and moves.
import * as THREE from 'three';
import { createHand, skinOver, LAND_Z, KEYTOP, FOREARM } from './piano-hand/handmotion.mjs';
import { poseHand, placeHand, setPalm, archThumb, fromHand, FR } from './piano-hand/hand.mjs';
import { readRig, wearRig } from './piano-hand/righand.mjs';
import { KEY, STAND_BACK } from './keyboard.mjs';

const RIG_FILE = 'hand/Hand_Nails_R.gltf', RIGHT = 1, FINGERS = 5;
const SKIN = { color: 0xd9a587, roughness: 0.6, metalness: 0, sheen: 0.3, sheenRoughness: 0.6 }, NAIL = { color: 0xf0d9cc, roughness: 0.16, clearcoat: 0.7, clearcoatRoughness: 0.2 };
// Skin takes little of the bright room all round (which on its own washes it flat, as the piano found): the room's
// share is SKIN_ROOM, and the hand's shape is drawn by the lamps instead (main.mjs HAND_LIGHT).
const SKIN_ROOM = 0.22;
const TIP_SEAT = 1.03;                                     // a fingertip's centre sits this many tip radii above its key (handmotion.mjs)
const ELBOW_FROM_WRIST = [0.10, -0.10, 1];                 // the way the forearm runs from the wrist: towards the player, a little out and down
// arriving: how high above its place the hand starts (metres, before scaling) and how long it takes to come down
export const ARRIVE = { from: 0.09, seconds: 1.4 };
// the balls: a finger's joints and the middles of its bones, the wrist, and the middles of the palm's bones
const PALM_BALL = 0.016, WRIST_BALL = 0.024, BALLS = FINGERS * 7 + 1 + (FINGERS - 1);
// a ledge: as wide as its key, this far either side of the home line (metres, before scaling), this far above the
// highest ball over it, and going down by this share of what the key under it goes down
const LEDGE = { halfDeep: 0.013, above: 0.0015, follow: 0.7 };
const smooth = u => u * u * (3 - 2 * u);

// keys: the five keys the fingers rest on, thumb first (MIDI numbers of white keys next to each other)
export async function buildHand3d(scene, kb, keys) {
  const s = kb.scale, group = new THREE.Group(); group.scale.setScalar(s); group.visible = false; scene.add(group);
  // a material's own share of the room only works if the room is set on the material itself (three.js)
  const skin = new THREE.MeshPhysicalMaterial({ ...SKIN, envMap: scene.environment, envMapIntensity: SKIN_ROOM });
  const H = createHand(RIGHT, skin, new THREE.MeshPhysicalMaterial(NAIL)), M = H.M; group.add(M.root);
  try { wearRig(M, readRig(await fetch(RIG_FILE).then(r => { if (!r.ok) throw new Error(RIG_FILE + ' ' + r.status); return r.json(); }))); } catch (e) { console.warn('the rigged hand did not load; using the built one', e); }
  // in the group's own metres: keys' tops at y = 0, their front edge at z = STAND_BACK
  const keyX = keys.map(m => kb.keys[m].x / s), wrist = new THREE.Vector3(keyX[2] + (H.wrist.x - H.tips[2].x), H.wrist.y - KEYTOP, H.wrist.z + STAND_BACK);
  M.root.position.copy(wrist); placeHand(M);
  const elbow = new THREE.Vector3(...ELBOW_FROM_WRIST).normalize().multiplyScalar(FOREARM).add(wrist), none = [0, 0, 0, 0, 0];
  const tips = keys.map((m, a) => new THREE.Vector3(keyX[a], 0, LAND_Z[a] + STAND_BACK));
  // how far down key m's top is where finger a rests on it (metres): the key turns about its back end
  const dipAt = (m, a) => kb.down[m] * KEY.swing * (KEY.whiteLong + LAND_Z[a]);
  const P = { n: 0, x: new Float64Array(BALLS), y: new Float64Array(BALLS), z: new Float64Array(BALLS), r: new Float64Array(BALLS), lo: [0, 0, 0], hi: [0, 0, 0], moving: false };
  const v = new THREE.Vector3(), w = new THREE.Vector3(), state = { shown: false, u: 0, landed: false, lastSum: NaN };
  const ball = (p, r) => { fromHand(M, p, v); const i = P.n++; P.x[i] = v.x * s; P.y[i] = v.y * s + group.position.y; P.z[i] = v.z * s; P.r[i] = r * s; };
  function balls() {
    P.n = 0;
    M.fingers.forEach((f, a) => { const J = [f.K, f.J1, f.J2, f.E]; J.forEach((p, j) => { ball(p, FR[a][j]); if (j) ball(w.addVectors(J[j - 1], p).multiplyScalar(0.5), (FR[a][j - 1] + FR[a][j]) / 2); }); });
    ball(w.set(0, 0, 0), WRIST_BALL); for (let a = 1; a < FINGERS; a++) ball(w.copy(M.fingers[a].K).multiplyScalar(0.5), PALM_BALL);
    for (let k = 0; k < 3; k++) { const A = k === 0 ? P.x : k === 1 ? P.y : P.z; let lo = Infinity, hi = -Infinity; for (let i = 0; i < P.n; i++) { lo = Math.min(lo, A[i] - P.r[i]); hi = Math.max(hi, A[i] + P.r[i]); } P.lo[k] = lo; P.hi[k] = hi; }
  }
  // the ledges, from where the balls are now (called once the hand has landed, no key down)
  function ledges() {
    const half = LEDGE.halfDeep * s;
    return keys.map(m => {
      const k = kb.keys[m]; let top = -Infinity;
      for (let i = 0; i < P.n; i++) if (P.x[i] + P.r[i] > k.x0 && P.x[i] - P.r[i] < k.x1 && P.z[i] + P.r[i] > -half && P.z[i] - P.r[i] < half) top = Math.max(top, P.y[i] + P.r[i]);
      return { x0: k.x0, x1: k.x1, z0: -half, z1: half, top: (Number.isFinite(top) ? top : 0) + LEDGE.above * s, key: m, follow: LEDGE.follow };
    });
  }
  return {
    group, pushers: P, keys, state,
    // where the wrist is along z, in the world: the picture must reach at least this far forward
    wristZ: wrist.z * s,
    // the middle of the hand, at the keys' height, in the world: what the camera circles
    centre: new THREE.Vector3(keyX[2] * s, 0, (wrist.z + tips[2].z) / 2 * s),
    // about how high the top of the hand is above the keys, in the world (before it has landed and the ledges are known)
    top: (wrist.y + WRIST_BALL) * s,
    show() { state.shown = true; state.u = 0; state.landed = false; group.visible = true; },
    hide() { state.shown = false; group.visible = false; P.n = 0; },
    ledges,
    // dt: seconds. Returns true in the one frame the hand finishes arriving.
    update(dt) {
      if (!state.shown) return false;
      const was = state.u; state.u = Math.min(1, state.u + dt / ARRIVE.seconds);
      group.position.y = ARRIVE.from * s * (1 - smooth(state.u));
      let sum = state.u; for (let a = 0; a < FINGERS; a++) { const d = dipAt(keys[a], a); tips[a].y = FR[a][3] * TIP_SEAT - d; sum += d; }
      P.moving = sum !== state.lastSum; state.lastSum = sum;
      if (P.moving || !P.n) { setPalm(M, none, none); archThumb(M, 0); poseHand(M, tips); skinOver(H, elbow); balls(); }
      if (was < 1 && state.u >= 1) { state.landed = true; return true; }
      return false;
    },
    // for the tests: how far each fingertip is from where it was asked to be (metres), and the balls
    miss: () => M.fingers.map(f => f.miss),
    // how high each fingertip's centre is above the keys' tops, in the world
    tipY: () => M.fingers.map(f => fromHand(M, f.E, v).y * s + group.position.y),
  };
}
