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
import { openMic } from './mic.mjs';

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
// Repeat after me: the hand's notes are held for this share of a beat and struck this hard; the learner's turn is
// called a beat after its last note, and the hand's next turn begins this many beats after the learner's last key.
const DEMO = { held: 0.8, force: 0.55, beatsBefore: 2 };
// Game view: the whole length of the keys and the rail, with room above the rail for the letters sitting on it.
const GAME_VIEW = { downDeg: 50, head: 1.3 };
const ALREADY = { from: 0.4, everyS: 0.05 };              // letters a lesson begins with: they drop this many sizes onto their keys, this far apart in time
const PLINTH = { dropFrom: 0.5, everyS: 0.12 };            // a letter pops up this many sizes above the rail and lands on it, one after another
const ORBIT = { perPixel: 0.006, leastDeg: 12, mostDeg: 86, closest: 0.3, farthest: 2.2, wheel: 0.0012, tapWithinPx: 6, tapWithinMs: 350 };                                 // between one letter and the next when several fall

const fontJson = await fetch('fonts/titan-notes.json').then(r => r.json()); setFont(fontJson);
const sound = createSound(); setSound(sound);
// keys wide enough for the widest letter with room between neighbours
const kb = createKeyboard((widestLetter(LETTERS) + LETTER_GAP * LETTER_SIZE) / KEY.pitch, LETTER_SIZE * FEET_REACH);
const size = LETTER_SIZE;
// where a jelly may go, for keys from `left` to `right`: the table beside them and in front
const boundsFor = (left, right) => ({ x0: left - VIEW.sideRoom * size, x1: right + VIEW.sideRoom * size, z0: kb.rail.z0 - VIEW.sideRoom * size, z1: kb.front + VIEW.frontRoom * size });      // behind the rail too: letters sit on it in the game
const whole = boundsFor(kb.keys[MIDI_LOW].x0, kb.keys[MIDI_HIGH].x1), oneOctave = boundsFor(kb.left, kb.right);
let keys = null;                                           // the drawn keys (made once the world's scene exists)
let hand = null;                                           // the right hand (made the first time it is needed)
// the picture, eased from one framing to the next: how far towards the player it reaches (z), how high above the keys
// it must show at the home line (top), and the angle it looks down at (deg)
const frontOf = () => kb.front + VIEW.frontRoom * size, PLAIN = () => ({ z: frontOf(), top: 0, deg: VIEW.downDeg, sky: 0, rake: 0, whole: 0 });      // sky: set once the world's light exists
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
  // front.now.whole (0..1): how far the picture has opened from the keys' front part to their whole length and the rail
  const mix = (a, b) => a + (b - a) * (all ? 1 : front.now.whole);
  const farZ = mix(kb.front - VIEW.keysShown * (kb.front - kb.back), kb.rail.z0), farY = mix(KEY.blackTop * kb.scale, kb.rail.top + front.now.top);
  const farEdge = [span.left, span.right].flatMap(x => [new THREE.Vector3(x, farY, farZ), new THREE.Vector3(x, front.now.top * (1 - front.now.whole), 0)]);
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
const addLetter = (letter, midi, after = 0, from) => { const b = world.addLetter(letter, LETTER_COLOUR[letter], kb.homeX(midi), midi, after, from); b.lid = lid; return b; };
const inOctave = letter => keysNamed(letter).find(m => m >= kb.lo && m <= kb.hi);      // a letter's key in the octave shown
let fresh = 0;                                             // goes up each time a lesson begins afresh, so things still waiting to happen from before do not
// the keys the learner has found stay green: each found key, as it is shown now
const showFound = () => keys.keep([...flow.state.found].map(m => kb.shown(m)));
// the game's letters in the panel, in their jellies' colours: found ones ticked off, the one to find now marked
function showOrder(letters, at) {
  orderEl.replaceChildren(...letters.map((L, i) => { const el = document.createElement('span'); el.textContent = L; el.style.setProperty('--c', LETTER_COLOUR[L]); el.dataset.is = i < at ? 'found' : i === at ? 'now' : 'later'; return el; }));
  orderEl.hidden = !letters.length;
}
// the side list and the trail along the top: which lesson, which step
const sideEl = $('#lessons'), crumbLesson = $('#crumbLesson'), crumbStep = $('#crumbStep');
flow.lessons.forEach((L, n) => {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.n = n; b.innerHTML = `<span class="num">${n + 1}</span><span class="name"></span>`; b.querySelector('.name').textContent = L.name;
  b.addEventListener('click', () => { b.blur(); pick(n); }); sideEl.append(b);
});
// each lesson in the list is marked now, now-done, done or todo
function showPlace(fx) {
  [...sideEl.children].forEach((b, n) => { b.dataset.is = (n === fx.lesson ? 'now' : '') + (fx.finished.includes(n) ? (n === fx.lesson ? '-done' : 'done') : n === fx.lesson ? '' : 'todo'); if (n === fx.lesson) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  crumbLesson.textContent = `${fx.lesson + 1}. ${flow.lessons[fx.lesson].name}`; crumbStep.textContent = `${fx.step} of ${fx.steps}`;
}
// begin a lesson afresh: picked from the side, or tried again
function pick(n) { if (!ready()) return; sound.start(); carryOut(flow.jump(n)); }
$('#retry').addEventListener('click', e => { e.currentTarget.blur(); pick(flow.lesson()); });
// everything back as it is before any lesson: one octave, no letters, no hand, the first picture
function clearAll() {
  fresh++; demo.on = false;
  for (const [m] of midi.down) sound.noteOff(m); midi.down.clear(); for (const n of demo.notes) if (n.state === 1) sound.noteOff(n.midi); demo.notes = [];
  kb.letGo(); kb.setSupports([]); kb.setRange(...FIRST_OCTAVE); world.bounds = oneOctave; keys.keep([]);
  for (const b of [...world.bodies]) world.removeLetter(b);
  if (hand) hand.hide(); world.pushers = null;
  orbit.az = orbit.tilt = 0; orbit.zoom = 1; orbit.free = false; orbit.dirty = true; heli.u = 1;
  frameTo({ ...PLAIN(), sky: SKY_LIGHT_PLAIN }); showOrder([], 0);
}
function carryOut(effects) {
  let wait = 0;                                            // seconds before letters fall: the keyboard closes or opens first
  for (const fx of effects) {
    if (fx.type === 'place') showPlace(fx);
    // a lesson begins afresh: clear everything, then put the letters it begins with on their keys (and the hand down)
    else if (fx.type === 'reset') {
      clearAll(); fx.letters.forEach((L, i) => addLetter(L, inOctave(L), ALREADY.everyS * i, ALREADY.from));
      if (fx.hand) showHand(fx.hand, false);
    }
    else if (fx.type === 'panel') { textEl.textContent = fx.panel.text; panelEl.dataset.next = fx.panel.next; panelEl.dataset.id = fx.panel.id; showFound(); }
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
    // the letters go and sit on the rail, each behind its key: the ledges go, the picture opens to show the rail
    else if (fx.type === 'plinth') {
      kb.setSupports([]); const z = (kb.rail.z0 + kb.rail.z1) / 2;
      const now = fresh; [...world.bodies].sort((a, b) => a.key - b.key).forEach((b, i) => setTimeout(() => { if (now !== fresh) return; b.homeZ = z; b.cx = b.homeX; b.place(PLINTH.dropFrom * size, 0); sound.boing(480, .3, .1); }, 1000 * PLINTH.everyS * i));
      frameTo({ ...front.to, deg: GAME_VIEW.downDeg, top: GAME_VIEW.head * size, whole: 1 });
    }
    else if (fx.type === 'say') textEl.textContent = fx.text;
    // the hand plays: one letter a beat
    else if (fx.type === 'demo') { const beat = 60 / fx.bpm; demo.notes = fx.letters.map((L, i) => ({ midi: keysNamed(L).find(m => m >= kb.lo && m <= kb.hi), on: (DEMO.beatsBefore + i) * beat, off: (DEMO.beatsBefore + i + DEMO.held) * beat, state: 0 })); demo.t = 0; demo.end = (DEMO.beatsBefore + fx.letters.length) * beat; demo.on = true; }
    else if (fx.type === 'hint') keys.hint(keysNamed(fx.letter).find(m => m >= kb.lo && m <= kb.hi));
    else if (fx.type === 'finished') { world.hopAll(); sound.ding(); }
  }
}
// the hand's own playing: notes on a clock that runs with the picture, so it stops when the page is hidden
const demo = { on: false, t: 0, end: 0, notes: [] };
function playDemo(dt) {
  if (!demo.on) return; demo.t += dt;
  for (const n of demo.notes) {
    if (n.state === 0 && demo.t >= n.on) { n.state = 1; kb.press(n.midi); keys.strike(n.midi, DEMO.force, 'plain'); sound.noteOn(n.midi, DEMO.force); const b = world.onKey(n.midi); if (b) b.jolt(); }
    if (n.state === 1 && demo.t >= n.off) { n.state = 2; kb.release(n.midi); sound.noteOff(n.midi); }
  }
  if (demo.t >= demo.end) { demo.on = false; carryOut(flow.demoDone()); }
}
// fly: whether the camera flies round it as it lands (not when a lesson simply begins with the hand there)
async function showHand(letters, fly = true) {
  const now = fresh;
  const on = letters.map(L => keysNamed(L).find(m => m >= kb.lo && m <= kb.hi));
  hand ??= await buildHand3d(world.scene, kb, on);
  if (now !== fresh) return;                               // another lesson was picked while the hand was being made
  hand.show(); world.pushers = hand.pushers;
  frameTo({ z: Math.max(frontOf(), hand.wristZ + HAND_VIEW.room * size), top: hand.top + HAND_VIEW.head * size, deg: HAND_VIEW.downDeg, sky: HAND_LIGHT.sky, rake: HAND_LIGHT.rake, whole: 0 });
  rake.target.position.copy(hand.centre); orbit.pivot.copy(hand.centre); orbit.az = orbit.tilt = 0; orbit.zoom = 1; orbit.free = true; heli.u = fly ? 0 : 1; heli.wait = HELI.afterS;
}
// ---------- the learner's keyboard: the first MIDI keyboard found. Without one the lesson waits behind a notice.
const midi = { names: [], status: '', down: new Map(), found: 'asking' };      // down: the key shown for each key held
// Or the microphone: the learner's own instrument is heard instead (src/mic.mjs). Then the page does not sound the
// learner's notes (the instrument does), and it keeps its own sound out of its ears: the jellies' squeaks and boings
// are off (they come at any moment, and going deaf for each one lost the learner's notes), and while the hand plays,
// and for DEAF.afterDemoS after, it does not listen.
const DEAF = { afterDemoS: 0.45 }, NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const mic = { on: false, it: null, status: '', deafUntil: 0, last: '' }, micBtn = $('#micBtn'), inputEl = $('#inputInfo');
const ready = () => midi.found === 'yes' || mic.on;
const showInput = () => { document.body.dataset.keyboard = ready() ? 'yes' : midi.found; document.body.dataset.mic = mic.on ? 'on' : 'off'; micBtn.textContent = mic.on ? 'Stop the microphone' : 'Use the microphone'; inputEl.textContent = mic.on ? mic.status + (mic.last ? ' · ' + mic.last : '') : mic.status || midi.status; };
async function toggleMic() {
  if (mic.on) { for (const e of mic.it.stop()) heard(e); mic.on = false; mic.it = null; mic.status = ''; mic.last = ''; sound.hush(false); showInput(); return; }
  sound.start(); const got = await openMic(sound.context()); mic.status = got.status;
  if (got.ok) { mic.it = got.mic; mic.on = true; sound.hush(true); }
  showInput();
}
micBtn.addEventListener('click', e => { e.currentTarget.blur(); toggleMic(); }); $('#noticeMic').addEventListener('click', toggleMic);
function listen() {
  if (!mic.on) return; const now = sound.context().currentTime;
  if (demo.on) mic.deafUntil = now + DEAF.afterDemoS;
  const deaf = now < mic.deafUntil;
  for (const e of mic.it.hear(deaf)) { if (e.type === 'on') { mic.last = NOTE_NAMES[e.midi % 12] + (Math.floor(e.midi / 12) - 1); inputEl.textContent = mic.status + ' · ' + mic.last; } heard(e, true); }
}
function tap() { if (!ready()) return; sound.start(); carryOut(flow.tap()); }
panelEl.addEventListener('click', tap);
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); tap(); } });
// byEar: the note came through the microphone, so the learner's own instrument has already sounded it
function heard(d, byEar = false) {
  if (d.type === 'on') {
    if (midi.down.has(d.midi) || flow.muted(d.midi)) return;
    const shown = kb.shown(d.midi); midi.down.set(d.midi, shown);
    if (shown !== null) { kb.press(shown); keys.strike(shown, d.vel, flow.judge(d.midi)); }
    if (!byEar) sound.noteOn(d.midi, d.vel);
    carryOut(flow.key(d.midi));
  } else if (d.type === 'off') {
    if (!midi.down.has(d.midi)) return;
    const shown = midi.down.get(d.midi); midi.down.delete(d.midi);
    if (shown !== null) kb.release(shown);
    sound.noteOff(d.midi);
  } else if (d.type === 'pedal') sound.pedal(d.down);
}
openMidi({ first: true, onEvent: d => heard(d), onDevices: (names, status) => { midi.names = names; midi.status = status; midi.found = names.length ? 'yes' : 'no'; showInput(); } });

// ---------- every frame
let last = performance.now();
function frame(now) {
  const dt = Math.min(MAX_FRAME_S, (now - last) / 1000); last = now;
  if (!document.hidden) {
    const opening = keys.drawn.u < 1; keys.update(dt);
    if (front.u < 1) { front.u = Math.min(1, front.u + dt / HAND_VIEW.easeS); const e = front.u * front.u * (3 - 2 * front.u); for (const k in front.now) front.now[k] = front.from[k] + (front.to[k] - front.from[k]) * e; }
    playDemo(dt); listen();
    world.sky.intensity = front.now.sky; rake.intensity = front.now.rake;
    // the helicopter: once round, lower at the sides, and back where it began
    if (heli.u < 1) {
      if (heli.wait > 0) heli.wait -= dt; else { heli.u = Math.min(1, heli.u + dt / HELI.seconds); const e = heli.u * heli.u * (3 - 2 * heli.u); orbit.az = heli.u < 1 ? 2 * Math.PI * e : 0; orbit.tilt = Math.sin(Math.PI * heli.u) ** 2 * HELI.lowerDeg * Math.PI / 180; orbit.dirty = true; }
    }
    if (opening || front.u < 1 || front.moved || orbit.dirty) world.reframe();      // the picture follows the keys as they open out, makes room for the hand, and flies
    front.moved = front.u < 1; orbit.dirty = false;
    // the hand: once it has landed, a ledge over each finger for its letter, and the letters there are woken to find it
    if (hand && hand.update(dt) && flow.panel().hand) { kb.setSupports(hand.ledges()); for (const b of world.bodies) b.wake(); }
    world.tick(dt);
  }
  requestAnimationFrame(frame);
}
carryOut(flow.start());
requestAnimationFrame(frame);

// for the tests and for trying things from the console: what a keyboard would send, and what the page is doing
window.__mj = {
  midi: bytes => heard(decode(bytes)), tap, pick, flow, world, kb, keys, sound, keyboard: midi,
  // where the letter on a key is in the window, in CSS pixels (to drag it as a finger would), and how tall it is drawn
  screen: key => {
    const b = world.onKey(key), r = world.canvas.getBoundingClientRect(), c = b.center(), px = v => { const p = v.project(world.camera); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
    const mid = px(new THREE.Vector3(...c)), top = px(new THREE.Vector3(c[0], c[1] + b.height / 2, c[2])), foot = px(new THREE.Vector3(c[0], c[1] - b.height / 2, c[2]));
    return { ...mid, tall: foot.y - top.y };
  },
  state: () => ({
    lesson: flow.lesson(), side: [...sideEl.children].map(b => [b.textContent, b.dataset.is]), trail: [crumbLesson.textContent, crumbStep.textContent],
    panel: flow.panel().id, text: textEl.textContent, next: panelEl.dataset.next, found: [...flow.state.found], misses: flow.state.misses, done: flow.state.done,
    order: [...orderEl.children].map(el => [el.textContent, el.dataset.is]), orderSeen: !orderEl.hidden, kept: keys.kept(), colours: world.bodies.map(b => [b.letter, '#' + b.mesh.material.attenuationColor.getHexString()]),
    hand: hand ? { shown: hand.state.shown, landed: hand.state.landed, miss: hand.miss(), tipY: hand.tipY(), numbers: hand.numbers(), balls: hand.pushers.n, ledges: kb.supports.map(b => [b.key, +b.top.toFixed(4)]), y: hand.group.position.y } : null,
    viewDeg: front.now.deg, repeat: { round: flow.state.round, turn: flow.state.turn, at: flow.state.at, wrongs: flow.state.wrongs, playing: demo.on }, hinting: keys.hinting(), orbit: { az: orbit.az, tilt: orbit.tilt, zoom: orbit.zoom, free: orbit.free, flying: heli.u < 1 }, cameraAt: world.camera.position.toArray(),
    range: [kb.lo, kb.hi], keysDown: Array.from(kb.down).map((v, m) => (v > 0 ? [m, v] : null)).filter(Boolean), keysSeen: keys.meshes.filter(m => m && m.visible).length, opening: keys.drawn.u < 1,
    lit: keys.meshes.map((m, i) => (m && kb.down[i] > 0 ? [i, m.material.emissive.getHex()] : null)).filter(Boolean),
    mic: { on: mic.on, status: mic.status, last: mic.last, settings: mic.it ? mic.it.settings : null, deaf: mic.on ? sound.context().currentTime < mic.deafUntil : null }, pianoNotes: sound.state.notes, inputShown: inputEl.textContent,
    keyboard: midi.status, keyboardFound: midi.found, notice: getComputedStyle($('#notice')).display !== 'none' ? $('#notice > div').textContent.trim() : null,
    squeaks: sound.state.squeaks, soundReady: sound.state.ready, soundLayers: sound.state.layersLoaded, soundError: sound.state.error,
    letters: world.bodies.map(b => { const c = b.center(); return { letter: b.letter, key: b.key, x: c[0], y: c[1], z: c[2], homeX: b.homeX, here: world.t >= b.spawnAt, lid: b.lidNow, lidWanted: b.lid, startled: world.t < b.startledUntil, fallen: b.isFallen(), asleepPhysics: b.sleeping, grounded: !!b.grounded, riding: !!b.riding }; }),
  }),
};
window.__ready = true;
