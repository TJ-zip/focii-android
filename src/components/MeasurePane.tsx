"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "../lib/useDialogFocus";
import {
  clearSessions,
  downloadCSV,
  formatDuration,
  formatWhen,
  loadSessions,
  MIN_RECORD_LABEL,
  MIN_RECORD_SECONDS,
  type LiveSession,
  type SessionRecord,
} from "../lib/sessions";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The in-flight session, or null if nothing has been played this visit. */
  live: LiveSession | null;
  recording: boolean;
  onToggleRecording: (on: boolean) => void;
}

/** How long the delete button stays armed before it goes back to being safe. */
const CONFIRM_WINDOW = 4000;

/** A mode's share of a session, as a bar and a duration. */
function SpanRow({
  mode,
  seconds,
  total,
}: {
  mode: string;
  seconds: number;
  total: number;
}) {
  const pct = total > 0 ? (seconds / total) * 100 : 0;
  return (
    <li className="msrspan">
      <span className="msrspanname">{mode}</span>
      <span className="msrbar" aria-hidden="true">
        <span className="msrbarfill" style={{ width: `${pct}%` }} />
      </span>
      <span className="msrspantime">{formatDuration(seconds)}</span>
    </li>
  );
}

export default function MeasurePane({
  open,
  onClose,
  live,
  recording,
  onToggleRecording,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<"current" | "history">("current");
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<number | null>(null);

  useDialogFocus(open, panelRef);

  // Read on open, not on mount. The page writes to the same store while the
  // pane is shut, so anything cached would be a lie by the time it is shown.
  useEffect(() => {
    if (!open) return;
    setHistory(loadSessions());
    setView("current");
    setConfirming(false);
  }, [open]);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null)
        window.clearTimeout(confirmTimer.current);
    },
    []
  );

  const armClear = useCallback(() => {
    if (confirmTimer.current !== null)
      window.clearTimeout(confirmTimer.current);
    if (!confirming) {
      setConfirming(true);
      confirmTimer.current = window.setTimeout(
        () => setConfirming(false),
        CONFIRM_WINDOW
      );
      return;
    }
    clearSessions();
    setHistory([]);
    setConfirming(false);
  }, [confirming]);

  const allTime = useMemo(
    () => history.reduce((n, s) => n + s.total, 0),
    [history]
  );

  if (!open) return null;

  const spans = live ? [...live.spans].sort((a, b) => b.seconds - a.seconds) : [];

  return (
    <div className="cmdscrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="cmdpanel msrpanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="msrtitle"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmdhead">
          <h2 id="msrtitle">
            {view === "current" ? "This session" : "History"}
          </h2>
          <button
            type="button"
            className="cmdclose"
            onClick={onClose}
            aria-label="Close measurement"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        {view === "current" ? (
          !live || live.total <= 0 ? (
            <p className="msrempty">
              Nothing playing yet. Press <kbd>Space</kbd> to begin a session and
              this will fill in as it runs.
            </p>
          ) : (
            <>
              <div className="msrtotal">
                <span className="msrbig">{formatDuration(live.total)}</span>
                <span className="msrmeta">
                  since {formatWhen(live.startedAt)}
                </span>
              </div>
              <ul className="msrspans">
                {spans.map((s) => (
                  <SpanRow
                    key={s.mode}
                    mode={s.mode}
                    seconds={s.seconds}
                    total={live.total}
                  />
                ))}
              </ul>
              {live.total < MIN_RECORD_SECONDS && recording && (
                <p className="msrnote">
                  Sessions shorter than {MIN_RECORD_LABEL} are not saved.
                </p>
              )}
              {!recording && (
                <p className="msrnote">
                  Recording is off &mdash; this is shown from memory and will
                  not be saved.
                </p>
              )}
            </>
          )
        ) : history.length === 0 ? (
          <p className="msrempty">
            No sessions recorded yet. Anything longer than {MIN_RECORD_LABEL} is
            kept here, on this device only.
          </p>
        ) : (
          <>
            <div className="msrtotal">
              <span className="msrbig">{formatDuration(allTime)}</span>
              <span className="msrmeta">
                across {history.length}{" "}
                {history.length === 1 ? "session" : "sessions"}
              </span>
            </div>
            <ul className="msrlist">
              {history.map((s) => (
                <li key={s.id} className="msrentry">
                  <span className="msrwhen">{formatWhen(s.startedAt)}</span>
                  <span className="msrdur">{formatDuration(s.total)}</span>
                  <span className="msrmix">
                    {[...s.spans]
                      .sort((a, b) => b.seconds - a.seconds)
                      .map((sp) => (
                        <span key={sp.mode} className="msrchip">
                          {sp.mode} {formatDuration(sp.seconds)}
                        </span>
                      ))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="msrfoot">
          {/* Bottom left, as asked: the way between the two views. */}
          <button
            type="button"
            className="msrbtn"
            onClick={() =>
              setView((v) => (v === "current" ? "history" : "current"))
            }
          >
            {view === "current" ? "History" : "This session"}
          </button>

          <div className="msrfootright">
            <button
              type="button"
              className="msrbtn"
              onClick={() => downloadCSV(history)}
              disabled={history.length === 0}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="msrbtn"
              onClick={() => armClear()}
              data-danger={confirming ? "true" : undefined}
              disabled={history.length === 0}
            >
              {confirming ? "Confirm delete" : "Clear"}
            </button>
            {/* A real checkbox, not a div pretending. It is already
                keyboard-operable, already announced as a checkbox, and
                already reflects its own state. */}
            <label className="msrtoggle">
              <input
                type="checkbox"
                checked={recording}
                onChange={(e) => onToggleRecording(e.target.checked)}
              />
              <span>Record</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
