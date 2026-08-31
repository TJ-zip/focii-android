"use client";

import { useEffect, useRef, useState } from "react";

export type ArmState = "idle" | "pending" | "armed";

/**
 * How much of the sequence to play.
 *
 * "short" - line one only. This is the steady state after the user has seen
 *   the whole thing once.
 * "full"  - all three lines. First time only.
 */
export type HintScope = "short" | "full";

/**
 * The three things a stuck user needs, in the order they need them.
 *
 * Ordering is the whole design. The first line answers the question they are
 * actually asking right now ("why won't space stop it?"). Only once that is
 * answered does the second line suggest there is a reason for the refusal,
 * and the third says where the rest of it lives. Leading with "Press Shift+C"
 * would be answering a question nobody asked.
 *
 * Line one is NOT retired after it has been seen. It is not onboarding - it
 * is the answer to a question the user asks by pressing a key that does
 * nothing, and a question asked again deserves answering again. Lines two and
 * three are onboarding, and those do retire.
 */
export const KEY_STEPS = [
  "To pause, press P",
  "Want it seamless?",
  "Press Shift + C",
] as const;

/**
 * The same three beats for a device with no keyboard. ANDROID FORK.
 *
 * Same structure, same order, same purpose - only the instruction changes,
 * because the question being answered is identical. A phone user taps, the
 * session carries on, and they ask the screen why. "Press P" is not an answer
 * to that question; it is not even a thing they can do.
 *
 * Deliberately phrased as the gesture rather than as a key name in disguise.
 * "Two-finger tap" is a thing hands do. "Press P (two fingers)" would be an
 * apology for the desktop build.
 */
export const TOUCH_STEPS = [
  "To pause, tap with two fingers",
  "Want it seamless?",
  "Swipe up from the bottom",
] as const;

/** How long each line stays up, ms. The middle one is a beat, not a read. */
const HOLD = [3200, 2700, 4100] as const;

/**
 * Time the dot spends as a plain dot between lines. Deliberately short: the
 * collapse is what makes the sequence read as one object breathing rather
 * than as three separate notifications.
 */
const GAP = 700;

/**
 * Lines two and three bloom slower than line one.
 *
 * Line one is a reply - it should arrive at roughly the speed of the key
 * press that asked for it. Two and three are unprompted; the app is
 * volunteering something, so it opens more gently. The pace is CSS
 * (`data-pace`), but the hold times above already account for the extra
 * travel so the text is not on screen for less time.
 */
const paceOf = (i: number) => (i === 0 ? "quick" : "slow");

interface Props {
  arm: ArmState;
  /**
   * Sequence control. 0 is idle and also cancels a running sequence; any
   * increment starts it from the top. A counter rather than a boolean so a
   * second request after a completed run still fires.
   */
  run: number;
  scope: HintScope;
  /**
   * Which copy to speak. ANDROID FORK: the web app hardcodes the keyboard
   * lines, because it only has one kind of user. This build serves a desktop
   * browser and a phone from the same bundle and cannot know which until it
   * is running, so the copy is a prop rather than a constant.
   *
   * Defaulted, so every existing call site keeps its current behaviour and
   * the difference stays visible at exactly one place in the page.
   */
  steps?: readonly string[];
  onFinish?: () => void;
}

export default function ModeDot({
  arm,
  run,
  scope,
  steps = KEY_STEPS,
  onFinish,
}: Props) {
  const [step, setStep] = useState(-1);
  const [shown, setShown] = useState(false);
  const timers = useRef<number[]>([]);
  const finishRef = useRef(onFinish);
  // Read, never depended on: changing scope must not restart a running
  // sequence, and `run` is the only thing allowed to schedule.
  const scopeRef = useRef(scope);
  // Same reasoning for the copy. A device that switched from mouse to touch
  // mid-sequence would otherwise restart the hint under the user's hand.
  const stepsRef = useRef(steps);

  useEffect(() => {
    finishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  useEffect(() => {
    const clearAll = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };

    clearAll();
    if (run === 0) {
      setShown(false);
      return;
    }

    const lines = scopeRef.current === "full" ? stepsRef.current.length : 1;

    // One flat schedule rather than a chain of nested callbacks: every
    // timeout id lands in the same array, so a cancel is one sweep and there
    // is no window in which a stale callback can still fire.
    let t = 0;
    for (let i = 0; i < lines; i++) {
      timers.current.push(
        window.setTimeout(() => {
          setStep(i);
          setShown(true);
        }, t)
      );
      // Clamped rather than indexed directly, so a copy set of a different
      // length than HOLD cannot schedule a timeout for `undefined` ms.
      t += HOLD[Math.min(i, HOLD.length - 1)];
      timers.current.push(window.setTimeout(() => setShown(false), t));
      t += GAP;
    }
    timers.current.push(
      window.setTimeout(() => {
        finishRef.current?.();
      }, t)
    );

    return clearAll;
  }, [run]);

  const open = shown && step >= 0;

  return (
    <div className="dotwrap">
      {/*
        The blob stays mounted and collapses via CSS rather than unmounting.
        Unmounting would make it disappear instantly on the way out, which
        breaks the illusion that the dot and the blob are one object.

        `step` is deliberately not reset when the sequence ends: clearing the
        text would re-announce an empty region, and the collapsed blob is not
        visible anyway.
      */}
      <div className="dothintlive" aria-live="polite">
        <span
          className="dothint"
          data-open={open ? "true" : "false"}
          data-pace={paceOf(Math.max(step, 0))}
        >
          {step >= 0 ? steps[step] : ""}
        </span>
      </div>
      <span
        className="modedot"
        data-arm={arm}
        data-hidden={open ? "true" : "false"}
        aria-hidden="true"
      />
    </div>
  );
}
