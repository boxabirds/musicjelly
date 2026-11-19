// What a jelly can stand on: node tools/terrain-test.mjs
import { createKeyboard, KEY, FLOOR_RISE_MOST, KEY_DOWN_S, KEY_UP_S, MIDI_LOW, MIDI_HIGH, keysNamed } from '../src/keyboard.mjs';
import { checker } from './check.mjs';
const T = checker('the keyboard as ground'), SCALE = 2.84, FEET = 0.035, WHITES = 7, o = createKeyboard(SCALE, FEET), near = (a, b, e = 1e-9) => Math.abs(a - b) < e, mm = v => (v * 1000).toFixed(1) + ' mm';
const C = 60, C_SHARP = 61, D = 62, B = 71, C5 = 72, STEP = 1 / 240;
T.ok(near(o.right - o.left, WHITES * KEY.pitch * SCALE), 'seven white keys wide', mm(o.right - o.left));
T.ok(near(o.homeX(C), o.keys[C].x) && o.keys[C].x < o.keys[D].x, 'C\'s home is the middle of the leftmost key');
T.ok(o.keys[C].z1 > 0 && o.keys[C].z0 < 0, 'the home line z = 0 lies on the keys, behind their front edge', mm(o.front));
T.ok(near(o.heightAt(o.keys[C].x, 0), 0), 'a white key\'s top is at 0');
T.ok(near(o.heightAt(o.keys[C_SHARP].x, o.keys[C_SHARP].z1 - 0.01), KEY.blackTop * SCALE), 'a black key\'s top is above it', mm(KEY.blackTop * SCALE));
T.ok(near(o.heightAt(o.left - 0.01, 0), o.tableY) && near(o.heightAt(0, o.front + 0.01), o.tableY) && o.tableY < 0, 'beside and in front of the keys is the table, lower', mm(o.tableY));
T.ok(o.heightAt(0, o.rail.z1 - 0.001) === o.rail.top, 'the rail stands behind them');
{ // a point just under a key top goes up, and says by how much
  const p = Float64Array.from([o.keys[C].x, -0.003, 0]), up = o.resolve(p, 0);
  T.ok(near(p[1], 0) && near(up, 0.003) && near(p[0], o.keys[C].x), 'a point just under a key top is lifted onto it', mm(up));
}
{ // two keys at the same height: a point under the seam goes up, not across (it would go back and forth for ever)
  const seam = o.keys[C].x1, p = Float64Array.from([seam + 0.0004, -0.002, 0]); o.resolve(p, 0);
  T.ok(near(p[1], 0) && near(p[0], seam + 0.0004), 'at the seam of two level keys a point goes up, not sideways');
}
{ // a point deep inside the keys' front face comes out of the front
  const p = Float64Array.from([o.keys[D].x, o.tableY + 0.005, o.front - 0.002]), up = o.resolve(p, 0);
  T.ok(up === 0 && p[2] > o.front && near(p[1], o.tableY + 0.005), 'a point pressed into the keys\' front comes out forwards', mm(p[2] - o.front));
}
{ // the key goes down: at once for the jelly, and its front further than its back
  o.press(C); for (let t = 0; t < KEY_DOWN_S + STEP; t += STEP) o.step(STEP);
  T.ok(near(o.down[C], 1) && near(o.floor[C], 1), 'a pressed key is fully down after its travel time');
  const front = o.heightAt(o.keys[C].x, o.front - 1e-6), home = o.heightAt(o.keys[C].x, 0), feet = o.heightAt(o.keys[C].x, -FEET), back = o.heightAt(o.keys[C].x, o.rail.z1 + 1e-6);
  T.ok(home < -0.9 * o.dip && home > -o.dip, 'the home line goes down nearly the whole dip', `${mm(home)} of ${mm(o.dip)}`);
  T.ok(near(front, home) && near(feet, home), 'under a letter\'s feet the top is level, from behind the home line to the front edge', `front ${mm(front)}, feet ${mm(feet)}`);
  T.ok(back > home && back < 0, 'further back it goes down less: the key turns about its back end', `at the rail ${mm(back)}`);
  T.ok(near(o.dip, KEY.swing * KEY.whiteLong * SCALE) && Math.abs(o.dip / SCALE - 0.0114) < 0.0005, 'the dip is the piano\'s, scaled', mm(o.dip / SCALE) + ' before scaling');
  T.ok(near(o.heightAt(o.keys[D].x, 0), 0), 'its neighbour stays up');
  // beside the pressed key its neighbour is a wall: a point in D below D's top but above C's goes sideways into C
  const p = Float64Array.from([o.keys[D].x0 + 0.0005, home / 2, 0]), up = o.resolve(p, 0);
  T.ok(up === 0 && p[0] < o.keys[D].x0, 'a point caught in the raised neighbour\'s side is put back over the pressed key');
  // release: the drawn key is up in its return time, the ground under the jelly comes up slowly
  o.release(C); let t = 0, most = 0, prev = o.floor[C], drawnUpAt = null, floorUpAt = null;
  for (; t < 2 && floorUpAt === null; t += STEP) { o.step(STEP); most = Math.max(most, (prev - o.floor[C]) * o.dip / STEP); prev = o.floor[C]; if (drawnUpAt === null && o.down[C] === 0) drawnUpAt = t; if (o.floor[C] === 0) floorUpAt = t; }
  T.ok(drawnUpAt !== null && drawnUpAt <= KEY_UP_S + STEP, 'the drawn key is back up in its return time', (drawnUpAt * 1000).toFixed(0) + ' ms');
  T.ok(most <= FLOOR_RISE_MOST * 1.001 && floorUpAt > drawnUpAt, 'the ground under a jelly comes back no faster than its limit', `${most.toFixed(3)} a second at most, up after ${(floorUpAt * 1000).toFixed(0)} ms`);
}
{ // the same note in two octaves: the key stays down until both are let go
  o.press(D); o.press(D); o.release(D); for (let i = 0; i < 60; i++) o.step(STEP);
  const held = o.down[D]; o.release(D); for (let i = 0; i < 60; i++) o.step(STEP);
  T.ok(held === 1 && o.down[D] === 0, 'a key held in two octaves stays down until both are let go');
}
{ // one octave stands for every octave; then all 88 keys
  T.ok(o.shown(C5) === C && o.shown(42) === 66 && o.shown(B + 24) === B, 'with one octave shown, a note in any octave is shown on its key there');
  T.ok(near(o.heightAt(o.keys[C5].x, 0), o.tableY), 'and beyond that octave there is only table');
  const c4 = o.homeX(C); o.setRange(MIDI_LOW, MIDI_HIGH);
  T.ok(o.homeX(C) === c4, 'opened out to 88 keys, middle C has not moved');
  T.ok(near(o.right - o.left, 52 * KEY.pitch * SCALE), 'there are 52 white keys across', mm(o.right - o.left));
  T.ok(o.shown(C5) === C5 && o.shown(MIDI_LOW) === MIDI_LOW && o.shown(MIDI_HIGH + 1) === null, 'each note is now shown on its own key; one beyond the 88 on none');
  T.ok(near(o.heightAt(o.keys[C5].x, 0), 0) && near(o.heightAt(o.keys[MIDI_LOW].x, 0), 0) && near(o.heightAt(o.keys[MIDI_HIGH].x, 0), 0), 'and every white key can be stood on, the lowest and highest too');
  const cs = keysNamed('C'); T.ok(cs.length === 8 && cs[0] === 24 && cs.at(-1) === MIDI_HIGH, 'the 88 keys have eight Cs', cs.join(' '));
  let blacks = 0; for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) if (o.keys[m].black) { blacks++; const k = o.keys[m]; if (!near(o.heightAt(k.x, k.z1 - 0.01), KEY.blackTop * SCALE)) blacks = NaN; }
  T.ok(blacks === 36, 'and 36 black keys, each standing above the white', String(blacks));
  o.press(C5); for (let i = 0; i < 20; i++) o.step(STEP);
  T.ok(o.down[C5] === 1 && o.down[C] === 0 && o.heightAt(o.keys[C5].x, 0) < 0, 'pressing the C above middle C takes that key down, not middle C');
}
T.done();
