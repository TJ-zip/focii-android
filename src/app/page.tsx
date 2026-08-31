"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Visualizer, { type VisualMode } from "../components/Visualizer";
import CommandCenter from "../components/CommandCenter";
import MeasurePane from "../components/MeasurePane";
import Philosophy from "../components/Philosophy";
import ModeDot, { type ArmState, type HintScope } from "../components/ModeDot";
import SkipPrompt, {
  SKIP_AT_SHIFT,
  SKIP_AT_START,
  SKIP_HOLD,
} from "../components/SkipPrompt";
import Blackout, { type Screen } from "../components/Blackout";
import Wordmark from "../components/Wordmark";
import SessionClock, {
  easeInOutCubic,
  type Split,
} from "../components/SessionClock";
import {
  FociiEngine,
  SETTLE_DELAY,
  resumeSettleDelay,
} from "../audio/engine";
import { SECTIONS, sectionAt } from "../audio/presets";
import {
  isRecording,
  saveSession,
  setRecording as setRecordingPref,
  MIN_RECORD_SECONDS,
  type LiveSession,
} from "../lib/sessions";
import { KEYS, ensureMigrated } from "../lib/storage";

type Mode = VisualMode;

/**
 * The modes carry a label and nothing else.
 *
 * They used to carry a one-line blurb rendered under the name. It was
 * removed deliberately: a caption that explains the mechanism is a caption
 * that keeps the mechanism in view, and the whole point of the session
 * structure is that you stop noticing it. One of those blurbs also stated
 * the 3 -> 12 -> 75 progression as though it were a property of Focus, when
 * it is the shape of every session in every mode. That explanation now lives
 * in Philosophy, where it can be read once, on purpose.
 */
const MODES: { id: Mode; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "relax", label: "Relax" },
  { id: "sleep", label: "Sleep" },
  { id: "pump", label: "Pump" },
];

/** Set once the user has successfully started a session on this device. */
const STARTED_KEY = KEYS.started;
/**
 * Set once the onboarding tail of the hint sequence - lines two and three -
 * has been seen or acted on. Line one is never gated by this.
 */
const HINTS_KEY = KEYS.hints;

/**
 * How long the red clock counts before the two clocks merge.
 *
 * Taken from the session structure rather than hardcoded: it is the same
 * window a fresh session spends in Initiation, so a mode change is measured
 * against the same yardstick as a beginning.
 */
const SETTLE_SECONDS = SECTIONS[0][1];

/** How long the "+" is held before the red clock folds away, in ms. */
const SUM_HOLD = 1700;

/**
 * Arrow-key arming.
 *
 * Scrolling and clicking the mode bar are unambiguous gestures: you had to
 * reach for the bar to perform them. An arrow key is not - it is one stray
 * finger away while reading, and a stray mode change costs a 2.5 s crossfade
 * and a settle tick. So the first arrow press does NOT move. It arms.
 *
 * ARM_WINDOW - the second press must land inside this to count as a
 * deliberate double. Long enough for an unhurried double tap, short enough
 * that two unrelated presses a second apart are not read as one intent.
 *
 * ARM_IDLE - once armed, single presses keep stepping. The arming decays this
 * long after the last press, so a navigation burst stays fluid but walking
 * away and coming back starts from safe again.
 */
const ARM_WINDOW = 650;
const ARM_IDLE = 2500;

/**
 * Space is "begin", not "toggle" - pressing it while already playing is
 * deliberately inert. That inertness is a signal: someone pressing it twice
 * in quick succession is asking a question. Two dead presses inside this
 * window is the threshold at which the dot answers.
 *
 * It answers EVERY time, for the life of the app. A question asked again
 * deserves answering again; only the unprompted follow-up lines retire.
 */
const DEAD_SPACE_WINDOW = 1600;
const DEAD_SPACE_TRIGGER = 2;

/**
 * The recall flash.
 *
 * The dot answers one question - "how do I pause" - and it answers it
 * forever. What it can no longer answer, once its tail has retired, is the
 * larger question underneath a user who keeps pressing anyway: is this all
 * there is? That answer lives in the command centre, so the corner where the
 * command centre lives briefly says so itself.
 *
 * TIP_DELAY is measured from the moment the blob opens, and lands while line
 * one is still up (it holds 3.2 s). The two are meant to read as one gesture:
 * the app answers the question asked, then points at where the rest of the
 * answers are. Leading with the pointer, or showing it alone, would be
 * answering a question that was not asked.
 */
const TIP_DELAY = 1500;
const TIP_HOLD = 2400;

/**
 * Visually hidden, still announced.
 *
 * Kept as an inline style rather than a global class because it is used in
 * exactly one place, and globals.css is long enough that a class used once is
 * a class nobody will remember is load-bearing.
 */
const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * The in-flight session.
 *
 * `since` is a performance.now() stamp for the span currently running, or
 * null while paused. `acc` holds completed seconds per mode. Time is taken
 * from performance.now() rather than the AudioContext clock because the
 * audio clock does not exist while paused and is rebuilt on resume, whereas
 * what is being measured is wall-clock listening.
 */
interface Tracker {
  startedAt: number;
  mode: Mode;
  since: number | null;
  acc: Record<string, number>;
}

/**
 * True when the key event originated in something the user is typing into.
 * Space and P must never be stolen from a text field. There are no text
 * fields today, but a global keydown handler that does not check this is a
 * bug waiting for the first <input> anyone adds.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

/**
 * True when a real, activatable control holds focus.
 *
 * The global handler swallows Space to stop the page scrolling, which had the
 * side effect of making Space unable to press any button in the app - the
 * browser's own "activate the focused button" behaviour never got to run. So
 * Space steps aside when a button or link is focused, which is the only
 * circumstance in which the browser would have done something useful with it.
 */
function isActivatable(el: Element | null): boolean {
  const tag = (el as HTMLElement | null)?.tagName?.toUpperCase();
  return tag === "BUTTON" || tag === "A";
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("focus");
  const modeRef = useRef<Mode>("focus");
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrollTimer = useRef<number | null>(null);
  const animUntil = useRef(0); // ignore nearest-center while a programmatic smooth scroll runs
  const wheelAccum = useRef(0);
  const wheelLock = useRef(0);
  const active = MODES.find((m) => m.id === mode)!;

  const engineRef = useRef<FociiEngine | null>(null);
  const startingRef = useRef(false);
  /**
   * Session offset to resume from, in seconds. Pause writes the engine's
   * elapsed time here; the next start passes it back as `phase`, so pausing
   * holds your place in the Initiation -> Transition -> Deep structure
   * instead of dropping you back at the beginning.
   */
  const phaseRef = useRef(0);
  /**
   * One seed for the life of the tab, so a pause/resume produces a
   * continuation of the same session rather than a different one.
   */
  const seedRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [philosophyOpen, setPhilosophyOpen] = useState(false);
  const [hasStarted, setHasStarted] = useState(true); // assume yes until localStorage says otherwise
  const [session, setSession] = useState({ name: "", elapsed: 0 });

  /** Which full-screen screen is up, if any. */
  const [screen, setScreen] = useState<Screen | null>(null);
  /**
   * Mirror of `screen` for the key handler. Without it the handler would have
   * to depend on `screen` and be re-bound on every toggle, and the Escape
   * branch would have to make its decision inside a setState updater - which
   * React StrictMode invokes twice in development, so any side effect placed
   * there fires twice.
   */
  const screenRef = useRef<Screen | null>(null);

  /** Whether the stop-settling-in offer is currently on screen. */
  const [skipOpen, setSkipOpen] = useState(false);
  /**
   * What the offer window is measuring from.
   *
   * The window effect has to know whether it woke up because the mode
   * changed or because the session started, and its dependency list cannot
   * tell it: [mode, playing] fires identically for both. So the previous
   * values are kept explicitly. Refs rather than state, because they are
   * written during the same effect that reads them and must not cause a
   * render of their own.
   */
  const skipPrevMode = useRef<Mode>("focus");
  const skipPrevPlaying = useRef(false);

  /**
   * Text for the polite live region.
   *
   * Both features are otherwise silent to a screen reader for opposite
   * reasons: skipping the ramp changes nothing visible at all, and a screen
   * changes everything at once with no explanation of how to undo it.
   */
  const [announce, setAnnounce] = useState("");

  /**
   * True while any dialog owns the keyboard. All three are mutually
   * exclusive - opening one closes the others - so this is really "is a
   * dialog up", but naming it after the rule keeps the intent visible when a
   * fourth panel is inevitably added.
   */
  const modalOpen = commandOpen || measureOpen || philosophyOpen;

  // Measurement. The tracker is a ref because it is written from a keydown
  // handler, a visibilitychange listener and an unmount cleanup - none of
  // which can wait for a render. `live` is the rendered projection of it,
  // refreshed only while the pane is actually open.
  const tracker = useRef<Tracker | null>(null);
  const [live, setLive] = useState<LiveSession | null>(null);
  const [recording, setRecordingState] = useState(true);
  const recordingRef = useRef(true);

  /**
   * The split timer's stage machine.
   *
   * A mode change does not restart the session, so the clock cannot reset -
   * but something plainly happened, so it must not sit there either. It
   * splits in two for one settling window and then merges back:
   *
   *   rolling  -> the red copy spends the session number back down to 0:00,
   *               landing exactly as the settle tick sounds
   *   settling -> it counts up through the settling window
   *   summing  -> "+" appears and the two clocks fold together
   *
   * `splitId` only ever increases, so a mode change that interrupts a split
   * in progress cannot be finished by the previous run's timers.
   *
   * Both timed stages are suspendable. A pause nulls the relevant wall-clock
   * stamp; a resume restores it. Nothing about a split is derived from the
   * audio clock, because the audio clock does not survive a pause - the
   * engine is destroyed and rebuilt, and its modeElapsed restarts at zero.
   */
  const [split, setSplit] = useState<Split | null>(null);
  const splitId = useRef(0);
  /**
   * Mirror of `split` for the benefit of startAudio, which must read it
   * inside a user-gesture handler and therefore cannot depend on it.
   */
  const splitRef = useRef<Split | null>(null);

  // Arrow arming. The ref carries the logic (it must be readable from inside
  // a keydown handler without re-binding the listener); the state exists only
  // so the red dot can show what the keyboard is currently willing to do.
  const armRef = useRef<{ armed: boolean; dir: 0 | 1 | -1; at: number }>({
    armed: false,
    dir: 0,
    at: 0,
  });
  const armTimer = useRef<number | null>(null);
  const [armState, setArmState] = useState<ArmState>("idle");

  // Dot hint sequence. Same split as the arming state: refs for anything the
  // key handler reads, state only for what renders.
  const [hintRun, setHintRun] = useState(0);
  const [hintScope, setHintScope] = useState<HintScope>("full");
  const hintRunRef = useRef(0);
  const hintsSeenRef = useRef(false);
  const deadSpace = useRef({ n: 0, at: 0 });
  /** The Command tip, opened by the app rather than by a pointer. */
  const [tipFlash, setTipFlash] = useState(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    hintRunRef.current = hintRun;
  }, [hintRun]);

  useEffect(() => {
    splitRef.current = split;
  }, [split]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // Read on the client only: touching localStorage during render would drive
  // the server and client markup apart and produce a hydration mismatch.
  useEffect(() => {
    ensureMigrated();
    try {
      setHasStarted(window.localStorage.getItem(STARTED_KEY) === "1");
      const seen = window.localStorage.getItem(HINTS_KEY) === "1";
      hintsSeenRef.current = seen;
      setHintScope(seen ? "short" : "full");
    } catch {
      setHasStarted(true); // private mode / storage blocked: just stay quiet
      hintsSeenRef.current = true;
      setHintScope("short");
    }
    const rec = isRecording();
    recordingRef.current = rec;
    setRecordingState(rec);
  }, []);

  /**
   * Open the Command tip a beat into the blob, then close it.
   *
   * Gated on `hintsSeenRef` rather than on `hintScope`, deliberately: a
   * first-time sequence ENDS on "Press Shift + C", so flashing the corner at
   * the same time would be the app saying one thing in two places. Reading
   * the ref also means the scope flipping to "short" as that first sequence
   * finishes cannot retro-fire a flash for the run that just taught it.
   */
  useEffect(() => {
    if (hintRun === 0 || !hintsSeenRef.current) return;
    const on = window.setTimeout(() => setTipFlash(true), TIP_DELAY);
    const off = window.setTimeout(
      () => setTipFlash(false),
      TIP_DELAY + TIP_HOLD
    );
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
      setTipFlash(false);
    };
  }, [hintRun]);

  // --- measurement --------------------------------------------------------

  /** Bank the running span. Idempotent: `since` is advanced as it goes, so
      calling this twice in a row adds nothing the second time. */
  const flushSpan = useCallback(() => {
    const t = tracker.current;
    if (!t || t.since === null) return;
    const now = performance.now();
    const dt = (now - t.since) / 1000;
    if (dt > 0) t.acc[t.mode] = (t.acc[t.mode] ?? 0) + dt;
    t.since = now;
  }, []);

  const snapshot = useCallback((): LiveSession | null => {
    const t = tracker.current;
    if (!t) return null;
    flushSpan();
    const spans = Object.entries(t.acc).map(([m, seconds]) => ({
      mode: m,
      seconds,
    }));
    return {
      startedAt: t.startedAt,
      total: spans.reduce((n, s) => n + s.seconds, 0),
      spans,
    };
  }, [flushSpan]);

  /**
   * Write the session out. Keyed on its start time, so the repeated calls
   * from pause / tab-hide / unmount overwrite one row rather than producing
   * four. Silently does nothing when recording is off.
   */
  const persist = useCallback(() => {
    const t = tracker.current;
    if (!t || !recordingRef.current) return;
    const snap = snapshot();
    if (!snap || snap.total < MIN_RECORD_SECONDS) return;
    saveSession({
      id: t.startedAt,
      startedAt: t.startedAt,
      endedAt: Date.now(),
      total: snap.total,
      spans: snap.spans,
    });
  }, [snapshot]);

  const toggleRecording = useCallback((on: boolean) => {
    recordingRef.current = on;
    setRecordingState(on);
    setRecordingPref(on);
    if (on) persistRef.current();
  }, []);

  // persist() is referenced by toggleRecording, which is defined first for
  // readability. A ref keeps the dependency graph acyclic without either
  // callback having to be rebuilt when the other changes.
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  // The engine crossfades between modes without restarting the session clock,
  // so changing mode mid-session keeps the Initiation -> Deep progression.
  useEffect(() => {
    // Close the running span BEFORE the mode label changes, or the time
    // spent in the old mode is credited to the new one. Runs whether or not
    // audio is playing; while paused `since` is null and this is a no-op.
    const t = tracker.current;
    if (t && t.mode !== mode) {
      flushSpan();
      t.mode = mode;
    }

    const engine = engineRef.current;
    if (!engine || !engine.running) return;

    // Read the engine's mode BEFORE changing it. setMode early-returns when
    // the mode is unchanged, which means no crossfade and no settle tick -
    // and a split started on that non-event would wait for an onSettle that
    // never comes, freezing the reel at 0:00 forever.
    const prev = engine.currentMode;
    engine.setMode(mode);
    if (prev === mode) return;

    setSplit({
      id: ++splitId.current,
      stage: "rolling",
      from: engine.elapsed,
      rollMs: SETTLE_DELAY * 1000,
      rollStart: performance.now(),
      modeElapsed: 0,
      settleStart: null,
    });
  }, [mode, flushSpan]);

  // Hold the "+", then let the red clock fold away. Keyed on the whole split
  // object, so an interrupting mode change replaces the timer rather than
  // letting a stale one clear a newer split.
  useEffect(() => {
    if (!split || split.stage !== "summing") return;
    const id = window.setTimeout(() => setSplit(null), SUM_HOLD);
    return () => window.clearTimeout(id);
  }, [split]);

  const startAudio = useCallback(async () => {
    if (startingRef.current) return;
    const engine = engineRef.current;
    if (engine && engine.running) return; // Space is "begin", not "toggle"
    startingRef.current = true;
    try {
      if (seedRef.current === null) {
        seedRef.current = Math.floor(Math.random() * 1e9);
      }

      // A settle that a pause froze partway through. The engine that had the
      // tick scheduled is gone, so the new one has to be told to finish it,
      // and the reel has to be restarted over the same remainder so that the
      // two still land together.
      const pending = splitRef.current;
      const resumeRoll =
        pending && pending.stage === "rolling" && pending.rollStart === null
          ? resumeSettleDelay(pending.rollMs / 1000)
          : null;

      // Constructed here, inside the key/click handler: browsers only allow an
      // AudioContext to start from a user gesture.
      const next = new FociiEngine({
        phase: phaseRef.current,
        seed: seedRef.current,
        settleIn: resumeRoll ?? undefined,
        // Fires at the same instant the tick sounds, so the reel landing on
        // 0:00 and the mode audibly setting in are one event, not two.
        onSettle: () =>
          setSplit((s) =>
            s
              ? {
                  ...s,
                  stage: "settling",
                  modeElapsed: 0,
                  settleStart: performance.now(),
                }
              : s
          ),
      });
      await next.start(modeRef.current);
      engineRef.current = next;
      setPlaying(true);
      setHasStarted(true);

      // Restart whichever half of the split was suspended. Stamped now rather
      // than at the pause, so the time spent paused is time the settle simply
      // did not spend - which is the whole point of freezing it.
      if (resumeRoll !== null) {
        const at = performance.now();
        setSplit((s) =>
          s && s.stage === "rolling" && s.rollStart === null
            ? { ...s, rollMs: resumeRoll * 1000, rollStart: at }
            : s
        );
      } else {
        setSplit((s) =>
          s && s.stage === "settling" && s.settleStart === null
            ? { ...s, settleStart: performance.now() - s.modeElapsed * 1000 }
            : s
        );
      }

      // A resume continues the same measured session; only a tab that has
      // never played starts a new one. This matches the audio, which resumes
      // from the same phase and the same seed.
      const t = tracker.current;
      if (t) {
        t.mode = modeRef.current;
        t.since = performance.now();
      } else {
        tracker.current = {
          startedAt: Date.now(),
          mode: modeRef.current,
          since: performance.now(),
          acc: {},
        };
      }

      try {
        window.localStorage.setItem(STARTED_KEY, "1");
      } catch {
        // storage unavailable; the hint simply shows again next visit
      }
    } catch {
      setPlaying(false);
    } finally {
      startingRef.current = false;
    }
  }, []);

  const pauseAudio = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !engine.running) return;
    const at = engine.elapsed;
    phaseRef.current = at;
    engine.stop(); // fades over EDGE_FADE, then tears the graph down
    engineRef.current = null;
    setPlaying(false);
    setSession({ name: sectionAt(at).name, elapsed: at });

    // A pause SUSPENDS a settle; it does not cancel one. The mode change
    // already happened and will still be in force on resume, so throwing the
    // split away would leave the switch without an ending: no landing, no
    // flip, no settling window. Instead both timed stages freeze in place and
    // are handed back their remainder when the session returns.
    const now = performance.now();
    setSplit((s) => {
      if (!s) return s;
      if (s.stage === "rolling" && s.rollStart !== null) {
        // Evaluate the easing at the instant of the pause, so `from` becomes
        // exactly the number that was on screen. Anything else and the reel
        // visibly jumps the moment P is pressed.
        const p =
          s.rollMs > 0 ? Math.min(1, (now - s.rollStart) / s.rollMs) : 1;
        return {
          ...s,
          from: s.from * (1 - easeInOutCubic(p)),
          rollMs: Math.max(0, s.rollMs - (now - s.rollStart)),
          rollStart: null,
        };
      }
      if (s.stage === "settling" && s.settleStart !== null) {
        // Bank the settling time so far. Paused time is not settling time.
        return {
          ...s,
          modeElapsed: (now - s.settleStart) / 1000,
          settleStart: null,
        };
      }
      return s;
    });

    // Stop the clock on the current span and bank the session. Paused time
    // is not listening time, so `since` goes null rather than continuing.
    flushSpan();
    if (tracker.current) tracker.current.since = null;
    persist();
  }, [flushSpan, persist]);

  // --- stop settling in ---------------------------------------------------

  /**
   * Take the offer.
   *
   * There are two settlings, and this ends both.
   *
   * The session's own: Initiation, 180 seconds of climbing intensity. The
   * engine does that work and reports how far it actually moved, rounded up
   * to a whole beat so a pulsed mode lands on the grid rather than a fraction
   * of a beat short of it. Zero means there was nothing to skip.
   *
   * The mode's: the red split clock counting out a settling window after a
   * mode change. That one is a display rather than a sound, but the feature
   * is called "stop settling in", and leaving a clock visibly counting
   * settling time after the user has said they are done settling would be the
   * app contradicting itself. It is folded away through the ordinary summing
   * stage, so it merges rather than vanishing.
   *
   * Doing neither is silent. This is reachable from a key chord at any time,
   * including times when there is nothing to do, and a chord that announces
   * "nothing happened" is worse than one that does nothing.
   *
   * The session clock is re-read immediately instead of waiting for the
   * once-a-second interval, because the sound changes now and a readout that
   * agrees with it a beat later reads as a bug.
   */
  const skipSettling = useCallback(() => {
    setSkipOpen(false);
    const engine = engineRef.current;
    if (!engine || !engine.running) return;

    const jumped =
      engine.elapsed < SETTLE_SECONDS ? engine.fastForward(SETTLE_SECONDS) : 0;
    if (jumped > 0) {
      const at = engine.elapsed;
      setSession({ name: sectionAt(at).name, elapsed: at });
    }

    // Read the mirror, not the state: this runs from a key handler that
    // cannot depend on `split` without being re-bound on every tick of it.
    const s = splitRef.current;
    const folding = s !== null && s.stage === "settling";
    if (folding) {
      setSplit((cur) => {
        if (!cur || cur.stage !== "settling") return cur;
        // Keep the real number rather than jumping the red clock to 3:00.
        // It did not settle for three minutes; it settled for as long as it
        // settled, and then was stopped.
        const m =
          cur.settleStart !== null
            ? (performance.now() - cur.settleStart) / 1000
            : cur.modeElapsed;
        return { ...cur, stage: "summing", modeElapsed: m };
      });
    }

    if (jumped <= 0 && !folding) return;
    setAnnounce(
      jumped > 0
        ? "Settling in skipped. The session continues at full depth."
        : "Settling window ended."
    );
  }, []);

  /**
   * The offer window.
   *
   * Two situations, one number each. A beginning gets SKIP_AT_START; a mode
   * shift gets the longer SKIP_AT_SHIFT, because a shift already has a
   * crossfade, a settle tick and a rolling red clock happening in the same
   * place. Both hold for SKIP_HOLD. See SkipPrompt.tsx for why these are two
   * constants rather than eight.
   *
   * [mode, playing] cannot distinguish the two on its own - it fires the same
   * way for a mode change, a resume, and a mode change made while paused and
   * then resumed - so the previous values are compared explicitly.
   *
   * THE GUARD. This is checked when the offer would appear rather than when
   * the timer is set, because a session can cross out of Initiation, or be
   * paused, during the few seconds in between. It used to be `elapsed >=
   * SETTLE_SECONDS -> nothing to skip`, and that was the bug: taking the
   * offer fast-forwards past SETTLE_SECONDS, which makes that test true for
   * the rest of the session, so the offer never appeared again no matter how
   * many times the mode changed. A mode shift opens a settling window of its
   * own, and that window is a real thing to be offered out of, so it counts.
   */
  useEffect(() => {
    const shifted = skipPrevMode.current !== mode;
    const resumed = !skipPrevPlaying.current && playing;
    skipPrevMode.current = mode;
    skipPrevPlaying.current = playing;

    setSkipOpen(false);
    if (!playing) return;

    const at = shifted && !resumed ? SKIP_AT_SHIFT : SKIP_AT_START;
    const show = window.setTimeout(() => {
      const engine = engineRef.current;
      if (!engine || !engine.running) return;
      const s = splitRef.current;
      const settling = s !== null && s.stage === "settling";
      if (engine.elapsed >= SETTLE_SECONDS && !settling) return;
      setSkipOpen(true);
    }, at * 1000);
    const hide = window.setTimeout(
      () => setSkipOpen(false),
      (at + SKIP_HOLD) * 1000
    );
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [mode, playing]);

  // --- blackout / whiteout ------------------------------------------------

  const toggleScreen = useCallback((kind: Screen) => {
    if (screenRef.current === kind) {
      setScreen(null);
      setAnnounce("Screen restored.");
      return;
    }
    setScreen(kind);
    setAnnounce(
      kind === "black"
        ? "Blackout. The session is still playing. Press Shift plus B, or Escape, or double click, to come back."
        : "Whiteout. The session is still playing. Press Shift plus W, or Escape, or double click, to come back."
    );
  }, []);

  const exitScreen = useCallback(() => {
    if (!screenRef.current) return;
    setScreen(null);
    setAnnounce("Screen restored.");
  }, []);

  // Refresh the pane's numbers only while it is open. A session runs for
  // hours; there is no reason to re-render a closed dialog once a second.
  useEffect(() => {
    if (!measureOpen) return;
    const tick = () => setLive(snapshot());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [measureOpen, snapshot]);

  // Save at every point the session might not survive to be saved later.
  // `visibilitychange` is the reliable one on mobile - `beforeunload` is not
  // fired at all when a backgrounded tab is discarded - and `pagehide`
  // covers desktop navigation away.
  useEffect(() => {
    const save = () => {
      flushSpan();
      persist();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", save);
    };
  }, [flushSpan, persist]);

  // --- dot hints ----------------------------------------------------------

  /**
   * Retire the onboarding tail. Line one is unaffected and keeps answering
   * dead space presses forever.
   */
  const retireTail = useCallback(() => {
    hintsSeenRef.current = true;
    setHintScope("short");
    try {
      window.localStorage.setItem(HINTS_KEY, "1");
    } catch {
      // storage unavailable; the tail may offer itself again next visit
    }
  }, []);

  /**
   * Stop the sequence. `learned` is true when the user did the thing the
   * hints were about to teach - pausing, or opening the command centre. In
   * that case the tail has nothing left to say. An arrow press only cancels:
   * the user is busy, not taught.
   */
  const cancelHints = useCallback(
    (learned: boolean) => {
      if (learned) retireTail(); // true even if no sequence is running
      if (hintRunRef.current === 0) return;
      setHintRun(0);
      deadSpace.current = { n: 0, at: 0 };
    },
    [retireTail]
  );

  const finishHints = useCallback(() => {
    setHintRun(0);
    retireTail();
  }, [retireTail]);

  /** A space press that did nothing because the session was already running. */
  const noteDeadSpace = useCallback(() => {
    if (hintRunRef.current > 0) return; // already answering
    const now = performance.now();
    const d = deadSpace.current;
    d.n = now - d.at <= DEAD_SPACE_WINDOW ? d.n + 1 : 1;
    d.at = now;
    if (d.n >= DEAD_SPACE_TRIGGER) {
      d.n = 0;
      setHintRun((r) => r + 1);
    }
  }, []);

  // --- dialogs ------------------------------------------------------------
  //
  // One panel at a time, always. Two stacked dialogs would mean two focus
  // traps fighting, and an Escape whose meaning depends on which one won.

  const openCommand = useCallback(() => {
    cancelHints(true);
    setMeasureOpen(false);
    setPhilosophyOpen(false);
    setCommandOpen(true);
  }, [cancelHints]);

  const closeAll = useCallback(() => {
    setCommandOpen(false);
    setMeasureOpen(false);
    setPhilosophyOpen(false);
  }, []);

  /**
   * Entering a screen from the command centre. The panel has to go first:
   * leaving a dialog open underneath an opaque sheet leaves a focus trap the
   * user cannot see, and an Escape that closes the wrong thing.
   */
  const screenFromPanel = useCallback(
    (kind: Screen) => {
      closeAll();
      toggleScreen(kind);
    },
    [closeAll, toggleScreen]
  );

  /**
   * Philosophy is reached from inside the command centre, and REPLACES it
   * rather than covering it. Closing it therefore returns to the command
   * centre, which is where the user was - dumping them back onto a bare
   * session would lose their place.
   */
  const openPhilosophy = useCallback(() => {
    setCommandOpen(false);
    setMeasureOpen(false);
    setPhilosophyOpen(true);
  }, []);

  const closePhilosophy = useCallback(() => {
    setPhilosophyOpen(false);
    setCommandOpen(true);
  }, []);

  // Center of an item in the track's CONTENT coordinates.
  // Measured with bounding rects, so it does not depend on which ancestor
  // happens to be the offsetParent. The original offsetLeft-based math was
  // relative to a positioned ancestor and skewed selection one item left.
  // Because this is ancestry-independent it stayed correct when PR #6 moved
  // .hud out of position:fixed into normal flow.
  const centerOf = (track: HTMLElement, el: HTMLElement) => {
    const t = track.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.left - t.left + track.scrollLeft + r.width / 2;
  };

  const nearestMode = (): Mode => {
    const track = trackRef.current;
    if (!track) return modeRef.current;
    const center = track.scrollLeft + track.clientWidth / 2;
    let best: Mode = modeRef.current;
    let bestD = Number.POSITIVE_INFINITY;
    track.querySelectorAll<HTMLElement>("[data-mode]").forEach((el) => {
      const d = Math.abs(centerOf(track, el) - center);
      if (d < bestD) {
        bestD = d;
        best = el.dataset.mode as Mode;
      }
    });
    return best;
  };

  // while the user scrolls the bar, the item nearest the center becomes active
  const onScroll = () => {
    if (performance.now() < animUntil.current) return;
    if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      const m = nearestMode();
      setMode((prev) => (prev === m ? prev : m));
    }, 80);
  };

  const scrollTo = useCallback((id: Mode) => {
    const track = trackRef.current;
    const el = track?.querySelector<HTMLElement>(`[data-mode="${id}"]`);
    if (!track || !el) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    animUntil.current = performance.now() + (reduce ? 0 : 600);
    track.scrollTo({
      left: centerOf(track, el) - track.clientWidth / 2,
      behavior: reduce ? "auto" : "smooth",
    });
    setMode(id);
  }, []);

  const stepMode = useCallback(
    (dir: 1 | -1) => {
      const i = MODES.findIndex((m) => m.id === modeRef.current);
      const next = MODES[Math.min(Math.max(i + dir, 0), MODES.length - 1)].id;
      if (next !== modeRef.current) scrollTo(next);
    },
    [scrollTo]
  );

  const clearArmTimer = () => {
    if (armTimer.current !== null) {
      window.clearTimeout(armTimer.current);
      armTimer.current = null;
    }
  };

  const disarm = useCallback(() => {
    clearArmTimer();
    armRef.current = { armed: false, dir: 0, at: 0 };
    setArmState("idle");
  }, []);

  /**
   * The gate described at ARM_WINDOW above.
   *
   *   left                       -> nothing (armed-pending)
   *   left, left                 -> one mode
   *   left, left, left           -> two modes
   *
   * Once armed, direction is free: you are demonstrably navigating, so a
   * right after a left steps immediately rather than demanding a fresh
   * double. Only the initial pair must be the same key twice.
   */
  const arrowStep = useCallback(
    (dir: 1 | -1) => {
      const now = performance.now();
      const a = armRef.current;
      clearArmTimer();

      const live2 = a.armed && now - a.at <= ARM_IDLE;
      const completesDouble =
        !a.armed && a.dir === dir && now - a.at <= ARM_WINDOW;

      if (live2 || completesDouble) {
        armRef.current = { armed: true, dir, at: now };
        setArmState("armed");
        armTimer.current = window.setTimeout(disarm, ARM_IDLE);
        stepMode(dir);
        return;
      }

      // First press of a fresh gesture. Deliberately does not move; the dot
      // pulses so the press is visibly acknowledged rather than swallowed.
      armRef.current = { armed: false, dir, at: now };
      setArmState("pending");
      armTimer.current = window.setTimeout(disarm, ARM_WINDOW);
    },
    [disarm, stepMode]
  );

  useEffect(() => clearArmTimer, []);

  // --- the single global key handler -------------------------------------
  //
  // Bound to `window`, not to a control. That is the whole point: the app has
  // no transport button any more, so no key behaviour may depend on what
  // happens to hold focus.
  //
  // `e.code` throughout, never `e.key`. `code` is the physical key, so P is
  // still P on a Dvorak or AZERTY layout, and Space is unaffected by the
  // shift state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt + K: take the stop-settling-in offer.
      //
      // Deliberately punched through the alt bail immediately below. The
      // visible offer lives for eight seconds and the decision behind it does
      // not - "I do not need to ease into this" is just as true ninety
      // seconds later - so there has to be a way to say it that does not
      // depend on having caught the word before it withdrew.
      //
      // It is also above the dialog and screen guards, unlike every other
      // key: those guard things you look at, and this is a thing you hear.
      // The session is running behind the command centre and behind a
      // blackout, and so is Initiation.
      //
      // Alt+K on macOS types a character. preventDefault stops that. There
      // are no text fields in the app, but the typing check runs first
      // anyway, for the same reason it does for Space.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyK") {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        if (e.repeat) return;
        skipSettling();
        return;
      }

      // Leave browser and OS chords alone.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // Escape, in priority order. A screen outranks a panel: it is the only
      // state in which the user can see nothing at all, so it must be the
      // first thing any exit key undoes.
      if (e.code === "Escape") {
        if (screenRef.current) {
          e.preventDefault();
          exitScreen();
        } else if (modalOpen) {
          e.preventDefault();
          // Escape means "put it all away", including from Philosophy - it
          // is the one exit that does not hand you back to the command
          // centre, because it is the key you press when you want the
          // session back.
          closeAll();
        } else if (skipOpen) {
          e.preventDefault();
          setSkipOpen(false); // declining the offer early
        }
        return;
      }

      // The two panel chords are handled before the modal guard below, so
      // each one closes the others rather than stacking dialogs. They are
      // inert behind a screen: a dialog under an opaque sheet is a focus trap
      // with nothing visible in it.
      if (e.shiftKey && e.code === "KeyC") {
        if (screenRef.current) return;
        e.preventDefault();
        if (commandOpen) closeAll();
        else openCommand(); // they found it; the hint tail has nothing to add
        return;
      }

      if (e.shiftKey && e.code === "KeyM") {
        if (screenRef.current) return;
        e.preventDefault();
        cancelHints(true);
        setCommandOpen(false);
        setPhilosophyOpen(false);
        setMeasureOpen((o) => !o);
        return;
      }

      // While a dialog is up it owns the keyboard, apart from the keys
      // handled above.
      if (modalOpen) return;

      if (e.shiftKey && e.code === "KeyB") {
        e.preventDefault();
        toggleScreen("black");
        return;
      }

      if (e.shiftKey && e.code === "KeyW") {
        e.preventDefault();
        toggleScreen("white");
        return;
      }

      if (e.code === "Space") {
        // Do not steal Space from a focused control - see isActivatable().
        if (isActivatable(document.activeElement)) return;
        e.preventDefault(); // stop the page scrolling
        if (e.repeat) return;
        const engine = engineRef.current;
        if (engine && engine.running) {
          noteDeadSpace();
          return;
        }
        void startAudio();
        return;
      }

      if (e.code === "KeyP" && !e.shiftKey) {
        e.preventDefault();
        cancelHints(true);
        pauseAudio();
        return;
      }

      // Everything below this line moves the mode bar, which is not on screen
      // behind a blackout. Changing mode by feel, with no way to see what you
      // landed on, is not a shortcut - it is a guess.
      if (screenRef.current) return;

      if (e.code === "ArrowRight" || e.code === "ArrowDown") {
        e.preventDefault();
        if (e.repeat) return; // holding the key must not rush the modes
        cancelHints(false); // busy, not taught: the hints may return
        arrowStep(1);
      } else if (e.code === "ArrowLeft" || e.code === "ArrowUp") {
        e.preventDefault();
        if (e.repeat) return;
        cancelHints(false);
        arrowStep(-1);
      } else if (e.code === "Home") {
        e.preventDefault();
        cancelHints(false);
        scrollTo(MODES[0].id);
      } else if (e.code === "End") {
        e.preventDefault();
        cancelHints(false);
        scrollTo(MODES[MODES.length - 1].id);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    arrowStep,
    cancelHints,
    closeAll,
    commandOpen,
    exitScreen,
    modalOpen,
    noteDeadSpace,
    openCommand,
    pauseAudio,
    scrollTo,
    skipOpen,
    skipSettling,
    startAudio,
    toggleScreen,
  ]);

  // session readout, and the slow half of the split timer.
  //
  // The session clock is read from the engine, i.e. from the AudioContext's
  // own clock, so a dropped or throttled interval costs a visual update and
  // never accumulated drift. The settling clock cannot use that source: it
  // has to survive a pause, and the engine that would have been measuring it
  // is destroyed by one. It is anchored to a performance.now() stamp that the
  // pause moves instead.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine || !engine.running) return;
      const e = engine.elapsed;
      setSession({ name: sectionAt(e).name, elapsed: e });

      setSplit((s) => {
        if (!s || s.stage !== "settling" || s.settleStart === null) return s;
        const m = (performance.now() - s.settleStart) / 1000;
        if (m >= SETTLE_SECONDS) {
          return { ...s, stage: "summing", modeElapsed: SETTLE_SECONDS };
        }
        return { ...s, modeElapsed: m };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing]);

  // stop audio when the page unmounts, and bank whatever was measured
  useEffect(() => {
    return () => {
      flushSpan();
      persistRef.current();
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, [flushSpan]);

  // center the initial mode once mounted
  useEffect(() => {
    const track = trackRef.current;
    const el = track?.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
    if (track && el)
      track.scrollLeft = centerOf(track, el) - track.clientWidth / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mouse wheel over the bar shifts one mode per gesture.
  // Native (non-passive) listener so vertical wheel can be intercepted;
  // horizontal trackpad deltas fall through to native scrolling.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpad swipe
      e.preventDefault();
      const now = performance.now();
      if (now < wheelLock.current) return;
      wheelAccum.current += e.deltaY;
      if (Math.abs(wheelAccum.current) < 24) return;
      const dir = wheelAccum.current > 0 ? 1 : -1;
      wheelAccum.current = 0;
      wheelLock.current = now + 280;
      stepMode(dir);
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    return () => track.removeEventListener("wheel", onWheel);
  }, [stepMode]);

  const paused = !playing && phaseRef.current > 0;

  return (
    <main>
      <Visualizer mode={mode} paused={screen !== null} />
      <Wordmark />

      {/* Borderless, top-right. Hover or keyboard focus reveals the chord, so
          the shortcut is discoverable without the label shouting it.
          `data-flash` is the app opening the same tip on its own behalf; it
          is styled identically to hover, because it is meant to look like
          the corner answering rather than like a new kind of notice. */}
      <div className="cmdcorner">
        <button
          type="button"
          className="cmdbtn"
          data-flash={tipFlash ? "true" : "false"}
          onClick={() => (commandOpen ? closeAll() : openCommand())}
          aria-haspopup="dialog"
          aria-expanded={commandOpen}
        >
          Command
          <span className="cmdtip" aria-hidden="true">
            Shift + C
          </span>
        </button>
      </div>

      <CommandCenter
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onOpenPhilosophy={openPhilosophy}
        onBlackout={() => screenFromPanel("black")}
        onWhiteout={() => screenFromPanel("white")}
      />

      <Philosophy open={philosophyOpen} onClose={closePhilosophy} />

      <MeasurePane
        open={measureOpen}
        onClose={() => setMeasureOpen(false)}
        live={live}
        recording={recording}
        onToggleRecording={toggleRecording}
      />

      <div className="hud">
        {/* The mode name and the offer are one line, rendered by one
            component, so the pair re-centres as the red word opens instead
            of the name sitting still while something grows off its right.
            Closed behind a screen, which also takes it out of the tab order
            rather than leaving an invisible button to land on. */}
        <p className="session">
          <strong>
            <SkipPrompt
              mode={mode}
              label={active.label}
              open={skipOpen && screen === null}
              onSkip={skipSettling}
            />
          </strong>
        </p>

        <SessionClock
          label={session.name}
          elapsed={session.elapsed}
          paused={paused}
          visible={playing || paused}
          split={split}
          settleSeconds={SETTLE_SECONDS}
        />

        {/* With the transport button gone, this is the only thing telling a
            first-time visitor how to begin. It never returns once they have. */}
        {!playing && !hasStarted && (
          <p className="firsthint">
            press <kbd>space</kbd> to begin
          </p>
        )}

        <div
          ref={trackRef}
          className="modebar"
          role="radiogroup"
          aria-label="Focii mode"
          tabIndex={0}
          onScroll={onScroll}
        >
          {MODES.map((m) => (
            <span
              key={m.id}
              data-mode={m.id}
              role="radio"
              aria-checked={m.id === mode}
              className="modeitem"
              onClick={() => scrollTo(m.id)}
            >
              {m.label}
            </span>
          ))}
        </div>

        {/* The dot is three things at once: the selection marker the mode bar
            scrolls against, the arrow-arming indicator, and the anchor the
            hint blob grows out of. */}
        <ModeDot
          arm={armState}
          run={hintRun}
          scope={hintScope}
          onFinish={finishHints}
        />
      </div>

      <Blackout screen={screen} onExit={exitScreen} />

      {/* Polite, not assertive: these are confirmations of something the user
          just did, not interruptions. */}
      <p role="status" aria-live="polite" style={SR_ONLY}>
        {announce}
      </p>
    </main>
  );
}
