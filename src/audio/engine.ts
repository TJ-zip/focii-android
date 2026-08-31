/**
 * Real-time generative soundscape engine (Web Audio API).
 *
 * Endel does not play back files -- it synthesises continuously and adapts. So
 * does this. Nothing is streamed, nothing is stored, and a session can run
 * indefinitely without ever repeating, because every pulse and pad event is
 * generated on the fly from the mode preset plus the session structure.
 *
 * Design notes that are easy to get wrong:
 *
 * 1. LOOKAHEAD SCHEDULING. JavaScript timers are not accurate enough to fire
 *    audio events. A `setInterval` tick wakes up every SCHEDULE_INTERVAL and
 *    schedules everything falling in the next LOOKAHEAD seconds against the
 *    AudioContext's own sample-accurate clock. Timer jitter then only affects
 *    WHEN we plan, never when a sound actually starts.
 *
 * 2. PHASE-LOCKED PULSE. Each beat gets a freshly created oscillator started at
 *    that beat's time, so every beat is identical in phase and timbre. A
 *    single free-running oscillator would drift against the beat grid and make
 *    alternate beats cancel -- see quantizeRoot() in presets.ts for the same
 *    problem on the drone layer, which measurably shifted pump's tempo.
 *
 * 3. NO ATTACK TRANSIENTS -- IN THE MUSIC. Every musical envelope is a smooth
 *    curve applied with setValueCurveAtTime: gaussian for pulses,
 *    raised-cosine for pads. There is no instantaneous gain step anywhere,
 *    which is what keeps the result non-distracting (the "string pluck"
 *    complaint from v1). The settle tick is the one deliberate exception in
 *    character -- it is meant to sound like a mechanism -- but even it rises
 *    over 2.7ms rather than stepping, so it never actually clips.
 *
 * 4. AUTOPLAY POLICY. The AudioContext must be constructed and resumed inside
 *    a user gesture, so construction is deferred to start().
 *
 * 5. ONE PURPOSE PER AudioParam. A layer has two gain stages that look
 *    redundant but are not: `bus` carries the swell modulation, `out` carries
 *    the fade. They must stay separate, because connecting a modulation source
 *    to an AudioParam SUMS with that param's scheduled value. Routing the
 *    swell into the fade param meant a layer faded to +/-0.1 rather than to 0,
 *    so disposing it truncated a non-zero waveform and produced a click. The
 *    fade param must be owned by the fade alone.
 *
 * 6. AN ENGINE IS ONE PLAYING SESSION, NOT THE SESSION. stop() tears the graph
 *    down completely; a resume builds a new engine and hands it the phase and
 *    seed of the old one. Anything that has to survive a pause must therefore
 *    be expressible as a constructor option -- it cannot live only in a
 *    scheduled node, because scheduled nodes die with the context. `settleIn`
 *    exists for exactly that reason.
 *
 * 7. SESSION POSITION IS A NUMBER, NOT A CLOCK. `phase` is the session offset
 *    a layer started at, and everything structural is derived from it rather
 *    than from wall time. That is what makes both resuming a paused session
 *    and fastForward() possible without rebuilding anything: move the number
 *    and the structure moves with it.
 */

import {
  PRESETS,
  quantizeRoot,
  sectionAt,
  type Mode,
  type Preset,
} from "./presets";

/** How far ahead of the audio clock we schedule events, in seconds. */
const LOOKAHEAD = 1.5;
/** How often the scheduler wakes up, in milliseconds. */
const SCHEDULE_INTERVAL = 250;
/** Crossfade applied when switching modes, in seconds. */
const MODE_FADE = 2.5;
/** Fade applied on start and stop, in seconds. */
const EDGE_FADE = 1.2;

/**
 * Grace period between a fade reaching zero and the layer being torn down.
 * Only needs to cover clock imprecision now that the fade truly reaches 0;
 * it is not masking any residual signal.
 */
const DISPOSE_MARGIN = 0.25;

/**
 * Delay from the start of a mode change to the settle tick, in seconds.
 *
 * Deliberately NOT tied to MODE_FADE. The crossfade wants to be short enough
 * that the transition feels responsive; the tick wants to land after the new
 * mode has audibly established itself. Coupling them meant lengthening one to
 * lengthen the other. The tick now sounds 1.5s after the crossfade completes.
 */
const TICK_DELAY = 4.0;

/**
 * How long the intensity takes to catch up after a fastForward, in seconds.
 *
 * A fast-forward can move the section intensity by 0.45 in one instant. Left
 * to updateIntensity's ordinary 250ms ramp that is a step, and a step in
 * broadband level is the one thing this engine exists to avoid. 2.5s is the
 * same figure as MODE_FADE, for the same reason: it is about as fast as a
 * whole-mix level change can move without announcing itself.
 */
const FF_GLIDE = 2.5;

/**
 * Public name for the same number.
 *
 * Exported because the UI animates a reel that must arrive at 0:00 on the
 * tick, not near it. Two constants that have to be equal but live in
 * different files will eventually stop being equal, so there is only one.
 */
export const SETTLE_DELAY = TICK_DELAY;

/**
 * How long a resumed session should wait before finishing an interrupted
 * settle, given the time that was still outstanding when it was paused.
 *
 * Bounded at both ends, and both bounds matter:
 *
 * - The lower bound is EDGE_FADE, because a resume fades the master in from
 *   silence over that long. A tick scheduled inside the fade is attenuated by
 *   it, so a pause taken with 0.2s left would produce an almost inaudible
 *   flip -- the one sound in the app that must not be missed. Waiting out the
 *   fade costs a moment and guarantees the tick lands at full weight.
 * - The upper bound is TICK_DELAY, so a corrupted or absurd remainder can
 *   never leave the reel spinning longer than a fresh mode change would.
 */
export function resumeSettleDelay(remaining: number): number {
  if (!Number.isFinite(remaining)) return EDGE_FADE;
  return Math.max(EDGE_FADE, Math.min(TICK_DELAY, remaining));
}

/** Duration of each of the two switch transients, in seconds. */
const CLICK_LEN = 0.045;
/**
 * Spacing between the two transients, in seconds.
 *
 * This single number is what separates "a switch" from "a pop". Real toggle
 * switches are two events: the lever passing its detent, then the contact
 * seating. Somewhere around 18-28ms the ear fuses them into one textured
 * object; much shorter and it is a single click, much longer and it is two.
 */
const CLICK_GAP = 0.022;
/**
 * Peak gain of the settle tick, as linear amplitude.
 *
 * Set by ear, not by rule: 0.1 was judged "a little bit too loud" and 70% of
 * it exactly right. Amplitude is linear here, so 0.07 is that 70% (-3.1 dB).
 * The tick should sit just above the noise bed -- noticed, never announced.
 */
const TICK_GAIN = 0.07;
/** Centre frequency of the first (lever) transient, in Hz. Duller. */
const CLICK_LO_HZ = 1150;
/** Centre frequency of the second (contact) transient, in Hz. Brighter. */
const CLICK_HI_HZ = 2500;

/** Sample count used for generated envelope curves. */
const CURVE_STEPS = 128;

function gaussianCurve(steps = CURVE_STEPS): Float32Array {
  // exp(-0.5 * x^2) sampled over x in [-4, 4]; the tails are ~0.0003 so the
  // forced zero at each edge introduces no audible discontinuity.
  const c = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const x = -4 + (8 * i) / (steps - 1);
    c[i] = Math.exp(-0.5 * x * x);
  }
  c[0] = 0;
  c[steps - 1] = 0;
  return c;
}

function raisedCosineCurve(
  attackFrac: number,
  steps = CURVE_STEPS
): Float32Array {
  // Symmetric swell: raised-cosine in, raised-cosine out, no flat step at
  // either end. attackFrac decides how much of the event is the rise.
  const c = new Float32Array(steps);
  const a = Math.max(1, Math.round(steps * attackFrac));
  for (let i = 0; i < steps; i++) {
    if (i < a) {
      c[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
    } else {
      const r = steps - a;
      const j = i - a;
      c[i] = 0.5 + 0.5 * Math.cos((Math.PI * j) / Math.max(1, r - 1));
    }
  }
  c[0] = 0;
  c[steps - 1] = 0;
  return c;
}

/**
 * Percussive envelope: a very fast raised-cosine rise, then exponential decay.
 *
 * Asymmetric on purpose. The gaussian used everywhere else fades IN, which no
 * physical impact does -- that symmetry is exactly why the first version of
 * the settle tick was heard as a "blip" rather than as something being struck.
 * The rise is still a curve rather than a step, so nothing clips.
 */
function clickCurve(riseFrac: number, steps = CURVE_STEPS): Float32Array {
  const c = new Float32Array(steps);
  const a = Math.max(1, Math.round(steps * riseFrac));
  for (let i = 0; i < steps; i++) {
    if (i < a) {
      c[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
    } else {
      const j = (i - a) / Math.max(1, steps - a - 1);
      c[i] = Math.exp(-5.5 * j);
    }
  }
  c[0] = 0;
  c[steps - 1] = 0;
  return c;
}

/** Mulberry32: small deterministic PRNG so a seed reproduces a session. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Layer {
  /**
   * Fade node. Its gain is owned exclusively by start/crossfade ramps, so it
   * reaches exactly 0 and the layer can be disposed without a discontinuity.
   */
  out: GainNode;
  /**
   * Content bus, sitting between every sound source and `out`. Carries the
   * slow session swell modulation. Everything a layer produces routes through
   * here so the swell applies to the layer as a whole.
   */
  bus: GainNode;
  sources: AudioScheduledSourceNode[];
  preset: Preset;
  root: number;
  freqs: number[];
  /** Index of the next beat to be scheduled. */
  nextBeat: number;
  /** Audio-clock time up to which pad events have been scheduled. */
  padCursor: number;
  rand: () => number;
  /** Audio-clock time this layer's session began. */
  startTime: number;
  /** Session offset at startTime, so a session can be resumed mid-structure. */
  phase: number;
  intensityGain: GainNode;
  /**
   * Audio-clock time until which a fastForward glide owns `intensityGain`.
   * 0 means nobody owns it and the scheduler may ramp normally.
   */
  glideUntil: number;
  stopping: boolean;
}

export interface EngineOptions {
  /** Session offset in seconds to begin at. Default 0 (start of Initiation). */
  phase?: number;
  /** Seed for reproducible pad sequences. Default random. */
  seed?: number;
  /** Master volume 0..1. Default 0.9. */
  volume?: number;
  /**
   * Seconds after start() at which to sound a settle tick, or omitted for the
   * normal case of none.
   *
   * This exists for one situation: the session was paused partway through a
   * mode settling, and is now resuming with that settle still outstanding.
   * The pending tick could not survive the pause, because stop() closes the
   * AudioContext that had it scheduled, so the resumed engine has to be told
   * to finish the job. Pass the remaining delay through resumeSettleDelay()
   * to get a value that will actually be audible.
   */
  settleIn?: number;
  /**
   * Fired when a mode change has fully settled, at the same instant as the
   * audible settle tick. Lets the UI resolve a visual transition in sync with
   * what is heard rather than guessing at a duration.
   */
  onSettle?: (mode: Mode) => void;
}

interface ResolvedOptions {
  phase: number;
  seed: number;
  volume: number;
  /** null means "no settle outstanding", which is the ordinary case. */
  settleIn: number | null;
}

export class FociiEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers: Layer[] = [];
  private timer: number | null = null;
  private mode: Mode = "focus";
  private opts: ResolvedOptions;
  private onSettle: ((mode: Mode) => void) | null;
  private gauss = gaussianCurve();
  private click = clickCurve(0.06);
  private noiseBufferCache: AudioBuffer | null = null;
  /** Sources of a scheduled-but-not-yet-sounded settle tick. */
  private tickSources: AudioScheduledSourceNode[] = [];
  /** Timer that mirrors the scheduled tick back to the UI callback. */
  private tickTimer: number | null = null;

  constructor(options: EngineOptions = {}) {
    this.opts = {
      phase: options.phase ?? 0,
      seed: options.seed ?? Math.floor(Math.random() * 1e9),
      volume: options.volume ?? 0.9,
      settleIn:
        typeof options.settleIn === "number" && Number.isFinite(options.settleIn)
          ? Math.max(0, options.settleIn)
          : null,
    };
    this.onSettle = options.onSettle ?? null;
  }

  get running(): boolean {
    return this.ctx !== null && this.timer !== null;
  }

  get currentMode(): Mode {
    return this.mode;
  }

  /** Session offset in seconds, or 0 when not running. */
  get elapsed(): number {
    const layer = this.layers[this.layers.length - 1];
    if (!this.ctx || !layer) return 0;
    return this.ctx.currentTime - layer.startTime + layer.phase;
  }

  /**
   * Age of the current mode's layer in seconds, or 0 when not running.
   *
   * Distinct from `elapsed`, which carries across a mode change. This resets
   * on every switch, and is measured from the same audio clock as `elapsed`
   * so the two can be displayed side by side without drifting apart.
   *
   * Note it is measured from the START of the crossfade, not from the settle
   * tick: a caller that wants "time since this mode set in" should subtract
   * SETTLE_DELAY and clamp at zero.
   */
  get modeElapsed(): number {
    const layer = this.layers[this.layers.length - 1];
    if (!this.ctx || !layer) return 0;
    return this.ctx.currentTime - layer.startTime;
  }

  /** Must be called from a user gesture (autoplay policy). */
  async start(mode: Mode): Promise<void> {
    if (this.running) {
      this.setMode(mode);
      return;
    }
    this.mode = mode;

    type WindowWithWebkit = Window &
      typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const w = window as WindowWithWebkit;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) throw new Error("Web Audio API is not available");

    const ctx = new Ctor();
    this.ctx = ctx;
    // Safari and Chrome both start suspended until a gesture resumes them.
    if (ctx.state === "suspended") await ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0;

    // Approximates the offline renderer's dynFlatten stage: a slow, gentle
    // levelling so no single pad swell dominates. Attack and release are long
    // so it never pumps audibly.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 30;
    comp.ratio.value = 3;
    comp.attack.value = 0.25;
    comp.release.value = 1.2;

    master.connect(comp).connect(ctx.destination);
    this.master = master;

    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(
      this.opts.volume,
      ctx.currentTime + EDGE_FADE
    );

    this.layers.push(this.buildLayer(mode, this.opts.phase, true));
    this.tick();
    this.timer = window.setInterval(() => this.tick(), SCHEDULE_INTERVAL);

    // A settle that a pause interrupted. There is no crossfade here -- the
    // mode change itself happened before the pause and its layers are long
    // gone -- so this schedules the tick alone, which is the only part of the
    // settle that was still outstanding.
    if (this.opts.settleIn !== null) {
      const at = ctx.currentTime + resumeSettleDelay(this.opts.settleIn);
      this.opts.settleIn = null; // one-shot: a later setMode owns the next one
      this.scheduleSettleTick(at, mode);
    }
  }

  /** Crossfade to another mode without interrupting the session clock. */
  setMode(mode: Mode): void {
    if (!this.ctx || mode === this.mode) {
      this.mode = mode;
      return;
    }
    this.mode = mode;
    const now = this.ctx.currentTime;
    const carriedPhase = this.elapsed;

    for (const layer of this.layers) {
      if (layer.stopping) continue;
      layer.stopping = true;
      // `out.gain` carries nothing but this ramp, so it genuinely arrives at 0.
      layer.out.gain.cancelScheduledValues(now);
      layer.out.gain.setValueAtTime(layer.out.gain.value, now);
      layer.out.gain.linearRampToValueAtTime(0, now + MODE_FADE);
      window.setTimeout(
        () => this.disposeLayer(layer),
        (MODE_FADE + DISPOSE_MARGIN) * 1000
      );
    }
    // The new mode inherits the session offset, so switching mode does not
    // restart Initiation -- the session keeps progressing.
    const next = this.buildLayer(mode, carriedPhase, false);
    this.layers.push(next);

    // Mark the arrival, not the departure: the tick lands well after the
    // crossfade has finished, so it reads as "this mode has set in", not as a
    // transition artefact. Scheduling it here also cancels any tick still
    // pending from a mode change the user scrolled straight past.
    this.scheduleSettleTick(now + TICK_DELAY, mode);
  }

  /**
   * Jump the session forward to a later offset without restarting anything.
   *
   * Used to skip the settling-in period: the 180s Initiation section exists to
   * let a session arrive gradually, and sometimes the listener has already
   * arrived. Returns the number of seconds actually skipped, or 0 if the
   * session is not running or is already at or past `toPhase`.
   *
   * What makes this safe to do mid-flight:
   *
   * - NOTHING IS REBUILT. Oscillators, the noise bed, the pad PRNG and the
   *   seed all keep running. This is not a seek; the sound does not restart,
   *   it is the same sound with a later structural position. That is also why
   *   it survives a later pause for free -- the UI carries `elapsed` into the
   *   resumed engine's phase, and `elapsed` already includes the jump.
   *
   * - THE BEAT GRID IS PRESERVED, NOT SHIFTED. A pulse sounds at absolute time
   *   `startTime - phase + k * beat`. Raising `phase` by delta therefore pulls
   *   the entire grid delta seconds EARLIER. If delta is a whole number of
   *   beats the grid lands exactly on itself and only the beat indices move,
   *   so `nextBeat` is re-indexed by delta/beat and no beat inside the 1.5s
   *   lookahead is dropped or played twice. Delta is rounded UP rather than to
   *   nearest, so the jump always reaches the target -- rounding down by half
   *   a beat would leave the session 0.3s short of actually leaving Initiation.
   *
   * - PADS ARE UNAFFECTED BY DESIGN. `padCursor` lives on the audio clock, not
   *   the session clock, so pads already in flight keep sounding and the next
   *   inter-arrival gap is drawn as usual. Pad density does not depend on
   *   section, so there is nothing to correct.
   *
   * The one visible seam: pulses already scheduled inside the lookahead carry
   * the intensity they were baked with, for up to 1.5s. Against a 2.5s glide
   * that is not perceptible.
   */
  fastForward(toPhase: number): number {
    const ctx = this.ctx;
    if (!ctx || !this.running || !Number.isFinite(toPhase)) return 0;
    const current = this.elapsed;
    if (toPhase <= current) return 0;

    const now = ctx.currentTime;
    let delta = toPhase - current;

    // Snap against the mode that is actually sounding. A crossfading-out layer
    // is skipped below anyway, so its tempo must not get a vote here.
    const head = this.layers[this.layers.length - 1];
    const headBpm = head?.preset.bpm ?? 0;
    if (headBpm > 0) {
      const beat = 60 / headBpm;
      delta = Math.ceil(delta / beat) * beat;
    }
    if (delta <= 0) return 0;

    for (const layer of this.layers) {
      if (layer.stopping) continue;
      layer.phase += delta;

      const beat = layer.preset.bpm > 0 ? 60 / layer.preset.bpm : 0;
      if (beat > 0) layer.nextBeat += Math.round(delta / beat);

      const target = sectionAt(now - layer.startTime + layer.phase).intensity;
      const g = layer.intensityGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(target, now + FF_GLIDE);
      layer.glideUntil = now + FF_GLIDE;
    }

    return delta;
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.cancelSettleTick();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + EDGE_FADE);
    const layers = this.layers;
    this.layers = [];
    this.ctx = null;
    this.master = null;
    window.setTimeout(() => {
      for (const layer of layers) this.disposeLayer(layer);
      void ctx.close();
    }, (EDGE_FADE + 0.3) * 1000);
  }

  setVolume(v: number): void {
    this.opts.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(this.opts.volume, now + 0.15);
    }
  }

  // -------------------------------------------------------------------------

  /**
   * The sound of a mode having settled: a light switch being flipped.
   *
   * Two things make a switch sound like a switch rather than like a
   * notification:
   *
   * - IT HAS NO PITCH. The source is filtered noise, not oscillators. Anything
   *   with a definite fundamental is heard as a tone, and a short tone is a
   *   blip. A mechanism is broadband.
   * - IT IS TWO EVENTS, NOT ONE. A toggle switch clicks as the lever passes
   *   its detent, then again as the contact seats, roughly 20ms later. The ear
   *   fuses the pair into a single textured object -- that texture is the
   *   entire difference between "mechanical" and "electronic". The first
   *   transient is duller and quieter (a lever moving), the second brighter
   *   and louder (metal meeting metal).
   *
   * Both use a percussive envelope rather than the engine's usual symmetric
   * gaussian: an impact decays, it does not fade in. The rise is still 2.7ms
   * of raised cosine rather than a step, so this stays within the engine's
   * no-instantaneous-gain-step rule and cannot produce a real click artefact
   * of the kind fixed elsewhere in this file.
   */
  private scheduleSettleTick(at: number, mode: Mode): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    this.cancelSettleTick();

    const burst = (start: number, hz: number, q: number, gain: number) => {
      const src = ctx.createBufferSource();
      const buf = this.noiseBuffer(ctx);
      src.buffer = buf;
      // Start from a random point in the shared noise buffer so repeated
      // flips are not bit-identical -- a mechanism is never exactly the same
      // twice, and identical repetition is itself a synthetic cue.
      const offset = Math.random() * (buf.duration - CLICK_LEN - 0.01);

      const env = ctx.createGain();
      // No setValueAtTime before the curve: the curve is already 0 at index 0,
      // and an automation event inside a curve's window is a spec violation.
      env.gain.setValueCurveAtTime(this.click, start, CLICK_LEN);

      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = hz;
      bp.Q.value = q;

      const amp = ctx.createGain();
      amp.gain.value = TICK_GAIN * gain;

      src.connect(env).connect(bp).connect(amp).connect(master);
      src.start(start, offset, CLICK_LEN);
      src.onended = () => {
        src.disconnect();
        env.disconnect();
        bp.disconnect();
        amp.disconnect();
        this.tickSources = this.tickSources.filter((s) => s !== src);
      };
      return src;
    };

    this.tickSources = [
      burst(at, CLICK_LO_HZ, 0.9, 0.55),
      burst(at + CLICK_GAP, CLICK_HI_HZ, 1.1, 1),
    ];

    if (this.onSettle) {
      const delay = Math.max(0, (at - ctx.currentTime) * 1000);
      this.tickTimer = window.setTimeout(() => {
        this.tickTimer = null;
        this.onSettle?.(mode);
      }, delay);
    }
  }

  /** Silences a pending settle tick, e.g. when the user keeps scrolling. */
  private cancelSettleTick(): void {
    for (const s of this.tickSources) {
      try {
        s.stop();
      } catch {
        // already stopped or never started
      }
      s.disconnect();
    }
    this.tickSources = [];
    if (this.tickTimer !== null) {
      window.clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private buildLayer(mode: Mode, phase: number, immediate: boolean): Layer {
    const ctx = this.ctx!;
    const p = PRESETS[mode];
    const now = ctx.currentTime;

    // Fade stage. Nothing else may touch this param -- see design note 5.
    const out = ctx.createGain();
    out.gain.value = immediate ? 1 : 0;
    if (!immediate) {
      out.gain.setValueAtTime(0, now);
      out.gain.linearRampToValueAtTime(1, now + MODE_FADE);
    }
    out.connect(this.master!);

    // Content bus. Slow session swell modulates this instead of the fade, so
    // the swell survives for the life of the layer without ever preventing it
    // from reaching silence.
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(out);

    const swellLfo = ctx.createOscillator();
    swellLfo.frequency.value = 1 / p.swell;
    const swellAmt = ctx.createGain();
    swellAmt.gain.value = 0.1;
    swellLfo.connect(swellAmt).connect(bus.gain);
    swellLfo.start(now);

    const intensityGain = ctx.createGain();
    intensityGain.gain.value = sectionAt(phase).intensity;
    intensityGain.connect(bus);

    const root = quantizeRoot(p.root, p.bpm);
    const freqs: number[] = [];
    for (let o = p.pad.octLo; o < p.pad.octHi; o++) {
      for (const s of p.scale) freqs.push(root * Math.pow(2, o + s / 12));
    }

    const sources: AudioScheduledSourceNode[] = [swellLfo];

    // --- 1. sub drone with slowly panned upper harmonic ----------------------
    const f0 = root / 2;
    const sub = ctx.createOscillator();
    sub.frequency.value = f0;
    const subGain = ctx.createGain();
    subGain.gain.value = p.sub.gain;
    sub.connect(subGain).connect(bus);

    // Phase modulation in the offline renderer is an index in radians; the
    // equivalent frequency deviation is index / period Hz.
    const fmLfo = ctx.createOscillator();
    const fmPeriod = p.swell * 1.7;
    fmLfo.frequency.value = 1 / fmPeriod;
    const fmAmt = ctx.createGain();
    fmAmt.gain.value = p.sub.fmDepth / fmPeriod;
    fmLfo.connect(fmAmt).connect(sub.frequency);

    // The 1.5x harmonic is what actually moves across the stereo field -- this
    // is the "directional bass" effect. The fundamental stays centred so the
    // low end never wanders.
    const sub2 = ctx.createOscillator();
    sub2.frequency.value = f0 * 1.5;
    const sub2Gain = ctx.createGain();
    sub2Gain.gain.value = p.sub.h2gain * 0.5;
    const panner = ctx.createStereoPanner();
    panner.pan.value = 0;
    const panLfo = ctx.createOscillator();
    panLfo.frequency.value = 1 / p.sub.panPeriod;
    const panAmt = ctx.createGain();
    panAmt.gain.value = 0.7;
    panLfo.connect(panAmt).connect(panner.pan);
    sub2.connect(sub2Gain).connect(panner).connect(bus);

    sub.start(now);
    sub2.start(now);
    fmLfo.start(now);
    panLfo.start(now);
    sources.push(sub, sub2, fmLfo, panLfo);

    // --- 4. filtered noise bed ----------------------------------------------
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer(ctx);
    noiseSrc.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = p.noise.cut;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = p.noise.gain;
    noiseSrc.connect(lp).connect(noiseGain).connect(intensityGain);
    noiseSrc.start(now);
    sources.push(noiseSrc);

    const beat = p.bpm > 0 ? 60 / p.bpm : 0;
    return {
      out,
      bus,
      sources,
      preset: p,
      root,
      freqs,
      nextBeat: beat > 0 ? Math.ceil(phase / beat) : 0,
      padCursor: now,
      rand: mulberry32(this.opts.seed + mode.length * 7919),
      startTime: now,
      phase,
      intensityGain,
      glideUntil: 0,
      stopping: false,
    };
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBufferCache) return this.noiseBufferCache;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    for (let i = 0; i < len; i++) l[i] = Math.random() * 2 - 1;
    // Right channel is the left delayed by one sample: decorrelated enough to
    // feel wide, correlated enough to stay mono-compatible.
    r[0] = 0;
    for (let i = 1; i < len; i++) r[i] = l[i - 1];
    this.noiseBufferCache = buf;
    return buf;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (const layer of this.layers) {
      if (layer.stopping) continue;
      this.updateIntensity(layer);
      this.schedulePulses(layer, horizon);
      this.schedulePads(layer, horizon);
    }
  }

  private updateIntensity(layer: Layer): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // A fastForward glide owns this param until it lands. Two ramps on one
    // AudioParam do not blend, they fight: this 250ms ramp would restart from
    // wherever the glide currently is and re-target the same value four times
    // a second, flattening a 2.5s curve into a staircase.
    if (now < layer.glideUntil) return;
    const target = sectionAt(now - layer.startTime + layer.phase).intensity;
    // Ramp over one scheduler period so the 0.25 s staircase is inaudible.
    layer.intensityGain.gain.linearRampToValueAtTime(
      target,
      now + SCHEDULE_INTERVAL / 1000
    );
  }

  private schedulePulses(layer: Layer, horizon: number): void {
    const ctx = this.ctx!;
    const p = layer.preset;
    if (p.pulse.gain <= 0 || p.bpm <= 0) return;
    const beat = 60 / p.bpm;
    const sigma = p.pulse.sigma;
    const dur = 8 * sigma;

    // Beat k occurs at session offset k*beat, i.e. audio time
    // startTime - phase + k*beat.
    const origin = layer.startTime - layer.phase;
    while (origin + layer.nextBeat * beat - 4 * sigma < horizon) {
      const k = layer.nextBeat++;
      const centre = origin + k * beat;
      const t0 = centre - 4 * sigma;
      if (t0 < ctx.currentTime) continue;

      const intensity = sectionAt(k * beat).intensity;
      const alt = p.pulse.panAlt;
      const pan = alt > 0 ? (k % 2 === 0 ? -alt : alt) * 2 : 0;

      const g = ctx.createGain();
      // The curve is already 0 at index 0; an explicit setValueAtTime here
      // would be an automation event inside the curve's own window, which the
      // spec makes a NotSupportedError.
      g.gain.setValueCurveAtTime(this.gauss, t0, dur);

      const amp = ctx.createGain();
      amp.gain.value = p.pulse.gain * intensity;

      const pn = ctx.createStereoPanner();
      pn.pan.value = pan;

      const thump = ctx.createOscillator();
      thump.frequency.value = p.pulse.thump;
      const body = ctx.createOscillator();
      body.frequency.value = p.pulse.body;
      const bodyGain = ctx.createGain();
      bodyGain.gain.value = 0.4;

      thump.connect(g);
      body.connect(bodyGain).connect(g);
      g.connect(amp).connect(pn).connect(layer.bus);

      thump.start(t0);
      body.start(t0);
      thump.stop(t0 + dur);
      body.stop(t0 + dur);
      thump.onended = () => {
        thump.disconnect();
        body.disconnect();
        bodyGain.disconnect();
        g.disconnect();
        amp.disconnect();
        pn.disconnect();
      };
    }
  }

  private schedulePads(layer: Layer, horizon: number): void {
    const ctx = this.ctx!;
    const p = layer.preset;
    if (p.pad.gain <= 0) return;
    const meanGap = 60 / p.pad.perMin;

    while (layer.padCursor < horizon) {
      // Exponential inter-arrival times give a natural, non-mechanical spread.
      const gap = -Math.log(1 - layer.rand()) * meanGap;
      layer.padCursor += Math.max(0.4, gap);
      const t0 = layer.padCursor;
      if (t0 < ctx.currentTime) continue;

      const f = layer.freqs[Math.floor(layer.rand() * layer.freqs.length)];
      const len = p.pad.lenMin + layer.rand() * (p.pad.lenMax - p.pad.lenMin);
      const detune = 0.9985 + layer.rand() * 0.003;

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f * detune;

      // A quiet fifth above adds body without adding a new pitch class, so it
      // cannot clash: the pentatonic set stays consonant in any combination.
      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.value = f * 1.5;
      const osc2Gain = ctx.createGain();
      osc2Gain.gain.value = 0.28;

      const env = ctx.createGain();
      // As above: no automation event inside the curve's window.
      env.gain.setValueCurveAtTime(
        raisedCosineCurve(p.pad.attackFrac),
        t0,
        len
      );

      const amp = ctx.createGain();
      amp.gain.value = p.pad.gain;

      const pn = ctx.createStereoPanner();
      pn.pan.value = layer.rand() * 1.4 - 0.7;

      osc.connect(env);
      osc2.connect(osc2Gain).connect(env);
      env.connect(amp).connect(pn).connect(layer.intensityGain);

      osc.start(t0);
      osc2.start(t0);
      osc.stop(t0 + len);
      osc2.stop(t0 + len);
      osc.onended = () => {
        osc.disconnect();
        osc2.disconnect();
        osc2Gain.disconnect();
        env.disconnect();
        amp.disconnect();
        pn.disconnect();
      };
    }
  }

  private disposeLayer(layer: Layer): void {
    for (const s of layer.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
      s.disconnect();
    }
    layer.intensityGain.disconnect();
    layer.bus.disconnect();
    layer.out.disconnect();
    this.layers = this.layers.filter((l) => l !== layer);
  }
}
