// The lesson as a list of panels, and what a tap or a key does at each. No drawing and no sound: the page (main.mjs)
// carries out the effects this returns, and tools/flow-test.mjs plays it through.
// The wording of every panel is the owner's own; do not change it here without him.
import { letterOf } from './keyboard.mjs';

// next: 'tap'   a tap or the space bar goes on;
//       'keys'  wait until `find` more keys named `letter` are found (any octave, each key once);
//       'order' wait until the letters in `shuffle` are found, in an order shuffled when the panel opens (any octave);
//       'each'  wait until every letter in `letters` has been played once, in any order and any octave.
//       'repeat' the game "repeat after me": the hand plays a few of `letters`, then the learner plays them back, round
//                after round (roundsOf). `turnText` is shown while it is the learner's turn. `bpm`: the hand's speed.
// After the last panel the lesson is finished.
// plinth: the letters go and sit on the rail behind the keys, each behind its own key.
// hand: the right hand appears over the keys of `letters`, one finger a key.
// mute: letters whose keys do nothing at all while the panel is up (no key movement, no sound, no feedback).
// fresh: the keys found so far are forgotten when the panel opens (no key is green).
// drop: the letters that fall from the sky when the panel opens, each onto its key in the octave shown.
// widen: when the panel opens, the keyboard opens out to all 88 keys and every letter so far appears on each of its keys.
// narrow: when the panel opens, the keyboard closes back to the one octave.
// "keyboard" is said as "musical keyboard" so nobody looks for the letter on the computer's keys (owner, 19 Nov 2026).
export const PANELS = [
  { id: 'octave', text: 'Introducing the Octave', next: 'tap' },
  { id: 'first-letter', text: 'The first letter is "C".', next: 'tap', drop: 'C' },
  { id: 'find', text: 'Try to find C on your musical keyboard, and press it.', next: 'keys', letter: 'C', find: 1 },
  { id: 'more', text: 'Well done! You found a C on your musical keyboard! There is more than one. Try finding a couple more.', next: 'keys', letter: 'C', find: 2, widen: true },
  { id: 'names', text: 'All the notes have names. Let\'s look at the names of the other white letters.', next: 'tap', narrow: true, drop: 'DEFGAB' },
  { id: 'game', text: 'Let\'s play a game. Find the letters in the order I show them:', next: 'order', shuffle: 'DEFGAB' },
  { id: 'all-found', text: 'Well done! You found all the white letters!', next: 'tap' },
  { id: 'hand', text: 'Hand position: Let\'s look at how you can play keys quickly. Place your hand like the one below and press each key.', next: 'each', letters: 'CDEFG', mute: 'AB', hand: true, fresh: true },
  { id: 'repeat', text: 'Repeat after me', turnText: 'Your turn!', next: 'repeat', letters: 'CDEFG', bpm: 120, plinth: true, fresh: true },
];
// The lessons: runs of panels that can be picked from the side and tried again. from: the id of its first panel.
// letters: the letters whose jellies are already on their keys when it begins. handThere: the hand is already down.
// The names are the owner's own phrases from the panels, not yet confirmed by him as lesson names.
export const LESSONS = [
  { id: 'octave', name: 'Introducing the Octave', from: 'octave', letters: '' },
  { id: 'letters', name: 'The other white letters', from: 'names', letters: 'C' },
  { id: 'hand', name: 'Hand position', from: 'hand', letters: 'CDEFGAB' },
  { id: 'repeat', name: 'Repeat after me', from: 'repeat', letters: 'CDEFGAB', handThere: 'CDEFG' },
];
// Falling asleep: DROWSY_AFTER keys in a row that are not a known letter and the eyes close part of the way
// (DROWSY_FIRST, enough to be seen on a small face); each further one closes them more, and at ASLEEP_AFTER they are shut.
export const DROWSY_AFTER = 3, ASLEEP_AFTER = 6, DROWSY_FIRST = 0.4;
// how far shut the eyes are (0 open .. 1 shut) after `misses` wrong keys in a row
export const lidFor = misses => (misses < DROWSY_AFTER ? 0 : Math.min(1, DROWSY_FIRST + (1 - DROWSY_FIRST) * (misses - DROWSY_AFTER) / (ASLEEP_AFTER - DROWSY_AFTER)));
// The rounds of "repeat after me" on some letters: upwards two, then three ... then all of them (C D; C D E; ...), then
// the same lengths coming down to the first (D C; E D C; ...).
export function roundsOf(letters) {
  const L = [...letters], up = [], down = [];
  for (let n = 2; n <= L.length; n++) { up.push(L.slice(0, n)); down.push(L.slice(0, n).reverse()); }
  return [...up, ...down];
}
export const HINT_AFTER = 3;                               // wrong keys for one note before the right key is shown
// a fair shuffle (Fisher and Yates); random: () => a number from 0 up to but not 1
export function shuffled(letters, random) {
  const a = [...letters];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function createFlow(panels = PANELS, random = Math.random, lessons = LESSONS) {
  const starts = lessons.map(L => panels.findIndex(p => p.id === L.from)), lessonAt = i => { let k = 0; starts.forEach((st, n) => { if (st <= i) k = n; }); return k; };
  // found: every key found so far (MIDI numbers). order, at: the game's letters and how many of them are found.
  const S = { index: 0, found: new Set(), foundHere: 0, misses: 0, letters: [], order: [], at: 0, each: new Set(), done: false,
    rounds: [], round: 0, turn: false, wrongs: 0, lesson: 0, finished: new Set() };      // finished: the lessons got through this visit      // repeat after me: the rounds, which one, whether it is the learner's turn, wrong keys for the note now due
  const panel = () => panels[S.index];
  const open = (i, fx) => {
    S.index = i; S.foundHere = 0; S.each = new Set(); const p = panel(); if (p.fresh) S.found.clear();
    const L = lessonAt(i); if (L > S.lesson) for (let k = S.lesson; k < L; k++) S.finished.add(k);
    S.lesson = L;
    fx.push({ type: 'panel', panel: p });
    if (p.narrow) fx.push({ type: 'narrow' });
    if (p.drop) { S.letters.push(...p.drop); fx.push({ type: 'drop', letters: [...p.drop] }); }
    if (p.widen) fx.push({ type: 'widen', letters: [...S.letters] });
    if (p.next === 'order') { S.order = shuffled(p.shuffle, random); S.at = 0; }
    fx.push({ type: 'order', letters: p.next === 'order' ? [...S.order] : [], at: 0 });
    if (p.hand) fx.push({ type: 'hand', letters: [...p.letters] });
    if (p.plinth) fx.push({ type: 'plinth' });
    if (p.next === 'repeat') { S.rounds = roundsOf(p.letters); S.round = 0; demo(fx); }
    // where the learner is: which lesson, and which of its panels (counted from 1)
    fx.push({ type: 'place', lesson: L, step: i - starts[L] + 1, steps: (starts[L + 1] ?? panels.length) - starts[L], finished: [...S.finished] });
  };
  // the hand's turn: it plays this round's letters; the page says when it has (demoDone)
  const demo = fx => { S.turn = false; S.at = 0; S.wrongs = 0; fx.push({ type: 'say', text: panel().text }, { type: 'demo', letters: [...S.rounds[S.round]], bpm: panel().bpm, round: S.round }); };
  const forward = fx => { if (S.index + 1 < panels.length) open(S.index + 1, fx); else if (!S.done) { S.done = true; S.finished.add(S.lesson); fx.push({ type: 'finished' }, { type: 'place', lesson: S.lesson, step: S.index - starts[S.lesson] + 1, steps: panels.length - starts[S.lesson], finished: [...S.finished] }); } };
  return {
    state: S, panel,
    // has the learner met the letter of this key (has its jelly landed)?
    knows: midi => S.letters.includes(letterOf(midi)),
    // does this key do nothing at all just now?
    muted: midi => !!panel().mute && panel().mute.includes(letterOf(midi)),
    // is this key what the lesson is asking for now? (It lights green; any other key lights orange.) Where nothing is
    // being asked for, a key whose letter is known counts.
    // How a key the learner presses should light: 'right' (green), 'wrong' (red) or 'plain' (orange). Only the game
    // "repeat after me", in the learner's turn, calls a key wrong.
    judge(midi) {
      const p = panel();
      if (p.next === 'repeat' && !S.done) return !S.turn ? 'plain' : letterOf(midi) === S.rounds[S.round][S.at] ? 'right' : 'wrong';
      return this.wants(midi) ? 'right' : 'plain';
    },
    // the hand has finished playing the round: now the learner
    demoDone() { const fx = [], p = panel(); if (p.next === 'repeat' && !S.turn && !S.done) { S.turn = true; S.at = 0; S.wrongs = 0; fx.push({ type: 'say', text: p.turnText }, { type: 'turn', letters: [...S.rounds[S.round]] }); } return fx; },
    wants(midi) {
      const p = panel(), L = letterOf(midi); if (!L || !S.letters.includes(L) || S.done) return !!L && S.letters.includes(L);
      return p.next === 'keys' ? p.letter === L : p.next === 'order' ? S.order[S.at] === L : p.next === 'each' ? p.letters.includes(L) : true;
    },
    start() { const fx = []; open(0, fx); return fx; },
    lessons, lesson: () => S.lesson,
    // Begin lesson n afresh (picked from the side, or tried again): the page is told to clear everything and put the
    // letters that lesson begins with on their keys (and the hand down, if it begins with it there).
    jump(n) {
      const L = lessons[n], fx = []; if (!L) return fx;
      S.found.clear(); S.misses = 0; S.letters = [...L.letters]; S.order = []; S.at = 0; S.done = false; S.rounds = []; S.round = 0; S.turn = false; S.wrongs = 0; S.lesson = n;
      fx.push({ type: 'reset', letters: [...L.letters], hand: L.handThere ? [...L.handThere] : null }, { type: 'lid', lid: 0 });
      open(starts[n], fx); return fx;
    },
    // a tap or the space bar
    tap() { const fx = []; if (!S.done && panel().next === 'tap') forward(fx); return fx; },
    // a key going down on the learner's keyboard, any octave
    key(midi) {
      const fx = [], p = panel(); if (p.mute && p.mute.includes(letterOf(midi))) return fx;
      if (p.next === 'repeat') {
        if (!S.turn || S.done) return fx;                    // the hand is playing: the learner's keys are not judged
        const due = S.rounds[S.round][S.at];
        if (letterOf(midi) !== due) { S.wrongs++; fx.push({ type: 'wrong', midi }); if (S.wrongs % HINT_AFTER === 0) fx.push({ type: 'hint', letter: due }); return fx; }
        S.at++; S.wrongs = 0; fx.push({ type: 'right', midi, letter: due });
        if (S.at >= S.rounds[S.round].length) { S.turn = false; fx.push({ type: 'round', round: S.round, of: S.rounds.length }); if (++S.round < S.rounds.length) demo(fx); else { fx.push({ type: 'say', text: p.text }); forward(fx); } }
        return fx;
      }
      // a letter that has landed answers to its own key from then on; before any letter there is nothing to wake or bore
      const named = letterOf(midi), letter = S.letters.includes(named) ? named : null;
      if (letter) {
        const asleep = lidFor(S.misses) >= 1; S.misses = 0;
        fx.push({ type: 'squeak', letter, midi, woke: asleep }, { type: 'lid', lid: 0 });
        if (p.next === 'keys' && p.letter === letter && !S.found.has(midi)) {
          S.found.add(midi); S.foundHere++; fx.push({ type: 'found', midi, letter, count: S.found.size });
          if (S.foundHere >= p.find) forward(fx);
        } else if (p.next === 'order' && S.order[S.at] === letter) {
          S.found.add(midi); S.at++; fx.push({ type: 'found', midi, letter, count: S.found.size }, { type: 'order', letters: [...S.order], at: S.at });
          if (S.at >= S.order.length) forward(fx);
        } else if (p.next === 'each' && p.letters.includes(letter) && !S.done) {
          S.found.add(midi); const isNew = !S.each.has(letter); S.each.add(letter); fx.push({ type: 'found', midi, letter, count: S.each.size });
          if (isNew && S.each.size >= p.letters.length) forward(fx);
        }
      } else if (S.letters.length && (p.next === 'keys' || p.next === 'order' || p.next === 'each')) {
        S.misses++; fx.push({ type: 'lid', lid: lidFor(S.misses) });
      }
      return fx;
    },
  };
}
