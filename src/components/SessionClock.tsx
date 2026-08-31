"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The two-clock model.
 *
 * A mode change deliberately does NOT restart the session: the engine carries
 * its phase across a switch, so the Initiation -> Transition -> Deep structure
 * keeps progressing. That leaves the readout with a problem. It cannot reset,
 * because nothing reset. It must not ignore the switch either, because
 * something clearly happened.
 *
 * So it briefly becomes two clocks:
 *
 *   rolling  - a red copy of the session number peels off to the left and
 *              spends itself back down to 0:00. It lands exactly as the
 *              settle tick sounds, so the number reaching zero and the mode
 *              audibly setting in are one event rather than two.
 *   settling - the red clock counts up from 0:00 through the settling
 *              window, while the session clock carries on undisturbed.
 *   summing  - the separator becomes a "+" and the red clock folds into the
 *              session clock: the time this mode spent settling is now
 *              simply part of the session.
 *
 * The stage machine lives in the page, which owns the engine and the
 * once-a-second readout. This component owns only the reel, because that is
 * the one part that has to run per frame rather than per second.
 *
 * PAUSING. A settle can be interrupted, and an interrupted settle is not a
 * cancelled one: the mode did change, and it has not finished setting in. So
 * both timed stages carry a nullable wall-clock stamp rather than a fixed
 * duration, and a null stamp means suspended. The reel holds exactly where it
 * stopped until the session comes back to finish it.
 */
export type SplitStage = "rolling" | "settling" | "summing";

export interface Split {
  /** Identity of this run. Every mode change increments it and restarts. */
  id: number;
  stage: SplitStage;
  /**
   * Where the reel starts, in session seconds. Rewritten to the reel's frozen
   * value if a pause interrupts the roll, so a resume continues from there
   * rather than jumping back to the whole number.
   */
  from: number;
  /** Duration of the CURRENT roll segment, in ms. A resume shortens it. */
  rollMs: number;
  /**
   * performance.now() at the start of the current roll segment, or null while
   * the roll is suspended by a pause.
   */
  rollStart: number | null;
  /** Seconds since this mode settled. Meaningful from `settling` onward. */
  modeElapsed: number;
  /**
   * performance.now() the settling window began, back-dated across pauses so
   * that `modeElapsed` counts listening time rather than wall time. Null
   * while suspended, and before the tick has sounded.
   */
  settleStart: number | null;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Slot-machine easing: the reel takes a moment to pick up, runs fast through
 * the middle, and decelerates into its stop.
 *
 * A plain ease-out would dump most of the descent into the first half second
 * and then crawl for three and a half more, which reads as a number being
 * corrected rather than as a reel being spun.
 *
 * Exported because the page has to evaluate it at the instant of a pause, to
 * find the value the reel had reached. Two implementations of the same curve
 * would eventually disagree, and the disagreement would show up as the number
 * jumping the moment you pressed P.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Props {
  /** Section name at the current session offset. */
  label: string;
  /** Session seconds. */
  elapsed: number;
  paused: boolean;
  /** False before the first start: renders blank but keeps the row height. */
  visible: boolean;
  split: Split | null;
  /** Length of the settling window, in seconds. */
  settleSeconds: number;
}

export default function SessionClock({
  label,
  elapsed,
  paused,
  visible,
  split,
  settleSeconds,
}: Props) {
  const [reel, setReel] = useState(0);
  const rafRef = useRef(0);

  // Read as primitives so the reel effect depends only on the things that
  // should restart it. `split` itself is replaced once a second while
  // settling, and re-running the animation every second would be a bug.
  const stage: SplitStage | null = split ? split.stage : null;
  const runId = split ? split.id : 0;
  const from = split ? split.from : 0;
  const rollMs = split ? split.rollMs : 0;
  const rollStart = split ? split.rollStart : null;

  useEffect(() => {
    if (stage !== "rolling") return;

    // Suspended by a pause. `from` was rewritten to the value the reel had
    // reached, so holding it is the whole behaviour: no animation, no reset,
    // and the number on screen is the number the roll will resume from.
    if (rollStart === null) {
      setReel(from);
      return;
    }

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // The number is the information; the spin is the theatre. Drop the
      // theatre and land on the same value.
      setReel(0);
      return;
    }

    setReel(from);
    // Timed from the page's stamp rather than from a local one, so the value
    // the page computes at a pause is the value that was actually on screen.
    const step = () => {
      const p = rollMs > 0 ? Math.min(1, (performance.now() - rollStart) / rollMs) : 1;
      setReel(from * (1 - easeInOutCubic(p)));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [runId, stage, from, rollMs, rollStart]);

  const modeSeconds =
    stage === "rolling"
      ? reel
      : stage === "summing"
        ? settleSeconds
        : split
          ? split.modeElapsed
          : 0;

  // role="timer" rather than aria-live. A polite live region on a value that
  // changes every second announces the clock every second, which is unusable;
  // `timer` is the role for exactly this and is implicitly live="off". The
  // mode change itself is still announced, by the radiogroup.
  return (
    <div className="readout" role="timer">
      {visible ? (
        <>
          <span className="rlabel" data-hot={stage !== null}>
            {stage !== null ? "settling" : label}
          </span>
          <span
            className="rsplit"
            data-open={stage !== null}
            data-stage={stage ?? "none"}
            aria-hidden={stage === null}
          >
            <span className="rmode">{formatClock(modeSeconds)}</span>
          </span>
          <span className="rsep" data-sum={stage === "summing"}>
            {stage === "summing" ? "+" : "\u00b7"}
          </span>
          <span className="rsession">{formatClock(elapsed)}</span>
          {paused && <span className="rpaused">{"\u00b7 paused"}</span>}
        </>
      ) : (
        <span>&nbsp;</span>
      )}
    </div>
  );
}
