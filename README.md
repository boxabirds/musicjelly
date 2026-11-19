# Music Jelly

The piano keyboard for children, taught by jelly letters. Needs a MIDI keyboard and Chrome.

So far: the first lesson. One octave of piano keys seen from above; a message panel; a jelly letter C that falls onto the
C key, can be dragged about, falls asleep when other keys are played, and squeaks and wakes when any C is played. When
the first C is found the keyboard opens out to all 88 keys with a C jelly on every C. The first MIDI keyboard found is
used; with none, the page asks for one.

## Run it

    npm install
    npm run serve          # python3 -m http.server 8770, then open http://localhost:8770

It must be served over http (not opened as a file), and from `localhost` or https, because the browser only gives
MIDI and the sound engine to those. Chrome asks once for permission to use MIDI devices.

Tap the message panel or press the space bar to go on. Sound starts with that first tap (a browser rule: a MIDI key
does not count as a tap).

`?keys=1` shows the whole length of the keys (everything is then smaller); `?down=45` changes the camera's angle.

## Test it

    npm test                                  # the lesson's rules, the ground the jelly stands on, the page (no sound)
    MJ_URL=http://localhost:8770/ node tools/page-test.mjs --shots=/tmp/mj      # the page as served, with the piano's sound

The page test plays the whole lesson in headless Chrome: taps, MIDI messages given to the page as a keyboard would
send them, and a drag with the mouse. No test uses a real keyboard or listens to the loudspeaker.

## What it is made from

- The jelly letters are Unix Jelly's (`~/expts/unixjelly`, GPL): the soft-body physics, the see-through material, the
  googly eyes, standing back up, and walking home. `src/jelly.mjs` says exactly what was copied and what changed.
- The keys and the piano's sound are Great Piano Teachers' (`~/expts/greatpianoteachers`): key shapes and sizes, the
  WebAssembly sampler (`worklet.js`, `sampler.wasm`) and its MIDI reader (`src/midi-in.mjs`).
- Piano samples (`smp/`): Salamander Grand Piano by Alexander Holm, CC BY 3.0. The page carries the credit.
- Letters: Titan One, SIL Open Font License 1.1 (`tools/TitanOne-Regular.ttf`; `npm run font` makes
  `fonts/titan-notes.json` from it).
- three.js 0.187, loaded from `node_modules` by an import map. There is no build step.
