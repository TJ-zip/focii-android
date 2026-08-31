"use client";

/**
 * The offer to stop settling in.
 *
 * A session opens in Initiation: 180 seconds during which intensity climbs
 * from 0.35 to 0.80 so the sound arrives rather than starts. That ramp is the
 * right default and the wrong one for a listener who is already in the state
 * the mode is trying to produce. This is the escape hatch, and it is phrased
 * as a question rather than a command because it is asking permission to be
 * more, not offering to be less. Nothing is killed by taking it -- the session
 * is fast-forwarded past the ramp and continues normally.
 *
 * WHAT IT LOOKS LIKE, AND WHY.
 *
 * It is a word, not a control. The first version of this was a bordered pill
 * floating in the gap above the session clock, and it read as a notification
 * -- a thing the app had decided to show you -- rather than as part of the
 * readout you were already looking at. So it now sits directly beside the
 * mode name, in the mode name's own font, size, weight, tracking and case,
 * differing only in colour. FOCUS ATTACK? is one line saying one thing.
 *
 * The line is a centred flex row, so the pair re-centres continuously as the
 * red word opens out of zero width. Nothing else on the page moves: the row
 * is the same height with the word as without it.
 *
 * WHY IT WITHDRAWS. An always-available button would be a permanent
 * invitation to fiddle, which is the opposite of what this app is for. It
 * appears a few seconds in -- long enough that the mode is audible and the
 * question is answerable -- and leaves on its own after SKIP_HOLD. Ignoring
 * it is a valid answer and costs nothing.
 *
 * WHY MISSING IT IS NOT FINAL. The window is short and the decision is not:
 * "I do not need to ease into this" is just as true ninety seconds in as it
 * is at four and a half seconds. Alt+K therefore does exactly what clicking
 * the word does, at any point while there is still something to skip, whether
 * or not the word is on screen. The visible offer is a prompt, not the only
 * door.
 */

import { useRef } from "react";
import type { Mode } from "@/audio/presets";
import styles from "./SkipPrompt.module.css";

/**
 * The word, per mode.
 *
 * Always a question, and always the question that mode's listener would
 * actually be asking -- not a generic "Skip". Focus wants to attack the work;
 * relax wants to feel better; sleep wants it easier; pump wants it harder. The
 * verb belongs to the listener's goal, not to the software's mechanism.
 */
export const SKIP_LABELS: Record<Mode, string> = {
  focus: "Attack?",
  relax: "Better?",
  sleep: "Easier?",
  pump: "Harder?",
};

/**
 * Seconds after a session begins before the offer appears.
 *
 * These used to differ per mode -- 1s for pump, 4s for focus -- on the theory
 * that each mode becomes recognisable at a different speed. In practice the
 * variation was invisible as design and merely made the app's behaviour
 * unpredictable: the same gesture produced a different result depending on
 * which word happened to be under the dot. One number is a rule; four numbers
 * are a mood.
 *
 * 4.5s is after the settle tick at 4.0s, deliberately. The tick is the app
 * confirming the mode has set in; the question follows that confirmation
 * rather than pre-empting it.
 */
export const SKIP_AT_START = 4.5;

/**
 * Seconds after a mode shift before the offer appears.
 *
 * Longer than SKIP_AT_START because a shift is not a beginning. The 2.5s
 * crossfade has to finish, the settle tick has to land at 4.0s, and the red
 * split clock has to finish rolling down to 0:00 -- three things already
 * happening in the same corner of the screen. 7.0s is the first moment the
 * readout is quiet again.
 */
export const SKIP_AT_SHIFT = 7.0;

/** Seconds the offer stays up once it has appeared. The same everywhere. */
export const SKIP_HOLD = 8.0;

interface Props {
  mode: Mode;
  /** The mode name. Rendered here so the pair can be centred as one block. */
  label: string;
  open: boolean;
  onSkip: () => void;
}

export default function SkipPrompt({ mode, label, open, onSkip }: Props) {
  // The word is frozen while the offer is on screen. Without this, changing
  // mode during the withdrawal would swap it mid-fade, and the prompt would
  // appear to be answering a question nobody asked.
  const wordRef = useRef(SKIP_LABELS[mode]);
  if (open) wordRef.current = SKIP_LABELS[mode];
  const word = wordRef.current;

  return (
    <span className={styles.row}>
      <span className={styles.name}>{label}</span>

      {/*
        Always mounted, and genuinely zero-width when closed. Mount/unmount
        would need a two-frame dance to get the opening transition to run at
        all, and would still have nothing to animate on the way out. The
        `visibility` flip -- which is delayed by exactly the exit duration --
        is what keeps a closed offer out of the tab order and out of the
        accessibility tree, so there is no invisible button to land on.
      */}
      <span className={styles.wrap} data-on={open ? "true" : "false"}>
        <button
          type="button"
          className={styles.word}
          // The visible text is one question and gives a screen reader nothing
          // to act on, so the accessible name carries the whole offer.
          aria-label={`${word} Stop settling in and go straight to the fuller sound. Or press Alt plus K.`}
          onClick={onSkip}
          tabIndex={open ? 0 : -1}
        >
          {word}
        </button>
      </span>
    </span>
  );
}
