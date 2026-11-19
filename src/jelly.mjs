// Jelly letters: soft bodies that fall, squash, can be dragged, stand back up and walk home.
// Ported from Unix Jelly (~/expts/unixjelly/src/engine/shell.html: PHYS, makeLetter, JellyBody, jellyMaterial, studio,
// and JellyStage's pointer, contacts, shuffleHome, carry and simulate) (see tools/port-jelly.README). The physics and the
// tidying rules are unchanged; read docs/design/letter-reshuffle.md there for the rules. What differs here:
//   - the ground is not a flat floor: letters stand on whatever `terrain` says is solid (src/keyboard.mjs: keys that go
//     down, the rail, the table), so y = 0 is the white keys' tops and letters' home line is z = 0;
//   - eyes have lids (`lid`, 0 open .. 1 asleep) and a letter can be jolted;
//   - one world holds any letters, each with its own home, added one at a time (`addLetter`).
// Numbers inside the ported code are Unix Jelly's own tuning and are left as they were.
import * as THREE from 'three';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const DRAW = globalThis.JELLY_DRAW !== false;            // tests that only check movement switch the painting off
let FONT = null, sound = { boing() {}, ding() {} };
export const setFont = json => { FONT = new Font(json); };
export const setSound = s => { sound = s; };            // { boing(freq, seconds, volume), ding() }
export const JELLY = ['#ff4d6d', '#62c934', '#3a5bff', '#ffc61a', '#ff8a2b', '#9b5cff'], INK = '#24133b';
export const LETTER_SIZE = 0.07;                         // a letter's height: the size Unix Jelly's physics was tuned at
export const LETTER_BEVEL = 0.05, LETTER_GAP = 0.14;     // shares of the size: the rounding added to each side of a glyph, and the room kept between two letters
// eyes: how tall a shut eye is (share of open), how long a lid takes to move, how wide pupils go in a start and for how
// long, the lid at which the pupil is hidden, how open an eye must be for a whole pupil, and how far a drowsy pupil sinks
const EYE = { shut: 0.12, lidEaseS: 0.5, wide: 1.35, wideForS: 0.45, pupilGoneFrom: 0.85, pupilFits: 0.6, droop: 0.12 };
const PUSH_HOLDS = 0.5;                                  // a ball pushing a point more upwards than this (a cosine) is holding it up, and grips it like ground
const BALLAST = 5;                                       // how many times heavier than its top a letter's foot is, less one
const FALLEN_TILT = 0.6;                                 // a letter whose foot line rises this steeply (a sine: about 37 degrees) has fallen over
const JOLT_AGAIN_AFTER_S = 0.4, JOLT_SQUASH = 0.5;                                 // the downward speed a jolt gives the top of a letter (its feet get none)
// the widest of `letters` as it stands, in world units, so the keys can be made to fit it
export const widestLetter = (letters, size = LETTER_SIZE) => Math.max(...[...letters].map(ch => { const g = FONT.data.glyphs[ch]; return (g.x_max - g.x_min) / FONT.data.resolution * size; })) + 2 * LETTER_BEVEL * size;

/* ---------------- jelly physics (Unix Jelly's port of Jelly Baby's soft body) ---------------- */
// gravity is 2.4 here (Unix Jelly: 3.2): the owner wants a letter to hang in the air a moment when its key drops away
export const PHYS = { density: 1050, shear: 1200, bulk: 65000, damping: 3, gravity: 2.4, step: 1 / 240, iterations: 3, staticFriction: .65, dynamicFriction: .42, restitution: .065, maxGrabForce: 2.8 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const det3 = (a, b, c, d, e, f, g, h, i) => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, s = 1 / det3(...m);
  return [(e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s, (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s, (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s];
}
function inside(polys, x, y) {
  let hit = false;
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i].y > y) !== (p[j].y > y) && x < (p[j].x - p[i].x) * (y - p[i].y) / (p[j].y - p[i].y) + p[i].x) hit = !hit;
  }
  return hit;
}
const letterCache = new Map();
function makeLetter(ch, size) {
  const key = ch + size;
  if (letterCache.has(key)) { const c = letterCache.get(key); return { ...c, geo: c.geo.clone() }; }
  const shapes = FONT.generateShapes(ch, size);
  let geo = new THREE.ExtrudeGeometry(shapes, { depth: size * .3, curveSegments: 7, bevelEnabled: true, bevelThickness: size * .09, bevelSize: size * .05, bevelSegments: 4 });
  geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
  geo = mergeVertices(geo, size * 1e-4);
  geo.computeVertexNormals(); geo.computeBoundingBox();
  const bb = geo.boundingBox, sx = -(bb.min.x + bb.max.x) / 2, sy = -bb.min.y, sz = -(bb.min.z + bb.max.z) / 2;
  geo.translate(sx, sy, sz); geo.computeBoundingBox();
  const polys = shapes.flatMap((s) => { const e = s.extractPoints(7); return [e.shape, ...e.holes].map((p) => p.map((v) => ({ x: v.x + sx, y: v.y + sy }))); });
  // How much jelly the light passes through behind each point (aThick, read by jellyMaterial): the full depth on the
  // front and back faces, and on the walls the stroke width, found by a 2D ray across the glyph's outline.
  // Worked out once per letter and size. It rides the vertices, so it squishes with the jelly.
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, depth = size * .48, th = new Float32Array(P.length / 3);
  for (let i = 0; i < th.length; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], nx = N[i * 3], ny = N[i * 3 + 1], l = Math.hypot(nx, ny) || 1, dx = -nx / l, dy = -ny / l;
    let best = size * 1.2;
    for (const p of polys) for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
      const ex = p[a].x - p[b].x, ey = p[a].y - p[b].y, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) continue;
      const wx = p[b].x - x, wy = p[b].y - y, t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
      if (t > size * .01 && u >= 0 && u <= 1 && t < best) best = t;
    }
    const w = Math.abs(N[i * 3 + 2]);
    th[i] = Math.max(size * .04, w * depth + (1 - w) * best);
  }
  geo.setAttribute('aThick', new THREE.BufferAttribute(th, 1));
  const out = { geo, polys, box: geo.boundingBox.clone(), centerShift: -sx };
  letterCache.set(key, out);
  return { ...out, geo: geo.clone() };
}
const PERMS = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];
const UP = new THREE.Vector3(0, 0, 1);

export class JellyBody {
  // cells: how many cage cells fit across one size. Fewer is cheaper and stiffer; big jellies can afford fewer.
  constructor(stage, ch, color, cx, size, cells = 6.5) {
    const L = makeLetter(ch, size), geo = L.geo, box = L.box, polys = L.polys;
    this.stage = stage; this.size = size; this.cx = cx; this.homeX = cx; this.width = box.max.x - box.min.x; this.height = box.max.y;
    const dx = box.max.x - box.min.x, dy = box.max.y - box.min.y, dz = box.max.z - box.min.z, cell = this.cell = size / cells;
    const nx = Math.max(1, Math.round(dx / cell)), ny = Math.max(1, Math.round(dy / cell)), nz = Math.max(2, Math.round(dz / cell));
    const sx = dx / nx, sy = dy / ny, sz = dz / nz, ox = box.min.x, oy = box.min.y, oz = box.min.z;
    const col = (v, o, s, n) => clamp(Math.floor((v - o) / s), 0, n - 1);
    const occ = new Uint8Array(nx * ny), P = geo.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) occ[col(P[i], ox, sx, nx) + col(P[i + 1], oy, sy, ny) * nx] = 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (const [a, b] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75], [.5, .5]]) {
      if (inside(polys, ox + (i + a) * sx, oy + (j + b) * sy)) occ[i + j * nx] = 1;
    }
    const index = new Map(), rest = [], cellNodes = [];
    const node = (i, j, k) => {
      const key = i + (nx + 1) * (j + (ny + 1) * k);
      let id = index.get(key);
      if (id === undefined) { id = rest.length / 3; index.set(key, id); rest.push(ox + i * sx, oy + j * sy, oz + k * sz); }
      return id;
    };
    const corners = (i, j, k) => [0, 1, 2, 3, 4, 5, 6, 7].map((b) => node(i + (b & 1), j + (b >> 1 & 1), k + (b >> 2 & 1)));
    const tets = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (occ[i + j * nx]) for (let k = 0; k < nz; k++) {
      const c = corners(i, j, k); cellNodes.push(c);
      for (const [A, B] of PERMS) tets.push([c[0], c[1 << A], c[(1 << A) | (1 << B)], c[7]]);
    }
    const nearest = (i, j) => {
      if (occ[i + j * nx]) return [i, j];
      let best = [0, 0], bd = Infinity;
      for (let jj = 0; jj < ny; jj++) for (let ii = 0; ii < nx; ii++) if (occ[ii + jj * nx]) {
        const d = (ii - i) ** 2 + (jj - j) ** 2; if (d < bd) { bd = d; best = [ii, jj]; }
      }
      return best;
    };
    // Each surface point rides inside one Kuhn tetrahedron of its cage cell (dense four-node embedding).
    const bind = (px, py, pz) => {
      const [i, j] = nearest(col(px, ox, sx, nx), col(py, oy, sy, ny)), k = col(pz, oz, sz, nz);
      const u = [clamp((px - ox) / sx - i, 0, 1), clamp((py - oy) / sy - j, 0, 1), clamp((pz - oz) / sz - k, 0, 1)];
      const [A, B, C] = [0, 1, 2].sort((a, b) => u[b] - u[a]), c = corners(i, j, k);
      return [[c[0], 1 - u[A]], [c[1 << A], u[A] - u[B]], [c[(1 << A) | (1 << B)], u[B] - u[C]], [c[7], u[C]]];
    };

    const N = rest.length / 3;
    this.N = N; this.rest = Float64Array.from(rest);
    this.restMean = [0, 1, 2].map((k) => rest.reduce((a, v, i) => i % 3 === k ? a + v / N : a, 0));
    // two bottom-back corners, used to tell whether the letter is standing upright and facing front
    const base = [...Array(N).keys()].filter((i) => rest[i * 3 + 1] < oy + sy * .5 && rest[i * 3 + 2] < oz + sz * .5);
    this.footL = base.reduce((m, i) => rest[i * 3] < rest[m * 3] ? i : m, base[0]); this.footR = base.reduce((m, i) => rest[i * 3] > rest[m * 3] ? i : m, base[0]);
    this.x = new Float64Array(N * 3); this.prev = new Float64Array(N * 3); this.v = new Float64Array(N * 3);
    this.mass = new Float64Array(N); this.inv = new Float64Array(N); this.nodalVolume = new Float64Array(N);
    this.normal = new Float64Array(N); this.incoming = new Float64Array(N); this.nodalF = new Float64Array(N * 9);
    this.F = new Float64Array(9); this.dg = new Float64Array(12); this.hg = new Float64Array(12); this.co = new Float64Array(9);
    this.elements = []; this.edges = []; this.cellNodes = cellNodes; // for bumping: each cell's centre is the average of its 8 corners
    const seen = new Set(), p = this.rest;
    for (const t of tets) {
      let ids = t, o = ids.map((v) => v * 3);
      const dmOf = (o) => [p[o[1]] - p[o[0]], p[o[2]] - p[o[0]], p[o[3]] - p[o[0]], p[o[1] + 1] - p[o[0] + 1], p[o[2] + 1] - p[o[0] + 1], p[o[3] + 1] - p[o[0] + 1], p[o[1] + 2] - p[o[0] + 2], p[o[2] + 2] - p[o[0] + 2], p[o[3] + 2] - p[o[0] + 2]];
      let dm = dmOf(o);
      if (det3(...dm) < 0) { ids = [ids[0], ids[1], ids[3], ids[2]]; o = ids.map((v) => v * 3); dm = dmOf(o); }
      const vol = det3(...dm) / 6, inv = inv3(dm), g = new Float64Array(12);
      for (let k = 0; k < 3; k++) { g[3 + k] = inv[k]; g[6 + k] = inv[3 + k]; g[9 + k] = inv[6 + k]; g[k] = -inv[k] - inv[3 + k] - inv[6 + k]; }
      this.elements.push({ ids, o, vol, g, lD: 0, lH: 0, lB: 0 });
      for (const id of ids) { this.mass[id] += PHYS.density * vol / 4; this.nodalVolume[id] += vol; }
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        const lo = Math.min(ids[a], ids[b]), hi = Math.max(ids[a], ids[b]), key = lo * 100000 + hi;
        if (!seen.has(key)) { seen.add(key); this.edges.push([lo, hi]); }
      }
    }
    // Ballast: a letter is heavier towards its foot, like a toy that rights itself. A capital F is a stem with its arms
    // all to one side, and at even weight it will not stand: it fell over on landing and lay there.
    for (let i = 0; i < N; i++) this.mass[i] *= 1 + BALLAST * (1 - clamp((rest[i * 3 + 1] - oy) / dy, 0, 1)) ** 2;
    for (let i = 0; i < N; i++) this.inv[i] = 1 / this.mass[i];
    this.totalMass = this.mass.reduce((a, b) => a + b, 0);

    const V = P.length / 3;
    this.bIds = new Int32Array(V * 4); this.bW = new Float32Array(V * 4);
    for (let v = 0; v < V; v++) {
      const b = bind(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      for (let q = 0; q < 4; q++) { this.bIds[v * 4 + q] = b[q][0]; this.bW[v * 4 + q] = b[q][1]; }
    }
    this.restN = Float32Array.from(geo.attributes.normal.array);
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage); geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    this.geo = geo;
    const c = new THREE.Color(color);
    this.mesh = new THREE.Mesh(geo, jellyMaterial(c, size, stage.rich));
    this.mesh.castShadow = true; this.mesh.frustumCulled = false; this.mesh.userData.body = this;
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTexture, color: c.clone().lerp(new THREE.Color('#ffffff'), .25), transparent: true, opacity: .55, depthWrite: false, toneMapped: false }));
    this.glow.rotation.x = -Math.PI / 2; this.glow.scale.set(this.width * 1.5, size * 1.3, 1); this.glow.renderOrder = 1;

    this.eyes = this.makeEyes(polys, box, bind);
    this.grab = null; this.sleeping = false; this.quiet = 0; this.press = 0; this.spawnAt = 0; this.visible = true;
    // homeZ: how far its home is from the line z = 0 (the plinth is behind it). lid: how far shut the eyes should be (0 open .. 1 asleep)
    this.letter = ch; this.homeZ = 0; this.lid = 0; this.lidNow = 0; this.startledUntil = 0;
  }

  makeEyes(polys, box, bind) {
    const r = this.size * .085, step = this.size * .018, z = box.max.z, ok = (x, y) => [[0, 0], [r * 1.1, 0], [-r * 1.1, 0], [0, r * 1.1], [0, -r * 1.1]].every(([a, b]) => inside(polys, x + a, y + b));
    const rows = [];
    for (let y = box.max.y - r * 1.25; y > box.min.y + box.max.y * .45; y -= step) {
      const xs = []; for (let x = box.min.x + r; x < box.max.x - r; x += step) if (ok(x, y)) xs.push(x);
      if (xs.length) rows.push({ y, xs });
    }
    const pair = rows.find((row) => row.xs.at(-1) - row.xs[0] >= r * 2.3);
    const pts = pair
      ? (() => { const mid = (pair.xs[0] + pair.xs.at(-1)) / 2, sep = Math.min(r * 1.3, (pair.xs.at(-1) - pair.xs[0]) / 2), a = [mid - sep, pair.y], b = [mid + sep, pair.y]; return ok(...a) && ok(...b) ? [a, b] : [[pair.xs[0], pair.y], [pair.xs.at(-1), pair.y]]; })()
      : rows.length ? [[rows[0].xs[Math.floor(rows[0].xs.length / 2)], rows[0].y]] : [];
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .25 }), black = new THREE.MeshStandardMaterial({ color: '#15091f', roughness: .2 });
    return pts.map(([x, y]) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), white), pupil = new THREE.Mesh(new THREE.SphereGeometry(r * .5, 16, 10), black);
      ball.scale.set(1, 1, .5); ball.castShadow = true;
      return { b: bind(x, y, z), r, ball, pupil, q: new THREE.Vector2(0, -.3), qv: new THREE.Vector2(), pos: new THREE.Vector3(), vel: new THREE.Vector3(), n: new THREE.Vector3(0, 0, 1), first: true };
    });
  }

  place(drop, tilt) {
    // it stands on, or falls towards, whatever is solid where it is put (a key, a ledge over a finger, the table)
    const c = Math.cos(tilt), s = Math.sin(tilt), cy = this.height / 2, base = this.stage.terrain.heightAt(this.cx + this.restMean[0], this.homeZ + this.restMean[2]);
    for (let i = 0; i < this.N; i++) {
      const x = this.rest[i * 3], y = this.rest[i * 3 + 1] - cy;
      this.x[i * 3] = this.cx + x * c - y * s; this.x[i * 3 + 1] = base + cy + drop + x * s + y * c; this.x[i * 3 + 2] = this.homeZ + this.rest[i * 3 + 2];
    }
    this.prev.set(this.x); this.v.fill(0); this.grab = null; this.wake(); this.updateBox();
    for (const e of this.eyes) e.first = true;
  }
  wake() { this.sleeping = false; this.quiet = 0; }
  // The bumping lattice: cage corners (ids 0…N-1), then cell centres (ids N…). Each point has a weighted inverse mass W,
  // so a push on it is shared out to its corners. points() lists those inside a box (made once per jelly and reused);
  // at() finds one point and returns its W; nudge() moves one point.
  points(lo, hi) {
    const x = this.x, v = this.v, C = this.cellNodes, N = this.N, n = N + C.length;
    const s = this.pts ??= { id: new Int32Array(n), x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), vx: new Float64Array(n), vy: new Float64Array(n), vz: new Float64Array(n), m: 0 };
    let m = 0;
    const keep = (id, px, py, pz, vx, vy, vz) => {
      if (px < lo[0] || px > hi[0] || py < lo[1] || py > hi[1] || pz < lo[2] || pz > hi[2]) return;
      s.id[m] = id; s.x[m] = px; s.y[m] = py; s.z[m] = pz; s.vx[m] = vx; s.vy[m] = vy; s.vz[m] = vz; m++;
    };
    for (let i = 0; i < N; i++) { const j = i * 3; keep(i, x[j], x[j + 1], x[j + 2], v[j], v[j + 1], v[j + 2]); }
    // a cell whose first corner is more than a cell away from the box can't have its centre inside it: skip the averaging
    const e = this.cell * 2;
    for (let k = 0; k < C.length; k++) {
      const c = C[k], j0 = c[0] * 3;
      if (x[j0] < lo[0] - e || x[j0] > hi[0] + e || x[j0 + 1] < lo[1] - e || x[j0 + 1] > hi[1] + e || x[j0 + 2] < lo[2] - e || x[j0 + 2] > hi[2] + e) continue;
      let px = 0, py = 0, pz = 0, vx = 0, vy = 0, vz = 0;
      for (let q = 0; q < 8; q++) { const j = c[q] * 3; px += x[j]; py += x[j + 1]; pz += x[j + 2]; vx += v[j]; vy += v[j + 1]; vz += v[j + 2]; }
      keep(N + k, px / 8, py / 8, pz / 8, vx / 8, vy / 8, vz / 8);
    }
    s.m = m;
    return s;
  }
  at(id, out) {
    const x = this.x, inv = this.inv;
    if (id < this.N) { const j = id * 3; out[0] = x[j]; out[1] = x[j + 1]; out[2] = x[j + 2]; return inv[id]; }
    const c = this.cellNodes[id - this.N]; let w = 0; out[0] = out[1] = out[2] = 0;
    for (let q = 0; q < 8; q++) { const j = c[q] * 3; out[0] += x[j] / 8; out[1] += x[j + 1] / 8; out[2] += x[j + 2] / 8; w += inv[c[q]]; }
    return w / 64;
  }
  nudge(id, dx, dy, dz) {
    const x = this.x, move = (i, w) => { const j = i * 3; x[j] += dx * w; x[j + 1] = Math.max(this.stage.terrain.tableY, x[j + 1] + dy * w); x[j + 2] += dz * w; };
    if (id < this.N) move(id, this.inv[id]);
    else for (const i of this.cellNodes[id - this.N]) move(i, this.inv[i] / 8);
  }
  updateBox() {
    const x = this.x, lo = this.lo ??= [0, 0, 0], hi = this.hi ??= [0, 0, 0];
    lo.fill(Infinity); hi.fill(-Infinity);
    for (let i = 0; i < x.length; i += 3) for (let k = 0; k < 3; k++) { const v = x[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  }
  // Tall thin letters topple. Once one has settled on its side, it springs back up like a weeble.
  isFallen() {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.N; i++) { const y = this.x[i * 3 + 1]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (hi - lo < this.height * .75) return true;
    // or tipped right over on its side: some letters (F) are nearly as wide as tall, so their height alone does not tell
    const a = this.footL * 3, b = this.footR * 3, dx = this.x[b] - this.x[a], dy = this.x[b + 1] - this.x[a + 1], dz = this.x[b + 2] - this.x[a + 2], len = Math.hypot(dx, dy, dz);
    return len > 1e-6 && Math.abs(dy) / len > FALLEN_TILT;
  }
  standUpIfFallen() {
    if (!this.isFallen()) return;
    const B = this.stage.bounds;
    const x = this.center()[0] - this.restMean[0];
    this.cx = Math.abs(x - this.homeX) < this.size * .6 ? this.homeX : clamp(x, B.x0 + this.size * .5, B.x1 - this.size * .5); // close to home? stand up in its spot
    this.place(this.size * .2, 0); this.stoodAt = this.stage.t; sound.boing(480, .3, .1);
  }
  center() {
    const c = [0, 0, 0]; for (let i = 0; i < this.N; i++) for (let k = 0; k < 3; k++) c[k] += this.x[i * 3 + k] / this.N;
    return c;
  }
  facingFront() {
    const a = this.footL * 3, b = this.footR * 3, dx = this.x[b] - this.x[a], dy = this.x[b + 1] - this.x[a + 1], dz = this.x[b + 2] - this.x[a + 2], len = Math.hypot(dx, dy, dz);
    return len > 1e-6 && dx / len > .9;
  }
  // A small sideways hop: up a bit, across a bit. Friction stops the slide when it lands.
  hopToward(dx, dz, up = .42) {
    this.wake();
    const air = 2 * up / PHYS.gravity, d = Math.hypot(dx, dz), s = Math.min(1, this.size * .6 / (d || 1));
    for (let i = 0; i < this.N; i++) { this.v[i * 3] += dx * s / air; this.v[i * 3 + 1] += up; this.v[i * 3 + 2] += dz * s / air; }
    sound.boing(620 + Math.random() * 220, .09, .04);
  }
  visibleNow(on) {
    if (this.visible === on) return;
    this.visible = on; this.mesh.visible = on;
    for (const e of this.eyes) { e.ball.visible = on; e.pupil.visible = on; }
  }
  hop(power = 1) {
    this.wake();
    const spin = (Math.random() - .5) * 6 * power;
    let cy = 0; for (let i = 0; i < this.N; i++) cy += this.x[i * 3 + 1] / this.N;
    for (let i = 0; i < this.N; i++) { this.v[i * 3 + 1] += .55 * power; this.v[i * 3] += (this.x[i * 3 + 1] - cy) * spin; }
  }

  // Its own note was played: a small start, with wide eyes.
  jolt() {
    this.wake(); this.startledUntil = this.stage.t + EYE.wideForS;
    // squashed from the top, feet left where they are: it springs back and wobbles without leaving the ground, so
    // pressing its key over and over does not walk it off the key (a hop did)
    // and not again until the last one has died down: a key hammered many times a second would pump it up and over
    // nor at all on its own key: there the key falling away under it and slinging it back up is the jolt
    if (this.riding || this.stage.t - (this.joltedAt ?? -Infinity) < JOLT_AGAIN_AFTER_S) return;
    this.joltedAt = this.stage.t;
    for (let i = 0; i < this.N; i++) this.v[i * 3 + 1] -= JOLT_SQUASH * this.rest[i * 3 + 1] / this.height;
  }

  deformation(e) {
    const x = this.x, g = e.g, f = this.F, a = e.o[0], b = e.o[1], c = e.o[2], d = e.o[3];
    const bx = x[b] - x[a], by = x[b + 1] - x[a + 1], bz = x[b + 2] - x[a + 2];
    const cx = x[c] - x[a], cy = x[c + 1] - x[a + 1], cz = x[c + 2] - x[a + 2];
    const dx = x[d] - x[a], dy = x[d + 1] - x[a + 1], dz = x[d + 2] - x[a + 2];
    f[0] = bx * g[3] + cx * g[6] + dx * g[9]; f[1] = bx * g[4] + cx * g[7] + dx * g[10]; f[2] = bx * g[5] + cx * g[8] + dx * g[11];
    f[3] = by * g[3] + cy * g[6] + dy * g[9]; f[4] = by * g[4] + cy * g[7] + dy * g[10]; f[5] = by * g[5] + cy * g[8] + dy * g[11];
    f[6] = bz * g[3] + cz * g[6] + dz * g[9]; f[7] = bz * g[4] + cz * g[7] + dz * g[10]; f[8] = bz * g[5] + cz * g[8] + dz * g[11];
    return f;
  }
  // W = mu/2 (|F|^2 - 3) + K/2 (J - 1 - mu/K)^2, both constraints solved together (as in Jelly Baby).
  solveElastic(e, h) {
    const f = this.deformation(e), g = e.g, dg = this.dg, hg = this.hg;
    let norm = 0; for (let k = 0; k < 9; k++) norm += f[k] * f[k]; norm = Math.sqrt(norm);
    if (norm < 1e-12) return;
    const a = f[0], b = f[1], c = f[2], d = f[3], ee = f[4], ff = f[5], gg = f[6], hh = f[7], ii = f[8];
    const c0 = ee * ii - ff * hh, c1 = ff * gg - d * ii, c2 = d * hh - ee * gg;
    const c3 = c * hh - b * ii, c4 = a * ii - c * gg, c5 = b * gg - a * hh;
    const c6 = b * ff - c * ee, c7 = c * d - a * ff, c8 = a * ee - b * d, J = a * c0 + b * c1 + c * c2;
    const alphaD = 1 / (PHYS.shear * e.vol * h * h), alphaH = 1 / (PHYS.bulk * e.vol * h * h);
    let dd = alphaD, hm = alphaH, dh = 0;
    for (let v = 0; v < 4; v++) {
      const j = v * 3, x = g[j], y = g[j + 1], z = g[j + 2], w = this.inv[e.ids[v]];
      dg[j] = (a * x + b * y + c * z) / norm; dg[j + 1] = (d * x + ee * y + ff * z) / norm; dg[j + 2] = (gg * x + hh * y + ii * z) / norm;
      hg[j] = c0 * x + c1 * y + c2 * z; hg[j + 1] = c3 * x + c4 * y + c5 * z; hg[j + 2] = c6 * x + c7 * y + c8 * z;
      for (let k = 0; k < 3; k++) { dd += w * dg[j + k] ** 2; hm += w * hg[j + k] ** 2; dh += w * dg[j + k] * hg[j + k]; }
    }
    const rd = -norm - alphaD * e.lD, rh = -(J - 1 - PHYS.shear / PHYS.bulk) - alphaH * e.lH, den = dd * hm - dh * dh;
    const dlD = (rd * hm - rh * dh) / den, dlH = (rh * dd - rd * dh) / den;
    e.lD += dlD; e.lH += dlH;
    for (let v = 0; v < 4; v++) {
      const i = e.o[v], j = v * 3, w = this.inv[e.ids[v]];
      for (let k = 0; k < 3; k++) this.x[i + k] += w * (dlD * dg[j + k] + dlH * hg[j + k]);
    }
  }
  // Keeps every tetrahedron from collapsing below a quarter of its volume.
  solveBarrier(e) {
    const f = this.deformation(e), g = e.g, out = this.dg, co = this.co;
    const a = f[0], b = f[1], c = f[2], d = f[3], ee = f[4], ff = f[5], gg = f[6], hh = f[7], ii = f[8];
    const J = a * (ee * ii - ff * hh) + b * (ff * gg - d * ii) + c * (d * hh - ee * gg);
    if (J >= .25 && e.lB === 0) return;
    co[0] = ee * ii - ff * hh; co[1] = ff * gg - d * ii; co[2] = d * hh - ee * gg;
    co[3] = c * hh - b * ii; co[4] = a * ii - c * gg; co[5] = b * gg - a * hh;
    co[6] = b * ff - c * ee; co[7] = c * d - a * ff; co[8] = a * ee - b * d;
    let den = 0;
    for (let v = 0; v < 4; v++) {
      const j = v * 3, w = this.inv[e.ids[v]];
      for (let k = 0; k < 3; k++) { out[j + k] = co[k * 3] * g[j] + co[k * 3 + 1] * g[j + 1] + co[k * 3 + 2] * g[j + 2]; den += w * out[j + k] ** 2; }
    }
    if (den < 1e-15) return;
    const next = Math.max(0, e.lB - (J - .25) / den), delta = next - e.lB; e.lB = next;
    for (let v = 0; v < 4; v++) for (let k = 0; k < 3; k++) this.x[e.o[v] + k] += this.inv[e.ids[v]] * delta * out[v * 3 + k];
  }
  solveGrab(h) {
    for (const gr of this.grab?.multi ?? (this.grab ? [this.grab] : [])) this.solveGrabPoint(gr, h);
  }
  solveGrabPoint(gr, h) {
    const alpha = 1 / (90 * h * h);
    let den = alpha; const pt = [0, 0, 0];
    for (const [id, w] of gr.weights) { for (let k = 0; k < 3; k++) pt[k] += this.x[id * 3 + k] * w; den += this.inv[id] * w * w; }
    for (let k = 0; k < 3; k++) {
      const C = pt[k] - gr.target.getComponent(k), dl = (-C - alpha * gr.lambda[k]) / den;
      const next = clamp(gr.lambda[k] + dl, -PHYS.maxGrabForce * h * h, PHYS.maxGrabForce * h * h), change = next - gr.lambda[k];
      gr.lambda[k] = next;
      for (const [id, w] of gr.weights) this.x[id * 3 + k] += this.inv[id] * w * change;
    }
  }
  solveContacts() {
    const x = this.x, B = this.stage.bounds, T = this.stage.terrain, P = this.stage.pushers, lo = this.lo, hi = this.hi;
    const hit = !!(P && P.n && lo && lo[0] < P.hi[0] && hi[0] > P.lo[0] && lo[1] < P.hi[1] && hi[1] > P.lo[1] && lo[2] < P.hi[2] && hi[2] > P.lo[2]);
    for (let i = 0; i < this.N; i++) {
      const j = i * 3;
      x[j] = clamp(x[j], B.x0, B.x1); x[j + 2] = clamp(x[j + 2], B.z0, B.z1);
      this.normal[i] += T.resolve(x, j);                    // the keys, the rail and the table (src/keyboard.mjs)
      if (hit) for (let k = 0; k < P.n; k++) {              // the hand: balls that push a point out the nearest way
        const dx = x[j] - P.x[k], dy = x[j + 1] - P.y[k], dz = x[j + 2] - P.z[k], r = P.r[k], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r || d2 < 1e-14) continue;
        const d = Math.sqrt(d2), out = (r - d) / d; x[j] += dx * out; x[j + 1] += dy * out; x[j + 2] += dz * out;
        if (dy / d > PUSH_HOLDS) this.normal[i] += (r - d) * dy / d;
      }
    }
  }
  step(h) { if (this.solve(h)) this.finish(h); }
  // Predict and solve the jelly's own constraints. The stage resolves letter-vs-letter contacts
  // between solve() and finish(), so the push turns into velocity like every other constraint.
  // One physics step comes in three parts, so the stage can solve every jelly and their bumps together (simulate):
  // begin (everything moves on, and falls), iterate (each jelly pulls back towards its shape, several times), finish.
  begin(h) {
    if (this.grab) this.wake();
    if (this.sleeping) return false;
    const x = this.x, v = this.v, old = this.prev, N3 = this.N * 3;
    old.set(x); this.normal.fill(0);
    const air = Math.exp(-.025 * h);
    for (let i = 0; i < N3; i++) v[i] *= air;
    for (let i = 1; i < N3; i += 3) v[i] -= PHYS.gravity * h;
    for (let i = 0; i < this.N; i++) this.incoming[i] = v[i * 3 + 1];
    for (let i = 0; i < N3; i++) x[i] += v[i] * h;
    for (const e of this.elements) e.lD = e.lH = e.lB = 0;
    for (const gr of this.grab?.multi ?? (this.grab ? [this.grab] : [])) gr.lambda = [0, 0, 0];
    return true;
  }
  iterate(h, it) {
    const E = this.elements, n = E.length;
    for (let q = 0; q < n; q++) { const e = E[(it & 1) ? n - 1 - q : q]; this.solveElastic(e, h); this.solveBarrier(e); }
    this.solveGrab(h); this.solveContacts();
  }
  finish(h) {
    const x = this.x, v = this.v, old = this.prev, N3 = this.N * 3;
    let grounded = false; this.grounded = false;
    for (let i = 0; i < this.N; i++) if (this.normal[i] > 0) {
      grounded = true;
      const j = i * 3, dx = x[j] - old[j], dz = x[j + 2] - old[j + 2], t = Math.hypot(dx, dz), nrm = this.normal[i];
      const fr = t < PHYS.staticFriction * nrm ? 1 : Math.min(1, PHYS.dynamicFriction * nrm / (t + 1e-20));
      x[j] -= dx * fr; x[j + 2] -= dz * fr;
    }
    for (let i = 0; i < N3; i++) v[i] = (x[i] - old[i]) / h;
    let impact = 0;
    for (let i = 0; i < this.N; i++) if (this.normal[i] > 0 && this.incoming[i] < 0) {
      const vy = v[i * 3 + 1], inc = this.incoming[i], bounce = inc < -.18 ? -inc * PHYS.restitution : 0;
      v[i * 3 + 1] += Math.max(0, bounce - vy); impact = Math.min(impact, inc);
    }
    if (impact < -.45 && performance.now() - (this.lastThud || 0) > 220) { this.lastThud = performance.now(); sound.boing(140 + Math.random() * 90, .25, Math.min(.2, -impact * .12)); }
    // Equal and opposite axial viscosity: dissipates wobble without slowing the whole letter.
    const damp = 1 - Math.exp(-PHYS.damping * h * .35);
    for (const [a, b] of this.edges) {
      const ia = a * 3, ib = b * 3, dx = x[ib] - x[ia], dy = x[ib + 1] - x[ia + 1], dz = x[ib + 2] - x[ia + 2], len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      const nx = dx / len, ny = dy / len, nz = dz / len, rel = (v[ib] - v[ia]) * nx + (v[ib + 1] - v[ia + 1]) * ny + (v[ib + 2] - v[ia + 2]) * nz;
      const imp = rel * damp / (this.inv[a] + this.inv[b]), sa = imp * this.inv[a], sb = imp * this.inv[b];
      v[ia] += sa * nx; v[ia + 1] += sa * ny; v[ia + 2] += sa * nz; v[ib] -= sb * nx; v[ib + 1] -= sb * ny; v[ib + 2] -= sb * nz;
    }
    let energy = 0; for (let i = 0; i < this.N; i++) energy += .5 * this.mass[i] * (v[i * 3] ** 2 + v[i * 3 + 1] ** 2 + v[i * 3 + 2] ** 2);
    const rms = Math.sqrt(2 * energy / this.totalMass), held = !this.grab && (grounded || this.press > 0);
    this.grounded = grounded; this.rms = rms;
    // Settling: a jelly that is held up and already nearly still is slowed hard, so the last slow rocking of a rounded
    // jelly dies away in about a second instead of going on and on. Anything faster is left alone.
    if (held && rms < .03) { const k = Math.exp(-5 * h); for (let i = 0; i < N3; i++) v[i] *= k; }
    // Still for a moment, resting on the floor or on another jelly, and not pressed into one (collide sets press): asleep.
    // A sleeping jelly costs nothing and holds still until something pushes into it.
    this.quiet = held && this.press < .3 && rms < .005 ? this.quiet + h : 0;
    if (this.quiet > .45) { this.sleeping = true; v.fill(0); }
    this.dirty = true; this.updateBox();
    if (!Number.isFinite(x[0])) this.place(.05, 0);
  }
  updateSurface() {
    const nF = this.nodalF; nF.fill(0);
    for (const e of this.elements) {
      const f = this.deformation(e);
      for (let q = 0; q < 4; q++) { const id = e.ids[q], w = e.vol / this.nodalVolume[id], o = id * 9; for (let k = 0; k < 9; k++) nF[o + k] += f[k] * w; }
    }
    const p = this.geo.attributes.position.array, nr = this.geo.attributes.normal.array, ids = this.bIds, W = this.bW, rest = this.restN, x = this.x;
    for (let i = 0, j = 0; i < p.length; i += 3, j += 4) {
      const i0 = ids[j] * 3, i1 = ids[j + 1] * 3, i2 = ids[j + 2] * 3, i3 = ids[j + 3] * 3, w0 = W[j], w1 = W[j + 1], w2 = W[j + 2], w3 = W[j + 3];
      p[i] = x[i0] * w0 + x[i1] * w1 + x[i2] * w2 + x[i3] * w3;
      p[i + 1] = x[i0 + 1] * w0 + x[i1 + 1] * w1 + x[i2 + 1] * w2 + x[i3 + 1] * w3;
      p[i + 2] = x[i0 + 2] * w0 + x[i1 + 2] * w1 + x[i2 + 2] * w2 + x[i3 + 2] * w3;
      const m0 = ids[j] * 9, m1 = ids[j + 1] * 9, m2 = ids[j + 2] * 9, m3 = ids[j + 3] * 9, F = (k) => nF[m0 + k] * w0 + nF[m1 + k] * w1 + nF[m2 + k] * w2 + nF[m3 + k] * w3;
      const a = F(0), b = F(1), c = F(2), d = F(3), e = F(4), f = F(5), g = F(6), h = F(7), q = F(8), nx = rest[i], ny = rest[i + 1], nz = rest[i + 2];
      const ox = (e * q - f * h) * nx + (f * g - d * q) * ny + (d * h - e * g) * nz;
      const oy = (c * h - b * q) * nx + (a * q - c * g) * ny + (b * g - a * h) * nz;
      const oz = (b * f - c * e) * nx + (c * d - a * f) * ny + (a * e - b * d) * nz;
      const inv = 1 / (Math.hypot(ox, oy, oz) || 1);
      nr[i] = ox * inv; nr[i + 1] = oy * inv; nr[i + 2] = oz * inv;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
    this.dirty = false;
  }
  updateEyes(dt, look, t) {
    const x = this.x, nF = this.nodalF;
    this.lidNow += (this.lid - this.lidNow) * (1 - Math.exp(-dt / EYE.lidEaseS));
    for (const e of this.eyes) {
      const pos = new THREE.Vector3(), Fm = new Array(9).fill(0);
      for (const [id, w] of e.b) { pos.x += x[id * 3] * w; pos.y += x[id * 3 + 1] * w; pos.z += x[id * 3 + 2] * w; for (let k = 0; k < 9; k++) Fm[k] += nF[id * 9 + k] * w; }
      const [a, b, c, d, ee, f, g, h, q] = Fm;
      const n = new THREE.Vector3(d * h - ee * g, b * g - a * h, a * ee - b * d).normalize();
      if (!Number.isFinite(n.x)) n.set(0, 0, 1);
      const vel = pos.clone().sub(e.pos).divideScalar(Math.max(dt, 1e-3));
      const acc = e.first ? new THREE.Vector3() : vel.clone().sub(e.vel).divideScalar(Math.max(dt, 1e-3));
      e.first = false; e.pos.copy(pos); e.vel.copy(vel);
      // googly pupils: a damped spring pulled by gravity, the pointer, and the jelly's own jiggle
      const target = new THREE.Vector2(look.x - pos.x, look.y - pos.y);
      if (target.length() > 1e-6) target.normalize().multiplyScalar(.28); target.y -= .12;
      if (this.grab) target.multiplyScalar(0);
      const ax = -(e.q.x - target.x) * 140 - e.qv.x * 7 - acc.x / e.r * .035, ay = -(e.q.y - target.y) * 140 - e.qv.y * 7 - (acc.y + PHYS.gravity) / e.r * .035;
      e.qv.x += ax * dt; e.qv.y += ay * dt; e.q.addScaledVector(e.qv, dt);
      if (e.q.length() > .45) { e.q.setLength(.45); e.qv.multiplyScalar(-.5); }
      const blink = (((t + this.cx * 37) % 4.2) + 4.2) % 4.2 < .12, lid = blink ? 1 : this.lidNow, open = 1 - (1 - EYE.shut) * lid;
      e.ball.position.copy(pos).addScaledVector(n, e.r * .2);
      e.ball.quaternion.setFromUnitVectors(UP, n);
      e.ball.scale.set(1, open, .5);
      const s = this.grab || t < this.startledUntil ? EYE.wide : 1;
      e.pupil.scale.set(s, s * Math.min(1, open / EYE.pupilFits), s);
      e.pupil.visible = this.visible && lid < EYE.pupilGoneFrom;
      e.pupil.position.copy(pos).addScaledVector(n, e.r * .48).add(new THREE.Vector3(e.q.x * e.r, e.q.y * e.r * open - e.r * EYE.droop * this.lidNow, 0));
    }
  }
}

function floorTexture(base, line) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = line; g.globalAlpha = .35; g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  g.globalAlpha = .7; g.lineWidth = 4; g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// The jelly letters' material: see-through and glossy, with a little rainbow at the edges (dispersion), lit from
// inside where the jelly is thin, and brighter at the rim. A cheap stand-in for light scattering inside real jelly.
// rich: the rainbow edges, only for machines that have shown they're fast (it reads the see-through image three times).
function jellyMaterial(c, size, rich = false) {
  // deeper relative to each colour's own lightness: a fixed dark turns yellow and orange brown
  const hsl = c.getHSL({}), deep = new THREE.Color().setHSL(hsl.h, 1, Math.max(.4, hsl.l * .78));
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.max(.62, hsl.l)), transmission: .96, thickness: 1, roughness: .05, ior: 1.4,
    attenuationColor: deep, attenuationDistance: size * .3, clearcoat: 1, clearcoatRoughness: .03, specularIntensity: 1,
    dispersion: rich ? .35 : 0,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aThick;\nvarying float vThick;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vThick = aThick;');
    sh.fragmentShader = 'varying float vThick;\n' + sh.fragmentShader
      .replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment.replace('material.thickness = thickness;', 'material.thickness = vThick;'))
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 V = normalize(vViewPosition); float thin = clamp(1. - vThick / ${(size * .9).toFixed(5)}, .15, 1.);
          float rim = pow(1. - clamp(dot(normal, V), 0., 1.), 3.) * .5;
          totalEmissiveRadiance += diffuse * (thin * .4 + rim) * .15; }`);
  };
  m.customProgramCacheKey = () => 'jelly-letter' + size;
  return m;
}

// The light the jelly reflects: the usual soft room, plus a big four-pane window behind the viewer and a smaller one
// to the left. Every letter then carries crisp window highlights, the strongest cue that something is wet and glassy.
function studio(renderer) {
  if (!DRAW) return null;
  const room = new RoomEnvironment(), glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7, 6.6) });
  const panes = (x, y, z, w, h, ry) => [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([a, b]) => {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w * .46, h * .46), glow);
    pane.position.set(x + Math.cos(ry) * a * w * .25, y + b * h * .25, z - Math.sin(ry) * a * w * .25); pane.rotation.y = ry; room.add(pane);
  });
  panes(-3, 10, 13, 9, 7, Math.PI); panes(-14, 8, 2, 5, 5, Math.PI / 2);
  return new THREE.PMREMGenerator(renderer).fromScene(room, .015).texture;
}
// The coloured light a jelly throws on the floor, where light comes through it: a soft patch of its colour.
const glowTexture = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#ffffffff'); gr.addColorStop(.35, '#ffffff99'); gr.addColorStop(1, '#ffffff00'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

const SUN = { colour: '#fff6e6', strength: 2.6, shadowMap: 4096, from: [0.6, 1.8, 1.2], reach: 6 }, SKY_LIGHT = 1.1, ENV_STRENGTH = 0.9, CAMERA_FOV = 26, CAMERA_FAR = 60;
const FLOOR = { size: 48, tiles: 300, dim: 0.42 };
const DROP_FROM = 4.5;                                   // sizes above its key a letter starts its fall
const HAPPY_HOP = 0.22;
const STRANDED = { seconds: 8, far: 0.3 };               // away from home (by this share of a size, or fallen) for this long, in nobody's grip: it pops home
// a letter on its own key: how near home (share of a letter's size, along and across the keys) and how low above the
// ground there (its middle, share of size) it must be to count as on it; backS: the time in which it drifts back over
// its spot. SLING.most: the fastest it may be going up there (about 19 mm of flight at this gravity).
const RIDE = { near: 0.35, above: 2.5, backS: 0.2 }, SLING = { most: 0.3 };

// opts: { bg, floor, terrain, bounds {x0, x1, z0, z1} (may be replaced later: world.bounds), lit (the bounds the sun's
// shadows must cover), view(camera, aspect), onStep(h), onRide(body, riding) }
export class JellyWorld {
  constructor(canvas, opts) {
    this.canvas = canvas; this.opts = { size: LETTER_SIZE, ...opts }; this.bodies = []; this.acc = 0; this.t = 0;
    this.terrain = opts.terrain; this.bounds = opts.bounds;
    this.pushers = null;                                   // balls that push letters aside (the hand): { n, x, y, z, r, lo, hi, moving }, set by the page
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1;
    this.rich = false; this.speed = { n: 0, t0: 0 };
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(opts.bg);
    s.environment = studio(r); s.environmentIntensity = ENV_STRENGTH;
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, .01, CAMERA_FAR);
    this.sky = new THREE.HemisphereLight('#ffffff', opts.floor, SKY_LIGHT); s.add(this.sky);
    const B = opts.lit || this.bounds, half = Math.max(B.x1 - B.x0, B.z1 - B.z0) / 2 + this.opts.size, midX = (B.x0 + B.x1) / 2, midZ = (B.z0 + B.z1) / 2;
    const sun = this.sun = new THREE.DirectionalLight(SUN.colour, SUN.strength); sun.castShadow = true;
    sun.position.set(midX + SUN.from[0], SUN.from[1], midZ + SUN.from[2]); sun.target.position.set(midX, 0, midZ);
    sun.shadow.mapSize.set(SUN.shadowMap, SUN.shadowMap); sun.shadow.bias = -.0004; sun.shadow.normalBias = .002; s.add(sun, sun.target);
    const sc = sun.shadow.camera; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = .01; sc.far = SUN.reach; sc.updateProjectionMatrix();
    const tex = floorTexture(opts.floor, INK); tex.repeat.set(FLOOR.tiles, FLOOR.tiles);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.size, FLOOR.size), new THREE.MeshStandardMaterial({ map: tex, roughness: .85, toneMapped: false, color: new THREE.Color(FLOOR.dim, FLOOR.dim, FLOOR.dim) }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = this.terrain.tableY; floor.receiveShadow = true; s.add(floor);
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2(); this.look = new THREE.Vector3(0, .05, .2); this.plane = new THREE.Plane();
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  // A new letter, standing at homeX on the home line once it has fallen from the sky.
  // `key`: which key it belongs to (the page's own number for it). `after`: seconds before it appears and falls.
  // `from`: how many sizes above its key it starts.
  addLetter(ch, colour, homeX, key, after = 0, from = DROP_FROM) {
    const b = new JellyBody(this, ch, colour, homeX, this.opts.size);
    this.bodies.push(b); this.scene.add(b.mesh, b.glow); b.eyes.forEach((e) => this.scene.add(e.ball, e.pupil));
    b.key = key; b.place(this.opts.size * from, 0); b.spawnAt = this.t + after; b.visibleNow(false);
    return b;
  }
  onKey(key) { return this.bodies.find((b) => b.key === key); }
  removeLetter(b) {
    const i = this.bodies.indexOf(b); if (i < 0) return;
    this.bodies.splice(i, 1); this.scene.remove(b.mesh, b.glow); b.eyes.forEach((e) => this.scene.remove(e.ball, e.pupil)); b.geo.dispose();
    if (this.drag?.b === b) this.drag = null; if (b.riding) this.opts.onRide?.(b, false);
  }
  hopAll() { this.bodies.forEach((b, i) => setTimeout(() => b.hopToward(0, 0, HAPPY_HOP), i * 70)); }
  // place the camera again (the page's framing has changed) without touching the canvas
  reframe() { this.opts.view(this.camera, this.camera.aspect); this.camera.updateProjectionMatrix(); }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.opts.view(this.camera, w / h); this.camera.updateProjectionMatrix();
  }
  bindPointer() {
    const cv = this.canvas;
    const setPtr = (e) => { const r = cv.getBoundingClientRect(); this.ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); };
    const hit = (e) => {
      setPtr(e); this.ray.setFromCamera(this.ptr, this.camera);
      for (const b of this.bodies) { b.geo.computeBoundingSphere(); b.geo.computeBoundingBox(); }
      return this.ray.intersectObjects(this.bodies.map((b) => b.mesh), false)[0];
    };
    cv.addEventListener('touchstart', (e) => { if (hit(e.touches[0])) e.preventDefault(); }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      const h = hit(e); if (!h) return;
      const b = h.object.userData.body, f = h.face, P = b.geo.attributes.position;
      const vi = [f.a, f.b, f.c].sort((m, n) => new THREE.Vector3().fromBufferAttribute(P, m).distanceTo(h.point) - new THREE.Vector3().fromBufferAttribute(P, n).distanceTo(h.point))[0];
      const weights = [0, 1, 2, 3].map((q) => [b.bIds[vi * 4 + q], b.bW[vi * 4 + q]]);
      const start = new THREE.Vector3().fromBufferAttribute(P, vi);
      b.grab = { weights, target: start.clone(), lambda: [0, 0, 0] };
      this.plane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), start);
      this.drag = { b, x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      cv.setPointerCapture(e.pointerId); sound.boing(520, .18, .08);
    });
    cv.addEventListener('pointermove', (e) => {
      // a jelly carried out of its panel is let go there, so it can never stay stuck to the mouse
      const r = cv.getBoundingClientRect();
      if (this.drag && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) { end(e); return; }
      setPtr(e); this.ray.setFromCamera(this.ptr, this.camera);
      const p = new THREE.Vector3();
      if (this.drag && this.ray.ray.intersectPlane(this.plane, p)) { p.y = Math.max(p.y, this.terrain.tableY); this.drag.b.grab.target.copy(p); }
      if (this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.opts.size * .5), p)) this.look.copy(p);
    });
    const end = (e) => {
      const d = this.drag; if (!d) return; this.drag = null; d.b.grab = null; d.b.wake();
      const tap = Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && performance.now() - d.t < 350;
      if (tap) { d.b.hop(1.1); sound.boing(380, .4); } else sound.boing(260, .45, .14);
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); cv.addEventListener('lostpointercapture', end);
  }
  // Jellies bump into each other, every jelly in every guide: letters and the jar's jelly babies alike.
  // Each jelly is a body-centred lattice of points: its cage corners plus the centre of every cage cell. Its biggest hole
  // is about 0.56 of a cell, smaller than the gap d kept between jellies, so nothing can squeeze through. d comes from
  // each jelly's own cage cells, so big and small jellies keep the right gap.
  // Once a step, findContacts lists every pair of points from different jellies that are near each other. pushApart
  // then keeps them apart in every solver pass, alongside each jelly pulling back to its own shape (as XPBD solves
  // contacts), so a pile holds its weight instead of being squashed together and springing apart again.
  // A sleeping jelly holds still like a solid thing: an awake one touching it takes the whole push. It wakes when
  // something bumps it or presses into it, so two jellies can never fall asleep inside each other.
  // Each jelly's press (its deepest point inside the gap, as a share of it) tells finish() whether it is resting on
  // another jelly, and whether it is pressed too hard to fall asleep.
  // Only pairs whose bounding boxes touch are checked, so jellies standing apart cost nothing. The lists are kept and
  // reused, so bumping makes no garbage for old computers to clean up.
  findContacts() {
    const live = this.bodies.filter((b) => this.t >= b.spawnAt && b.lo), C = this.touch ??= { P: [], Q: [], a: [], b: [], d: [], ax: [], ay: [], az: [], n: 0 };
    let n = 0;
    for (const b of live) b.press = 0;
    for (let a = 0; a < live.length; a++) for (let c = a + 1; c < live.length; c++) {
      const P = live[a], Q = live[c];
      if (P.sleeping && Q.sleeping) continue;
      // near: within the gap, plus room for this step's movement
      const d = Math.max(P.cell, Q.cell) * .62, near = d * 1.5, n2 = near * near;
      const lo = [0, 1, 2].map((k) => Math.max(P.lo[k], Q.lo[k]) - near), hi = [0, 1, 2].map((k) => Math.min(P.hi[k], Q.hi[k]) + near);
      if (lo.some((v, k) => v > hi[k])) continue;
      const ps = P.points(lo, hi), qs = Q.points(lo, hi);
      // the way from P's middle to Q's: pushes may never move a point towards the other jelly's middle (pushApart)
      let ax = 0, ay = 0, az = 0;
      { const m = [0, 1, 2].map((k) => (Q.lo[k] + Q.hi[k] - P.lo[k] - P.hi[k]) / 2), l = Math.hypot(...m) || 1; ax = m[0] / l; ay = m[1] / l; az = m[2] / l; }
      let hit = false, deep = 0;
      for (let a2 = 0; a2 < ps.m; a2++) for (let b2 = 0; b2 < qs.m; b2++) {
        const dx = qs.x[b2] - ps.x[a2], dy = qs.y[b2] - ps.y[a2], dz = qs.z[b2] - ps.z[a2], r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= n2) continue;
        C.P[n] = P; C.Q[n] = Q; C.a[n] = ps.id[a2]; C.b[n] = qs.id[b2]; C.d[n] = d; C.ax[n] = ax; C.ay[n] = ay; C.az[n] = az; n++;
        const r = Math.sqrt(r2);
        if (r >= d) continue;
        deep = Math.max(deep, 1 - r / d);
        // a real bump: moving into each other, not two jellies resting cheek to cheek
        if (r > 1e-7 && ((qs.vx[b2] - ps.vx[a2]) * dx + (qs.vy[b2] - ps.vy[a2]) * dy + (qs.vz[b2] - ps.vz[a2]) * dz) / r < -.12) hit = true;
      }
      P.press = Math.max(P.press, deep); Q.press = Math.max(Q.press, deep);
      if (hit || deep > .3) for (const b of [P, Q]) if (b.sleeping) b.wake();
      if (hit && performance.now() - (this.lastBump || 0) > 260) { this.lastBump = performance.now(); sound.boing(300 + Math.random() * 160, .18, .07); }
    }
    C.n = n;
  }
  pushApart() {
    const C = this.touch, p = this.pp ??= [0, 0, 0], q = this.pq ??= [0, 0, 0];
    for (let k = 0; k < C.n; k++) {
      const P = C.P[k], Q = C.Q[k], d = C.d[k], ip = P.at(C.a[k], p), iq = Q.at(C.b[k], q), wp = P.sleeping ? 0 : ip, wq = Q.sleeping ? 0 : iq;
      const r = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (r >= d) continue;
      // Push the two points apart, never towards the other jelly's middle: a point caught among the other jelly's points
      // is pushed from all sides at once and would stay put, so the two jellies would stay inside each other.
      // (the part of the push that points that way is dropped; what's left is never zero, so it can't flicker)
      let nx = (q[0] - p[0]) / (r || 1), ny = (q[1] - p[1]) / (r || 1), nz = (q[2] - p[2]) / (r || 1);
      const back = Math.min(0, nx * C.ax[k] + ny * C.ay[k] + nz * C.az[k]) - .05;
      if (back < 0) { nx -= back * C.ax[k]; ny -= back * C.ay[k]; nz -= back * C.az[k]; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l; }
      // at most half the gap a pass, so two jellies pushed deep inside each other come apart without a bang
      const push = Math.min(d - r, d / 2) / (wp + wq);
      if (wp) P.nudge(C.a[k], -nx * push, -ny * push, -nz * push);
      if (wq) Q.nudge(C.b[k], nx * push, ny * push, nz * push);
      P.dirty = Q.dirty = true;
    }
  }
  // Stage two of tidying up: once everyone is standing still, letters that strayed go back into order.
  // An invisible hand holds each wanderer by the top and carries it home in bouncy hops, so it squishes
  // and dangles but cannot topple. A letter whose way is blocked goes round the front: forward, along, back.
  // Explained, with every rule, in docs/design/letter-reshuffle.md. Each letter's decision this frame is kept in
  // b.why (and where it is heading in b.goalX, b.goalZ), for the under-the-hood page that shows it working.
  shuffleHome(dt) {
    const B = this.bodies, size = this.opts.size, gap = size * .14;
    const drop = (b) => { if (b.carry) { if (b.grab === b.carry) b.grab = null; b.carry = null; b.wake(); } };
    if (this.drag || B.some((b) => this.t < b.spawnAt)) { if (this.homing) B.forEach(drop); this.homing = false; this.calm = 0; return; }
    const home = (b) => [b.homeX + b.restMean[0], b.homeZ + b.restMean[2]];
    const atHome = (b, c) => { const [hx, hz] = home(b); return Math.abs(c[0] - hx) < size * .1 && Math.abs(c[2] - hz) < size * .2; };
    const centers = new Map(B.map((b) => [b, b.center()]));
    const still = this.still = B.every((b) => !b.grab && !b.isFallen() && (b.sleeping || (b.grounded && b.rms < .03)));
    if (!this.homing) {
      this.calm = still ? (this.calm || 0) + dt : 0;
      if (this.calm < .6) return;
      const strays = B.filter((b) => !atHome(b, centers.get(b)));
      B.filter((b) => !strays.includes(b) && !b.facingFront()).forEach((b) => { b.cx = b.homeX; b.place(size * .2, 0); b.turnedAt = this.t; sound.boing(480, .3, .1); });
      if (!strays.length) return;
      this.homing = true; this.homeTime = 0; this.lanes = {}; B.forEach((b) => { b.lane = null; b.stray = strays.includes(b); });
    }
    this.homeTime += dt;
    if (this.homeTime > 20) { // tangled up: everyone pops straight home instead
      B.forEach((b) => { drop(b); b.cx = b.homeX; b.place(size * .15, 0); b.why = null; });
      sound.boing(300, .5, .14); this.homing = false; this.lanes = {}; this.tangledAt = this.t; return;
    }
    let moving = false;
    for (const b of B) {
      const c = centers.get(b), [hx, hz] = home(b), lane = hz + (b.lane === 'back' ? -1.15 : 1.15) * size;
      // only the letters that were out of place move; neighbours who just got jostled stay put
      if (!b.stray) { if (Math.abs(c[0] - hx) > size * .5 || Math.abs(c[2] - hz) > size * .6) b.stray = true; else { b.why = 'home'; continue; } }
      if (atHome(b, c) && b.carry) { // arrived: lower it gently onto its spot before letting go, so thin letters do not topple
        const k = b.carry; k.landing = (k.landing || 0) + dt; b.why = 'landing';
        k.p[0] += (hx + k.ox - k.p[0]) * .2; k.p[2] += (hz + k.oz - k.p[2]) * .2; k.p[1] += (k.y0 + this.terrain.heightAt(hx, hz) - k.p[1]) * .2;
        if (k.landing > .4) { b.stray = false; drop(b); if (b.lane) { this.lanes[b.lane] = null; b.lane = null; } }
        continue;
      }
      if (atHome(b, c)) {
        b.stray = false; b.why = 'home'; if (b.lane) { this.lanes[b.lane] = null; b.lane = null; }
        if (!b.facingFront() && !b.isFallen() && b.grounded) { b.cx = b.homeX; b.place(size * .2, 0); b.turnedAt = this.t; sound.boing(480, .3, .1); }
        continue;
      }
      moving = true;
      const others = B.filter((o) => o !== b), main = (oc) => Math.abs(oc[2] - hz) < size * .7;
      const right = hx > c[0], pad = (o) => (b.width + o.width) / 2 + gap * .3;
      const spotFree = !others.some((o) => { const oc = centers.get(o); return main(oc) && Math.abs(oc[0] - hx) < pad(o); });
      const between = others.some((o) => { const oc = centers.get(o); return main(oc) && (right ? oc[0] > c[0] && oc[0] < hx : oc[0] < c[0] && oc[0] > hx); });
      const blocked = between || !spotFree;
      let tx = hx, tz = hz;
      b.why = 'straight';
      if (b.lane) {
        if (Math.abs(c[2] - lane) > size * .2 && Math.abs(c[0] - hx) > size * .1) { tx = c[0]; tz = lane; b.why = 'step-out'; } // step out to the front lane
        else if (Math.abs(c[0] - hx) > size * .1) { tz = lane; b.why = 'along'; }                                               // shuffle along it
        else if (!spotFree) { this.carry(b).hold = true; b.why = 'hold'; b.goalX = hx; b.goalZ = lane; continue; }          // wait in front of the gap
        else b.why = 'step-in';
      } else if (blocked) {
        // go round the front, or round the back if the front is busy; otherwise wait a turn
        const side = !this.lanes.front ? 'front' : !this.lanes.back ? 'back' : null;
        if (!side) { drop(b); b.why = 'wait'; continue; }
        this.lanes[side] = b; b.lane = side; tx = c[0]; tz = hz + (side === 'back' ? -1.15 : 1.15) * size; b.why = 'step-out';
      }
      b.goalX = tx; b.goalZ = tz;
      const k = this.carry(b); k.hold = false;
      const sp = .16 * dt, p = k.p, gx = tx + k.ox - p[0], gz = tz + k.oz - p[2], gd = Math.hypot(gx, gz), f = gd > sp ? sp / gd : 1;
      p[0] += gx * f; p[2] += gz * f;
      k.phase += dt * 1.7;
      p[1] = k.y0 + Math.max(0, this.terrain.heightAt(hx, hz)) + size * .06 + size * .25 * Math.abs(Math.sin(k.phase * Math.PI));      // carried at the height of its home (a ledge is higher than a key)
      if (Math.floor(k.phase) !== k.lastHop) { k.lastHop = Math.floor(k.phase); sound.boing(620 + Math.random() * 220, .09, .035); }
    }
    if (!moving && still) { this.homing = false; this.lanes = {}; B.forEach((b, i) => setTimeout(() => b.hopToward(0, 0, .22), i * 70)); sound.ding(); } // a happy little squish, not a jump
  }
  // The invisible hand: a soft grab on the letter's top nodes, using the same constraint as a mouse drag.
  carry(b) {
    if (b.carry) return b.carry;
    const top = [...Array(b.N).keys()].filter((i) => b.rest[i * 3 + 1] > b.height * .6);
    const mean = (ids, arr) => [0, 1, 2].map((k) => ids.reduce((a, i) => a + arr[i * 3 + k] / ids.length, 0));
    const r = mean(top, b.rest), cur = mean(top, b.x);
    const k = { ox: r[0] - b.restMean[0], oz: r[2] - b.restMean[2], y0: r[1], p: cur, phase: 0, lastHop: 0 };
    // one hand on each side of the top, keeping their rest spacing, so the letter cannot spin round
    k.multi = [top.filter((i) => b.rest[i * 3] <= r[0]), top.filter((i) => b.rest[i * 3] >= r[0])].map((ids) => {
      const o = mean(ids, b.rest).map((v, j) => v - r[j]);
      return { weights: ids.map((i) => [i, 1 / ids.length]), lambda: [0, 0, 0], target: { getComponent: (j) => k.p[j] + o[j] } };
    });
    b.carry = k; b.grab = k; b.wake();
    return k;
  }
  simulate(dt) {
    this.t += dt; this.acc += Math.min(dt, 1 / 20);
    let n = 0;
    while (this.acc >= PHYS.step && n < 7) {
      const h = PHYS.step;
      this.moveScenery(h);
      const moving = this.bodies.filter((b) => this.t >= b.spawnAt && b.begin(h));
      this.findContacts();
      for (let it = 0; it < PHYS.iterations; it++) { for (const b of moving) b.iterate(h, it); this.pushApart(); }
      for (const b of moving) b.finish(h);
      this.acc -= h; n++;
    }
    if (n === 7) this.acc = 0;
    this.tidy(dt);
  }
  // Anything solid that moves (a shaken jar's walls) moves here, once per physics step. Moving it once per frame instead
  // makes it jump further on slow computers, and a big jump can crumple a jelly into a dent it never springs out of.
  moveScenery(h) {
    this.opts.onStep?.(h); this.ride(h);
    // a sleeping letter that the hand's balls have come near is woken, or the hand would pass through it
    const P = this.pushers;
    if (P && P.n && P.moving) for (const b of this.bodies) if (b.sleeping && b.lo && b.lo[0] < P.hi[0] && b.hi[0] > P.lo[0] && b.lo[1] < P.hi[1] && b.hi[1] > P.lo[1] && b.lo[2] < P.hi[2] && b.hi[2] > P.lo[2]) b.wake();
  }
  // A letter on its own key. The key drops away under it faster than it can fall, so it hangs in the air for a moment
  // and lands in the well; when the key comes back up it is thrown up a little, the key being a small slingshot (the
  // owner's wish, 19 Nov 2026). Two things keep that from walking it off its key, which the bare physics did within a
  // few presses: while it is near home the whole letter is eased back over its spot (a wobble never adds up to a
  // walk), and the speed the returning key gives it is capped (SLING.most): a real key's return would throw it
  // higher than it is tall. A sleeping letter is woken when the ground at its home moves, or it would hang there.
  // opts.onRide(body, riding) tells the page which keys have their letter on them.
  ride(h) {
    const size = this.opts.size;
    for (const b of this.bodies) {
      const hx = b.homeX + b.restMean[0], hz = b.homeZ + b.restMean[2], ground = this.terrain.heightAt(hx, hz);
      let rides = this.t >= b.spawnAt && !b.grab && !b.carry, c = null;
      if (rides) { c = b.center(); rides = Math.abs(c[0] - hx) < RIDE.near * size && Math.abs(c[2] - hz) < RIDE.near * size && c[1] - ground < RIDE.above * size && c[1] > ground && !b.isFallen(); }
      if (rides !== !!b.riding) { b.riding = rides; this.opts.onRide?.(b, rides); }
      const moved = ground - (b.groundWas ?? ground); b.groundWas = ground;
      if (rides && moved) b.wake();
      if (!rides || b.sleeping) continue;
      const ease = 1 - Math.exp(-h / RIDE.backS), dx = (hx - c[0]) * ease, dz = (hz - c[2]) * ease, x = b.x, old = b.prev, v = b.v;
      let up = 0; for (let i = 1; i < b.N * 3; i += 3) up += v[i]; up = up / b.N - SLING.most;
      for (let i = 0; i < b.N * 3; i += 3) { x[i] += dx; old[i] += dx; x[i + 2] += dz; old[i + 2] += dz; if (up > 0) v[i + 1] -= up; }
      b.dirty = true;
    }
  }
  // What the jellies do once the physics has moved them. Letters stand back up and go home in order.
  tidy(dt) {
    for (const b of this.bodies) {
      b.restTime = b.sleeping ? (b.restTime || 0) + dt : 0;
      if (b.restTime > 1.1) { b.restTime = 0; b.standUpIfFallen(); }
    }
    this.shuffleHome(dt);
    // Stranded: tidying only begins once every letter is standing still, and a letter caught under the hand never is
    // (the hand's balls keep pressing it), so nobody would go home. A letter that has been away from home, in nobody's
    // grip, for STRANDED_S pops back to its place.
    const size = this.opts.size;
    for (const b of this.bodies) {
      const c = b.center(), away = this.t >= b.spawnAt && !b.grab && (Math.abs(c[0] - b.homeX - b.restMean[0]) > size * STRANDED.far || Math.abs(c[2] - b.homeZ - b.restMean[2]) > size * STRANDED.far || b.isFallen());
      b.awayFor = away ? (b.awayFor || 0) + dt : 0;
      if (b.awayFor > STRANDED.seconds) { b.awayFor = 0; b.carry = null; b.stray = false; b.cx = b.homeX; b.place(size * .2, 0); sound.boing(480, .3, .1); }
    }
  }
  tick(dt) {
    // Measure the frames after the first few (which build shaders). Under 30 a second, the see-through pass drops to half
    // resolution. Over 55, the jelly gets its rainbow edges. (Unix Jelly's rule.)
    if (this.speed.n < 140 && ++this.speed.n === 20) this.speed.t0 = performance.now();
    else if (this.speed.n === 140) {
      this.speed.n++; const ms = (performance.now() - this.speed.t0) / 120;
      if (ms > 1000 / 30) this.renderer.transmissionResolutionScale = .5;
      if (ms < 1000 / 55) { this.rich = true; for (const b of this.bodies) { b.mesh.material.dispersion = .35; b.mesh.material.needsUpdate = true; } }
    }
    this.simulate(dt);
    for (const b of this.bodies) {
      b.visibleNow(this.t >= b.spawnAt);
      if (b.dirty) b.updateSurface();
      b.updateEyes(dt, this.look, this.t);
      // the glow lies on whatever is under the letter, on the far side from the sun, and fades as the letter leaves it
      const [x, y, z] = b.center(), gx = x - this.opts.size * .12, gz = z - this.opts.size * .35, ground = this.terrain.heightAt(gx, gz); b.glow.visible = b.mesh.visible;
      b.glow.position.set(gx, ground + .0008, gz); b.glow.material.opacity = .55 * clamp(1 - (y - ground - b.height * .5) / b.size, 0, 1);
    }
    if (DRAW) this.renderer.render(this.scene, this.camera);
  }
}
