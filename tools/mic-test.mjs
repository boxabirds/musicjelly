// The lessons played by ear: no MIDI keyboard, a (pretend) microphone, and real piano notes played into it.
//   node tools/mic-test.mjs [--shots=/tmp/mjm]      (MJ_URL=<served address> to include the checks on the page's own sound)
// What this shows: the path from the browser's microphone stream to the lesson works on clean piano sound.
// What it cannot show: a real room, a real microphone, the page's loudspeaker being heard by it.
import { openPage } from './page.mjs'; import { checker } from './check.mjs';
const shots = (process.argv.find(a => a.startsWith('--shots=')) || '').slice(8);
const T = checker('the lessons by microphone'), { browser, page, problems, state, served } = await openPage({ keyboards: [], microphone: true });
const C3 = 48, C4 = 60, C5 = 72, C6 = 84, D4 = 62, E4 = 64, GREEN = 0x2fd35a, RED = 0xff3b3b, ORANGE = 0xff8a1e, NOTE_S = 0.35, AFTER_MS = 650;
const wait = ms => page.waitForTimeout(ms), shot = name => (shots ? page.screenshot({ path: `${shots}-${name}.png` }) : null);
const until = async (test, ms, every = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await test()) return Date.now() - t0; await wait(every); } return -1; };
const play = async (midi, seconds = NOTE_S) => { await page.evaluate(([m, s]) => window.__fakeMic.play(m, s), [midi, seconds]); await wait(seconds * 1000 + AFTER_MS); };
const litOf = (s, m) => (s.lit.find(([k]) => k === m) || [])[1];
let s = await state();
T.ok(s.notice !== null && s.keyboardFound === 'no', 'with no MIDI keyboard the notice shows');
await page.click('#noticeMic'); const listening = await until(async () => (await state()).mic.on, 20000); s = await state();
T.ok(listening >= 0 && s.notice === null, 'its button turns the microphone on and the notice goes', s.mic.status);
const asked = await page.evaluate(() => window.__fakeMic.constraints.audio);
T.ok(asked.echoCancellation === false && asked.noiseSuppression === false && asked.autoGainControl === false, 'the browser is asked to leave the sound alone: no echo cancelling, noise suppression or automatic gain');
await page.keyboard.press('Space'); await page.keyboard.press('Space'); await wait(4500); await page.keyboard.press('Space'); s = await state();
T.ok(s.panel === 'find', 'the lesson runs as with a keyboard, to "Try to find C..."', s.text);
// a note that is not C, then C
await page.evaluate(m => window.__fakeMic.play(m, 0.5), D4); let seen = { down: false, colour: 0, at: -1 }; const t0 = Date.now();
await until(async () => { const q = await state(); if (q.keysDown.some(([m]) => m === D4)) { seen = { down: true, colour: litOf(q, D4) || seen.colour, at: seen.at < 0 ? Date.now() - t0 : seen.at }; } return seen.down && q.keysDown.length === 0; }, 3000, 15);
s = await state();
T.ok(seen.down && seen.colour === ORANGE && s.panel === 'find' && s.misses === 1, 'D played into the microphone: the D key goes down, orange, and it is not taken for C', `seen ${seen.at} ms after it was played; the page shows "${s.inputShown}"`);
T.ok(s.keysDown.length === 0, 'and the key comes up when the note is let go');
const before = s.pianoNotes; await page.evaluate(m => window.__fakeMic.play(m, 0.5), C5); let green = false;
await until(async () => { const q = await state(); green ||= q.lit.some(([, c]) => c === GREEN); return q.panel === 'more' && green; }, 3000, 15); s = await state();
T.ok(s.panel === 'more' && green, 'C (the one above middle C) is heard, lights the C key green, and is found', s.inputShown);
T.ok(s.pianoNotes === before, 'the page does not sound the learner\'s notes itself: the instrument does');
await wait(4500); await play(C3); await play(C6); s = await state();
T.ok(s.panel === 'names', 'two more Cs, low and high, are found', `found ${s.found.length}`);
// the game of six letters
await wait(7000); await page.keyboard.press('Space'); s = await state(); const KEY_OF = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 }, order = s.order.map(o => o[0]);
for (const L of order) await play(KEY_OF[L]);
s = await state();
T.ok(s.panel === 'all-found', 'the six letters, played in the order shown, are all heard', order.join(' '));
// the hand, then repeat after me
await page.keyboard.press('Space'); await until(async () => (await state()).hand?.landed, 8000); await wait(1500);
for (const m of [60, 62, 64, 65, 67]) await play(m);
s = await state();
T.ok(s.panel === 'repeat', 'C D E F G under the hand are heard, and "Repeat after me" begins', s.panel);
// while the hand plays, the page is deaf: a note played then is not judged and moves no key of its own
await until(async () => (await state()).repeat.playing && (await state()).mic.deaf, 4000, 20);
await page.evaluate(m => window.__fakeMic.play(m, 0.2), 71); await wait(250); s = await state();
T.ok(s.mic.deaf && !s.keysDown.some(([m]) => m === 71), 'while the hand is playing the page does not listen (it would hear its own loudspeaker)');
await until(async () => (await state()).repeat.turn && !(await state()).mic.deaf, 8000, 30); await wait(300);
await page.evaluate(m => window.__fakeMic.play(m, 0.4), E4); let red = false; await until(async () => { const q = await state(); red ||= litOf(q, E4) === RED; return red; }, 2000, 15); await wait(900);
T.ok(red && (await state()).repeat.at === 0, 'in the learner\'s turn a wrong note (E when C is due) is heard and lights red');
await play(C4); await play(D4); s = await state();
T.ok(s.repeat.round === 1, 'C then D are heard, and the round is won', `round ${s.repeat.round + 1} next`);
await shot('repeat');
// all the rest of the game by ear
const ROUNDS = ['CDE', 'CDEF', 'CDEFG', 'DC', 'EDC', 'FEDC', 'GFEDC'];
for (const r of ROUNDS) { await until(async () => (await state()).repeat.turn && !(await state()).mic.deaf, 12000, 30); await wait(250); for (const L of r) await play(KEY_OF[L], 0.3); }
s = await state();
T.ok(s.done, 'the whole game, every round, can be played by ear', `round ${s.repeat.round} of 8`);
// off again
await page.click('#micBtn'); await wait(200); s = await state();
T.ok(!s.mic.on && s.notice !== null, 'the microphone button turns it off again, and with no keyboard the notice returns');
const real = problems.filter(m => served || !/worklet/i.test(m));
T.ok(real.length === 0, 'no errors in the page', real.join(' | '));
T.done(); await browser.close();
