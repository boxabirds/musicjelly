// MIDI in: a keyboard plugged into the computer, read through the browser's Web MIDI.
// decode() turns the bytes of one message into what the page cares about: a key going down, a key coming up, or the
// sustain pedal. openMidi() listens to every input there is, or with `first` only to the first one found (and to ones
// plugged in later), and reports the names of those it listens to.
// Nothing here touches the page; src/main.js decides what a key does.
const STATUS_HIGH = 0xf0, NOTE_OFF = 0x80, NOTE_ON = 0x90, CONTROL = 0xb0, SUSTAIN = 64, DATA_MAX = 127, PEDAL_DOWN_FROM = 64;
// One message -> { type: 'on' | 'off' | 'pedal' | null, midi, vel (0..1), down }. A note-on with no force is a note-off.
export function decode(bytes) {
  const none = { type: null, midi: 0, vel: 0, down: false };
  if (!bytes || bytes.length < 3) return none;
  const kind = bytes[0] & STATUS_HIGH, a = bytes[1] & DATA_MAX, b = bytes[2] & DATA_MAX;
  if (kind === NOTE_ON && b > 0) return { type: 'on', midi: a, vel: b / DATA_MAX, down: true };
  if (kind === NOTE_OFF || kind === NOTE_ON) return { type: 'off', midi: a, vel: 0, down: false };
  if (kind === CONTROL && a === SUSTAIN) return { type: 'pedal', midi: 0, vel: b / DATA_MAX, down: b >= PEDAL_DOWN_FROM };
  return none;
}
export const MIDI_STATUS = { unsupported: 'MIDI: not supported in this browser', refused: 'MIDI: permission refused', none: 'MIDI: none found', asking: 'MIDI: asking' };
export const midiStatus = names => (names.length ? 'MIDI: ' + names.join(', ') : MIDI_STATUS.none);
// Ask for the keyboards. onEvent(decoded message, time in ms on performance.now()'s clock); onDevices(names, status text).
// Resolves to { ok, status }; never throws (no Web MIDI, or the visitor says no, is a status, not an error).
export async function openMidi({ onEvent, onDevices, first = false, nav = globalThis.navigator }) {
  if (!nav || typeof nav.requestMIDIAccess !== 'function') { onDevices([], MIDI_STATUS.unsupported); return { ok: false, status: MIDI_STATUS.unsupported }; }
  let access;
  try { access = await nav.requestMIDIAccess({ sysex: false }); } catch (_) { onDevices([], MIDI_STATUS.refused); return { ok: false, status: MIDI_STATUS.refused }; }
  const heard = e => { const d = decode(e.data); if (d.type) onEvent(d, e.timeStamp); };
  const listen = () => {
    const names = [];
    // first: only the first keyboard found is listened to; the others are let go
    access.inputs.forEach(input => { const use = input.state !== 'disconnected' && !(first && names.length); input.onmidimessage = use ? heard : null; if (use) names.push(input.name || 'unnamed keyboard'); });
    onDevices(names, midiStatus(names)); return names;
  };
  access.onstatechange = e => { if (!e.port || e.port.type === 'input') listen(); };
  const names = listen();
  return { ok: true, status: midiStatus(names), access };
}
