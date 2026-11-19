// Music Jelly: the page. Builds the keyboard and the jelly world, listens to the learner's keyboard, and carries out
// what the lesson (src/flow.mjs) says should happen.
import * as THREE from 'three';
import { createKeyboard, KEY, LETTERS, MIDI_LOW, MIDI_HIGH, FIRST_OCTAVE, keysNamed } from './keyboard.mjs';
import { buildKeys, SPREAD_S } from './keys3d.mjs';
import { JellyWorld, setFont, setSound, widestLetter, LETTER_SIZE, LETTER_GAP } from './jelly.mjs';
import { createFlow } from './flow.mjs';
import { createSound } from './sound.mjs';
import { openMidi, decode } from './midi-in.mjs';
import { buildHand3d } from './hand3d.mjs';

const $ = s => document.querySelector(s), UP = new THREE.Vector3(0, 1, 0);
const SKY = '#d4eeff', TABLE = '#bfe3ff';
// The view: the camera looks down at this angle at the keys, as close as it can be with what must be seen inside the
// picture. Room is kept at the sides and in front for a letter that is dragged or falls off.
const Q = new URLSearchParams(location.search), DOWN_DEG = 35;      // the owner chose 35 over 45 (19 Nov 2026)
const KEYS_SHOWN = 0.6;                                    // the least share of the keys' length in the picture, from the front: the black keys' front halves and their groups of two and three
const VIEW = { downDeg: +Q.get('down') || DOWN_DEG, keysShown: +Q.get('keys') || KEYS_SHOWN, sideRoom: 1.1, frontRoom: 1.3, fitSteps: 30, farthest: 40 };      // rooms in letter sizes
// every letter its own colour: Unix Jelly's six, and a teal for the seventh
const LETTER_COLOUR = { C: '#ff4d6d', D: '#62c934', E: '#3a5bff', F: '#ffc61a', G: '#ff8a2b', A: '#9b5cff', B: '#12b5c9' };
const MAX_FRAME_S = 0.05, FEET_REACH = 0.5;                // FEET_REACH: how far behind the home line a letter's feet can be, in letter sizes (it is about half a size deep)
// when the keyboard opens out: new letters start to fall once it has, one after another from the lowest
const MULTIPLY = { afterS: SPREAD_S, everyS: 0.14 };
const DROP_EVERY_S = 0.35;
// With the hand there the camera looks down more steeply (from the first angle the back of the hand hides its own
// fingers, the keys and the letters), and the picture reaches `room` letter sizes in front of the wrist and `head` above
// the ledges the letters stand on. easeS: the time the picture takes to change.
const HAND_VIEW = { downDeg: 62, room: 0.3, head: 1.3, easeS: SPREAD_S };
// Light for the hand: the even light from the sky is turned down and a lamp rakes across from the left and a little
// behind, low, so knuckles, fingers and the hollow of the thumb throw shade on the hand itself.
const HAND_LIGHT = { sky: 0.45, rake: 2.4, rakeColour: '#fff1e0', rakeFrom: [-1.6, 0.9, -0.5] };
// The helicopter: as the hand lands the camera flies once round it, dipping to `lowerDeg` less steep at the sides so the
// hand's arch is seen from the side, and comes back. Then the learner may fly it: drag on empty space to circle and
// tilt, wheel or pinch to come closer. ORBIT: radians a pixel, the angles it may look down at, how close and far.
const HELI = { seconds: 9, lowerDeg: 30, afterS: 0.6 };
const ORBIT = { perPixel: 0.006, leastDeg: 12, mostDeg: 86, closest: 0.3, farthest: 2.2, wheel: 0.0012, tapWithinPx: 6, tapWithinMs: 350 };                                 // between one letter and the next when several fall

const fontJson = await fetch('fonts/titan-notes.json').then(r => r.json()); setFont(fontJson);
const sound = createSound(); setSound(sound);
// keys wide enough for the widest letter with room between neighbours
const kb = createKeyboard((widestLetter(LETTERS) + LETTER_GAP * LETTER_SIZE) / KEY.pitch, LETTER_SIZE * FEET_REACH);
const size = LETTER_SIZE;
// where a jelly may go, for keys from `left` to `right`: the table beside them and in front
const boundsFor = (left, right) => ({ x0: left - VIEW.sideRoom * size, x1: right + VIEW.sideRoom * size, z0: kb.rail.z1, z1: kb.front + VIEW.frontRoom * size });
const whole = boundsFor(kb.keys[MIDI_LOW].x0, kb.keys[MIDI_HIGH].x1), oneOctave = boundsFor(kb.left, kb.right);
let keys = null;                                           // the drawn keys (made once the world's scene exists)
let hand = null;                                           // the right hand (made the first time it is needed)
// the picture, eased from one framing to the next: how far towards the player it reaches (z), how high above the keys
// it must show at the home line (top), and the angle it looks down at (deg)
const frontOf = () => kb.front + VIEW.frontRoom * size, PLAIN = () => ({ z: frontOf(), top: 0, deg: VIEW.downDeg, sky: 0, rake: 0 });      // sky: set once the world's light exists
const front = { now: PLAIN(), from: PLAIN(), to: PLAIN(), u: 1 };
const frameTo = to => { front.from = { ...front.now }; front.to = to; front.u = 0; };
// the camera flown about a point: az (radians round it), tilt (radians less steep), zoom (1: as framed), by the
// helicopter (heli.u 0..1, 1: not flying) and then by the learner (free: allowed to)
const orbit = { az: 0, tilt: 0, zoom: 1, pivot: new THREE.Vector3(), free: false, dirty: false }, heli = { u: 1, wait: 0 };

// Place the camera for the keys drawn now (their width opens out when the keyboard does): as close as it can be with
// the table's front edge at the bottom of the picture, the table beside the keys inside its sides, and the keys in
// view from their front edge back at least as far as VIEW.keysShown of their length (1: all of them and the rail).
// One octave is as deep as it is wide, so its length decides the size; all 88 keys are wide, so their width does.
function view(camera, aspect) {
  const span = keys ? keys.drawn : kb, B = boundsFor(span.left, span.right);
  const a = front.now.deg * Math.PI / 180, dir = new THREE.Vector3(0, Math.sin(a), Math.cos(a)), p = new THREE.Vector3(), mid = (span.left + span.right) / 2, at = new THREE.Vector3();
  const frontEdge = [B.x0, B.x1].map(x => new THREE.Vector3(x, kb.tableY, front.now.z)), all = VIEW.keysShown >= 1;
  const farZ = all ? kb.rail.z0 : kb.front - VIEW.keysShown * (kb.front - kb.back), farY = all ? kb.rail.top : KEY.blackTop * kb.scale;
  const farEdge = [span.left, span.right].flatMap(x => [new THREE.Vector3(x, farY, farZ), new THREE.Vector3(x, front.now.top, 0)]);
  camera.aspect = aspect;
  const aim = d => { camera.position.copy(at).addScaledVector(dir, d); camera.lookAt(at); camera.updateProjectionMatrix(); camera.updateMatrixWorld(); };
  const seen = d => { aim(d); return frontEdge.every(m => Math.abs(p.copy(m).project(camera).x) <= 1) && farEdge.every(m => { p.copy(m).project(camera); return Math.abs(p.x) <= 1 && p.y <= 1; }); };
  const nearest = () => { let near = 0, far = VIEW.farthest; for (let i = 0; i < VIEW.fitSteps; i++) { const m = (near + far) / 2; if (seen(m)) far = m; else near = m; } return far; };
  // slide the aim back and forth until the table's front edge is at the bottom, finding the distance anew each time
  let back = farZ, fwd = front.now.z, d = 0;
  for (let i = 0; i < VIEW.fitSteps; i++) {
    at.set(mid, 0, (back + fwd) / 2); d = nearest(); aim(d);
    // edge below the picture: aim nearer the player
    if (p.copy(frontEdge[0]).project(camera).y < -1) back = at.z; else fwd = at.z;
  }
  aim(d);
  if (!orbit.az && !orbit.tilt && orbit.zoom === 1) return;
  // flown: the same picture turned about the pivot
  const off = new THREE.Spherical().setFromVector3(p.copy(camera.position).sub(orbit.pivot)), rad = Math.PI / 180;
  off.theta += orbit.az; off.phi = Math.min(Math.PI / 2 - ORBIT.leastDeg * rad, Math.max(Math.PI / 2 - ORBIT.mostDeg * rad, off.phi + orbit.tilt)); off.radius *= orbit.zoom;
  camera.position.setFromSpherical(off).add(orbit.pivot);
  camera.lookAt(p.copy(at).sub(orbit.pivot).applyAxisAngle(UP, orbit.az).multiplyScalar(orbit.zoom).add(orbit.pivot)); camera.updateMatrixWorld();
}

const world = new JellyWorld($('#stage'), { bg: SKY, floor: TABLE, terrain: kb, bounds: oneOctave, lit: whole, view, onStep: h => kb.step(h),
  onRide: (b, riding) => { kb.carrying[b.key] = riding ? 1 : 0; } });
keys = buildKeys(world.scene, kb);
const SKY_LIGHT_PLAIN = world.sky.intensity; front.now.sky = front.from.sky = front.to.sky = SKY_LIGHT_PLAIN;
const rake = new THREE.DirectionalLight(HAND_LIGHT.rakeColour, 0); rake.position.set(...HAND_LIGHT.rakeFrom); world.scene.add(rake, rake.target);
// a tap on empty space goes on, as a tap on the panel does; a drag there flies the camera when the learner may
{
  const cv = world.canvas; let held = null;
  cv.addEventListener('pointerdown', e => { if (!world.drag) held = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), far: false }; });
  cv.addEventListener('pointermove', e => {
    if (!held) return; if (Math.hypot(e.clientX - held.x0, e.clientY - held.y0) > ORBIT.tapWithinPx) held.far = true;
    if (orbit.free && held.far) { heli.u = 1; orbit.az -= (e.clientX - held.x) * ORBIT.perPixel; orbit.tilt -= (e.clientY - held.y) * ORBIT.perPixel; orbit.dirty = true; }
    held.x = e.clientX; held.y = e.clientY;
  });
  const up = () => { if (held && !held.far && performance.now() - held.t < ORBIT.tapWithinMs) tap(); held = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { held = null; });
  cv.addEventListener('wheel', e => { if (!orbit.free) return; e.preventDefault(); heli.u = 1; orbit.zoom = Math.min(ORBIT.farthest, Math.max(ORBIT.closest, orbit.zoom * Math.exp(e.deltaY * ORBIT.wheel))); orbit.dirty = true; }, { passive: false });
  cv.addEventListener('dblclick', () => { if (orbit.free && !world.drag) { orbit.az = orbit.tilt = 0; orbit.zoom = 1; orbit.dirty = true; } });      // back to the picture as framed
}

// ---------- the lesson
const flow = createFlow(), panelEl = $('#panel'), textEl = $('#panelText'), orderEl = $('#panelOrder');
let lid = 0;                                               // how far shut every letter's eyes should be
const addLetter = (letter, midi, after = 0) => { const b = world.addLetter(letter, LETTER_COLOUR[letter], kb.homeX(midi), midi, after); b.lid = lid; return b; };
// the keys the learner has found stay green: each found key, as it is shown now
const showFound = () => keys.keep([...flow.state.found].map(m => kb.shown(m)));
// the game's letters in the panel, in their jellies' colours: found ones ticked off, the one to find now marked
function showOrder(letters, at) {
  orderEl.replaceChildren(...letters.map((L, i) => { const el = document.createElement('span'); el.textContent = L; el.style.setProperty('--c', LETTER_COLOUR[L]); el.dataset.is = i < at ? 'found' : i === at ? 'now' : 'later'; return el; }));
  orderEl.hidden = !letters.length;
}
function carryOut(effects) {
  let wait = 0;                                            // seconds before letters fall: the keyboard closes or opens first
  for (const fx of effects) {
    if (fx.type === 'panel') { textEl.textContent = fx.panel.text; panelEl.dataset.next = fx.panel.next; panelEl.dataset.id = fx.panel.id; showFound(); }
    // letters first land on their keys in the octave shown
    else if (fx.type === 'drop') fx.letters.forEach((letter, i) => addLetter(letter, keysNamed(letter).find(m => m >= kb.lo && m <= kb.hi), wait + DROP_EVERY_S * i));
    // the keyboard opens out to all 88 keys, and each letter so far appears on every key of its name
    else if (fx.type === 'widen') {
      kb.setRange(MIDI_LOW, MIDI_HIGH); world.bounds = whole; showFound();
      let n = 0; for (const letter of fx.letters) for (const m of keysNamed(letter)) if (!world.onKey(m)) addLetter(letter, m, MULTIPLY.afterS + MULTIPLY.everyS * n++);
    }
    // and closes back to the one octave: the letters on keys that go, go with them
    else if (fx.type === 'narrow') {
      kb.setRange(...FIRST_OCTAVE); world.bounds = oneOctave; showFound(); wait = SPREAD_S;
      for (const b of [...world.bodies]) if (b.key < kb.lo || b.key > kb.hi) world.removeLetter(b);
    }
    else if (fx.type === 'squeak') { const b = world.onKey(kb.shown(fx.midi)); if (b && world.t >= b.spawnAt) b.jolt(); sound.squeak(); }
    else if (fx.type === 'lid') { lid = fx.lid; for (const b of world.bodies) b.lid = lid; }
    else if (fx.type === 'found') showFound();
    else if (fx.type === 'order') showOrder(fx.letters, fx.at);
    // the right hand comes down over the keys of these letters; when it has landed, a ledge over each finger
    else if (fx.type === 'hand') showHand(fx.letters);
    else if (fx.type === 'finished') { world.hopAll(); sound.ding(); }
  }
}
async function showHand(letters) {
  const on = letters.map(L => keysNamed(L).find(m => m >= kb.lo && m <= kb.hi));
  hand ??= await buildHand3d(world.scene, kb, on);
  hand.show(); world.pushers = hand.pushers;
  frameTo({ z: Math.max(frontOf(), hand.wristZ + HAND_VIEW.room * size), top: hand.top + HAND_VIEW.head * size, deg: HAND_VIEW.downDeg, sky: HAND_LIGHT.sky, rake: HAND_LIGHT.rake });
  rake.target.position.copy(hand.centre); orbit.pivot.copy(hand.centre); orbit.az = orbit.tilt = 0; orbit.zoom = 1; orbit.free = true; heli.u = 0; heli.wait = HELI.afterS;
}
// ---------- the learner's keyboard: the first MIDI keyboard found. Without one the lesson waits behind a notice.
const midi = { names: [], status: '', down: new Map(), found: 'asking' };      // down: the key shown for each key held
const ready = () => midi.found === 'yes';
function tap() { if (!ready()) return; sound.start(); carryOut(flow.tap()); }
panelEl.addEventListener('click', tap);
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); tap(); } });
function heard(d) {
  if (d.type === 'on') {
    if (midi.down.has(d.midi) || flow.muted(d.midi)) return;
    const shown = kb.shown(d.midi); midi.down.set(d.midi, shown);
    if (shown !== null) { kb.press(shown); keys.strike(shown, d.vel, flow.wants(d.midi)); }
    sound.noteOn(d.midi, d.vel); carryOut(flow.key(d.midi));
  } else if (d.type === 'off') {
    if (!midi.down.has(d.midi)) return;
    const shown = midi.down.get(d.midi); midi.down.delete(d.midi);
    if (shown !== null) kb.release(shown);
    sound.noteOff(d.midi);
  } else if (d.type === 'pedal') sound.pedal(d.down);
}
openMidi({ first: true, onEvent: heard, onDevices: (names, status) => { midi.names = names; midi.status = status; midi.found = names.length ? 'yes' : 'no'; document.body.dataset.keyboard = midi.found; } });

// ---------- every frame
let last = performance.now();
function frame(now) {
  const dt = Math.min(MAX_FRAME_S, (now - last) / 1000); last = now;
  if (!document.hidden) {
    const opening = keys.drawn.u < 1; keys.update(dt);
    if (front.u < 1) { front.u = Math.min(1, front.u + dt / HAND_VIEW.easeS); const e = front.u * front.u * (3 - 2 * front.u); for (const k in front.now) front.now[k] = front.from[k] + (front.to[k] - front.from[k]) * e; }
    world.sky.intensity = front.now.sky; rake.intensity = front.now.rake;
    // the helicopter: once round, lower at the sides, and back where it began
    if (heli.u < 1) {
      if (heli.wait > 0) heli.wait -= dt; else { heli.u = Math.min(1, heli.u + dt / HELI.seconds); const e = heli.u * heli.u * (3 - 2 * heli.u); orbit.az = heli.u < 1 ? 2 * Math.PI * e : 0; orbit.tilt = Math.sin(Math.PI * heli.u) ** 2 * HELI.lowerDeg * Math.PI / 180; orbit.dirty = true; }
    }
    if (opening || front.u < 1 || front.moved || orbit.dirty) world.reframe();      // the picture follows the keys as they open out, makes room for the hand, and flies
    front.moved = front.u < 1; orbit.dirty = false;
    // the hand: once it has landed, a ledge over each finger for its letter, and the letters there are woken to find it
    if (hand && hand.update(dt)) { kb.setSupports(hand.ledges()); for (const b of world.bodies) b.wake(); }
    world.tick(dt);
  }
  requestAnimationFrame(frame);
}
carryOut(flow.start());
requestAnimationFrame(frame);

// for the tests and for trying things from the console: what a keyboard would send, and what the page is doing
window.__mj = {
  midi: bytes => heard(decode(bytes)), tap, flow, world, kb, keys, sound, keyboard: midi,
  // where the letter on a key is in the window, in CSS pixels (to drag it as a finger would), and how tall it is drawn
  screen: key => {
    const b = world.onKey(key), r = world.canvas.getBoundingClientRect(), c = b.center(), px = v => { const p = v.project(world.camera); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
    const mid = px(new THREE.Vector3(...c)), top = px(new THREE.Vector3(c[0], c[1] + b.height / 2, c[2])), foot = px(new THREE.Vector3(c[0], c[1] - b.height / 2, c[2]));
    return { ...mid, tall: foot.y - top.y };
  },
  state: () => ({
    panel: flow.panel().id, text: textEl.textContent, next: panelEl.dataset.next, found: [...flow.state.found], misses: flow.state.misses, done: flow.state.done,
    order: [...orderEl.children].map(el => [el.textContent, el.dataset.is]), orderSeen: !orderEl.hidden, kept: keys.kept(), colours: world.bodies.map(b => [b.letter, '#' + b.mesh.material.attenuationColor.getHexString()]),
    hand: hand ? { shown: hand.state.shown, landed: hand.state.landed, miss: hand.miss(), tipY: hand.tipY(), balls: hand.pushers.n, ledges: kb.supports.map(b => [b.key, +b.top.toFixed(4)]), y: hand.group.position.y } : null,
    viewDeg: front.now.deg, orbit: { az: orbit.az, tilt: orbit.tilt, zoom: orbit.zoom, free: orbit.free, flying: heli.u < 1 }, cameraAt: world.camera.position.toArray(),
    range: [kb.lo, kb.hi], keysDown: Array.from(kb.down).map((v, m) => (v > 0 ? [m, v] : null)).filter(Boolean), keysSeen: keys.meshes.filter(m => m && m.visible).length, opening: keys.drawn.u < 1,
    lit: keys.meshes.map((m, i) => (m && kb.down[i] > 0 ? [i, m.material.emissive.getHex()] : null)).filter(Boolean),
    keyboard: midi.status, keyboardFound: midi.found, notice: getComputedStyle($('#notice')).display !== 'none' ? $('#notice').textContent.trim() : null,
    squeaks: sound.state.squeaks, soundReady: sound.state.ready, soundLayers: sound.state.layersLoaded, soundError: sound.state.error,
    letters: world.bodies.map(b => { const c = b.center(); return { letter: b.letter, key: b.key, x: c[0], y: c[1], z: c[2], homeX: b.homeX, here: world.t >= b.spawnAt, lid: b.lidNow, lidWanted: b.lid, startled: world.t < b.startledUntil, fallen: b.isFallen(), asleepPhysics: b.sleeping, grounded: !!b.grounded, riding: !!b.riding }; }),
  }),
};
window.__ready = true;
