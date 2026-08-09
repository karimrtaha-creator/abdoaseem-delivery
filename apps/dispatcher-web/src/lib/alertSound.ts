// No bundled audio asset - both alerts are synthesized with the Web Audio
// API so there's nothing to fetch/ship. Browsers block audio until the
// page has seen a user gesture; the login button click covers that for
// the rest of the session, so no extra "enable sound" step is needed.
let ctx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(frequency: number, startOffset: number, durationSec: number) {
  const audioCtx = getContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + startOffset);
  gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + startOffset + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + startOffset + durationSec);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(audioCtx.currentTime + startOffset);
  osc.stop(audioCtx.currentTime + startOffset + durationSec + 0.05);
}

/** New order waiting for dispatch: two-note pleasant chime. */
export function playNewOrderChime() {
  tone(880, 0, 0.15);
  tone(1175, 0.16, 0.2);
}

/** Order stuck in preparing past the threshold: faster, lower, more urgent. */
export function playPrepDelayAlarm() {
  tone(440, 0, 0.12);
  tone(440, 0.18, 0.12);
  tone(440, 0.36, 0.12);
}

/** A customer cancelled their own pending order: distinct falling tone, so
 * it's never confused with the rising new-order chime or the flat prep alarm. */
export function playCancellationAlert() {
  tone(660, 0, 0.14);
  tone(523, 0.16, 0.14);
  tone(392, 0.32, 0.22);
}
