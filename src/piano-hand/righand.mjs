// A rigged hand from a file, worn in place of the skin built in glove.mjs.
// The file (glTF, data/reference/hands/godot-xr, CC0, made with MakeHuman) holds a hand surface drawn by an artist, a
// skeleton, and for each point of the surface the bones it follows. Our own skeleton (hand.mjs) still does all the
// playing: every frame its solved joints say where each of the file's bones goes, and the surface follows them.
//
// The file's bones are not as long as ours (its index finger is 36, 30 and 28 mm from joint to joint at our hand size,
// ours 42, 24 and 21). Each bone is therefore stretched along its length to end where our joint is, so the fingertips
// land exactly where the solver put them. The forearm is not in the file: it is grown from the rim of the file's wrist
// (as for the recorded hands in main.js), rigid, and it turns about the wrist joint.
import * as THREE from 'three';
import { KN, FR, FOREARM } from './hand.mjs';

// the forearm: rings from the wrist rim to the elbow. Radii in metres; shares of the forearm's length by which a ring has
// become round, and level; how far the rings crowd towards the wrist
export const SLEEVE = { rings: 18, wristR: 0.0262, elbowR: 0.0345, roundBy: 0.45, levelBy: 0.25, crowd: 1.6 };
const HELD_OVER = 0.045;                                   // the file lets the skin at the wrist's end move with the palm and thumb bones; here it comes to rest on the wrist over this length (metres), so the forearm has a still rim to grow from
// the wrist's bend, in metres along the arm from the wrist joint (minus is towards the fingers). Nothing else bends.
export const WRIST = { from: -0.010, to: 0.030 };
const DIGITS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const CHAIN = a => (a === 0 ? ['Metacarpal', 'Proximal', 'Distal', 'Tip'] : ['Proximal', 'Intermediate', 'Distal', 'Tip']);
const SIDE_SUFFIX = /_[RL]$/;
const CAP_FACING = 0.9, CAP_WITHIN = 0.012;                // the lid on the file's wrist: triangles facing up the arm, this close (metres) to its end
const OWNED = 0.5;                                         // a point belongs to a bone that carries more than this share of it
const THUMB_BACK = [-0.8, 0.6, 0];                         // roughly where the back of a right thumb faces (as the thumb's pole in hand.mjs)
const FILE_INFLUENCES = 4, INFLUENCES = 6, MAT = 12;       // bones per point in the file, and here (two more: the wrist and the forearm)
const WRIST_SLOT = FILE_INFLUENCES, FOREARM_SLOT = FILE_INFLUENCES + 1;
// A bone that is stretched to our length stretches only between its two joints. The skin it carries behind its start
// and beyond its end (the knuckle, the crease of the next joint) keeps its shape: three parts, three matrices per bone.
const PARTS = 3, BEHIND = 0, BETWEEN = 1, BEYOND = 2;
// Flesh gives way where two parts of the hand press together. The hand is five rays (a palm bone and the finger on it;
// the thumb's three bones). Between two rays lies the surface half way between their bones; skin that belongs to one ray
// stops `air` short of it (metres) instead of passing into the other ray, so two fingers side by side flatten against
// each other as fingers do. Skin that already lies beyond that surface in the file's own pose (the palm, the webs) may
// stay as far beyond it as it was. A point takes part from `owned` of its weight on one ray, fully from `firm`.
const FLESH = { air: 0.0002, owned: 0.5, firm: 0.9 };
const TOUCHING = 1e-6;                                      // two lines closer than this (metres) have no side to press towards
const RAYS = 5, RAY_POINTS = 5, XYZ = 3;                    // a ray's line: the palm bone's start, knuckle, two joints, the end of the skin
const WELD = 1e5;                                          // points closer than 1/WELD metres are one place
const TYPES = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }, WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const smooth01 = u => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); }, lerp = (a, b, k) => a + (b - a) * k;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Read the file: the surface (points, normals, triangles), the bones each point follows, and where each bone lies at rest.
export function readRig(gltf) {
  const bytes = gltf.buffers.map(b => Uint8Array.from(atob(b.uri.slice(b.uri.indexOf(',') + 1)), c => c.charCodeAt(0)));
  const get = i => {
    const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView], T = TYPES[a.componentType], n = a.count * WIDTH[a.type], from = (v.byteOffset || 0) + (a.byteOffset || 0);
    if (v.byteStride && v.byteStride !== WIDTH[a.type] * T.BYTES_PER_ELEMENT) throw new Error('interleaved data is not read');
    return new T(bytes[v.buffer].buffer.slice(from, from + n * T.BYTES_PER_ELEMENT));
  };
  const node = gltf.nodes.find(n => n.mesh !== undefined && n.skin !== undefined), prim = gltf.meshes[node.mesh].primitives[0], skin = gltf.skins[node.skin];
  if (node.translation || node.rotation || node.scale || node.matrix) throw new Error('a moved mesh is not read');
  const inverse = get(skin.inverseBindMatrices), rest = skin.joints.map((_, k) => new THREE.Matrix4().fromArray(inverse, k * 16).invert().elements);
  return { pos: get(prim.attributes.POSITION), nor: get(prim.attributes.NORMAL), idx: get(prim.indices), ji: get(prim.attributes.JOINTS_0), jw: get(prim.attributes.WEIGHTS_0), names: skin.joints.map(j => gltf.nodes[j].name.replace(SIDE_SUFFIX, '')), rest };
}

// The right hand in our hand frame (hand.mjs: wrist joint at the origin, x across with the thumb side negative, y towards
// the back of the hand, -z towards the fingertips), sized so that its knuckles are as far from the wrist as ours, with
// the forearm added. Built once from the file's right hand; the left hand is its mirror image (see wearRig).
function fit(raw) {
  const J = name => { const k = raw.names.indexOf(name); if (k < 0) throw new Error('no bone ' + name); return k; };
  const at = k => [raw.rest[k][12], raw.rest[k][13], raw.rest[k][14]], axis = (k, c) => [raw.rest[k][c * 4], raw.rest[k][c * 4 + 1], raw.rest[k][c * 4 + 2]];
  // the file's frame: x towards the back of the hand, y towards the thumb, -z towards the fingertips, wrist joint up its z axis
  const turn = v => [-v[1], v[0], v[2]], wrist = at(J('Wrist')), fromWrist = p => turn([p[0] - wrist[0], p[1] - wrist[1], p[2] - wrist[2]]);
  const knuckles = [1, 2, 3, 4].map(a => fromWrist(at(J(DIGITS[a] + '_Proximal'))));
  const scale = knuckles.reduce((s, k, i) => s + Math.hypot(...KN[i + 1]) / Math.hypot(...k), 0) / knuckles.length;
  const shift = knuckles.reduce((s, k, i) => s + KN[i + 1][0] - k[0] * scale, 0) / knuckles.length;      // across, so the row of knuckles sits where ours does
  const point = p => { const v = fromWrist(p); return [v[0] * scale + shift, v[1] * scale, v[2] * scale]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], unit = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

  // ---- the surface. Points that share a place are one place (the file splits them along the seams of its texture).
  const count = raw.pos.length / 3, place = new Int32Array(count), places = new Map();
  for (let v = 0; v < count; v++) { const key = Math.round(raw.pos[v * 3] * WELD) + ',' + Math.round(raw.pos[v * 3 + 1] * WELD) + ',' + Math.round(raw.pos[v * 3 + 2] * WELD); if (!places.has(key)) places.set(key, places.size); place[v] = places.get(key); }
  const P = []; for (let v = 0; v < count; v++) P.push(point([raw.pos[v * 3], raw.pos[v * 3 + 1], raw.pos[v * 3 + 2]]));
  const N = []; for (let v = 0; v < count; v++) N.push(turn([raw.nor[v * 3], raw.nor[v * 3 + 1], raw.nor[v * 3 + 2]]));
  // the wrist ends in a flat lid. Take the lid off; its edge is the rim the forearm grows from.
  let top = -Infinity; for (const p of P) top = Math.max(top, p[2]);
  const faces = [], lid = [];
  for (let t = 0; t < raw.idx.length; t += 3) {
    const a = raw.idx[t], b = raw.idx[t + 1], c = raw.idx[t + 2], u = sub(P[b], P[a]), w = sub(P[c], P[a]), n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], area = Math.hypot(...n);
    const onLid = area > 0 && n[2] / area > CAP_FACING && Math.min(P[a][2], P[b][2], P[c][2]) > top - CAP_WITHIN * scale;
    (onLid ? lid : faces).push(a, b, c);
  }
  const used = new Map(); for (const v of faces) if (!used.has(place[v])) used.set(place[v], v);      // a point of the hand's side at each place
  const once = new Map(), edge = (a, b) => (a < b ? a + ',' + b : b + ',' + a), next = new Map();
  for (let t = 0; t < lid.length; t += 3) for (let e = 0; e < 3; e++) { const k = edge(place[lid[t + e]], place[lid[t + (e + 1) % 3]]); once.set(k, (once.get(k) || 0) + 1); }
  for (let t = 0; t < lid.length; t += 3) for (let e = 0; e < 3; e++) { const a = place[lid[t + e]], b = place[lid[t + (e + 1) % 3]]; if (once.get(edge(a, b)) === 1) next.set(a, b); }
  const first = next.keys().next().value, loop = [first]; for (let p = next.get(first); p !== first && loop.length <= next.size; p = next.get(p)) loop.push(p);
  if (loop.length !== next.size || loop.some(p => !used.has(p))) throw new Error('the wrist rim was not found');
  const rim = loop.map(p => used.get(p)), R = rim.length, centre = [0, 1, 2].map(c => rim.reduce((s, v) => s + P[v][c], 0) / R);
  // the forearm, straight up the arm from the rim: each ring keeps the rim's flat shape at first, then rounds out,
  // thickens, and comes onto the line from the wrist joint to the elbow
  const ring = (r, i) => (r === 0 ? rim[i % R] : count + (r - 1) * R + i % R);
  for (let r = 1; r <= SLEEVE.rings; r++) {
    const t = (r / SLEEVE.rings) ** SLEEVE.crowd, along = lerp(centre[2], FOREARM, t), round = smooth01(t / SLEEVE.roundBy), level = 1 - smooth01(t / SLEEVE.levelBy), radius = lerp(SLEEVE.wristR, SLEEVE.elbowR, smooth01(t));
    for (let i = 0; i < R; i++) {
      const o = sub(P[rim[i]], centre), out = Math.hypot(o[0], o[1]) || 1e-6, k = lerp(out, radius, round) / out;
      P.push([centre[0] * (1 - round) + o[0] * k, centre[1] * (1 - round) + o[1] * k, along + o[2] * level]); N.push([o[0] / out, o[1] / out, 0]);
    }
  }
  for (let r = 0; r < SLEEVE.rings; r++) for (let i = 0; i < R; i++) faces.push(ring(r, i), ring(r, i + 1), ring(r + 1, i + 1), ring(r, i), ring(r + 1, i + 1), ring(r + 1, i));      // wound as the lid was
  // normals for the rim (the file's lean towards the lid that is gone): from the triangles now round it,
  // and for the forearm: from its own triangles (each weighted by its size)
  const rimPlaces = new Set(loop), sum = new Map();
  const placeOf = v => (v < count ? place[v] : -1 - v), wanted = v => v >= count || rimPlaces.has(place[v]);
  for (let t = 0; t < faces.length; t += 3) {
    const a = faces[t], b = faces[t + 1], c = faces[t + 2], u = sub(P[b], P[a]), w = sub(P[c], P[a]), n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const v of [a, b, c]) if (wanted(v)) { const s = sum.get(placeOf(v)) || [0, 0, 0]; s[0] += n[0]; s[1] += n[1]; s[2] += n[2]; sum.set(placeOf(v), s); }
  }
  for (let v = 0; v < P.length; v++) if (wanted(v) && sum.has(placeOf(v))) N[v] = unit(sum.get(placeOf(v)));

  // ---- where each bone lies at rest: its start, the direction it runs (along), the direction its back faces, its length
  const weightOf = (v, k) => { let w = 0; for (let s = 0; s < FILE_INFLUENCES; s++) if (raw.ji[v * FILE_INFLUENCES + s] === k) w += raw.jw[v * FILE_INFLUENCES + s]; return w; };
  const bone = (name, child, backAxis, faces_, toSkinEnd) => {
    const k = J(name), o = point(at(k)), run = sub(point(at(J(child))), o), d = unit(run), raw_ = turn(axis(k, backAxis)), lean = dot(raw_, d);
    let back = unit([raw_[0] - d[0] * lean, raw_[1] - d[1] * lean, raw_[2] - d[2] * lean]); if (dot(back, faces_) < 0) back = back.map(x => -x);
    let len = Math.hypot(...run); if (toSkinEnd) { len = 0; for (let v = 0; v < count; v++) if (weightOf(v, k) > OWNED) len = Math.max(len, dot(sub(P[v], o), d)); }      // the last bone is measured to the end of the fingertip
    return { bone: k, o, d, back, len };
  };
  const UP = [0, 1, 0], AXIS_X = 0, AXIS_Z = 2;             // a finger's back is along its bones' x axis in the file, the thumb's along z
  const digits = DIGITS.map((name, a) => [0, 1, 2].map(j => bone(name + '_' + CHAIN(a)[j], name + '_' + CHAIN(a)[j + 1], a === 0 ? AXIS_Z : AXIS_X, a === 0 ? THUMB_BACK : UP, j === 2)));
  const palm = [null, ...[1, 2, 3, 4].map(a => bone(DIGITS[a] + '_Metacarpal', DIGITS[a] + '_Proximal', AXIS_X, UP, false))];
  const rests = new Map(); for (const b of [...digits.flat(), ...palm.slice(1)]) rests.set(b.bone, b);
  // ---- which bones each point follows, and which part of each. The forearm is one more bone: it takes over through
  // the wrist's bend.
  const partOf = (v, k) => { const b = rests.get(k); if (!b) return BEHIND; const t = dot(sub(P[v], b.o), b.d); return t < 0 ? BEHIND : t <= b.len ? BETWEEN : BEYOND; };
  const total = P.length, forearm = raw.names.length, wristBone = J('Wrist'), wi = new Uint8Array(total * INFLUENCES), ww = new Float32Array(total * INFLUENCES);
  for (let v = 0; v < total; v++) {
    const share = smooth01((P[v][2] - WRIST.from) / (WRIST.to - WRIST.from)), held = v < count ? smooth01((centre[2] - P[v][2]) / HELD_OVER) : 0, o = v * INFLUENCES;
    if (v < count) { let all = 0; for (let s = 0; s < FILE_INFLUENCES; s++) all += raw.jw[v * FILE_INFLUENCES + s]; for (let s = 0; s < FILE_INFLUENCES; s++) { const k = raw.ji[v * FILE_INFLUENCES + s]; wi[o + s] = k * PARTS + partOf(v, k); ww[o + s] = raw.jw[v * FILE_INFLUENCES + s] / all * held * (1 - share); } }
    wi[o + WRIST_SLOT] = wristBone * PARTS; ww[o + WRIST_SLOT] = (1 - held) * (1 - share);
    wi[o + FOREARM_SLOT] = forearm * PARTS; ww[o + FOREARM_SLOT] = share;
  }
  return { pos: Float32Array.from(P.flat()), nor: Float32Array.from(N.flat()), idx: Uint32Array.from(faces), wi, ww, bones: forearm + 1, forearm, digits, palm, scale, shift };
}

const RIGHT = new WeakMap();                                // one fitted right hand per file read
const frame = (b, side) => {                                // a bone's rest frame for this hand: start, across, back, along
  const o = V(side * b.o[0], b.o[1], b.o[2]), d = V(side * b.d[0], b.d[1], b.d[2]), back = V(side * b.back[0], b.back[1], b.back[2]), across = V().crossVectors(d, back).normalize();
  return { bone: b.bone, o, d, a: across, u: V().crossVectors(across, d).normalize(), len: b.len };
};
// Put the rigged hand on hand M (from buildHand) in place of its own skin and nails. `raw` is what readRig returned.
export function wearRig(M, raw) {
  if (!RIGHT.has(raw)) RIGHT.set(raw, fit(raw));
  const G = RIGHT.get(raw), side = M.side, pos = new Float32Array(G.pos), nor = new Float32Array(G.nor), idx = new Uint32Array(G.idx);
  if (side < 0) { for (let i = 0; i < pos.length; i += 3) { pos[i] = -pos[i]; nor[i] = -nor[i]; } for (let i = 0; i < idx.length; i += 3) { const k = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = k; } }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  M.skin.geometry.dispose(); M.skin.geometry = geo; M.skin.visible = true; M.fingers.forEach(f => { f.nail.visible = false; });      // the file's hand has its own nails
  M.rig = { restPos: pos, restNor: nor, wi: G.wi, ww: G.ww, mats: new Float32Array(G.bones * PARTS * MAT), bones: G.bones, forearm: G.forearm, digits: G.digits.map(d => d.map(b => frame(b, side))), palm: G.palm.map(b => b && frame(b, side)) };
  M.dressed = true; M.skinWith = skinRig;
  // ---- flesh: which ray each point of the skin belongs to, how firmly, and how near the other rays it lies at rest
  const R = M.rig, count = pos.length / XYZ, boneRay = new Int8Array(G.bones).fill(-1);
  R.digits.forEach((d, a) => d.forEach(b => { boneRay[b.bone] = a; })); R.palm.forEach((b, a) => { if (b) boneRay[b.bone] = a; });
  R.line = new Float32Array(RAYS * RAY_POINTS * XYZ); R.ray = new Int8Array(count).fill(-1); R.firm = new Float32Array(count); R.keep = new Float32Array(count * RAYS);
  const share = new Float32Array(RAYS);
  for (let v = 0; v < count; v++) {
    share.fill(0); for (let k = 0; k < INFLUENCES; k++) { const a = boneRay[Math.floor(G.wi[v * INFLUENCES + k] / PARTS)]; if (a >= 0) share[a] += G.ww[v * INFLUENCES + k]; }
    let a = 0; for (let b = 1; b < RAYS; b++) if (share[b] > share[a]) a = b;
    if (share[a] > FLESH.owned) { R.ray[v] = a; R.firm[v] = smooth01((share[a] - FLESH.owned) / (FLESH.firm - FLESH.owned)); }
  }
  for (let a = 0; a < RAYS; a++) {
    const d = R.digits[a], start = a === 0 ? d[0].o : R.palm[a].o, at = [start, d[0].o, d[1].o, d[2].o, _d.copy(d[2].o).addScaledVector(d[2].d, d[2].len)];
    at.forEach((p, i) => p.toArray(R.line, (a * RAY_POINTS + i) * XYZ));
  }
  for (let v = 0; v < count; v++) { const a = R.ray[v]; if (a < 0) continue; own(R.line, a, pos[v * XYZ], pos[v * XYZ + 1], pos[v * XYZ + 2]); for (let b = 0; b < RAYS; b++) if (b !== a) R.keep[v * RAYS + b] = Math.min(FLESH.air, beyond(R.line, b, pos[v * XYZ], pos[v * XYZ + 1], pos[v * XYZ + 2])); }
}

// The point of ray a's line nearest to (x, y, z), into _near.
const _near = new Float64Array(XYZ), _mine = new Float64Array(XYZ), _way = new Float64Array(XYZ);
function nearest(L, a, x, y, z) {
  let best = Infinity;
  for (let i = 0, o = a * RAY_POINTS * XYZ; i < RAY_POINTS - 1; i++, o += XYZ) {
    const ax = L[o], ay = L[o + 1], az = L[o + 2], ex = L[o + 3] - ax, ey = L[o + 4] - ay, ez = L[o + 5] - az, long = ex * ex + ey * ey + ez * ez;
    const t = long > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / long)) : 0, qx = ax + t * ex, qy = ay + t * ey, qz = az + t * ez, far = (x - qx) * (x - qx) + (y - qy) * (y - qy) + (z - qz) * (z - qz);
    if (far < best) { best = far; _near[0] = qx; _near[1] = qy; _near[2] = qz; }
  }
}
// How far (x, y, z), a point of ray a whose own line is nearest at _mine, lies on its own side of the surface half way
// between the lines of rays a and b (metres; negative: beyond it, in ray b). Leaves the direction from b's line to a's
// in _way.
function beyond(L, b, x, y, z) {
  nearest(L, b, x, y, z);
  const wx = _mine[0] - _near[0], wy = _mine[1] - _near[1], wz = _mine[2] - _near[2], apart = Math.hypot(wx, wy, wz);
  if (apart < TOUCHING) { _way[0] = _way[1] = _way[2] = 0; return Infinity; }
  _way[0] = wx / apart; _way[1] = wy / apart; _way[2] = wz / apart;
  return (x - (_mine[0] + _near[0]) / 2) * _way[0] + (y - (_mine[1] + _near[1]) / 2) * _way[1] + (z - (_mine[2] + _near[2]) / 2) * _way[2];
}
const own = (L, a, x, y, z) => { nearest(L, a, x, y, z); _mine[0] = _near[0]; _mine[1] = _near[1]; _mine[2] = _near[2]; };
// Where the rays' lines are now (from the solved joints), then every point of the skin that has gone further into
// another ray than it lay at rest is moved back out, straight away from that ray.
function press(M, P) {
  const R = M.rig, L = R.line;
  for (let a = 0; a < RAYS; a++) {
    const f = M.fingers[a], o = a * RAY_POINTS * XYZ, start = a === 0 ? R.digits[0][0].o : R.palm[a].o, knuckle = a === 0 ? start : f.K;
    start.toArray(L, o); knuckle.toArray(L, o + XYZ); f.J1.toArray(L, o + 2 * XYZ); f.J2.toArray(L, o + 3 * XYZ);
    _d.subVectors(f.E, f.J2).normalize().multiplyScalar(FR[a][3]).add(f.E).toArray(L, o + 4 * XYZ);
  }
  for (let v = 0, n = R.ray.length; v < n; v++) {
    const a = R.ray[v]; if (a < 0) continue; const i = v * XYZ, x = P[i], y = P[i + 1], z = P[i + 2]; let mx = 0, my = 0, mz = 0; own(L, a, x, y, z);
    for (let b = 0; b < RAYS; b++) {
      if (b === a) continue; const short = R.keep[v * RAYS + b] - beyond(L, b, x, y, z);
      if (short > 0) { mx += short * _way[0]; my += short * _way[1]; mz += short * _way[2]; }
    }
    if (mx || my || mz) { const k = R.firm[v]; P[i] = x + k * mx; P[i + 1] = y + k * my; P[i + 2] = z + k * mz; }
  }
}

const _zAxis = V(0, 0, 1), _quat = new THREE.Quaternion(), _rot = new THREE.Matrix4(), _a = V(), _u = V(), _d = V(), _pa = V(), _pu = V();
// The matrices (three rows of the turn, then the shift) carrying rest frame R to start `o` with axes a (across), u (back),
// d (along), stretched s times between its joints: one for the skin behind the bone's start, one for between its joints,
// one for beyond its end. The three agree where they meet.
function carry(m, R, o, a, u, d, s) {
  const k = R.bone * PARTS * MAT, behind = k + BEHIND * MAT, between = k + BETWEEN * MAT, beyond = k + BEYOND * MAT, grown = (s - 1) * R.len;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) { const along = d.getComponent(r) * R.d.getComponent(c), turn = a.getComponent(r) * R.a.getComponent(c) + u.getComponent(r) * R.u.getComponent(c) + along; m[behind + r * 3 + c] = m[beyond + r * 3 + c] = turn; m[between + r * 3 + c] = turn + (s - 1) * along; }
  }
  for (let r = 0; r < 3; r++) {
    m[behind + 9 + r] = o.getComponent(r) - (m[behind + r * 3] * R.o.x + m[behind + r * 3 + 1] * R.o.y + m[behind + r * 3 + 2] * R.o.z);
    m[between + 9 + r] = o.getComponent(r) - (m[between + r * 3] * R.o.x + m[between + r * 3 + 1] * R.o.y + m[between + r * 3 + 2] * R.o.z);
    m[beyond + 9 + r] = m[behind + 9 + r] + grown * d.getComponent(r);
  }
}
// Lay the rigged hand over the solved bones (the same call as skinHand in hand.mjs, which hands over to this).
let flesh = true;                                           // tools/skin-test.mjs turns it off to show what it is for
export const setFlesh = on => { flesh = on; };
export function skinRig(M, forearm, stretch = 1) {
  const R = M.rig, m = R.mats;
  m.fill(0); for (let b = 0; b < R.bones * PARTS; b++) m[b * MAT] = m[b * MAT + 4] = m[b * MAT + 8] = 1;      // wrist and palm: stay put
  if (forearm) {
    const e = _rot.makeRotationFromQuaternion(_quat.setFromUnitVectors(_zAxis, forearm)).elements, o = R.forearm * PARTS * MAT;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[o + r * 3 + c] = e[c * 4 + r] * (c === 2 ? stretch : 1);      // the rest forearm lies along z, and turns about the wrist joint
  }
  for (let a = 0; a < 5; a++) {
    const f = M.fingers[a]; _a.crossVectors(f.D, f.N).normalize();        // the three bones bend in one plane, so they share the across axis
    for (let j = 0; j < 3; j++) {
      // The thumb's first bone keeps the file's own base (ours is 8 mm further out, and moving it there pushed the ball
      // of the thumb out of the wrist); it still ends at our joint, so everything beyond is where the solver put it.
      const rest = R.digits[a][j], A = j === 0 ? (a === 0 ? rest.o : f.K) : j === 1 ? f.J1 : f.J2, B = j === 0 ? f.J1 : j === 1 ? f.J2 : f.E;
      const len = _d.subVectors(B, A).length(); _d.multiplyScalar(1 / len); _u.crossVectors(_a, _d).normalize(); _pa.crossVectors(_d, _u);
      carry(m, rest, A, _pa, _u, _d, (len + (j === 2 ? FR[a][3] : 0)) / rest.len);      // our last bone stops at the middle of the fingertip; the skin goes on to its end
    }
    if (a === 0) continue;
    const rest = R.palm[a], len = _d.subVectors(f.K, rest.o).length(); _d.multiplyScalar(1 / len);      // the palm bone runs from its own base to our knuckle
    _quat.setFromUnitVectors(rest.d, _d); _pa.copy(rest.a).applyQuaternion(_quat); _pu.copy(rest.u).applyQuaternion(_quat);
    carry(m, rest, rest.o, _pa, _pu, _d, len / rest.len);
  }
  const P0 = R.restPos, N0 = R.restNor, wi = R.wi, ww = R.ww, pos = M.skin.geometry.attributes.position, nor = M.skin.geometry.attributes.normal, P = pos.array, N = nor.array;
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
  if (flesh) press(M, P);
  pos.needsUpdate = true; nor.needsUpdate = true;
}
