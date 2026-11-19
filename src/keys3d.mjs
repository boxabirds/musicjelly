// The keyboard drawn: the piano's own keys (rounded white blocks, black keys that narrow to the top and lean back at
// the front, from greatpianoteachers src/main.js), a rail behind them and the block they rest on. Positions and sizes
// come from src/keyboard.mjs; this file only makes meshes and moves them. All 88 keys are made at once; a key shows
// when the drawn width (which follows the keyboard's range, opening out over SPREAD_S) has reached it.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { KEY, MIDI_LOW, MIDI_HIGH, MIDI_SLOTS } from './keyboard.mjs';

const WHITE_ROUND = 0.0012, BLACK_ROUND = 0.0020, KEY_ROUND_STEPS = 4;      // metres before scaling
const BLACK_TOP_NARROWS = 0.74, BLACK_FRONT_LEANS = 0.009;                  // width of the top as a share of the base; how far the top of the front sits back (m)
const IVORY = { color: 0xf2f0ec, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.25 };
const EBONY = { color: 0x040404, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 };
const LACQUER = { color: 0x0b0b0d, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 };
// A key that is down glows: it takes a light's colour as it goes down and shines as brightly as it was struck.
// `plain`: any key. `named`: a key whose letter the learner has met (its jelly has landed).
// `kept`: a key the learner found stays this share of the way to green after it comes up, with this much glow.
const LIGHT = { plain: 0xff8a1e, named: 0x2fd35a, least: 0.18, curve: 1.3, glow: 1.6, kept: 0.85, keptGlow: 0.25 };
export const SPREAD_S = 1.6;                                               // the time the keyboard takes to open out to a wider range
const smooth = u => u * u * (3 - 2 * u), KEY_SHOWS_WITHIN = 1e-4;
const RAIL_ROUND = 0.004, BED_ROUND = 0.002, ROUND_STEPS = 3;
const clamp01 = v => Math.max(0, Math.min(1, v)), lerp = (a, b, t) => a + (b - a) * t;

export function buildKeys(scene, kb) {
  const s = kb.scale, group = new THREE.Group(); scene.add(group);
  const white = [(KEY.pitch - KEY.gap) * s, KEY.whiteHigh * s, KEY.whiteLong * s], black = [KEY.blackWide * s, KEY.blackHigh * s, KEY.blackLong * s];
  // each key turns about its back end, so its shape starts at z = 0 there
  const whiteGeo = new RoundedBoxGeometry(...white, KEY_ROUND_STEPS, WHITE_ROUND * s); whiteGeo.translate(0, 0, white[2] / 2);
  const blackGeo = new RoundedBoxGeometry(...black, KEY_ROUND_STEPS, BLACK_ROUND * s); blackGeo.translate(0, 0, black[2] / 2);
  {
    const p = blackGeo.attributes.position, n = blackGeo.attributes.normal, h = black[1], leans = BLACK_FRONT_LEANS * s, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), up = clamp01(p.getY(i) / h + 0.5), front = p.getZ(i) > black[2] / 2 ? 1 : 0;      // every vertex of a rounded block lies near one end
      const wide = lerp(1, BLACK_TOP_NARROWS, up), lean = leans * front / h, slant = x * (BLACK_TOP_NARROWS - 1) / h;
      p.setX(i, x * wide); p.setZ(i, p.getZ(i) - leans * up * front);
      v.set(n.getX(i) / wide, n.getY(i) - slant / wide * n.getX(i) + lean * n.getZ(i), n.getZ(i)).normalize(); n.setXYZ(i, v.x, v.y, v.z);
    }
  }
  const plain = new THREE.Color(LIGHT.plain), named = new THREE.Color(LIGHT.named), meshes = new Array(MIDI_SLOTS).fill(null), base = [], force = new Float32Array(MIDI_SLOTS), isNamed = new Uint8Array(MIDI_SLOTS), kept = new Uint8Array(MIDI_SLOTS);
  for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) {
    const k = kb.keys[m], mat = new THREE.MeshPhysicalMaterial(k.black ? EBONY : IVORY), mesh = new THREE.Mesh(k.black ? blackGeo : whiteGeo, mat);
    mesh.castShadow = true; mesh.receiveShadow = !k.black;
    // a white key's block lies wholly below its top; a black key's bottom is sunk among the white keys
    mesh.position.set(k.x, k.top - (k.black ? black[1] : white[1]) / 2, k.black ? k.z0 : kb.back);
    group.add(mesh); meshes[m] = mesh; base[m] = mat.color.clone();
  }
  // the rail and the bed are made one unit wide and stretched to the width drawn
  const lacquer = new THREE.MeshPhysicalMaterial(LACQUER), r = kb.rail;
  const rail = new THREE.Mesh(new RoundedBoxGeometry(1, r.top - kb.tableY, r.z1 - r.z0, ROUND_STEPS, RAIL_ROUND * s), lacquer);
  rail.position.set(0, (r.top + kb.tableY) / 2, (r.z0 + r.z1) / 2); rail.castShadow = rail.receiveShadow = true; group.add(rail);
  const bedTop = -KEY.whiteHigh * s, bed = new THREE.Mesh(new RoundedBoxGeometry(1, bedTop - kb.tableY, kb.front - r.z1, ROUND_STEPS, BED_ROUND * s), lacquer);
  bed.position.set(0, (bedTop + kb.tableY) / 2, (kb.front + r.z1) / 2); bed.castShadow = bed.receiveShadow = true; group.add(bed);
  // the width drawn: where it was when the range last changed, and how far along it is to the keyboard's width now
  const drawn = { left: kb.left, right: kb.right, fromLeft: kb.left, fromRight: kb.right, toLeft: kb.left, toRight: kb.right, u: 1 };
  return {
    group, meshes, drawn,
    // how hard (0..1) a key was last struck (sets how brightly it glows while down), and whether its letter is known
    strike(midi, vel, known) { force[midi] = vel; isNamed[midi] = known ? 1 : 0; },
    // which keys stay green: the ones the learner has found (a list of MIDI numbers; replaces the last list)
    keep(list) { kept.fill(0); for (const m of list) if (m !== null) kept[m] = 1; },
    kept: () => Array.from(kept).map((v, m) => (v ? m : -1)).filter(m => m >= 0),
    // draw the keys where the keyboard says they are; dt: seconds since the last call
    update(dt) {
      if (drawn.toLeft !== kb.left || drawn.toRight !== kb.right) { drawn.fromLeft = drawn.left; drawn.fromRight = drawn.right; drawn.toLeft = kb.left; drawn.toRight = kb.right; drawn.u = 0; }
      if (drawn.u < 1) { drawn.u = Math.min(1, drawn.u + dt / SPREAD_S); const e = smooth(drawn.u); drawn.left = lerp(drawn.fromLeft, drawn.toLeft, e); drawn.right = lerp(drawn.fromRight, drawn.toRight, e); }
      const wide = drawn.right - drawn.left, mid = (drawn.left + drawn.right) / 2;
      rail.scale.x = bed.scale.x = wide; rail.position.x = bed.position.x = mid;
      for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) {
        const mesh = meshes[m], k = kb.keys[m], d = kb.down[m], mat = mesh.material, v = d * (LIGHT.least + (1 - LIGHT.least) * force[m] ** LIGHT.curve), colour = isNamed[m] ? named : plain;
        mesh.visible = k.x0 >= drawn.left - KEY_SHOWS_WITHIN && k.x1 <= drawn.right + KEY_SHOWS_WITHIN;
        mesh.rotation.x = d * KEY.swing;
        const stay = kept[m] ? LIGHT.kept : 0, tint = kept[m] ? named : colour;
        mat.color.copy(base[m]).lerp(tint, Math.max(d, stay)); mat.emissive.copy(tint); mat.emissiveIntensity = Math.max(LIGHT.glow * v, kept[m] ? LIGHT.keptGlow : 0);
      }
    },
  };
}
