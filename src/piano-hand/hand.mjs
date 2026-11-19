// The hand: skeleton proportions, three-jointed fingers and thumb, and the skin over them.
// Everything is built inside one group (M.root) in the hand's own frame, so the whole hand can be
// placed and turned as a rigid body, and the fingers are then solved towards five fingertip targets.
// The skin is one piece (glove.mjs): each of its vertices follows the bones it sits on, every frame.
//
// Hand frame: origin at the wrist joint. x across (thumb side negative for a right hand, mirrored by
// `side` for a left hand), y towards the back of the hand, -z towards the fingertips.
// Finger order a: 0 thumb, 1 index, 2 middle, 3 ring, 4 little.
import * as THREE from 'three';
import { buildGlove, BONES, DIGIT_BONES_END, CUFF_BONE, boneOf, metacarpalOf, metacarpalBase, FOREARM, ELBOW_BALL } from './glove.mjs';
export { FOREARM, ELBOW_BALL };

// Segment lengths in metres. Fingers: proximal, middle, distal phalanx. Thumb: metacarpal, proximal,
// distal. The last value stops at the centre of the rounded fingertip, so the visible finger is longer
// by the tip radius. Bone lengths follow adult radiographic means (about 40/22/16 mm for the index,
// 45/26/17 middle, 41/26/17 ring, 33/18/16 little, 46/32/22 thumb) plus about 4 mm of fingertip pulp.
// A pianist's hand, a little larger than the adult mean so that it spans a ninth: every length is scaled by SIZE,
// finger thickness by GIRTH.
export const SIZE = 1.06, GIRTH = 1.03;
export const PH = [[0.0462, 0.0316, 0.0172], [0.0398, 0.0224, 0.0128], [0.0446, 0.0263, 0.0142], [0.0414, 0.0257, 0.0142], [0.0327, 0.0181, 0.0136]].map(r => r.map(v => v * SIZE));
// radius at the base, first joint, second joint and tip of each finger
// The thumb is the stoutest digit: at its end joint it is about 1.28 times as wide as the index finger at its own
// (19.7 against 15.4 mm in one measured sample of adult men); the little finger is the slimmest.
export const FR = [[0.0123, 0.0113, 0.0101, 0.0090], [0.0100, 0.0090, 0.0079, 0.0071], [0.0103, 0.0092, 0.0080, 0.0072], [0.0098, 0.0088, 0.0077, 0.0069], [0.0090, 0.0080, 0.0070, 0.0063]].map(r => r.map(v => v * GIRTH));
// base joint of each finger in the hand frame: [across, up, ahead]. Thumb: the saddle joint at the heel
// of the hand. Fingers: the knuckles, which form a shallow arch that falls away to the little finger.
// How far apart the knuckles sit sets the breadth of the hand. Measured men average 90 mm across the knuckles of the
// index to little finger on a 190 mm hand, women 79 on 174 (Spahr, Bradtmiller and Guan, NIOSH), so this hand,
// 198 mm long, wants about 94 (tools/hand-measure.mjs measures the skin the same way).
export const KN = [[-0.030, -0.006, 0.026], [-0.0275, 0.012, 0.092], [-0.005, 0.014, 0.095], [0.0165, 0.011, 0.089], [0.036, 0.004, 0.080]].map(r => r.map(v => v * SIZE));
export const MIDDLE_X = KN[2][0];                        // the hand's centre line runs through the middle finger
// least bend of the middle joint (a playing finger is never straight) and how much the end joint
// bends for each radian of the middle joint (the two are tied by a shared tendon)
// The thumb is not a fifth finger: its middle joint (the knuckle of the thumb) flexes only about 50 to 60 degrees and its
// end joint about 80, against roughly 100 and 70 to 80 for a finger's two outer joints. Its reach comes from the saddle
// joint at its base instead.
export const MIN_BEND = [0.10, 0.18, 0.20, 0.20, 0.14], MAX_BEND = [0.96, 1.9, 1.9, 1.9, 1.9];
// A finger's end joint does not bend in step with the middle joint from the start. In the pianists' captured hands
// (465,000 finger poses, audit section 14) it stays straight until the middle joint has bent about 35 degrees and then
// follows at 0.6 of what the middle joint bends beyond that. Bending it from the start gave a hooked fingertip, 70
// degrees below level at the key where pianists' is about 50. The thumb was not measured and is as before.
export const END_RATIO = [1.1, 0.6, 0.6, 0.6, 0.6], END_FROM = [0, 0.61, 0.61, 0.61, 0.61];
// But it is never quite straight. A dead straight end joint on a flat finger reads as a joint giving way backwards (the
// owner saw it on the little finger), which teachers correct: the fingertip is to stay firm, neither caved in nor
// curled. The capture is at its weakest on this joint (a 20 mm bone, about a centimetre of error), so teaching practice
// decides: END_LEAST is the slight curve the joint always keeps (radians).
export const END_LEAST = [0, 0.10, 0.10, 0.10, 0.10];
// how far finger a's end joint is bent when its middle joint is bent by b (radians)
export const endBend = (a, b) => END_LEAST[a] + END_RATIO[a] * Math.max(0, b - END_FROM[a]);
// how far a fingertip may swing sideways at the knuckle, as the tangent of the angle [towards thumb, towards little finger]
export const SPLAY = [null, [0.60, 0.30], [0.32, 0.32], [0.30, 0.38], [0.30, 0.66]];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, k) => a + (b - a) * k;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _sy = V(0, 1, 0), _sd = V(), _id = V(), _ip = V(), _t = V();

// stretch a unit-height tapered cylinder from a to b
export function setSeg(m, a, b) {
  _sd.subVectors(b, a); const len = Math.max(1e-4, _sd.length());
  m.position.copy(a).addScaledVector(_sd, 0.5); m.scale.set(1, len, 1);
  m.quaternion.setFromUnitVectors(_sy, _sd.multiplyScalar(1 / len));
}
// length and direction of a three-bone chain whose middle joint bends by b and end joint by e
export function chain(p1, p2, p3, b, e) {
  const x = p1 + p2 * Math.cos(b) + p3 * Math.cos(b + e), y = -(p2 * Math.sin(b) + p3 * Math.sin(b + e));
  return [Math.hypot(x, y), Math.atan2(y, x)];
}
// Solve one finger from its base K to the target T. It bends in the plane through K, T and the pole,
// with the joints bulging towards the pole. Writes the joints J1, J2, the end E, the direction D of the
// last bone and N, the direction its back (the nail side) faces. Returns how far E is from T. `a`: which finger (for
// how its end joint follows its middle joint).
export function solveFinger(K, T, P, pole, minB, maxB, a, J1, J2, E, D, N) {
  _id.subVectors(T, K); const d = Math.max(1e-6, _id.length()); _id.multiplyScalar(1 / d);
  let lo = minB, hi = maxB; const dc = clamp(d, chain(P[0], P[1], P[2], hi, endBend(a, hi))[0], chain(P[0], P[1], P[2], lo, endBend(a, lo))[0]);
  for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (chain(P[0], P[1], P[2], mid, endBend(a, mid))[0] > dc) lo = mid; else hi = mid; }
  const b = (lo + hi) / 2, a1 = -chain(P[0], P[1], P[2], b, endBend(a, b))[1], a2 = a1 - b, a3 = a2 - endBend(a, b);
  _ip.copy(pole).addScaledVector(_id, -pole.dot(_id)); if (_ip.lengthSq() < 1e-8) _ip.set(0, 1, 0); _ip.normalize();
  J1.copy(K).addScaledVector(_id, P[0] * Math.cos(a1)).addScaledVector(_ip, P[0] * Math.sin(a1));
  J2.copy(J1).addScaledVector(_id, P[1] * Math.cos(a2)).addScaledVector(_ip, P[1] * Math.sin(a2));
  D.copy(_id).multiplyScalar(Math.cos(a3)).addScaledVector(_ip, Math.sin(a3));
  N.copy(_id).multiplyScalar(-Math.sin(a3)).addScaledVector(_ip, Math.cos(a3));
  E.copy(J2).addScaledVector(D, P[2]);
  return { miss: Math.abs(d - dc), bend: b, base: a1 };
}
// ---- the skin
// The rest pose the skin is modelled in: fingers gently curved and a little spread, so that they stand clear of one
// another. REST_AIM is the direction from knuckle to fingertip [down, ahead], REST_SPLAY how far each leans sideways.
const REST_BEND = 0.55, REST_AIM = [-0.62, -0.78], REST_SPLAY = [0, -0.24, -0.06, 0.11, 0.32], THUMB_REST = [-0.043, -0.024, -0.077].map(v => v * SIZE);
const FRAME = 12, MAT = 12, INFLUENCES = 4;               // numbers per bone frame (origin, across, back, along) and per bone matrix
const newFinger = (a, side) => ({ a, K: V(side * KN[a][0], KN[a][1], -KN[a][2]), K0: V(side * KN[a][0], KN[a][1], -KN[a][2]), B: V().fromArray(metacarpalBase([KN[a][0], KN[a][1], -KN[a][2]], SIZE)).multiply(V(side, 1, 1)), mc: 0, fan: 0, lean: 0, J1: V(), J2: V(), E: V(), D: V(), N: V(), T: V(), miss: 0, bend: 0, base: 0 });
// Which way the thumb's knuckle stands off the line from its base to its tip: [towards the other hand, up, towards the
// player]. Measured on the pianists' thumbs at their keys (tools/pianist.mjs THUMB, audit section 22): 0.88, 0.15, 0.28.
// It was 0.80, 0.60, 0: bowed upwards, which lifted the thumb's knuckle beside the index finger's.
const THUMB_BOWS = [0.88, 0.15, 0.28];
const thumbPoleOf = side => V(-side * THUMB_BOWS[0], THUMB_BOWS[1], THUMB_BOWS[2]).normalize(), UP = V(0, 1, 0);
// The thumb bends in the plane through its base, its tip and its pole, its joints bulging towards the pole: outwards and
// a little up. The nail is on the outside of the bend, so the pole is also the way the nail faces. Arching the thumb
// (0 to 1) turns that plane towards upright, which lifts its two joints a little with its tip where it was: how one
// thumb rides over the other when two hands meet (handmotion.mjs separate()). A thumb turns about its own length only
// so far: over ten recorded hands the nail is never past 60 degrees out of the palm's plane and its 99th percentile is
// 15 to 52 degrees (tools/pianist.mjs, THUMB turned; audit section 22). Before this limit the plane went all the way
// upright and the thumb lay nail up beside the index finger like a sixth finger, which the owner saw.
const THUMB_TURN_MOST = 35 * Math.PI / 180;                // the furthest the thumb's bending plane rises out of the hand's level (rad)
const _flat = V();
export function archThumb(M, arch) {
  const rest = thumbPoleOf(M.side), from = Math.asin(rest.y), e = from + (Math.max(from, THUMB_TURN_MOST) - from) * clamp(arch, 0, 1);
  _flat.set(rest.x, 0, rest.z).normalize(); M.thumbPole.copy(_flat).multiplyScalar(Math.cos(e)).addScaledVector(UP, Math.sin(e));
}
function restFingers(side) {
  const pole = thumbPoleOf(side);
  return [0, 1, 2, 3, 4].map(a => {
    const f = newFinger(a, side);
    if (a === 0) f.T.set(side * THUMB_REST[0], THUMB_REST[1], THUMB_REST[2]).add(f.K);
    else f.T.set(side * REST_SPLAY[a], REST_AIM[0], REST_AIM[1]).normalize().multiplyScalar(chain(PH[a][0], PH[a][1], PH[a][2], REST_BEND, endBend(a, REST_BEND))[0]).add(f.K);
    solveFinger(f.K, f.T, PH[a], a === 0 ? pole : UP, MIN_BEND[a], MAX_BEND[a], a, f.J1, f.J2, f.E, f.D, f.N);
    return f;
  });
}
// where each finger bone is and how it is turned: origin, across, back, along, written at bone * FRAME
const _fx = V(), _fd = V(), _fu = V();
function boneFrames(fingers, F) {
  for (let a = 0; a < 5; a++) {
    const f = fingers[a]; _fx.crossVectors(f.D, f.N).normalize();        // the three bones bend in one plane, so they share the across axis
    for (let j = 0; j < 3; j++) {
      const A = j === 0 ? f.K : j === 1 ? f.J1 : f.J2, B = j === 0 ? f.J1 : j === 1 ? f.J2 : f.E, o = boneOf(a, j) * FRAME;
      _fd.subVectors(B, A).normalize(); _fu.crossVectors(_fx, _fd).normalize();
      F[o] = A.x; F[o + 1] = A.y; F[o + 2] = A.z; F[o + 3] = _fx.x; F[o + 4] = _fx.y; F[o + 5] = _fx.z; F[o + 6] = _fu.x; F[o + 7] = _fu.y; F[o + 8] = _fu.z; F[o + 9] = _fd.x; F[o + 10] = _fd.y; F[o + 11] = _fd.z;
    }
  }
}
let GLOVE = null;                                          // the right hand's skin in its rest pose, built once
function glove() {
  if (GLOVE) return GLOVE;
  const fingers = restFingers(1), F = new Float32Array(BONES * FRAME); boneFrames(fingers, F);
  const rest = fingers.map((f, a) => {
    const at = j => Array.from(F.subarray(boneOf(a, j) * FRAME, boneOf(a, j) * FRAME + FRAME));
    return { P: [f.K.toArray(), f.J1.toArray(), f.J2.toArray(), f.E.toArray()], X: at(0).slice(3, 6), U: [0, 1, 2].map(j => at(j).slice(6, 9)), D: [0, 1, 2].map(j => at(j).slice(9, 12)) };
  });
  return (GLOVE = buildGlove(rest, FR, SIZE));
}
// a copy of rest-pose points for this hand: the left hand is the mirror image, with its triangles turned to match
function mirrored(src, side) { const out = new Float32Array(src); if (side < 0) for (let i = 0; i < out.length; i += 3) out[i] = -out[i]; return out; }
function facing(src, side) { const out = src.slice(); if (side < 0) for (let i = 0; i < out.length; i += 3) { const k = out[i + 1]; out[i + 1] = out[i + 2]; out[i + 2] = k; } return out; }
export function buildHand(side, skin, nailMat) {
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BufferGeometry(), skin);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.visible = false; root.add(mesh);       // moved every frame
  const M = { side, root, inv: new THREE.Matrix4(), skin: mesh, dressed: false, skinWith: null, restPos: null, restNor: null, wi: null, ww: null, fingers: [], thumbPole: thumbPoleOf(side), up: UP.clone(), rest: new Float32Array(BONES * FRAME), now: new Float32Array(BONES * FRAME), mats: new Float32Array(BONES * MAT) };
  boneFrames(restFingers(side), M.rest);
  for (let a = 0; a < 5; a++) {
    const nail = new THREE.Mesh(new THREE.BufferGeometry(), nailMat); nail.frustumCulled = false; nail.matrixAutoUpdate = false; nail.visible = false; root.add(nail);
    M.fingers.push(Object.assign(newFinger(a, side), { nail }));
  }
  return M;
}
// Put the skin on. Building it takes a moment, so it waits until the hand is first shown (skinHand calls this).
function dress(M) {
  const G = glove(), side = M.side, geo = M.skin.geometry;
  M.restPos = mirrored(G.pos, side); M.restNor = mirrored(G.nor, side); M.wi = G.wi; M.ww = G.ww;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M.restPos), 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(M.restNor), 3));
  geo.setIndex(new THREE.BufferAttribute(facing(G.idx, side), 1)); M.skin.visible = true;
  M.fingers.forEach((f, a) => {
    const ng = f.nail.geometry; ng.setAttribute('position', new THREE.BufferAttribute(mirrored(G.nails[a].pos, side), 3)); ng.setIndex(new THREE.BufferAttribute(facing(G.nails[a].idx, side), 1)); ng.computeVertexNormals(); f.nail.visible = true;
  });
  M.dressed = true;
}
// ---- the palm is not one block: each finger's metacarpal hinges on the carpus. How far each can flex from its rest
// position (cupping the hand, the knuckle moving towards the palm) and extend (flattening it), in radians. Measured
// flexion and extension together: about 11 degrees at the index, 7 at the middle, 10 to 20 at the ring and 15 to 27 at
// the little finger; the split either side of rest is mine.
export const METACARPAL_RANGE = [null, [-0.02, 0.04], [-0.01, 0.02], [-0.07, 0.16], [-0.12, 0.28]];
// The metacarpals also fan sideways a little, the outer ones most. Measured on the same joints (El-Shennawy, Nakamura,
// Patterson and Viegas 2001, J Hand Surg, PMID 11721246: side to side 2, 4, 7 and 13 degrees in all for the index to the
// little finger's joint; up and down 11, 7, 20 and 27). Half of each to either side of rest is my split. The middle
// finger's is the hand's own line and is left still. Radians either way.
export const METACARPAL_SIDE = [null, 0.017, 0, 0.061, 0.113];
// Set how far each finger's metacarpal is flexed (mc[a], radians from rest) and how far it has fanned out (fan[a],
// radians, positive towards the little finger's side; left out: none). Index 0, the thumb, is ignored. Call before poseHand.
export function setPalm(M, mc, fan) {
  for (let a = 1; a < 5; a++) {
    const f = M.fingers[a], k = clamp(mc[a], METACARPAL_RANGE[a][0], METACARPAL_RANGE[a][1]), d = fan ? clamp(fan[a], -METACARPAL_SIDE[a], METACARPAL_SIDE[a]) : 0;
    const c = Math.cos(k), sn = Math.sin(k), cd = Math.cos(d), sd = M.side * Math.sin(d), x = f.K0.x - f.B.x, y = f.K0.y - f.B.y, z = f.K0.z - f.B.z, y1 = y * c + z * sn, z1 = -y * sn + z * c;
    f.mc = k; f.fan = d; f.K.set(f.B.x + x * cd - z1 * sd, f.B.y + y1, f.B.z + x * sd + z1 * cd);      // the knuckle swings about the across axis through the metacarpal's base, then about the upright one
  }
}
// Call after moving M.root: refreshes the matrices used to convert between the piano frame and the hand frame.
export function placeHand(M) { M.root.updateMatrix(); M.inv.copy(M.root.matrix).invert(); }
export const toHand = (M, v, out) => out.copy(v).applyMatrix4(M.inv);
export const fromHand = (M, v, out) => out.copy(v).applyMatrix4(M.root.matrix);

// ---- laying the skin over the solved bones
// Call after poseHand. `forearm` is the direction from the wrist to the elbow in the hand frame (a unit vector) and
// `stretch` how far away the elbow is as a multiple of FOREARM (1 unless the arm cannot reach): the forearm part of the
// skin follows, so wrist and forearm are one surface. Every bone gets the turn and shift that carry it from the rest
// pose to where it is now, and every vertex of the skin is moved by the bones it belongs to.
const _zAxis = V(0, 0, 1), _quat = new THREE.Quaternion(), _rot = new THREE.Matrix4();
export function skinHand(M, forearm, stretch = 1) {
  if (M.skinWith) return M.skinWith(M, forearm, stretch);      // a hand wearing another skin (righand.mjs)
  if (!M.dressed) dress(M);
  const m = M.mats, R0 = M.rest, R1 = M.now; boneFrames(M.fingers, R1);
  m.fill(0); for (let b = 0; b < BONES; b++) m[b * MAT] = m[b * MAT + 4] = m[b * MAT + 8] = 1;       // palm: stays put
  if (forearm) {
    const e = _rot.makeRotationFromQuaternion(_quat.setFromUnitVectors(_zAxis, forearm)).elements, o = CUFF_BONE * MAT;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[o + r * 3 + c] = e[c * 4 + r] * (c === 2 ? stretch : 1);      // the rest forearm lies along z
  }
  for (let b = boneOf(0, 0); b < DIGIT_BONES_END; b++) {
    const f = b * FRAME, o = b * MAT;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[o + r * 3 + c] = R1[f + 3 + r] * R0[f + 3 + c] + R1[f + 6 + r] * R0[f + 6 + c] + R1[f + 9 + r] * R0[f + 9 + c];
    for (let r = 0; r < 3; r++) m[o + 9 + r] = R1[f + r] - (m[o + r * 3] * R0[f] + m[o + r * 3 + 1] * R0[f + 1] + m[o + r * 3 + 2] * R0[f + 2]);
  }
  for (let a = 1; a < 5; a++) {                            // each metacarpal: the same two swings as its knuckle (setPalm), about its base
    const f = M.fingers[a], o = metacarpalOf(a) * MAT, c = Math.cos(f.mc), sn = Math.sin(f.mc), cd = Math.cos(f.fan), sd = M.side * Math.sin(f.fan), B = f.B;
    m[o] = cd; m[o + 1] = sd * sn; m[o + 2] = -sd * c; m[o + 3] = 0; m[o + 4] = c; m[o + 5] = sn; m[o + 6] = sd; m[o + 7] = -cd * sn; m[o + 8] = cd * c;
    for (let r = 0; r < 3; r++) m[o + 9 + r] = B.getComponent(r) - (m[o + r * 3] * B.x + m[o + r * 3 + 1] * B.y + m[o + r * 3 + 2] * B.z);
  }
  const P0 = M.restPos, N0 = M.restNor, wi = M.wi, ww = M.ww, pos = M.skin.geometry.attributes.position, nor = M.skin.geometry.attributes.normal, P = pos.array, N = nor.array;
  for (let v = 0, n = P0.length / 3; v < n; v++) {
    const i = v * 3, x = P0[i], y = P0[i + 1], z = P0[i + 2], nx = N0[i], ny = N0[i + 1], nz = N0[i + 2];
    let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
    for (let s = 0; s < INFLUENCES; s++) {
      const w = ww[v * INFLUENCES + s]; if (w === 0) continue; const o = wi[v * INFLUENCES + s] * MAT;
      px += w * (m[o] * x + m[o + 1] * y + m[o + 2] * z + m[o + 9]); py += w * (m[o + 3] * x + m[o + 4] * y + m[o + 5] * z + m[o + 10]); pz += w * (m[o + 6] * x + m[o + 7] * y + m[o + 8] * z + m[o + 11]);
      qx += w * (m[o] * nx + m[o + 1] * ny + m[o + 2] * nz); qy += w * (m[o + 3] * nx + m[o + 4] * ny + m[o + 5] * nz); qz += w * (m[o + 6] * nx + m[o + 7] * ny + m[o + 8] * nz);
    }
    P[i] = px; P[i + 1] = py; P[i + 2] = pz; N[i] = qx; N[i + 1] = qy; N[i + 2] = qz;
  }
  pos.needsUpdate = true; nor.needsUpdate = true;
  for (let a = 0; a < 5; a++) {                            // each nail rides its last bone
    const o = boneOf(a, 2) * MAT;
    M.fingers[a].nail.matrix.set(m[o], m[o + 1], m[o + 2], m[o + 9], m[o + 3], m[o + 4], m[o + 5], m[o + 10], m[o + 6], m[o + 7], m[o + 8], m[o + 11], 0, 0, 0, 1);
  }
}
// Pose the fingers. tips[a] is the target for the centre of fingertip a, in the frame M.root sits in.
export function poseHand(M, tips) {
  const s = M.side;
  for (let a = 0; a < 5; a++) {
    const f = M.fingers[a];
    toHand(M, tips[a], f.T);
    if (a > 0) {                                           // a finger only swings so far sideways at the knuckle
      const fwd = Math.max(0.012, Math.hypot(f.T.z - f.K.z, f.T.y - f.K.y)), u = (f.T.x - f.K.x) * s;
      f.lean = clamp(u / ((u < 0 ? SPLAY[a][0] : SPLAY[a][1]) * fwd), -1, 1);          // how far towards its sideways limit the finger is asked to swing (minus: towards the thumb)
      f.T.x = f.K.x + s * clamp(u, -SPLAY[a][0] * fwd, SPLAY[a][1] * fwd);
    }
    const r = solveFinger(f.K, f.T, PH[a], a === 0 ? M.thumbPole : M.up, MIN_BEND[a], MAX_BEND[a], a, f.J1, f.J2, f.E, f.D, f.N);
    f.miss = _t.copy(f.E).applyMatrix4(M.root.matrix).distanceTo(tips[a]); f.bend = r.bend; f.base = r.base;
  }
}
