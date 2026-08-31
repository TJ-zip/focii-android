"use client";

/**
 * Total blackout and total whiteout.
 *
 * Two requests that turn out to be the same component:
 *
 * - BLACKOUT. You want the session but you do not want the visualizer, and you
 *   do not want a dimmed version of it either -- you want the machine to look
 *   switched off. That means true #000 rather than the app's #050505, no
 *   cursor, no chrome, no residual glow at an edge. Anything less reads as "a
 *   dark screen", which is a different thing entirely.
 *
 * - WHITEOUT. The inverse use of the same surface: the panel as a light
 *   source. A laptop lid angled at a desk is a perfectly good study lamp, and
 *   a phone is a perfectly good reading light. This one has a real physical
 *   requirement attached -- it must be uniformly bright edge to edge, because
 *   a lamp that is dimmer down one side is a bad lamp.
 *
 * The session keeps playing throughout. Neither of these is a stop; they are
 * about the screen, and the screen is not the point of the app.
 */

import { useEffect, useRef, useState } from "react";
import styles from "./Blackout.module.css";

export type Screen = "black" | "white";

/**
 * Duration of the burn-in, in ms. MUST match the transition duration in
 * Blackout.module.css -- it is what keeps the component mounted long enough
 * for the exit to be seen rather than cut.
 */
const BURN_MS = 900;

/**
 * Interval between screensaver sweeps, in ms. Three and a half minutes.
 *
 * Long enough that it is not a feature you watch, short enough to be doing
 * the two jobs a screensaver has ever had: keeping a static image from being
 * a static image, and telling the machine somebody is still here.
 */
const SAVER_EVERY = 210_000;

interface Props {
  screen: Screen | null;
  onExit: () => void;
}

export default function Blackout({ screen, onExit }: Props) {
  // `held` outlives `screen` by one animation, so the burn can run backwards
  // on the way out instead of the overlay simply disappearing.
  const [held, setHeld] = useState<Screen | null>(null);
  const [shown, setShown] = useState(false);
  const [saver, setSaver] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (screen) {
      setHeld(screen);
      // Two frames. One is not reliably enough: the rAF scheduled from an
      // effect can run before the browser has painted the start state, and a
      // transition between two states that were never both painted does not
      // animate at all.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false);
    setSaver(0);
    const t = window.setTimeout(() => setHeld(null), BURN_MS);
    return () => window.clearTimeout(t);
  }, [screen]);

  // Take focus, so Tab cannot wander into controls that are now invisible
  // underneath an opaque sheet. Released back to the document on exit.
  useEffect(() => {
    if (shown) rootRef.current?.focus();
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const id = window.setInterval(() => setSaver((n) => n + 1), SAVER_EVERY);
    return () => window.clearInterval(id);
  }, [shown]);

  /**
   * Keep the display awake.
   *
   * Whiteout is useless if the operating system dims it after 60 seconds, and
   * blackout is meant to look like a device that is off rather than one that
   * actually went to sleep and needs waking. The Wake Lock API is the correct
   * tool and is not universally available, so this is entirely optional:
   * feature-detected, and every failure path is swallowed. A lock is also
   * dropped by the browser whenever the tab is backgrounded, which is the
   * behaviour we want anyway.
   *
   * The lock is kept in an object rather than a plain `let` so that the
   * cleanup closure reads the value assigned by the async callback.
   */
  useEffect(() => {
    if (!shown) return;
    interface Sentinel {
      release: () => Promise<void>;
    }
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
    };
    if (!nav.wakeLock) return;

    const box: { lock: Sentinel | null; done: boolean } = {
      lock: null,
      done: false,
    };
    nav.wakeLock
      .request("screen")
      .then((lock) => {
        if (box.done) {
          void lock.release().catch(() => {});
          return;
        }
        box.lock = lock;
      })
      .catch(() => {});

    return () => {
      box.done = true;
      void box.lock?.release().catch(() => {});
    };
  }, [shown]);

  if (!held) return null;

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-kind={held}
      data-on={shown ? "true" : "false"}
      tabIndex={-1}
      // Not a dialog and not a region: there is nothing here to read. The
      // announcement and the instructions for getting out are made by the
      // live region in the page, at the moment the screen is entered.
      role="presentation"
      // A double click, and only a double click. Single clicks and pointer
      // movement must do nothing, or a hand resting on a trackpad undoes a
      // blackout the moment it is set. But some way out that is not a keyboard
      // chord has to exist: a phone has neither Shift nor Escape.
      onDoubleClick={onExit}
    >
      <div className={styles.sheet} aria-hidden="true" />
      {saver > 0 && (
        <div key={saver} className={styles.saver} aria-hidden="true" />
      )}
    </div>
  );
}
