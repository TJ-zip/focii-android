/**
 * localStorage key names, and the migration off the old ones.
 *
 * The app was called Soundscape until the rename to Focii. Its four keys
 * were named after it, and they are the only record a user has that any of
 * this ever happened - the session history in particular is months of
 * personal data that exists nowhere else, on no server and in no backup.
 * Renaming the keys without moving the values would silently empty it.
 *
 * So the values are COPIED, not moved. The legacy keys are left in place
 * for one release. If this rename has to be rolled back, the old build
 * finds its data exactly where it left it.
 */

/** Current key names. Nothing outside this module should spell them out. */
export const KEYS = {
  started: "focii.hasStarted",
  hints: "focii.hintsSeen",
  sessions: "focii.sessions",
  recording: "focii.recording",
} as const;

/** New name -> the name it used to have. */
const LEGACY: Readonly<Record<string, string>> = {
  [KEYS.started]: "soundscape.hasStarted",
  [KEYS.hints]: "soundscape.hintsSeen",
  [KEYS.sessions]: "soundscape.sessions",
  [KEYS.recording]: "soundscape.recording",
};

let migrated = false;

/**
 * Copy any pre-rename values forward. Safe to call as often as convenient:
 * it is a no-op after the first call in a page, and on the server.
 *
 * A new key that already exists is never overwritten, so a value written
 * since the rename always wins over the stale copy beside it.
 */
export function ensureMigrated(): void {
  if (migrated || typeof window === "undefined") return;
  migrated = true;
  try {
    for (const next of Object.keys(LEGACY)) {
      if (window.localStorage.getItem(next) !== null) continue;
      const value = window.localStorage.getItem(LEGACY[next]);
      if (value !== null) window.localStorage.setItem(next, value);
    }
  } catch {
    // Private mode, disabled storage, or quota. Nothing to migrate into,
    // and the app is expected to work without persistence at all.
  }
}

/**
 * Delete a key and the value it was migrated from.
 *
 * Both halves matter. Removing only the current key would leave the legacy
 * copy behind, and the next page load would migrate it straight back - so
 * "clear my history" would undo itself on refresh. Deleting is the one
 * operation where the copy has to be treated as the same value.
 */
export function removeWithLegacy(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
    const previous = LEGACY[key];
    if (previous) window.localStorage.removeItem(previous);
  } catch {
    // nothing readable to clear
  }
}
