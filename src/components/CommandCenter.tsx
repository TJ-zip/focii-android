"use client";

import { useRef } from "react";
import { useDialogFocus } from "../lib/useDialogFocus";

/**
 * A single command row. `keys` are rendered as separate <kbd> elements so a
 * chord reads as "SHIFT + C" rather than as one opaque token.
 *
 * `sep` is what goes between them. It defaults to "+" (press together). Set
 * it to "then" for a sequence: "SHIFT + C" and "LEFT then LEFT" are entirely
 * different instructions and the panel must not render them identically.
 *
 * `action` marks a row that DOES something rather than describing a key. Such
 * a row is rendered as a real <button>, because a list item with a click
 * handler is invisible to the keyboard and announced as nothing.
 *
 * Blackout and whiteout are listed as actions rather than as plain reference
 * rows on purpose. Their chords require a Shift key, and a phone does not have
 * one; a feature reachable only from a keyboard would be a feature missing
 * from half the devices this app is meant to run on.
 */
export interface Command {
  keys: string[];
  label: string;
  detail?: string;
  sep?: string;
  action?: "philosophy" | "blackout" | "whiteout" | "measure";
}

export const COMMANDS: Command[] = [
  {
    keys: ["Space"],
    label: "Begin",
    detail:
      "Starts the session. Audio can only begin from a key press or click \u2014 browsers require it.",
  },
  {
    keys: ["P"],
    label: "Pause",
    detail:
      "Fades out and holds your place. Space resumes from the same point in the session.",
  },
  {
    keys: ["\u2190", "\u2190"],
    sep: "then",
    label: "Change mode",
    detail:
      "Press twice. The first arrow arms and does not move; the second moves, and further single presses keep moving while the dot glows. Scrolling or clicking the bar needs no such confirmation \u2014 you already reached for it.",
  },
  {
    keys: ["Alt", "K"],
    label: "Stop settling in",
    detail:
      "A session opens with three minutes of easing in. If you are already where the mode is trying to take you, a red word appears beside the mode name offering to skip the rest of it \u2014 Attack, Better, Easier, Harder, depending on the mode. It arrives four and a half seconds in, seven seconds after a mode change, and withdraws on its own after eight. Click it, or press Alt + K at any point while there is still something to skip \u2014 the word is a prompt, not the only way in.",
  },
  {
    keys: ["Shift", "M"],
    label: "Measure",
    detail:
      "How long this session has run, and how it divided between modes. History and CSV export are in the same panel. Kept on this device only, and can be switched off there.",
  },
  {
    keys: ["Shift", "C"],
    label: "Command centre",
    detail: "This panel.",
  },
  {
    keys: ["Shift", "B"],
    label: "Blackout",
    action: "blackout",
    detail:
      "Hides everything behind true black, so the screen looks switched off. The session keeps playing. Press Shift + B again, or Escape, or double click, to come back.",
  },
  {
    keys: ["Shift", "W"],
    label: "Whiteout",
    action: "whiteout",
    detail:
      "The same, in white \u2014 the screen as a lamp to read or work by. The display is kept awake where the browser allows it. Shift + W, Escape, or a double click returns.",
  },
  {
    keys: ["Esc"],
    label: "Close",
  },
  {
    keys: ["\u21B5"],
    label: "Philosophy",
    action: "philosophy",
    detail:
      "Why the session is shaped the way it is, what the click after a mode change is for, and what this app deliberately refuses to do.",
  },
];

/**
 * The same panel for a device with no keyboard. ANDROID FORK.
 *
 * Not a translation of the list above but a replacement for it. A phone user
 * reading "SHIFT + B" learns that a feature exists and that they cannot have
 * it, which is worse than not listing it, so every row here names something a
 * hand can actually do.
 *
 * Three rows differ by more than wording:
 *
 *  - MEASURE is an action here. On a keyboard it is Shift + M and the panel
 *    only has to name the chord. There is no touch gesture for it -- and
 *    inventing a fourth two-finger gesture to reach a statistics pane would
 *    be worse than a row you press -- so on touch this panel IS the way in.
 *    Without it the pane would be unreachable on Android entirely.
 *  - CLOSE names the two things that work: the cross, and the area outside.
 *    There is no Escape key to name.
 *  - CHANGE MODE has no arming step. Arming exists because a blind arrow
 *    press is ambiguous; dragging the bar with a finger is not, exactly as
 *    clicking it is not.
 */
export const TOUCH_COMMANDS: Command[] = [
  {
    keys: ["Tap"],
    label: "Begin",
    detail:
      "Tap anywhere that is not a control. Audio can only begin from a touch \u2014 browsers require it \u2014 so nothing plays until you ask.",
  },
  {
    keys: ["Tap with two fingers"],
    label: "Pause",
    detail:
      "Fades out and holds your place. A single tap resumes from the same point in the session.",
  },
  {
    keys: ["Drag the mode bar"],
    label: "Change mode",
    detail:
      "Drag the strip of mode names sideways, or tap the one you want. Whichever name comes to rest over the red dot is the mode. There is no confirmation step \u2014 you already reached for it.",
  },
  {
    keys: ["Tap the red word"],
    label: "Stop settling in",
    detail:
      "A session opens with three minutes of easing in. If you are already where the mode is trying to take you, a red word appears beside the mode name offering to skip the rest of it \u2014 Attack, Better, Easier, Harder, depending on the mode. It arrives four and a half seconds in, seven seconds after a mode change, and withdraws on its own after eight. Tap it while it is there.",
  },
  {
    keys: ["Open"],
    label: "Measure",
    action: "measure",
    detail:
      "How long this session has run, and how it divided between modes. History and CSV export are in the same panel. Kept on this device only, and can be switched off there.",
  },
  {
    keys: ["Swipe up from the bottom"],
    label: "Command centre",
    detail:
      "This panel. Start the swipe at the very bottom edge of the screen, so an ordinary flick to scroll is never mistaken for it.",
  },
  {
    keys: ["Swipe down with two fingers"],
    label: "Blackout",
    action: "blackout",
    detail:
      "Hides everything behind true black, so the screen looks switched off. The session keeps playing. Double tap to come back.",
  },
  {
    keys: ["Swipe up with two fingers"],
    label: "Whiteout",
    action: "whiteout",
    detail:
      "The same, in white \u2014 the screen as a lamp to read or work by. The display is kept awake where the browser allows it. Double tap to come back.",
  },
  {
    keys: ["Tap outside"],
    label: "Close",
    detail: "Or the cross, top right of this panel.",
  },
  {
    keys: ["Open"],
    label: "Philosophy",
    action: "philosophy",
    detail:
      "Why the session is shaped the way it is, what the click after a mode change is for, and what this app deliberately refuses to do.",
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenPhilosophy: () => void;
  onOpenMeasure: () => void;
  onBlackout: () => void;
  onWhiteout: () => void;
  /**
   * ANDROID FORK. Show the gesture list instead of the key list. Decided at
   * runtime by the page, because one bundle serves a desktop browser and a
   * phone and only the device knows which it is.
   */
  touch?: boolean;
}

export default function CommandCenter({
  open,
  onClose,
  onOpenPhilosophy,
  onOpenMeasure,
  onBlackout,
  onWhiteout,
  touch = false,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useDialogFocus(open, panelRef);

  if (!open) return null;

  const rows = touch ? TOUCH_COMMANDS : COMMANDS;

  const run = (action: NonNullable<Command["action"]>) => {
    if (action === "philosophy") onOpenPhilosophy();
    else if (action === "measure") onOpenMeasure();
    else if (action === "blackout") onBlackout();
    else onWhiteout();
  };

  /*
    A gesture is not a key, and must not be dressed as one. <kbd> means "the
    user presses this on an input device", and a keycap drawn around the
    words "Swipe up from the bottom" reads as a joke. Gestures get a plain
    pill instead - same column, same weight, no cap.
  */
  const keysOf = (c: Command) => (
    <span className="cmdkeys">
      {c.keys.map((k, i) => (
        <span key={`${k}-${i}`} className="cmdkeywrap">
          {i > 0 && <span className="cmdplus">{c.sep ?? "+"}</span>}
          {touch ? <span className="cmdgesture">{k}</span> : <kbd>{k}</kbd>}
        </span>
      ))}
    </span>
  );

  const textOf = (c: Command) => (
    <span className="cmdtext">
      <span className="cmdlabel">{c.label}</span>
      {c.detail && <span className="cmddetail">{c.detail}</span>}
    </span>
  );

  return (
    <div className="cmdscrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="cmdpanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmdtitle"
        tabIndex={-1}
        // The scrim closes on click; the panel must not, or every click inside
        // it would bubble up and dismiss the dialog.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmdhead">
          <h2 id="cmdtitle">Commands</h2>
          <button
            type="button"
            className="cmdclose"
            onClick={onClose}
            aria-label="Close commands"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        {/* `data-touch` widens the rows: a gesture name is a phrase, and a
            phrase does not fit the 8.5rem column a key chord was sized for. */}
        <ul className="cmdlist" data-touch={touch ? "true" : "false"}>
          {rows.map((c) => {
            const action = c.action;
            return action ? (
              <li key={c.label} className="cmdrow cmdrowgo">
                <button
                  type="button"
                  className="cmdgo"
                  onClick={() => run(action)}
                  // Philosophy and Measure open another dialog. Announcing the
                  // screens as dialogs would promise a thing to come back
                  // from, and a blackout is not that.
                  aria-haspopup={
                    action === "philosophy" || action === "measure"
                      ? "dialog"
                      : undefined
                  }
                >
                  {keysOf(c)}
                  {textOf(c)}
                </button>
              </li>
            ) : (
              <li key={c.label} className="cmdrow">
                {keysOf(c)}
                {textOf(c)}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
