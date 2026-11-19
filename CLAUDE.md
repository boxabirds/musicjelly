# Music Jelly

Teaches children the piano keyboard with jelly letters. A new app; the owner drives the lessons himself, one at a
time, and gives the wording of every message. Do not change or add learner-facing words without him.
Read README.md for how to run and test.

## Files

- index.html: the page. A message panel (`#panel`) above the 3D canvas (`#stage`). The round arrow in the panel shows
  only on panels that wait for a tap.
- src/flow.mjs: the lesson as data (PANELS) and its rules: what a tap or a key does. Pure; returns effects that
  main.mjs carries out. Falling asleep: DROWSY_AFTER, ASLEEP_AFTER, lidFor.
- src/keyboard.mjs: the 88 keys as numbers: positions, how far down each key is, and the solid shapes a jelly stands
  on (`heightAt`, `resolve`). Pure. Only the keys in `range` exist: one octave (middle C to B) at first, all 88 after
  `setRange`. `shown(midi)` says which key is drawn for a note: with one octave, its key of the same name; with 88,
  itself. All sizes are the piano's, times a scale that makes a key as wide as the widest letter plus a gap.
- src/keys3d.mjs: the keys drawn from those numbers (three.js). The drawn width opens out over SPREAD_S when the range
  grows, and the camera follows it. A key that is down glows orange, or green if the learner has met its letter.
- src/jelly.mjs: the jelly letters, ported from Unix Jelly. JellyBody (one letter), JellyWorld (scene, camera,
  dragging, bumping, tidying, riding).
- src/sound.mjs: the piano sampler for the learner's notes, and the jelly's noises (boing, squeak).
- src/midi-in.mjs: Web MIDI reader (from Great Piano Teachers, plus `first`: listen only to the first keyboard found).
  With no keyboard the page shows `#notice` over everything and the lesson does not start.
- src/main.mjs: wires it together. `window.__mj` is for tests and the console: `midi([status, note, force])` acts as a
  keyboard would, `tap()`, `state()`.
- tools/: flow-test.mjs and terrain-test.mjs (node only), page-test.mjs (headless Chrome, via tools/page.mjs).

## Things that were hard to get right (read before changing them)

- Axes: y = 0 is the white keys' tops, z = 0 is the line letters stand on. Unix Jelly's code assumes a floor at y = 0
  and homes at z = 0 (`place`, `shuffleHome`), which is why the octave is placed that way round.
- A letter on its own key (JellyWorld.ride): the key drops away and the letter hangs in the air (about 0.13 s) and
  lands; when the key returns the letter is thrown up a little (the owner asked for both, and for lower gravity: 2.4).
  While near home it is eased back over its spot, and the speed the key gives it is capped (SLING.most). Hammering a
  key may still throw it off; the owner accepts that, as long as it picks itself up. The test checks it gets home.
- For a jelly a key's top is LEVEL under a letter's feet (keyboard.mjs `topOf`), though the drawn key slopes. A sloping
  top tipped the letter forwards at every press.
- Letters are heavier at the foot (BALLAST). At even weight a capital F fell over on landing and could not stand.
  `isFallen` also counts a letter tipped on its side, since F is nearly as wide as tall.
- Found keys stay green (`keys.keep`, fed from `flow.state.found` through `kb.shown`).
- The game (`next: 'order'`): the six other letters in a shuffled order, shown as chips in the panel (`#panelOrder`).
- The ground under a jelly that is NOT riding comes back up no faster than FLOOR_RISE_MOST.
- tools/page-test.mjs holds these: the letter must stay on its key through 40 presses at four speeds.
- The view (main.mjs `view`): 35 degrees down (the owner's choice), at least KEYS_SHOWN (0.6) of the keys' length.
  A letter is about 82 pixels tall on one octave and 16 on all 88 keys, in a 1280 by 720 window.
- The panel `more` has `widen`: the keyboard opens out to 88 keys and each known letter appears on every key of its
  name (eight Cs). A letter belongs to one key (`b.key`, a MIDI number).
- The tests plug a pretend keyboard in through the real Web MIDI calls (tools/page.mjs `fakeMidi`).
- A sound worklet cannot be loaded through Playwright's request interception, so the piano's sound is only tested
  when the folder is really served (MJ_URL).

- src/hand3d.mjs: the right hand over C to G. It is Great Piano Teachers' hand (src/piano-hand, copied unchanged; the
  rigged skin is /hand, CC0) used without its planner: each fingertip is held on its key and goes down with it. For the
  jellies the hand is 40 balls that push them aside (`world.pushers`), and once landed a flat invisible ledge over each
  finger (`kb.setSupports`), whose top follows 0.7 of its key's dip. A letter stands up on whatever is solid at its
  home (`place` asks the terrain), so the same homes serve keys and ledges.
- For the hand the camera rises to 62 degrees (HAND_VIEW): at 35 the back of the hand hides fingers, keys and letters.
- With the hand: the sky light is turned down and a raking lamp added (HAND_LIGHT; skin takes little of the room,
  SKIN_ROOM), the camera flies once round the hand as it lands (HELI), and then the learner may fly it: drag on empty
  space, wheel, double tap to put it back (ORBIT, `orbit` in main.mjs; applied at the end of `view`). A tap on empty
  space still goes on; a drag that starts on a jelly drags the jelly.
- Seen once in a still taken while the hand was landing: a jelly's eyes with no body to be seen near them. Probably a
  jelly pulled thin between the hand's balls and a ledge (thin jelly is nearly clear). Not looked into.
- Repeat after me (`next: 'repeat'`, `roundsOf`): the hand plays a round at 120 beats a minute (main.mjs `playDemo`,
  on the picture's clock), main calls `flow.demoDone()`, the panel says "Your turn!", and the learner plays it back.
  `flow.judge` says how a pressed key lights: right green, wrong red (only here), plain orange. Three wrong keys for
  one note flash the right key yellow three times (`keys.hint`, HINT). The letters sit on the rail (`b.homeZ`): the
  jelly bounds therefore reach behind the rail. The hand is cartoon yellow so it is nobody's skin (owner).
- In scripted edits, never put a `//` comment in the middle of a dense line: it swallowed `this.lidNow = 0` once.
- Lessons (flow.mjs LESSONS): runs of panels. The side list (`#lessons`) picks one, the trail along the top says where
  the learner is, and Retry begins the current one again: all three call `flow.jump(n)`, whose `reset` effect makes
  main.mjs clear everything (`clearAll`) and put the letters that lesson begins with on their keys. `fresh` counts
  resets so that timers and the hand's loading from before a reset do nothing after it. Lesson names are the owner's
  phrases from the panels; he has not confirmed them as names.
- Stranded letters (jelly.mjs STRANDED): tidying waits for every letter to be still, and one caught under the hand
  never is; so a letter away from home and ungripped for 8 s pops home. Without it the hand step sometimes left four
  letters on the table for good (seen in one test run in three).
- Finger numbers (hand3d.mjs NUMBER): a sprite over each fingertip, 1 thumb to 5 little finger, drawn over the hand;
  it rises and grows while its key is down.
- A key lights green only if the lesson is asking for it (`flow.wants`); otherwise orange. Found keys stay green.

- Microphone (version 1: one note at a time). src/listen.mjs is the detector, pure: windows of sound in, key down and
  key up events out (McLeod pitch method, then rules for a note beginning, changing, being struck again and dying
  away; each rule's comment says which wrong hearing it prevents). src/mic.mjs reads the microphone through an
  AnalyserNode once a picture frame (nothing on the audio thread) and asks the browser for no echo cancelling, noise
  suppression or automatic gain. main.mjs feeds its events to the same `heard()` as MIDI. In microphone mode the page
  does not sound the learner's notes, the jellies' noises are off (`sound.hush`), and it does not listen while the
  hand plays (DEAF). tools/listen-test.mjs runs the detector on the app's own piano samples; tools/mic-test.mjs plays
  those samples into a pretend microphone stream in the page. Both are clean studio sound.
  It is JavaScript, not yet the Rust core the owner has in mind: the rules were still changing.

- index.html writes its own import map with a time stamp on each of the page's modules (the OWN list there), so a
  reload always gets matching code. Add new modules to that list.

## Not done, not known
- The microphone has never heard a real room, a real instrument, or the page's own loudspeaker. Never run on an iPad
  or in Safari. An iPad needs the page served over https.

- Never run with a real MIDI keyboard or listened to. Latency of the learner's notes is unmeasured.
- Nothing follows "Well done! You found all the white letters!" yet. The black keys are the owner's to decide.
- No count shown of how many Cs were found.
- Performance on an old computer is unmeasured (Unix Jelly has a perf test; this has none).
- Only Cs so far: letters on neighbouring keys (C beside D) have not been run here.

## House rules (the owner's)

No magic numbers. No em or en dashes in copy. UK English. Claims of "working" must be tested, with proof.
Only the owner commits. Open no network port without asking (other agents share this machine).
