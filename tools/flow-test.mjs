// The lesson's rules, played through without a page: node tools/flow-test.mjs
import { createFlow, PANELS, lidFor, shuffled, DROWSY_AFTER, ASLEEP_AFTER } from '../src/flow.mjs';
import { keysNamed } from '../src/keyboard.mjs';
import { checker } from './check.mjs';
const T = checker('the lesson flow'), types = fx => fx.map(e => e.type).join(' ');
const C4 = 60, C5 = 72, C3 = 48, D4 = 62, E5 = 76, F_SHARP = 66;
{
  // a fixed stand-in for chance, so the game's order is the same every run
  let seed = 7; const chance = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const f = createFlow(PANELS, chance), first = f.start();
  T.ok(first[0].panel.text === 'Introducing the Octave', 'it opens on "Introducing the Octave"', first[0].panel.text);
  T.ok(types(f.key(C4)) === '', 'a key before any letter has come does nothing to the lesson');
  T.ok(f.panel().id === 'octave', 'and does not move it on');
  const second = f.tap();
  T.ok(second[0].panel.text === 'The first letter is "C".' && second[1].type === 'drop' && second[1].letters.join() === 'C', 'a tap brings the second panel and drops the C', types(second));
  const early = f.key(C4);
  T.ok(types(early) === 'squeak lid' && f.state.found.size === 0, 'C played before it is asked for squeaks but is not counted', types(early));
  T.ok(types(f.key(D4)) === '', 'a wrong key before the hunt begins does not make it drowsy');
  f.tap();
  T.ok(f.panel().text === 'Try to find C on your musical keyboard, and press it.', 'a tap brings "Try to find C..."', f.panel().text);
  T.ok(types(f.tap()) === '' && f.panel().id === 'find', 'a tap does not skip a panel that waits for a key');
  // falling asleep
  const lids = []; for (let i = 0; i < ASLEEP_AFTER; i++) lids.push(f.key(i % 2 ? D4 : F_SHARP)[0].lid);
  T.ok(lids.slice(0, DROWSY_AFTER - 1).every(l => l === 0), `the first ${DROWSY_AFTER - 1} wrong keys leave the eyes open`, lids.join(' '));
  T.ok(lids[DROWSY_AFTER - 1] > 0 && lids[DROWSY_AFTER - 1] < 1, `wrong key ${DROWSY_AFTER} begins to close them`, String(lids[DROWSY_AFTER - 1]));
  T.ok(lids.every((l, i) => !i || l >= lids[i - 1]) && lids[ASLEEP_AFTER - 1] === 1, `they close further each time and are shut at wrong key ${ASLEEP_AFTER}`, lids.join(' '));
  T.ok(f.panel().id === 'find', 'wrong keys never move the lesson on');
  const woke = f.key(C5);
  T.ok(woke[0].type === 'squeak' && woke[0].woke === true && woke[1].lid === 0, 'any C wakes it: a squeak, eyes open', JSON.stringify(woke.slice(0, 2)));
  T.ok(woke[0].midi === C5, 'the squeak says which key was played, so the jelly on that key can jump');
  const widen = woke.find(e => e.type === 'widen');
  T.ok(widen && widen.letters.join() === 'C', 'finding it opens the keyboard out and multiplies the C', JSON.stringify(widen));
  T.ok(f.knows(C3) && !f.knows(D4), 'C is now a letter the learner knows; D is not');
  T.ok(woke.some(e => e.type === 'found') && f.panel().id === 'more', 'that C (an octave above the one shown) is found and brings "Well done!..."', f.panel().text);
  T.ok(f.panel().text === 'Well done! You found a C on your musical keyboard! There is more than one. Try finding a couple more.', 'with the owner\'s wording', f.panel().text);
  const again = f.key(C5);
  T.ok(types(again) === 'squeak lid' && f.state.found.size === 1, 'the same C again squeaks but is not a new one', types(again));
  f.key(C4);
  T.ok(f.state.found.size === 2 && f.panel().id === 'more', 'a second C counts; one more to find');
  const last = f.key(C3);
  T.ok(f.state.found.size === 3 && f.panel().id === 'names', 'a third C (two more after the first) brings the names panel', types(last));
  T.ok(f.panel().text === 'All the notes have names. Let\'s look at the names of the other white letters.' && f.panel().next === 'tap', 'with the owner\'s wording, waiting for a tap', f.panel().text);
  const narrow = last.findIndex(e => e.type === 'narrow'), drop = last.findIndex(e => e.type === 'drop');
  T.ok(narrow >= 0 && drop > narrow && last[drop].letters.join('') === 'DEFGAB', 'the keyboard closes to one octave, then D E F G A B fall', types(last));
  T.ok(f.knows(D4) && !f.knows(F_SHARP), 'D is now known; a black key is not');
  const game = f.tap(), order = game.find(e => e.type === 'order').letters;
  T.ok(f.panel().text === 'Let\'s play a game. Find the letters in the order I show them:' && f.panel().next === 'order', 'a tap brings the game', f.panel().text);
  T.ok(order.length === 6 && [...order].sort().join('') === 'ABDEFG', 'its order is the six other letters, each once', order.join(' '));
  T.ok(order.join('') !== 'DEFGAB', 'shuffled', order.join(' '));
  T.ok(types(f.tap()) === '', 'a tap does not skip the game');
  const keyOf = (L, octave = 0) => keysNamed(L)[3 + octave], wrongFirst = order[1];
  const wrong = f.key(keyOf(wrongFirst));
  T.ok(types(wrong) === 'squeak lid' && f.state.at === 0, 'a letter out of turn squeaks but is not taken', types(wrong));
  T.ok(types(f.key(C4)) === 'squeak lid' && f.state.at === 0, 'nor is C, which is not in the game');
  const right = f.key(keyOf(order[0], 2));
  T.ok(right.some(e => e.type === 'found' && e.letter === order[0]) && right.find(e => e.type === 'order').at === 1, 'the letter shown first, in any octave, is found', types(right));
  T.ok(f.key(F_SHARP)[0].type === 'lid' && f.state.misses === 1, 'a black key in the game counts towards falling asleep');
  let fx = []; for (let i = 1; i < order.length; i++) fx = f.key(keyOf(order[i], i % 2 ? -1 : 1));
  T.ok(f.panel().id === 'all-found' && f.panel().text === 'Well done! You found all the white letters!', 'all six in order bring "Well done! You found all the white letters!"', f.panel().text);
  T.ok(!f.state.done && f.panel().next === 'tap', 'which waits for a tap');
  T.ok(f.state.found.size === 9, 'nine keys found in all: three Cs and the six letters', String(f.state.found.size));
  // green only for what is asked for
  {
    const g = createFlow(PANELS, chance); g.start(); g.tap();
    T.ok(g.wants(C4) && !g.wants(D4), 'before the hunt, a known letter\'s key is green and an unknown one is not');
    g.tap(); g.key(C4); g.key(C5); g.key(C3); g.tap();
    const o = g.state.order; T.ok(g.wants(keyOf(o[0])) && !g.wants(keyOf(o[1])) && !g.wants(C4), 'in the game only the letter whose turn it is is green', o.join(' '));
  }
  // the hand
  const hand = f.tap();
  T.ok(f.panel().text === 'Hand position: Let\'s look at how you can play keys quickly. Place your hand like the one below and press each key.', 'a tap brings the hand position, in the owner\'s words', f.panel().text);
  T.ok(hand.some(e => e.type === 'hand' && e.letters.join('') === 'CDEFG') && f.state.found.size === 0, 'the hand comes over C D E F G, and no key is green to begin with', types(hand));
  const A4 = 69, B5 = 83, G2 = 43;
  T.ok(f.muted(A4) && f.muted(B5) && !f.muted(G2) && types(f.key(A4)) === '' && types(f.key(B5)) === '', 'A and B, in any octave, do nothing at all');
  T.ok(f.wants(C4) && f.wants(G2) && !f.wants(F_SHARP), 'C to G are what is asked for');
  T.ok(types(f.key(F_SHARP)) === 'lid' && types(f.tap()) === '', 'a black key still counts towards sleep; a tap does nothing');
  f.key(C4); f.key(C5);
  T.ok(f.state.each.size === 1 && !f.state.done, 'C twice (two octaves) is one key of the five');
  f.key(E5); f.key(G2); f.key(D4);
  T.ok(f.state.each.size === 4 && !f.state.done, 'four of the five, in any order: not yet');
  const end = f.key(65);
  T.ok(end.at(-1).type === 'finished' && f.state.done, 'the fifth finishes the lesson', types(end));
  T.ok(types(f.key(C4)) === 'squeak lid' && types(f.tap()) === '', 'afterwards a letter still squeaks and a tap does nothing');
}
T.ok(lidFor(0) === 0 && lidFor(ASLEEP_AFTER + 5) === 1, 'lids stay between open and shut');
T.ok(PANELS.filter(p => p.next === 'keys').every(p => p.letter && p.find > 0), 'every panel that waits for keys says which letter and how many');
{ // the shuffle is fair enough: over many goes every letter comes first about equally often
  const first = {}, GOES = 6000; for (let i = 0; i < GOES; i++) { const L = shuffled('DEFGAB', Math.random)[0]; first[L] = (first[L] || 0) + 1; }
  const share = Object.values(first).map(n => n / GOES);
  T.ok(share.length === 6 && share.every(v => v > 0.13 && v < 0.2), 'the shuffle puts each letter first about one time in six', share.map(v => v.toFixed(2)).join(' '));
}
T.done();
