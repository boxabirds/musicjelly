// The microphone: asks for it, and hands the newest sound to the listener (src/listen.mjs) once a picture frame.
// The sound is read on the page's own thread through an AnalyserNode into one buffer made once, so nothing is
// created on the audio thread and nothing is created per frame.
// The browser's own speech processing is asked to stay off: echo cancelling, noise suppression and automatic gain are
// made for voices and damage a piano's long steady notes. Whether a browser obeys is reported in `settings`
// (on iPad Safari this has not been tried).
import { createListener } from './listen.mjs';

const WINDOW = 2048, WANT = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
export const MIC_STATUS = { unsupported: 'This browser cannot use a microphone here (it needs https).', refused: 'The microphone was not allowed.' };

// ctx: the page's AudioContext. Resolves to { ok, status, mic }. mic.hear(deaf) returns the note events of this frame
// (an array reused by the next call); while `deaf` it returns none and the listener keeps what it had.
export async function openMic(ctx, nav = globalThis.navigator) {
  if (!nav.mediaDevices || !nav.mediaDevices.getUserMedia) return { ok: false, status: MIC_STATUS.unsupported };
  let stream; try { stream = await nav.mediaDevices.getUserMedia({ audio: WANT, video: false }); } catch (_) { return { ok: false, status: MIC_STATUS.refused }; }
  if (ctx.state === 'suspended') await ctx.resume();
  const source = ctx.createMediaStreamSource(stream), analyser = ctx.createAnalyser(); analyser.fftSize = WINDOW; analyser.smoothingTimeConstant = 0; source.connect(analyser);      // not connected to the loudspeaker
  const buf = new Float32Array(WINDOW), listener = createListener(ctx.sampleRate, WINDOW), none = [], track = stream.getAudioTracks()[0];
  const mic = {
    listener, name: (track && track.label) || 'microphone', settings: track && track.getSettings ? track.getSettings() : {},
    hear(deaf) { if (deaf) return none; analyser.getFloatTimeDomainData(buf); return listener.hear(buf, ctx.currentTime); },
    // stop listening: the events that let go of any note still held
    stop() { stream.getTracks().forEach(t => t.stop()); source.disconnect(); return listener.reset(); },
  };
  return { ok: true, status: 'Microphone: ' + mic.name, mic };
}
