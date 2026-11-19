// The whole first lesson in the real page, in headless Chrome, as a child with a MIDI keyboard would meet it:
//   node tools/page-test.mjs [--shots=/tmp/mj]     (no web server needed, but then no piano sound; see tools/page.mjs)
// A pretend MIDI keyboard is plugged in through the browser's own Web MIDI calls; taps and drags go through the mouse.
import { openPage } from './page.mjs'; import { checker } from './check.mjs';
const shots = (process.argv.find(a => a.startsWith('--shots=')) || '').slice(8);
const FIRST = 'First Keys', SECOND = 'Second Keys', WIDTH = 1280, HEIGHT = 720;
const T = checker('the first lesson in the page'), { browser, page, problems, state, served } = await openPage({ width: WIDTH, height: HEIGHT, keyboards: [] });
const NOTE_ON = 0x90, NOTE_OFF = 0x80, FORCE = 80, C2 = 36, C3 = 48, C4 = 60, C5 = 72, C7 = 96, D4 = 62, D5 = 74, E5 = 76, F_SHARP_2 = 42, A4 = 69, LOWEST = 21, HIGHEST = 108;
const ORANGE = 0xff8a1e, GREEN = 0x2fd35a, ALL_CS = [24, 36, 48, 60, 72, 84, 96, 108];
const NOTICE = 'Music Jelly requires a MIDI keyboard. Please connect one to this computer.';
const SIZE = 0.07, HOME_WITHIN = SIZE * 0.25, LAND_WITHIN_MS = 6000, HOLD_MS = 180, GAP_MS = 220, HOME_AGAIN_WITHIN_MS = 45000, OPEN_WITHIN_MS = 15000;
const wait = ms => page.waitForTimeout(ms), shot = name => (shots ? page.screenshot({ path: `${shots}-${name}.png` }) : null);
const fake = (what, ...args) => page.evaluate(([w, a]) => window.__fakeMidi[w](...a), [what, args]);
const send = (status, midi, force, from = FIRST) => fake('send', from, [status, midi, force]);
const play = async midi => { await send(NOTE_ON, midi, FORCE); await wait(HOLD_MS); await send(NOTE_OFF, midi, 0); await wait(GAP_MS); };
const on = async key => (await state()).letters.find(L => L.key === key);
const atHome = L => L && L.here && Math.abs(L.x - L.homeX) < HOME_WITHIN && Math.abs(L.z) < HOME_WITHIN && L.y > 0 && !L.fallen;
const until = async (test, ms, every = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await test()) return Date.now() - t0; await wait(every); } return -1; };
const downKeys = s => s.keysDown.filter(([, v]) => v === 1).map(([m]) => m).join(' '), litOf = (s, m) => (s.lit.find(([k]) => k === m) || [])[1];

// --- no keyboard: a notice, and the lesson waits
let s = await state();
T.ok(s.notice === NOTICE, 'with no MIDI keyboard the page says so, in the owner\'s words', String(s.notice));
await page.keyboard.press('Space'); T.ok((await state()).panel === 'octave', 'and the space bar does not start the lesson');
await shot('0-no-keyboard');
await fake('plug', FIRST); await wait(100); s = await state();
T.ok(s.notice === null && s.keyboard === 'MIDI: ' + FIRST, 'plugging one in takes the notice away, with nothing to choose', s.keyboard);
await fake('plug', SECOND); await wait(100); s = await state();
T.ok(s.keyboard === 'MIDI: ' + FIRST, 'a second keyboard does not replace the first found', s.keyboard);
const heardSecond = await send(NOTE_ON, D4, FORCE, SECOND); await wait(HOLD_MS);
T.ok(!heardSecond && (await state()).keysDown.length === 0, 'and its keys are not listened to');
// --- panel 1
s = await state();
T.ok(s.panel === 'octave' && s.text === 'Introducing the Octave' && s.next === 'tap' && s.letters.length === 0 && s.keysSeen === 12, 'it opens on "Introducing the Octave", twelve keys, waiting for a tap', `${s.text}; ${s.keysSeen} keys`);
await shot('1-octave');
await send(NOTE_ON, D5, FORCE); await wait(HOLD_MS); s = await state();
T.ok(downKeys(s) === String(D4), 'D in another octave goes down on the D shown, and only it', downKeys(s));
T.ok(litOf(s, D4) === ORANGE, 'lit orange');
await send(NOTE_OFF, D5, 0); await wait(GAP_MS); T.ok((await state()).keysDown.length === 0, 'and comes up when let go');
// --- panel 2: the C falls
await page.keyboard.press('Space'); s = await state();
T.ok(s.panel === 'first-letter' && s.text === 'The first letter is "C".' && s.letters.length === 1 && s.letters[0].key === C4, 'the space bar brings "The first letter is "C"." and a C for the C shown', s.text);
T.ok(s.letters[0].y > SIZE * 3, 'the C starts high above the keys', (s.letters[0].y / SIZE).toFixed(1) + ' letter heights up');
let lowest = Infinity, bounced = false; const landed = await until(async () => { const L = await on(C4); if (L.y < lowest) lowest = L.y; else if (L.y > lowest + 0.002) bounced = true; return L.asleepPhysics && atHome(L); }, LAND_WITHIN_MS, 30);
let L = await on(C4);
T.ok(landed >= 0, 'it comes to rest standing on the near end of the C key', landed >= 0 ? `after ${landed} ms, ${((L.x - L.homeX) * 1000).toFixed(1)} mm from the key's middle` : JSON.stringify(L));
T.ok(bounced, 'with a bounce: it rises again after it first lands');
const one = await page.evaluate(k => window.__mj.screen(k), C4);
await shot('2-landed');
// sound starts with that first tap: the piano must be ready and able to sound a note (only where the page is really served)
if (served) {
  const ready = await until(async () => (await state()).soundReady, 30000);
  T.ok(ready >= 0 && !(await state()).soundError, 'the piano is ready to sound after the first tap', (await state()).soundError || `${ready} ms`);
  await send(NOTE_ON, A4, FORCE); await wait(60); const voices = await page.evaluate(() => window.__mj.sound.voices()); await send(NOTE_OFF, A4, 0); await wait(GAP_MS);
  T.ok(voices >= 1, 'a pressed key sounds a note in the sampler', voices + ' sounding');
  const all = await until(async () => (await state()).soundLayers === 3, 60000);
  T.ok(all >= 0, 'all three loudness layers of the piano load', `${all} ms`);
} else console.log('  --    NOT RUN: the piano\'s sound (needs MJ_URL=<where the folder is served>)');
// --- panel 3: find C
await page.click('#panel'); s = await state();
T.ok(s.panel === 'find' && s.text === 'Try to find C on your musical keyboard, and press it.' && s.next === 'keys', 'a tap on the panel brings "Try to find C on your musical keyboard..."', s.text);
await page.keyboard.press('Space'); T.ok((await state()).panel === 'find', 'the space bar does not skip it');
for (const m of [D4, E5]) await play(m);
T.ok((await on(C4)).lidWanted === 0, 'two wrong keys: eyes still open');
for (const m of [F_SHARP_2, A4]) await play(m);
await wait(900); L = await on(C4);
T.ok(L.lid > 0.45 && L.lid < 0.75, 'four wrong keys: the eyes are more than half shut', L.lid.toFixed(2)); await shot('3-drowsy');
for (const m of [D4, E5]) await play(m);
await wait(1400); L = await on(C4);
T.ok(L.lid > 0.9, 'six wrong keys: asleep, eyes shut', L.lid.toFixed(2)); await shot('4-asleep');
T.ok(atHome(L), 'and still standing on its key');
// any C wakes it: here the C an octave above the one shown
const before = (await state()).squeaks, restY = L.y;
await send(NOTE_ON, C5, FORCE); let moved = 0, sawDown = false, sawStart = false, sawGreen = false;
for (let i = 0; i < 8; i++) { await wait(25); const q = await state(), c = q.letters.find(l => l.key === C4); moved = Math.max(moved, Math.abs(c.y - restY)); sawDown ||= q.keysDown.some(([m, v]) => m === C4 && v === 1); sawStart ||= c.startled; sawGreen ||= litOf(q, C4) === GREEN; }
await shot('5-c-pressed'); s = await state();
T.ok(sawDown, 'C in another octave takes the shown C key down');
T.ok(sawGreen, 'lit green, not orange');
T.ok(moved > 0.01, 'the jelly goes down with its key and is jolted', (moved * 1000).toFixed(1) + ' mm');
T.ok(s.squeaks === before + 1, 'it squeaks once');
T.ok(s.letters[0].lidWanted === 0 && sawStart, 'it wakes with a start');
T.ok(s.panel === 'more' && s.text === 'Well done! You found a C on your musical keyboard! There is more than one. Try finding a couple more.', 'and "Well done!..." comes', s.text);
await send(NOTE_OFF, C5, 0);
// --- panel 4: the keyboard opens out to 88 keys and the C multiplies
T.ok(s.range.join() === `${LOWEST},${HIGHEST}`, 'the keyboard is now the 88 keys', s.range.join(' to '));
const opened = await until(async () => { const q = await state(); return !q.opening && q.letters.length === ALL_CS.length && q.letters.every(l => atHome(l) && l.asleepPhysics); }, OPEN_WITHIN_MS);
s = await state();
T.ok(opened >= 0, 'it opens out, and a C comes to rest on every C key', opened >= 0 ? `after ${(opened / 1000).toFixed(1)} s` : JSON.stringify(s.letters.map(l => [l.key, l.here, +l.x.toFixed(3), +l.y.toFixed(3), l.fallen])));
T.ok(s.keysSeen === 88 && s.keysDown.length === 0, 'all 88 keys are drawn, none left down', `${s.keysSeen} keys`);
T.ok(s.letters.map(l => l.key).sort((a, b) => a - b).join() === ALL_CS.join(), 'eight Cs, one on each C of the keyboard', s.letters.map(l => l.key).join(' '));
const spots = []; for (const k of ALL_CS) spots.push(await page.evaluate(key => window.__mj.screen(key), k));
T.ok(spots.every(p => p.x > 0 && p.x < WIDTH && p.y > 0 && p.y < HEIGHT), 'the picture has zoomed out to show them all', `from x ${spots[0].x.toFixed(0)} to ${spots.at(-1).x.toFixed(0)} of ${WIDTH}`);
console.log(`  --    a C is drawn ${one.tall.toFixed(0)} pixels tall on one octave and ${spots[3].tall.toFixed(0)} on 88 keys, in a ${WIDTH} by ${HEIGHT} window`);
await shot('6-88-keys');
// now each key is itself
const c5Rest = (await on(C5)).y; await send(NOTE_ON, C5, FORCE); let c5Moved = 0, c4Moved = 0; const c4Rest = (await on(C4)).y;
for (let i = 0; i < 6; i++) { await wait(25); c5Moved = Math.max(c5Moved, Math.abs((await on(C5)).y - c5Rest)); c4Moved = Math.max(c4Moved, Math.abs((await on(C4)).y - c4Rest)); }
s = await state();
T.ok(downKeys(s) === String(C5) && litOf(s, C5) === GREEN, 'the C above middle C now takes its own key down, green', downKeys(s));
T.ok(c5Moved > 0.01 && c4Moved < 0.002, 'and jolts the jelly on that key, not the one on middle C', `${(c5Moved * 1000).toFixed(1)} mm against ${(c4Moved * 1000).toFixed(1)} mm`);
await send(NOTE_OFF, C5, 0); await wait(GAP_MS);
T.ok((await state()).found.length === 1 && (await state()).panel === 'more', 'the C already found is not another one');
await send(NOTE_ON, D4, FORCE); await wait(HOLD_MS); s = await state();
T.ok(downKeys(s) === String(D4) && litOf(s, D4) === ORANGE, 'a key that is not C is still orange'); await send(NOTE_OFF, D4, 0); await wait(GAP_MS);
for (const m of [E5, A4]) await play(m);
await wait(300); s = await state();
T.ok(s.letters.every(l => l.lidWanted > 0), 'three wrong keys and all eight grow drowsy');
await play(C2); s = await state();
T.ok(s.found.length === 2 && s.panel === 'more' && s.letters.every(l => l.lidWanted === 0), 'a second C: one more to find, and all eight wake');
T.ok(s.kept.join() === `${C2},${C5}` && s.keysDown.length === 0 && litOf(await state(), C2) === undefined, 'the Cs found stay green after they are let go', s.kept.join(' '));
await shot('7-found-stay-green');
await play(C7); s = await state();
// --- the names of the other letters: back to one octave, six more jellies
T.ok(s.panel === 'names' && s.text === 'All the notes have names. Let\'s look at the names of the other white letters.' && s.next === 'tap', 'a third C brings "All the notes have names..."', s.text);
T.ok(s.range.join() === `${C4},${C4 + 11}` && s.letters.filter(l => l.here).every(l => l.key === C4), 'the keyboard is one octave again, and only middle C\'s jelly is left of the eight');
const named = await until(async () => { const q = await state(); return !q.opening && q.letters.length === 7 && q.letters.every(l => atHome(l) && l.asleepPhysics); }, OPEN_WITHIN_MS);
s = await state();
T.ok(named >= 0, 'it closes up, and D E F G A B fall and come to rest on their keys', named >= 0 ? `after ${(named / 1000).toFixed(1)} s` : JSON.stringify(s.letters.map(l => [l.letter, l.here, +(l.x - l.homeX).toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3), l.fallen])));
T.ok(s.letters.map(l => l.letter + l.key).join(' ') === 'C60 D62 E64 F65 G67 A69 B71', 'each on the key of its name', s.letters.map(l => l.letter + l.key).join(' '));
T.ok(new Set(s.colours.map(c => c[1])).size === 7, 'seven jellies, seven colours', s.colours.map(c => c.join(' ')).join(', '));
T.ok(s.keysSeen === 12 && s.kept.join() === String(C4), '12 keys drawn, and C is still green', `${s.keysSeen} keys, green: ${s.kept.join(' ')}`);
await shot('8-names');
// --- the game
const EMPTY = { x: 90, y: 640 };                           // a spot on the table, away from keys and jellies
await page.mouse.move(EMPTY.x, EMPTY.y); await page.mouse.down(); await page.mouse.move(EMPTY.x + 200, EMPTY.y - 60, { steps: 8 }); await page.mouse.up(); await page.mouse.wheel(0, 300); await wait(100); s = await state();
T.ok(s.panel === 'names' && s.orbit.az === 0 && s.orbit.zoom === 1 && !s.orbit.free, 'before the hand, a drag or the wheel on empty space neither flies the camera nor goes on');
await page.mouse.click(EMPTY.x, EMPTY.y); s = await state();
T.ok(s.panel === 'game' && s.text === 'Let\'s play a game. Find the letters in the order I show them:', 'a tap on empty space brings the game', s.text);
const order = s.order.map(o => o[0]);
T.ok(s.orderSeen && order.length === 6 && [...order].sort().join('') === 'ABDEFG' && s.order[0][1] === 'now' && s.order.slice(1).every(o => o[1] === 'later'), 'the panel shows the six other letters in some order, the first marked', order.join(' '));
const fits = await page.evaluate(() => { const p = document.querySelector('#panel').getBoundingClientRect(); return [...document.querySelectorAll('#panelText, #panelOrder')].every(el => { const r = el.getBoundingClientRect(); return r.top >= p.top && r.bottom <= p.bottom && r.left >= p.left && r.right <= p.right; }); });
T.ok(fits, 'the words and the letters fit inside the panel');
await shot('9-game');
const KEY_OF = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 }, OCTAVE = 12;
await send(NOTE_ON, KEY_OF[order[1]], FORCE); await wait(HOLD_MS); s = await state();
T.ok(litOf(s, KEY_OF[order[1]]) === ORANGE, 'a letter out of turn lights orange, not green');
await send(NOTE_OFF, KEY_OF[order[1]], 0); await wait(GAP_MS); s = await state();
T.ok(s.order[0][1] === 'now' && s.kept.join() === String(C4), 'it is not taken and does not stay green');
{ const n = s.found.length; await play(C5); s = await state(); T.ok(s.found.length === n && s.order[0][1] === 'now', 'C, found earlier and still green, is not part of the game: playing it changes nothing'); }
await send(NOTE_ON, KEY_OF[order[0]] - OCTAVE, FORCE); await wait(HOLD_MS); T.ok(litOf(await state(), KEY_OF[order[0]]) === GREEN, 'the letter whose turn it is lights green'); await send(NOTE_OFF, KEY_OF[order[0]] - OCTAVE, 0); await wait(GAP_MS);
T.ok((await state()).order[1][1] === 'now', 'and is taken');
for (let i = 1; i < order.length; i++) {
  const shownKey = KEY_OF[order[i]], played = shownKey + OCTAVE * [1, -2, 0, 2, -1, 3][i];      // each in a different octave
  await play(played); s = await state();
  if (i < order.length - 1) T.ok(s.order[i][1] === 'found' && s.order[i + 1][1] === 'now' && s.kept.includes(shownKey), `${order[i]} (played ${OCTAVE * [1, -2, 0, 2, -1, 3][i] / OCTAVE} octaves away) is found and its key stays green`, s.kept.join(' '));
  if (i === 2) await shot('10-game-half');
}
T.ok(s.panel === 'all-found' && s.text === 'Well done! You found all the white letters!' && s.next === 'tap', 'the sixth brings "Well done! You found all the white letters!"', s.text);
T.ok(s.kept.join() === '60,62,64,65,67,69,71' && !s.orderSeen, 'all seven white keys are green', s.kept.join(' '));
await wait(2500); s = await state();
T.ok(s.letters.every(atHome), 'after all those keys every jelly is still on its key, upright', s.letters.filter(l => !atHome(l)).map(l => l.letter).join(' '));
await shot('11-all-found');
// --- the key as a slingshot: the jelly hangs in the air when its key drops, and is thrown up a little when it returns
{
  const rest = (await on(D4)).y, FRAME_MS = 16; await send(NOTE_ON, D4, FORCE);
  const fell = await page.evaluate(async ([key, ms]) => { const w = window.__mj.world, b = w.onKey(key), kb = window.__mj.kb; let air = 0, t0 = performance.now(), last = t0; while (performance.now() - t0 < ms) { await new Promise(requestAnimationFrame); const now = performance.now(), feet = Math.min(...Array.from({ length: b.N }, (_, i) => b.x[i * 3 + 1])); if (feet - kb.heightAt(b.homeX, 0) > 0.002) air += now - last; last = now; } return air; }, [D4, 500]);
  T.ok(fell > 60 && fell < 400, 'its key pressed, the jelly is in the air for a fraction of a second before it lands', `${fell.toFixed(0)} ms`);
  await send(NOTE_OFF, D4, 0);
  const rose = await page.evaluate(async ([key, ms]) => { const b = window.__mj.world.onKey(key); let top = -1, t0 = performance.now(); while (performance.now() - t0 < ms) { await new Promise(requestAnimationFrame); top = Math.max(top, b.center()[1]); } return top; }, [D4, 700]);
  T.ok(rose - rest > 0.005 && rose - rest < SIZE * 0.6, 'the key let go, it is thrown up a little', `${((rose - rest) * 1000).toFixed(1)} mm above where it stands`);
  await wait(1200); T.ok(atHome(await on(D4)), 'and comes down on its key');
}
// keys hammered at several speeds may throw their jellies off (the owner: that is fine); they must pick themselves up
let worst = 0;
for (const key of [C4, D4]) for (const [hold, gap] of [[200, 400], [60, 120], [30, 60], [500, 150]]) for (let k = 0; k < 6; k++) { await send(NOTE_ON, key, FORCE); await wait(hold); await send(NOTE_OFF, key, 0); await wait(gap); for (const q of (await state()).letters) worst = Math.max(worst, Math.hypot(q.x - q.homeX, q.z)); }
const recovered = await until(async () => (await state()).letters.every(l => atHome(l) && l.asleepPhysics), HOME_AGAIN_WITHIN_MS, 200);
T.ok(recovered >= 0, 'C and D each hammered 24 times, slowly and fast: afterwards all seven are back standing on their keys', recovered >= 0 ? `the furthest any went was ${(worst * 1000).toFixed(0)} mm; all home ${(recovered / 1000).toFixed(1)} s after the last key` : JSON.stringify((await state()).letters.map(l => [l.letter, +(l.x - l.homeX).toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3), l.fallen])));
// --- dragging: carried off its key and dropped on the table, it gets up and goes home
const from = await page.evaluate(k => window.__mj.screen(k), C4);
await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x - 60, from.y + 60, { steps: 12 }); await page.mouse.move(from.x - 90, from.y + 150, { steps: 12 }); await wait(300);
L = await on(C4); await shot('12-dragged');
T.ok(Math.hypot(L.x - L.homeX, L.z) > SIZE, 'a drag carries a jelly away from its key', (Math.hypot(L.x - L.homeX, L.z) * 1000).toFixed(0) + ' mm');
await page.mouse.up(); await wait(1500); L = await on(C4);
T.ok(L.y < 0, 'let go beyond the keys, it drops to the table', (L.y * 1000).toFixed(0) + ' mm');
const back = await until(async () => { const q = await state(); return q.letters.every(l => atHome(l) && l.asleepPhysics); }, HOME_AGAIN_WITHIN_MS, 200);
T.ok(back >= 0, 'it gets up and goes back to its key by itself, and the others are still on theirs', back >= 0 ? `after ${(back / 1000).toFixed(1)} s` : JSON.stringify((await state()).letters.map(l => [l.letter, +(l.x - l.homeX).toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3)])));
await shot('13-home-again');
// --- hand position
await page.keyboard.press('Space'); s = await state();
T.ok(s.panel === 'hand' && s.text === 'Hand position: Let\'s look at how you can play keys quickly. Place your hand like the one below and press each key.', 'the space bar brings the hand position', s.text);
T.ok(s.kept.length === 0, 'no key is green to begin with');
const HAND_KEYS = [60, 62, 64, 65, 67], LAND_WITHIN_HAND_MS = 8000, MM = 0.001;
let brushed = 0; const handDown = await until(async () => { const q = await state(); for (const l of q.letters) if (HAND_KEYS.includes(l.key)) brushed = Math.max(brushed, Math.hypot(l.x - l.homeX, l.z), l.fallen ? 1 : 0); return q.hand && q.hand.landed; }, LAND_WITHIN_HAND_MS, 30);
s = await state();
T.ok(handDown >= 0 && s.hand.shown, 'the right hand comes down over the keys', `${handDown} ms`);
T.ok(s.hand.miss.every(m => m < MM), 'each fingertip is on its key, thumb on C to little finger on G', s.hand.miss.map(m => (m * 1000).toFixed(2)).join(' ') + ' mm off');
T.ok(brushed > SIZE * 0.2, 'on its way down it knocks the jellies under it about', brushed >= 1 ? 'one fell over' : `${(brushed * 1000).toFixed(0)} mm`);
T.ok(s.viewDeg > 55, 'the camera has risen to look down on the fingers', s.viewDeg.toFixed(0) + ' degrees');
// the helicopter: once round the hand and back
{
  const HELI_WITHIN_MS = 15000, home = [0, 0, 0]; let furthest = 0, lowest = 0; const seen = new Set();
  const flown = await until(async () => { const q = await state(); furthest = Math.max(furthest, q.orbit.az); lowest = Math.max(lowest, q.orbit.tilt); seen.add(Math.floor(q.orbit.az / (Math.PI / 2))); if (Math.abs(q.orbit.az - Math.PI) < 0.5) await shot('14a-helicopter-behind'); return !q.orbit.flying; }, HELI_WITHIN_MS, 120);
  s = await state();
  T.ok(flown >= 0 && furthest > 5.5 && seen.size >= 4, 'as the hand lands the camera flies once round it', `${(furthest * 180 / Math.PI).toFixed(0)} degrees round in ${(flown / 1000).toFixed(1)} s`);
  T.ok(lowest > 0.35, 'lower at the sides, to show the hand\'s arch', `${(lowest * 180 / Math.PI).toFixed(0)} degrees less steep`);
  T.ok(s.orbit.az === 0 && Math.abs(s.orbit.tilt) < 1e-6 && s.orbit.zoom === 1, 'and comes back to where it began');
}
T.ok(s.hand.ledges.length === 5 && s.hand.ledges.every(([, top]) => top > 0.05), 'there is a ledge over each finger', s.hand.ledges.map(([k, t]) => `${k}: ${(t * 1000).toFixed(0)} mm`).join(', '));
const onLedge = (l, q) => { const led = q.hand.ledges.find(([k]) => k === l.key); return led ? l.y > led[1] && Math.abs(l.x - l.homeX) < HOME_WITHIN && Math.abs(l.z) < HOME_WITHIN && !l.fallen : atHome(l); };
const climbed = await until(async () => { const q = await state(); return q.letters.every(l => onLedge(l, q) && l.asleepPhysics); }, HOME_AGAIN_WITHIN_MS, 200);
s = await state();
T.ok(climbed >= 0, 'the jellies of C to G get back up, on top of the fingers; A and B stay on their keys', climbed >= 0 ? `after ${(climbed / 1000).toFixed(1)} s` : JSON.stringify(s.letters.map(l => [l.letter, +(l.x - l.homeX).toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3), l.fallen])));
await shot('14-hand');
// A and B do nothing
const quiet = (await state()).squeaks;
for (const m of [A4, 83]) { await send(NOTE_ON, m, FORCE); await wait(HOLD_MS); const q = await state(); T.ok(q.keysDown.length === 0 && q.squeaks === quiet && q.kept.length === 0, `${m === A4 ? 'A' : 'B (another octave)'} does nothing: no key moves, no squeak, nothing green`); await send(NOTE_OFF, m, 0); await wait(GAP_MS); }
// each of the five keys: its finger goes down with it, its jelly is jostled, and it stays green
const octaves = [1, 0, -2, 2, -1];
for (let a = 0; a < HAND_KEYS.length; a++) {
  const key = HAND_KEYS[a], before = await state(), restTip = before.hand.tipY[a], restY = before.letters.find(l => l.key === key).y;
  await send(NOTE_ON, key + OCTAVE * octaves[a], FORCE); let low = restTip, jolt = 0, green = false;
  for (let i = 0; i < 8; i++) { await wait(25); const q = await state(); low = Math.min(low, q.hand.tipY[a]); jolt = Math.max(jolt, Math.abs(q.letters.find(l => l.key === key).y - restY)); green ||= litOf(q, key) === GREEN; }
  await send(NOTE_OFF, key + OCTAVE * octaves[a], 0); await wait(GAP_MS); s = await state();
  T.ok(green && restTip - low > 0.01 && jolt > 0.003 && s.kept.includes(key), `${'CDEFG'[a]}: green, finger ${a + 1} goes down with the key, its jelly is jostled, and the key stays green`, `finger ${((restTip - low) * 1000).toFixed(0)} mm, jelly ${(jolt * 1000).toFixed(0)} mm`);
  if (a === 2) await shot('15-hand-playing');
}
T.ok(s.done && s.kept.join() === HAND_KEYS.join(), 'all five played: the lesson is done, C to G green', s.kept.join(' '));
const again = await until(async () => { const q = await state(); return q.letters.every(l => onLedge(l, q) && l.asleepPhysics); }, HOME_AGAIN_WITHIN_MS, 200);
T.ok(again >= 0, 'and the jellies are on the fingers again afterwards', again >= 0 ? `${(again / 1000).toFixed(1)} s after the last key` : JSON.stringify((await state()).letters.map(l => [l.letter, +(l.x - l.homeX).toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3), l.fallen])));
await shot('16-hand-done');
// --- the learner flies the camera
{
  const before = (await state()).cameraAt;
  await page.mouse.move(EMPTY.x, EMPTY.y); await page.mouse.down(); await page.mouse.move(EMPTY.x + 160, EMPTY.y - 50, { steps: 8 }); await page.mouse.up(); await wait(100); s = await state();
  T.ok(Math.abs(s.orbit.az) > 0.5 && Math.abs(s.orbit.tilt) > 0.1 && Math.hypot(...s.cameraAt.map((v, k) => v - before[k])) > 0.1, 'with the hand there, a drag on empty space circles and tilts the camera', `${(s.orbit.az * 180 / Math.PI).toFixed(0)} degrees round, ${(s.orbit.tilt * 180 / Math.PI).toFixed(0)} tilted`);
  await page.mouse.wheel(0, -500); await wait(100); s = await state();
  T.ok(s.orbit.zoom < 0.7, 'the wheel comes closer', `to ${s.orbit.zoom.toFixed(2)} of the distance`);
  await shot('17-flown');
  await page.mouse.dblclick(EMPTY.x, EMPTY.y); await wait(100); s = await state();
  T.ok(s.orbit.az === 0 && s.orbit.tilt === 0 && s.orbit.zoom === 1, 'a double tap on empty space puts the picture back');
  const c = await page.evaluate(k => window.__mj.screen(k), 69);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 60, c.y + 40, { steps: 8 }); await wait(200); s = await state(); await page.mouse.up();
  const a = s.letters.find(l => l.key === 69);
  T.ok(s.orbit.az === 0 && Math.hypot(a.x - a.homeX, a.z) > SIZE * 0.3, 'a drag that starts on a jelly still drags the jelly, not the camera', `${(Math.hypot(a.x - a.homeX, a.z) * 1000).toFixed(0)} mm`);
}
// --- the keyboard is unplugged
await fake('unplug', FIRST); await wait(100); s = await state();
T.ok(s.notice === null && s.keyboard === 'MIDI: ' + SECOND, 'the first keyboard unplugged: the next one is taken', s.keyboard);
await fake('unplug', SECOND); await wait(100);
T.ok((await state()).notice === NOTICE, 'no keyboard left: the notice comes back');
const real = problems.filter(m => served || !/worklet/i.test(m));
T.ok(real.length === 0, 'no errors in the page', real.join(' | '));
T.done(); await browser.close();
