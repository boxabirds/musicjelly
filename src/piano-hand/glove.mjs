// The skin of the hand as one piece, like a thin glove: palm, heel, the web to the thumb, every finger and a cuff
// that runs up the forearm to the elbow are a single closed surface with no seams between parts.
//
// How: the hand in a relaxed, slightly spread rest pose is described as a solid (rounded cones, balls and pads
// blended into one another, a signed distance field). That solid is turned into a triangle mesh once, at start-up.
// Every vertex then notes which bones it belongs to and by how much, so that hand.mjs can move it with the bones
// each frame (the web stretches, the knuckles and wrist bend, nothing comes apart).
//
// All coordinates here are for a right hand in the hand frame (see hand.mjs). The left hand is its mirror image.

const CELL = 0.0014, BLOCK = 4, BOX_MARGIN = 0.016;       // mesh resolution (metres), coarse search block (cells)
const LIPSCHITZ_SAFETY = 1.1, GRAD_STEP = 0.0004, PROJECT_STEPS = 2;
const WEIGHT_FALLOFF = 0.0030;                             // a bone's hold on the skin fades over this distance from it
const FINGER_APART = 0.0030;                               // skin between two fingers stays with the palm until they are this far apart
const INFLUENCES = 4, WEIGHT_FLOOR = 0.02;
// the flesh between thumb and index finger: skin within WEB_SKIN of its body is shared between the thumb's first bone and
// the hand, the share running from one to the other over WEB_SHARED_OVER either side of half way (metres)
// WEB_WITH_HAND: the muscle's belly lies along the index finger's bone, so the even point sits this much nearer the thumb
const WEB_SKIN = 0.003, WEB_SKIN_SOFT = 0.003, WEB_SHARED_OVER = 0.013, WEB_WITH_HAND = 0.005;
const smooth01 = u => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };
const FAR = 0.02;                                          // see handSolid: beyond this a digit has no say (well past every blend and weight falloff)
// how softly the parts run into one another (metres)
const BLEND = { palm: 0.009, thumbBase: 0.007, thumbToPalm: 0.011, web: 0.008, cuff: 0.008, joint: 0.0010, thumbFree: 0.0045, fingerToPalm: 0.0055 };
// cross-section of each bone as multiples of its radius: [across, back of the finger, pad side]
const SECTION = { finger: [[1.04, 0.93, 1.05], [1.00, 0.91, 1.02], [1.00, 0.86, 1.04]], thumb: [[1.08, 0.94, 1.06], [1.05, 0.90, 1.00], [1.10, 0.80, 0.98]] };      // the thumb's last bone is broad and flat
// The ball at each joint (knuckle, middle joint, end joint): its size as a multiple of the bone radius there, and how far
// it stands out on the back. Kept barely proud of the shaft (about a quarter of a millimetre on the finger joints): any
// more and the joints read as swollen.
const KNUCKLE = [1.04, 0.915, 0.875], KNUCKLE_RISE = [0.13, 0.025, 0.015];
// The palm. Its thickness is flesh on the palm side: the back of the hand is bone under thin skin. PALM.section is the
// cross-section of each metacarpal ray [across, back, palm side]; the pad under the knuckles and the heel below the
// little finger are [millimetres below the knuckle or wrist line, radius, radius at the far end].
// Measured against the surface of a pianist's hand (FürElise, the capture's hand model; tools/furelise/bulk.py, see the
// audit report section 12), with both hands scaled to 100 mm from wrist to middle knuckle: the palm is about 33 mm thick at its
// middle (ours was 28) and 37 along the index finger's ray (ours 29).
const PALM = { ray: 13.8, section: [1, 1.02, 1.50], pad: { drop: [13.5, 12.5], r: [8.6, 8.0] }, heel: { drop: [6.5, 10.5], r: [14.2, 11.4] } };
// The flesh between the thumb and the index finger. On a real hand the thumb's first bone is not a separate stalk: the
// muscle that pulls the index finger towards the thumb (the first dorsal interosseous) fills the angle between the two
// bones on the back of the hand, and the muscles of the thumb's ball fill it on the palm side. Above the middle of the
// thumb's first bone the pianist's hand has about 32 mm of flesh to the back of the hand; ours had 12.
// muscle: a body from between the bases of the two bones to part way along them. web: the fold of skin at its free edge,
// from the thumb's knuckle to just short of the index knuckle. ball: the thumb's ball, on the palm side of its first bone.
const THUMB_WEB = { muscle: { from: 0.30, to: 0.70, towardsIndex: [0.48, 0.52], lift: [2.5, 4], r: [14.5, 10] }, web: { thumbAt: 0.96, index: [0, -6, 9], inner: 0.38, r: 5.2 }, ball: { r: [17.6, 13.8] } };
const PAD = { at: 0.50, size: 0.90, drop: 0.20 };                       // the pulp of the fingertip
export const NAIL = { from: 0.40, rows: 9, capRows: 5, capTo: 0.28, across: 10, halfAngle: 0.88, cuticle: 0.30, lift: 0.00025, round: 0.92 };
// The forearm is part of the same surface: from the flat wrist it rounds out and runs to the elbow, where it ends
// inside the ball of the elbow (main.js). FOREARM is its length, wrist to elbow, in the rest pose.
export const FOREARM = 0.275, ELBOW_BALL = 0.036;
// metres from the wrist, and radii: flat-sided at the wrist, round from `round` on, ending a little smaller than the elbow's ball
const ARM = { from: 0.016, wrist: 0.0250, round: 0.052, there: 0.0258, elbow: 0.0352, flat: 0.80 };
const ARM_ALONE_FROM = 0.062;                              // further than this from the wrist nothing but the forearm shapes the surface

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => mul(a, 1 / Math.hypot(a[0], a[1], a[2])), mixv = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// ---- the solid shapes. Each returns the distance from (x, y, z) to its surface, negative inside.
// A rounded cone from o along D with radius r1 at the start and r2 at the end; X and U are its across and back axes,
// and s = [across, back, pad] flattens its cross-section.
function cone(o, X, U, D, h, r1, r2, s = [1, 1, 1]) {
  const b = (r1 - r2) / h, a = Math.sqrt(Math.max(1e-9, 1 - b * b)), least = Math.min(s[0], s[1], s[2]);
  return (x, y, z) => {
    const px = x - o[0], py = y - o[1], pz = z - o[2];
    const lx = (px * X[0] + py * X[1] + pz * X[2]) / s[0], up = px * U[0] + py * U[1] + pz * U[2], ly = up / (up > 0 ? s[1] : s[2]), lz = px * D[0] + py * D[1] + pz * D[2];
    const q = Math.hypot(lx, ly), k = -b * q + a * lz;
    return (k < 0 ? Math.hypot(q, lz) - r1 : k > a * h ? Math.hypot(q, lz - h) - r2 : q * a + lz * b - r1) * least;
  };
}
// the same between two points, round in section, optionally flattened along the hand's back-to-palm axis
function stick(p, q, r1, r2, s) {
  const D = unit(sub(q, p)), X = unit(cross([0, 1, 0], D)), U = cross(D, X);
  return cone(p, X, U, D, Math.hypot(...sub(q, p)), r1, r2, s);
}
const ball = (c, r) => (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
function ellipsoid(c, r) {
  return (x, y, z) => {
    const px = x - c[0], py = y - c[1], pz = z - c[2], k0 = Math.hypot(px / r[0], py / r[1], pz / r[2]), k1 = Math.hypot(px / (r[0] * r[0]), py / (r[1] * r[1]), pz / (r[2] * r[2]));
    return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(r[0], r[1], r[2]);
  };
}
// a flat triangle with thickness r
function slab(a, b, c, r) {
  const ba = sub(b, a), cb = sub(c, b), ac = sub(a, c), n = cross(ba, ac), nn = dot(n, n), e1 = cross(ba, n), e2 = cross(cb, n), e3 = cross(ac, n);
  const edge = (p, e, ee) => { const k = Math.min(1, Math.max(0, dot(e, p) / ee)); return (e[0] * k - p[0]) ** 2 + (e[1] * k - p[1]) ** 2 + (e[2] * k - p[2]) ** 2; };
  const baba = dot(ba, ba), cbcb = dot(cb, cb), acac = dot(ac, ac);
  return (x, y, z) => {
    const pa = [x - a[0], y - a[1], z - a[2]], pb = [x - b[0], y - b[1], z - b[2]], pc = [x - c[0], y - c[1], z - c[2]];
    const outside = Math.sign(dot(e1, pa)) + Math.sign(dot(e2, pb)) + Math.sign(dot(e3, pc)) < 2;
    return Math.sqrt(outside ? Math.min(edge(pa, ba, baba), edge(pb, cb, cbcb), edge(pc, ac, acac)) : dot(n, pa) ** 2 / nn) - r;
  };
}
// which way is out: the unit gradient of a solid, from four samples at the corners of a tetrahedron
function slope(solid, x, y, z, out) {
  const h = GRAD_STEP, a = solid(x + h, y - h, z - h), b = solid(x - h, y - h, z + h), c = solid(x - h, y + h, z - h), d = solid(x + h, y + h, z + h);
  const gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d, l = Math.hypot(gx, gy, gz) || 1; out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
}
const blend = (shapes, k) => (x, y, z) => { let d = shapes[0](x, y, z); for (let i = 1; i < shapes.length; i++) d = smin(d, shapes[i](x, y, z), k); return d; };

// ---- the hand as a solid
// rest: for each of the five digits { P: [base, joint 1, joint 2, tip centre], X, U: [back of bone 0, 1, 2], D: [direction of bone 0, 1, 2] }
// Returns { bones: one shape per bone (palm, forearm, then three per digit), solid(x, y, z) }
// Bones: the carpus (the block of small bones at the heel of the hand), the forearm, three bones per digit, and the four
// metacarpals of the fingers, which hinge a little on the carpus (the ring and little finger's much more than the others).
export const PALM_BONE = 0, CUFF_BONE = 1, DIGIT_BONES_END = 17, BONES = 21, boneOf = (a, j) => 2 + 3 * a + j, metacarpalOf = a => DIGIT_BONES_END + a - 1;
// where a finger's metacarpal hinges on the carpus, given its knuckle K (right hand, hand frame)
const HAND_SIDE = [PALM_BONE, metacarpalOf(1), metacarpalOf(2), metacarpalOf(3), metacarpalOf(4)];      // the bones of the hand that the thumb's flesh joins
export const metacarpalBase = (K, SIZE) => [0.42 * K[0] + 0.002 * SIZE, 0.001 * SIZE + 0.22 * K[1], -0.014 * SIZE];
function handSolid(rest, FR, SIZE) {
  const mm = v => v * 0.001 * SIZE, at = (x, y, z) => [mm(x), mm(y), mm(z)];
  const K = rest.map(d => d.P[0]), bones = new Array(BONES);
  // palm: four metacarpals from the wrist to the knuckles, their heads, the pads under the knuckles, the heel
  const palm = [], carpus = [];
  for (let a = 1; a < 5; a++) {
    const ray = [stick(metacarpalBase(K[a], SIZE), add(K[a], at(0, -1, 4)), mm(PALM.ray), FR[a][0] * 1.07, PALM.section), ball(add(K[a], [0, FR[a][0] * KNUCKLE_RISE[0], 0]), FR[a][0] * KNUCKLE[0])];
    if (a === 4) ray.push(stick(at(21, -PALM.heel.drop[0], -6), add(K[4], at(-5, -PALM.heel.drop[1], 30)), mm(PALM.heel.r[0]), mm(PALM.heel.r[1])));     // heel on the little finger side: it moves with that metacarpal
    palm.push(...ray); bones[metacarpalOf(a)] = blend(ray, BLEND.palm);
  }
  carpus.push(stick(add(K[1], at(1, -PALM.pad.drop[0], 13)), add(K[4], at(-1, -PALM.pad.drop[1], 12)), mm(PALM.pad.r[0]), mm(PALM.pad.r[1])));      // pads under the knuckles
  carpus.push(ellipsoid(at(0, -1, 4), at(27.8, 19.6, 30)));                                            // the wrist
  palm.push(...carpus); bones[PALM_BONE] = blend(carpus, BLEND.palm);
  const wholePalm = blend(palm, BLEND.palm);               // the shape of the palm is the same whichever bone each part follows
  // cuff: from the flat wrist to the round forearm
  const armFlat = z => ARM.flat + (1 - ARM.flat) * Math.min(1, Math.max(0, z / ARM.round));
  const armCone = blend([stick([0, 0, ARM.from], [0, 0, ARM.round], ARM.wrist, ARM.there), stick([0, 0, ARM.round], [0, 0, FOREARM], ARM.there, ARM.elbow)], BLEND.joint);
  bones[CUFF_BONE] = (x, y, z) => armCone(x, y / armFlat(z), z) * ARM.flat;
  // digits
  for (let a = 0; a < 5; a++) {
    const d = rest[a], sec = a === 0 ? SECTION.thumb : SECTION.finger;
    for (let j = 0; j < 3; j++) {
      const len = Math.hypot(...sub(d.P[j + 1], d.P[j])), parts = [cone(d.P[j], d.X, d.U[j], d.D[j], len, FR[a][j], FR[a][j + 1], sec[j])];
      if (j > 0) parts.push(ball(add(d.P[j], mul(d.U[j], FR[a][j] * KNUCKLE_RISE[j])), FR[a][j] * KNUCKLE[j]));
      if (j === 2) parts.push(ball(add(mixv(d.P[2], d.P[3], PAD.at), mul(d.U[2], -FR[a][3] * PAD.drop)), FR[a][3] * PAD.size));
      if (a === 0 && j === 0) {                           // the ball of the thumb lies along its first bone, towards the palm
        const along = sub(d.P[1], d.P[0]);
        parts.push(stick(add(d.P[0], at(7, -5, 2)), add(add(d.P[0], mul(along, 0.70)), at(7, -4, 0)), mm(THUMB_WEB.ball.r[0]), mm(THUMB_WEB.ball.r[1])));
      }
      bones[boneOf(a, j)] = blend(parts, a === 0 && j === 0 ? BLEND.thumbBase : BLEND.joint);
    }
  }
  // the web of skin from the thumb to the index finger
  const TW = THUMB_WEB, thumbBone = t => mixv(rest[0].P[0], rest[0].P[1], t), indexBone = t => mixv(metacarpalBase(K[1], SIZE), K[1], t);
  const fold = slab(thumbBone(TW.web.thumbAt), add(K[1], at(...TW.web.index)), add(mixv(rest[0].P[0], K[1], TW.web.inner), at(0, -2, 0)), mm(TW.web.r));
  const muscle = stick(add(mixv(thumbBone(TW.muscle.from), indexBone(TW.muscle.from), TW.muscle.towardsIndex[0]), at(0, TW.muscle.lift[0], 0)), add(mixv(thumbBone(TW.muscle.to), indexBone(TW.muscle.to), TW.muscle.towardsIndex[1]), at(0, TW.muscle.lift[1], 0)), mm(TW.muscle.r[0]), mm(TW.muscle.r[1]));
  const web = (x, y, z) => smin(fold(x, y, z), muscle(x, y, z), BLEND.web);
  // A ball round each digit: a point further outside it than FAR is too far for that digit to shape the surface or hold
  // the skin there, so its bones need not be worked out (this is most of the cost of building the mesh).
  const around = rest.map((d, a) => { const from = a === 0 ? 1 : 0, c = mul(add(d.P[from], d.P[3]), 0.5); return { c, r: Math.max(...d.P.slice(from).map(p => Math.hypot(...sub(p, c)))) + FR[a][0] * 1.3 }; });
  const outside = (a, x, y, z) => Math.hypot(x - around[a].c[0], y - around[a].c[1], z - around[a].c[2]) - around[a].r;
  const digit = (a, x, y, z) => { const far = outside(a, x, y, z); return far > FAR ? far : smin(smin(bones[boneOf(a, 0)](x, y, z), bones[boneOf(a, 1)](x, y, z), BLEND.joint), bones[boneOf(a, 2)](x, y, z), BLEND.joint); };
  const thumbFree = (x, y, z) => { const far = outside(0, x, y, z); return far > FAR ? far : smin(bones[boneOf(0, 1)](x, y, z), bones[boneOf(0, 2)](x, y, z), BLEND.joint); };
  const solid = (x, y, z) => {
    if (z > ARM_ALONE_FROM) return bones[CUFF_BONE](x, y, z);
    let base = smin(wholePalm(x, y, z), bones[boneOf(0, 0)](x, y, z), BLEND.thumbToPalm);
    base = smin(base, web(x, y, z), BLEND.web); base = smin(base, bones[CUFF_BONE](x, y, z), BLEND.cuff);
    base = smin(base, thumbFree(x, y, z), BLEND.thumbFree);
    let all = base; for (let a = 1; a < 5; a++) all = Math.min(all, smin(base, digit(a, x, y, z), BLEND.fingerToPalm));
    return all;
  };
  return { bones, solid, digit, thumbFree, outside, web, armAloneFrom: ARM_ALONE_FROM };
}

// ---- solid to mesh: one vertex in every grid cell the surface passes through, joined across the cell faces
// (surface nets), then each vertex pulled exactly onto the surface.
function mesh(solid, lo, hi) {
  const n = [0, 1, 2].map(k => Math.ceil((hi[k] - lo[k]) / CELL / BLOCK) * BLOCK), NX = n[0] + 1, NY = n[1] + 1, NZ = n[2] + 1;
  const val = new Float32Array(NX * NY * NZ).fill(NaN), node = (i, j, k) => (k * NY + j) * NX + i;
  const at = (i, j, k) => { const q = node(i, j, k); let v = val[q]; if (v !== v) v = val[q] = solid(lo[0] + i * CELL, lo[1] + j * CELL, lo[2] + k * CELL); return v; };
  const cellIndex = new Int32Array(n[0] * n[1] * n[2]).fill(-1), cell = (i, j, k) => (k * n[1] + j) * n[0] + i;
  const pos = [], cells = [], reach = Math.sqrt(3) * BLOCK * CELL / 2 * LIPSCHITZ_SAFETY, half = BLOCK * CELL / 2;
  const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], EDGE = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]], v8 = new Float64Array(8);
  for (let bk = 0; bk < n[2]; bk += BLOCK) for (let bj = 0; bj < n[1]; bj += BLOCK) for (let bi = 0; bi < n[0]; bi += BLOCK) {
    if (Math.abs(solid(lo[0] + bi * CELL + half, lo[1] + bj * CELL + half, lo[2] + bk * CELL + half)) > reach) continue;      // the surface cannot pass through this block
    for (let k = bk; k < bk + BLOCK; k++) for (let j = bj; j < bj + BLOCK; j++) for (let i = bi; i < bi + BLOCK; i++) {
      let inside = 0; for (let c = 0; c < 8; c++) { v8[c] = at(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2]); if (v8[c] < 0) inside++; }
      if (inside === 0 || inside === 8) continue;
      let sx = 0, sy = 0, sz = 0, m = 0;
      for (const [p, q] of EDGE) if ((v8[p] < 0) !== (v8[q] < 0)) { const t = v8[p] / (v8[p] - v8[q]); sx += CORNER[p][0] + (CORNER[q][0] - CORNER[p][0]) * t; sy += CORNER[p][1] + (CORNER[q][1] - CORNER[p][1]) * t; sz += CORNER[p][2] + (CORNER[q][2] - CORNER[p][2]) * t; m++; }
      cellIndex[cell(i, j, k)] = pos.length / 3; cells.push(i, j, k);
      pos.push(lo[0] + (i + sx / m) * CELL, lo[1] + (j + sy / m) * CELL, lo[2] + (k + sz / m) * CELL);
    }
  }
  const nv = pos.length / 3, P = new Float32Array(pos), N = new Float32Array(nv * 3);
  const g3 = [0, 0, 0], grad = (x, y, z, o) => { slope(solid, x, y, z, g3); N[o] = g3[0]; N[o + 1] = g3[1]; N[o + 2] = g3[2]; };
  for (let v = 0; v < nv; v++) {
    const o = v * 3;
    for (let s = 0; s < PROJECT_STEPS; s++) { grad(P[o], P[o + 1], P[o + 2], o); const d = Math.max(-CELL, Math.min(CELL, solid(P[o], P[o + 1], P[o + 2]))); P[o] -= N[o] * d; P[o + 1] -= N[o + 1] * d; P[o + 2] -= N[o + 2] * d; }
    grad(P[o], P[o + 1], P[o + 2], o);
  }
  // a quad across every grid edge that crosses the surface, from the four cells that share the edge
  const idx = [], AXES = [[1, 2], [2, 0], [0, 1]], c4 = [0, 0, 0, 0], ijk = [0, 0, 0];
  for (let c = 0; c < cells.length; c += 3) {
    const i = cells[c], j = cells[c + 1], k = cells[c + 2], here = at(i, j, k) < 0;
    for (let ax = 0; ax < 3; ax++) {
      const [u, w] = AXES[ax]; ijk[0] = i; ijk[1] = j; ijk[2] = k; if (ijk[u] === 0 || ijk[w] === 0) continue;
      ijk[ax]++; const there = at(ijk[0], ijk[1], ijk[2]) < 0; ijk[ax]--; if (here === there) continue;
      let ok = true;
      for (let q = 0; q < 4; q++) { const du = q === 0 || q === 3 ? -1 : 0, dw = q < 2 ? -1 : 0; ijk[u] += du; ijk[w] += dw; c4[q] = cellIndex[cell(ijk[0], ijk[1], ijk[2])]; ijk[u] -= du; ijk[w] -= dw; if (c4[q] < 0) ok = false; }
      if (!ok) continue;
      if (here) idx.push(c4[0], c4[1], c4[2], c4[0], c4[2], c4[3]); else idx.push(c4[0], c4[2], c4[1], c4[0], c4[3], c4[2]);
    }
  }
  return { pos: P, nor: N, idx: new Uint32Array(idx) };
}

// ---- which bones move each vertex
function weigh(S, P) {
  const nv = P.length / 3, wi = new Uint8Array(nv * INFLUENCES), ww = new Float32Array(nv * INFLUENCES), raw = new Float64Array(BONES), dg = new Float64Array(5);
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (z > S.armAloneFrom) { wi[v * INFLUENCES] = CUFF_BONE; ww[v * INFLUENCES] = 1; continue; }
    dg[0] = S.thumbFree(x, y, z); for (let a = 1; a < 5; a++) dg[a] = S.digit(a, x, y, z);
    for (let b = 0; b < BONES; b++) { const digit = b >= 2 && b < DIGIT_BONES_END, a = Math.floor((b - 2) / 3), j = b - boneOf(a, 0); raw[b] = digit && !(a === 0 && j === 0) && S.outside(a, x, y, z) > FAR ? 0 : Math.exp(-Math.max(0, S.bones[b](x, y, z)) / WEIGHT_FALLOFF); }
    // a digit only holds the skin where no other digit is as close: between two fingers the skin belongs to the palm
    for (let a = 0; a < 5; a++) {
      let other = Infinity; for (let o = 0; o < 5; o++) if (o !== a) other = Math.min(other, dg[o]);
      const own = Math.min(1, Math.max(0, (other - dg[a]) / FINGER_APART)), keeper = a === 0 ? PALM_BONE : metacarpalOf(a);       // what the finger gives up goes to its own metacarpal
      for (let j = a === 0 ? 1 : 0; j < 3; j++) { const b = boneOf(a, j); raw[keeper] += raw[b] * (1 - own); raw[b] *= own; }
    }
    // The flesh between the thumb and the index finger lies far from every bone. Left to the rule above, each patch of
    // it would follow whichever bone is a hair nearer, and the skin would tear along the line where that changes when
    // the thumb moves. Instead it is shared between the thumb's first bone and the hand like a membrane: all thumb at the
    // thumb's side, all hand at the index finger's side, evenly in between.
    const webAt = S.web(x, y, z);
    if (webAt < WEB_SKIN) {
      const T = boneOf(0, 0), dT = Math.max(0, S.bones[T](x, y, z)); let dH = Infinity, hand = 0;
      for (const b of HAND_SIDE) { dH = Math.min(dH, Math.max(0, S.bones[b](x, y, z))); hand += raw[b]; }
      const share = smooth01(0.5 + (dH - dT - WEB_WITH_HAND) / (2 * WEB_SHARED_OVER)), k = smooth01((WEB_SKIN - webAt) / WEB_SKIN_SOFT), total = raw[T] + hand;
      if (total > 0) { const scale = hand > 0 ? total * (1 - share) / hand : 0; if (hand <= 0) raw[metacarpalOf(1)] = total * (1 - share) * k; raw[T] += (total * share - raw[T]) * k; for (const b of HAND_SIDE) raw[b] += (raw[b] * scale - raw[b]) * k; }
    }
    let sum = 0, top = 0; for (let b = 0; b < BONES; b++) top = Math.max(top, raw[b]);
    for (let s = 0; s < INFLUENCES; s++) { let best = 0; for (let b = 1; b < BONES; b++) if (raw[b] > raw[best]) best = b; wi[v * INFLUENCES + s] = best; ww[v * INFLUENCES + s] = raw[best] < WEIGHT_FLOOR * top && s > 0 ? 0 : raw[best]; sum += ww[v * INFLUENCES + s]; raw[best] = -1; }      // a bone counts if its hold is not negligible beside the strongest one's
    for (let s = 0; s < INFLUENCES; s++) ww[v * INFLUENCES + s] /= sum;
  }
  return { wi, ww };
}

// ---- nails: a thin plate laid on the back of each last bone, shaped on the finished surface. Each is rigid with its bone.
function nails(S, rest, FR) {
  const out = [], rows = NAIL.rows + NAIL.capRows, g = [0, 0, 0];
  const grad = (x, y, z) => slope(S.solid, x, y, z, g);
  for (let a = 0; a < 5; a++) {
    const d = rest[a], o = d.P[2], len = Math.hypot(...sub(d.P[3], o)), X = d.X, U = d.U[2], D = d.D[2], r2 = FR[a][2], r3 = FR[a][3], pos = new Float32Array(rows * NAIL.across * 3), idx = [];
    for (let i = 0; i < rows; i++) {
      let t = 1, push = 0, shrink = 1;
      if (i < NAIL.rows) t = NAIL.from + (1 - NAIL.from) * i / (NAIL.rows - 1); else { const al = (i - NAIL.rows + 1) / NAIL.capRows * NAIL.capTo * Math.PI / 2; shrink = Math.cos(al) ** 0.9; push = Math.sin(al) * r3; }
      const r = (r2 + (r3 - r2) * t) * shrink, open = NAIL.halfAngle * Math.sqrt(1 - (1 - Math.min(1, (i + 0.6) / (NAIL.rows * NAIL.cuticle))) ** 2);
      for (let j = 0; j < NAIL.across; j++) {
        const th = Math.PI / 2 + open * (1 - 2 * j / (NAIL.across - 1)), cs = Math.cos(th), sn = Math.sin(th), sx = Math.sign(cs) * Math.abs(cs) ** NAIL.round * r, sy = sn ** NAIL.round * r, al = t * len + push;
        let x = o[0] + D[0] * al + X[0] * sx + U[0] * sy, y = o[1] + D[1] * al + X[1] * sx + U[1] * sy, z = o[2] + D[2] * al + X[2] * sx + U[2] * sy;
        for (let s = 0; s < PROJECT_STEPS + 2; s++) { grad(x, y, z); const off = S.solid(x, y, z) - NAIL.lift; x -= g[0] * off; y -= g[1] * off; z -= g[2] * off; }
        pos.set([x, y, z], (i * NAIL.across + j) * 3);
      }
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < NAIL.across - 1; j++) { const A = i * NAIL.across + j, B = A + 1, C = A + NAIL.across, E = C + 1; idx.push(A, B, C, B, E, C); }
    // face the plate outwards
    const p = k => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]], mid = Math.floor(rows / 2) * NAIL.across + Math.floor(NAIL.across / 2) - 1;
    const face = cross(sub(p(mid + 1), p(mid)), sub(p(mid + NAIL.across), p(mid))); grad(...p(mid));
    if (dot(face, g) < 0) for (let k = 0; k < idx.length; k += 3) { const s = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = s; }
    out.push({ pos, idx: new Uint16Array(idx) });
  }
  return out;
}

// Build the right hand's glove in its rest pose. Returns { pos, nor, idx, wi, ww, nails: [{ pos, idx }] }.
export function buildGlove(rest, FR, SIZE) {
  const S = handSolid(rest, FR, SIZE), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const grow = p => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - BOX_MARGIN * 1.6); hi[k] = Math.max(hi[k], p[k] + BOX_MARGIN * 1.6); } };
  rest.forEach(d => d.P.forEach(grow)); grow([ELBOW_BALL, ELBOW_BALL, FOREARM + ELBOW_BALL]); grow([-ELBOW_BALL, -ELBOW_BALL, FOREARM + ELBOW_BALL]); grow([0.03 * SIZE, 0, 0]); grow([-0.03 * SIZE, 0, 0]);
  const m = mesh(S.solid, lo, hi), w = weigh(S, m.pos);
  return { ...m, ...w, nails: nails(S, rest, FR) };
}
