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
  action?: "philosophy" | "blackout" | "whiteout";
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

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenPhilosophy: () => void;
  onBlackout: () => void;
  onWhiteout: () => void;
}

export default function CommandCenter({
  open,
  onClose,
  onOpenPhilosophy,
  onBlackout,
  onWhiteout,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useDialogFocus(open, panelRef);

  if (!open) return null;

  const run = (action: NonNullable<Command["action"]>) => {
    if (action === "philosophy") onOpenPhilosophy();
    else if (action === "blackout") onBlackout();
    else onWhiteout();
  };

  const keysOf = (c: Command) => (
    <span className="cmdkeys">
      {c.keys.map((k, i) => (
        <span key={`${k}-${i}`} className="cmdkeywrap">
          {i > 0 && <span className="cmdplus">{c.sep ?? "+"}</span>}
          <kbd>{k}</kbd>
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

        <ul className="cmdlist">
          {COMMANDS.map((c) => {
            const action = c.action;
            return action ? (
              <li key={c.label} className="cmdrow cmdrowgo">
                <button
                  type="button"
                  className="cmdgo"
                  onClick={() => run(action)}
                  // Only philosophy opens another dialog. Announcing the
                  // screens as dialogs would promise a thing to come back
                  // from, and a blackout is not that.
                  aria-haspopup={action === "philosophy" ? "dialog" : undefined}
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
