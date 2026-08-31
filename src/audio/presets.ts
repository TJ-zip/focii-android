/**
 * Mode presets and session structure for the generative engine.
 *
 * These values are shared verbatim with generator/engine_ref.py, the offline
 * Python reference renderer. The sandbox that authors this project has no
 * browser, so the reference renderer is the only way to MEASURE engine output
 * (tempo, transient count, dynamic range). Any change made here must be made
 * there too, or the two will silently drift apart.
 *
 * That is not left to discipline: `python3 generator/engine_ref.py --check`
 * parses this file and fails when the two disagree, and CI runs it.
 *
 * focus/* values are measured from the Endel Focus reference profile
 * (generator/endel_focus_profile.json). relax/sleep/pump are design defaults
 * awaiting reference-track profiling.
 */

export type Mode = "focus" | "relax" | "sleep" | "pump";

export interface SubPreset {
  gain: number;
  h2gain: number;
  panPeriod: number;
  fmDepth: number;
}

export interface PulsePreset {
  gain: number;
  sigma: number;
  thump: number;
  body: number;
  panAlt: number;
}

export interface PadPreset {
  gain: number;
  lenMin: number;
  lenMax: number;
  perMin: number;
  octLo: number;
  octHi: number;
  attackFrac: number;
}

export interface NoisePreset {
  cut: number;
  gain: number;
}

export interface Preset {
  root: number;
  scale: number[];
  bpm: number;
  swell: number;
  sub: SubPreset;
  pulse: PulsePreset;
  pad: PadPreset;
  noise: NoisePreset;
  dynFlatten: number;
}

export const PRESETS: Record<Mode, Preset> = {
  focus: {
    root: 110.0,
    scale: [0, 3, 5, 7, 10],
    bpm: 60.1,
    swell: 25.9,
    sub: { gain: 0.3, h2gain: 0.22, panPeriod: 33.7, fmDepth: 3.0 },
    pulse: { gain: 0.3, sigma: 0.055, thump: 70.0, body: 220.0, panAlt: 0.1 },
    pad: {
      gain: 0.038,
      lenMin: 9.0,
      lenMax: 16.0,
      perMin: 14.0,
      octLo: 1,
      octHi: 3,
      attackFrac: 0.45,
    },
    noise: { cut: 1200.0, gain: 0.035 },
    dynFlatten: 0.35,
  },
  relax: {
    root: 98.0,
    scale: [0, 2, 5, 7, 9],
    bpm: 0.0,
    swell: 38.0,
    sub: { gain: 0.26, h2gain: 0.16, panPeriod: 51.0, fmDepth: 2.0 },
    pulse: { gain: 0.0, sigma: 0.09, thump: 60.0, body: 180.0, panAlt: 0.0 },
    pad: {
      gain: 0.055,
      lenMin: 14.0,
      lenMax: 26.0,
      perMin: 10.0,
      octLo: 1,
      octHi: 3,
      attackFrac: 0.48,
    },
    noise: { cut: 700.0, gain: 0.03 },
    dynFlatten: 0.25,
  },
  sleep: {
    root: 73.42,
    scale: [0, 3, 5, 7, 10],
    bpm: 0.0,
    swell: 55.0,
    sub: { gain: 0.34, h2gain: 0.12, panPeriod: 74.0, fmDepth: 1.2 },
    pulse: { gain: 0.0, sigma: 0.12, thump: 50.0, body: 150.0, panAlt: 0.0 },
    pad: {
      gain: 0.04,
      lenMin: 20.0,
      lenMax: 34.0,
      perMin: 6.0,
      octLo: 0,
      octHi: 2,
      attackFrac: 0.49,
    },
    noise: { cut: 380.0, gain: 0.055 },
    dynFlatten: 0.2,
  },
  pump: {
    root: 110.0,
    scale: [0, 3, 5, 7, 10],
    bpm: 122.0,
    swell: 16.0,
    sub: { gain: 0.3, h2gain: 0.26, panPeriod: 21.0, fmDepth: 4.0 },
    // panAlt 0: a driving mode needs every beat equally weighted and centred.
    // Alternating the pan per beat halves every second beat in each channel,
    // which reads as a limp rather than momentum.
    pulse: { gain: 0.42, sigma: 0.03, thump: 62.0, body: 220.0, panAlt: 0.0 },
    pad: {
      gain: 0.042,
      lenMin: 5.0,
      lenMax: 11.0,
      perMin: 22.0,
      octLo: 1,
      octHi: 4,
      attackFrac: 0.3,
    },
    noise: { cut: 2400.0, gain: 0.028 },
    dynFlatten: 0.15,
  },
};

/**
 * Lock the sustained drone to the beat grid.
 *
 * The drone runs on absolute time while the pulse restarts at every beat.
 * Unless the drone completes a whole number of cycles per beat, its phase at
 * successive beat centres drifts, so it reinforces some beats and cancels
 * others. That is an audible wobble in beat weight -- and it measurably
 * dragged pump's tempo from 122 BPM to 118 (a 55 Hz drone against a 62 Hz
 * thump repeats only every ~2.3 beats).
 *
 * Rounding to an EVEN cycle count also lands the 1.5x harmonic on a whole
 * cycle. The root is re-derived from the quantised drone so every other layer
 * stays exactly in tune with it; only absolute pitch moves (<2%), which is
 * inaudible in isolation and irrelevant for ambient material.
 */
export function quantizeRoot(root: number, bpm: number): number {
  if (bpm <= 0) return root;
  const beat = 60.0 / bpm;
  const k = Math.max(2.0, 2.0 * Math.round(((root / 2.0) * beat) / 2.0));
  return (2.0 * k) / beat;
}

/** Session structure: applies to ALL modes (user decision 2026-08-18). */
export const SECTIONS: ReadonlyArray<readonly [string, number]> = [
  ["initiation", 180.0],
  ["transition", 720.0],
  ["deep", 4500.0],
];

export interface SectionState {
  name: string;
  intensity: number;
}

/** Section name and intensity (0..1) at a given session offset, in seconds. */
export function sectionAt(elapsed: number): SectionState {
  if (elapsed < 180.0) {
    // Initiation: rises from near-silence to working level.
    return { name: "initiation", intensity: 0.35 + 0.45 * (elapsed / 180.0) };
  }
  const t = elapsed - 180.0;
  const cycle = t % (720.0 + 4500.0);
  if (cycle < 720.0) {
    // Transition: gentle lift into the long block.
    return { name: "transition", intensity: 0.7 + 0.15 * (cycle / 720.0) };
  }
  // Deep: settled, with one slow breathe across the 4500 s (75 min) deep
  // block, after which transition + deep repeat as an 87-minute cycle.
  //
  // A previous version of this comment said "~110 min per Endel's model".
  // No span in this file is 110 minutes, so the number was describing
  // nothing; the durations above are the authoritative ones.
  const u = (cycle - 720.0) / 4500.0;
  return { name: "deep", intensity: 0.82 + 0.1 * Math.sin(2 * Math.PI * u) };
}
