/**
 * Session measurement - storage, formatting and export.
 *
 * WHAT IS RECORDED: when a session started, when it was last seen, how
 * long audio actually played, and how that time divided between modes.
 * Nothing else. No identifier, no device information, no network call.
 *
 * WHERE IT LIVES: one localStorage key on this device. localStorage has no
 * expiry, so a history genuinely does accumulate for years; at roughly
 * 120 bytes per session even a decade of daily use is a fraction of the
 * ~5 MB a browser allows. It is per-origin and per-browser, though: it does
 * not follow you to another machine, and clearing site data erases it.
 * That is the trade for it never leaving the device.
 */

import { KEYS, ensureMigrated, removeWithLegacy } from "./storage";

/** Seconds spent in one mode within a session. */
export interface ModeSpan {
  mode: string;
  seconds: number;
}

/** A session as persisted. */
export interface SessionRecord {
  /**
   * Epoch ms at which the session began. Doubles as the primary key: a
   * running session is written repeatedly and must overwrite itself rather
   * than accumulate duplicates.
   */
  id: number;
  startedAt: number;
  /** Epoch ms of the last snapshot - i.e. when it was last known to exist. */
  endedAt: number;
  /** Seconds of audio actually played. Paused time is not counted. */
  total: number;
  spans: ModeSpan[];
}

/** The in-flight session, before it is worth persisting. */
export interface LiveSession {
  startedAt: number;
  total: number;
  spans: ModeSpan[];
}

const STORE_KEY = KEYS.sessions;
const RECORD_KEY = KEYS.recording;

/**
 * Below this, it was not a session. Someone pressed Space and changed their
 * mind, or opened the tab to show somebody the visualizer. Writing those
 * would fill the history with noise and make the real entries harder to
 * find.
 *
 * Two minutes also sits inside the 3-minute initiation block, so anything
 * saved is at least a session that was genuinely beginning rather than one
 * that was being glanced at.
 */
export const MIN_RECORD_SECONDS = 120;

/**
 * The same fact for prose. "under 120 seconds" is a correct sentence and a
 * bad one; the UI should say what a person would say.
 */
export const MIN_RECORD_LABEL = "two minutes";

/**
 * Oldest entries are dropped past this. Chosen to be far beyond any
 * plausible use - a decade of three sessions a day is ~11,000 - while still
 * bounding the worst case, because a store that can only grow will
 * eventually throw QuotaExceededError at the least convenient moment.
 */
export const MAX_SESSIONS = 5000;

/* --- opt-out ------------------------------------------------------------
   Recording is ON unless this device has explicitly said otherwise, and the
   switch is in the measurement pane where the data itself is shown. Storage
   being unavailable reads as OFF: if the preference cannot be persisted,
   the data cannot be either. --- */

export function isRecording(): boolean {
  if (typeof window === "undefined") return false;
  ensureMigrated();
  try {
    return window.localStorage.getItem(RECORD_KEY) !== "0";
  } catch {
    return false;
  }
}

export function setRecording(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECORD_KEY, on ? "1" : "0");
  } catch {
    // storage unavailable; nothing was being recorded anyway
  }
}

/* --- store -------------------------------------------------------------- */

/**
 * Newest first. Anything malformed is discarded rather than repaired: this
 * is a personal log, and a store half-parsed into a broken shape is worse
 * than a store that starts again.
 */
export function loadSessions(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  ensureMigrated();
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

function isRecord(v: unknown): v is SessionRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Partial<SessionRecord>;
  return (
    typeof r.id === "number" &&
    typeof r.startedAt === "number" &&
    typeof r.endedAt === "number" &&
    typeof r.total === "number" &&
    Array.isArray(r.spans)
  );
}

/**
 * Write one session, replacing any earlier snapshot of the same session.
 *
 * Returns the resulting list so a caller that is displaying the history can
 * refresh without a second read.
 */
export function saveSession(rec: SessionRecord): SessionRecord[] {
  if (typeof window === "undefined") return [];
  if (rec.total < MIN_RECORD_SECONDS) return loadSessions();

  const list = loadSessions().filter((s) => s.id !== rec.id);
  list.unshift(rec);
  const trimmed = list.slice(0, MAX_SESSIONS);

  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota, or storage disabled. The session is lost, the audio is not.
  }
  return trimmed;
}

export function clearSessions(): void {
  if (typeof window === "undefined") return;
  // Drops the pre-rename copy too, otherwise the migration would restore
  // the cleared history on the next page load.
  removeWithLegacy(STORE_KEY);
}

/* --- formatting --------------------------------------------------------- */

/**
 * Human duration: "1h 04m", "12m 30s", "45s".
 *
 * Deliberately drops the smallest unit once a larger one is present. Nobody
 * reading a history wants "1h 04m 09s" - the seconds are noise at that
 * scale, and they make the column ragged.
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Fixed-width h:mm:ss, for the CSV where columns must line up. */
export function formatHMS(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** "27 Aug 2026, 14:03" in the reader's own locale and time zone. */
export function formatWhen(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(epochMs).toISOString();
  }
}

/* --- export -------------------------------------------------------------
   Entirely client-side: a string, a Blob, an object URL, a synthetic click.
   No server is involved, which is why this works identically on Vercel, on
   localhost, and with the network unplugged. --- */

const DQUOTE = String.fromCharCode(34);
const COMMA = ",";
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const CRLF = CR + LF;

/**
 * Characters that force a field to be quoted, per RFC 4180. Built from code
 * points rather than a regex literal: a character class containing CR and LF
 * is exactly the kind of thing that gets mangled by a rewrite, and when it
 * breaks it breaks the whole module rather than one field.
 */
const QUOTE_TRIGGERS = [DQUOTE, COMMA, LF, CR];

/**
 * RFC 4180 quoting. The data is currently plain, but an export that breaks
 * the first time a mode is renamed to something with a comma in it is not
 * an export.
 */
function cell(v: string | number): string {
  const s = String(v);
  if (!QUOTE_TRIGGERS.some((c) => s.includes(c))) return s;
  // A literal quote inside a quoted field is escaped by doubling it.
  return DQUOTE + s.split(DQUOTE).join(DQUOTE + DQUOTE) + DQUOTE;
}

/**
 * One row per mode per session - "long" format rather than one column per
 * mode. It survives new modes being added without the header changing, and
 * it is the shape every pivot table and plotting library expects.
 */
export function toCSV(list: SessionRecord[]): string {
  const head = [
    "session_start_iso",
    "session_start_local",
    "session_end_iso",
    "session_total_seconds",
    "session_total_hms",
    "mode",
    "mode_seconds",
    "mode_hms",
    "mode_share_pct",
  ].join(COMMA);

  const rows: string[] = [];
  for (const s of list) {
    const spans = s.spans.length > 0 ? s.spans : [{ mode: "-", seconds: 0 }];
    for (const span of spans) {
      rows.push(
        [
          cell(new Date(s.startedAt).toISOString()),
          cell(formatWhen(s.startedAt)),
          cell(new Date(s.endedAt).toISOString()),
          cell(Math.round(s.total)),
          cell(formatHMS(s.total)),
          cell(span.mode),
          cell(Math.round(span.seconds)),
          cell(formatHMS(span.seconds)),
          cell(s.total > 0 ? ((span.seconds / s.total) * 100).toFixed(1) : "0"),
        ].join(COMMA)
      );
    }
  }

  // Trailing newline: POSIX tools treat a file without one as truncated.
  return [head, ...rows].join(CRLF) + CRLF;
}

/** Trigger a download of the history as CSV. Returns false if there is
    nothing to export. */
export function downloadCSV(list: SessionRecord[]): boolean {
  if (typeof window === "undefined" || list.length === 0) return false;

  const blob = new Blob([toCSV(list)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `focii-sessions-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  // Firefox will not act on a click for an element outside the document.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in some browsers before
  // it has read the blob; one turn of the event loop is enough.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
