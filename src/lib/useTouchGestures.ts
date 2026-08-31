"use client";

import { useEffect, useRef } from "react";

/**
 * The touch input layer for the Android build.
 *
 * The web app is keyboard-first: Space begins, P pauses, Shift + C opens the
 * command centre. A phone has none of those keys, so on a touch device every
 * one of those instructions is a dead end. This module is the replacement --
 * a small recogniser over raw touch events, reporting intent rather than
 * coordinates, so the page can keep one switch statement instead of a second
 * copy of its state machine.
 *
 * WHY RAW TOUCH EVENTS AND NOT POINTER EVENTS
 *
 * Pointer events are the modern API and are the right default, but they model
 * one pointer at a time and leave multi-touch bookkeeping to the caller. Two
 * of the five gestures here are two-finger gestures whose whole definition is
 * the relationship between the two contacts, so the bookkeeping is the
 * feature. TouchEvent hands that over already assembled, with a `touches`
 * list and stable identifiers.
 *
 * WHY EVERY LISTENER IS PASSIVE
 *
 * Nothing here ever calls preventDefault. That is a constraint, not an
 * oversight:
 *
 *  - Suppressing default touch behaviour to make two-finger gestures
 *    unambiguous would mean disabling pinch zoom, and a page that cannot be
 *    zoomed fails WCAG 1.4.4. An app for people who want to sit and stare at
 *    a screen for an hour is exactly the wrong place to remove the zoom.
 *  - A non-passive touchmove listener on window forces the compositor to wait
 *    for JavaScript on every frame of every scroll. The mode bar is a
 *    scroll-snap strip; making it janky to add a shortcut would be a bad
 *    trade.
 *
 * A pinch is therefore not blocked -- it is DECLINED. If the distance between
 * the two contacts changes by more than PINCH_TOL the gesture is abandoned
 * and the browser is left to zoom in peace. What remains is the two-finger
 * PAN, which on an unzoomed page does nothing at all in Android Chrome, so
 * claiming it costs the user nothing.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * There is no double-tap-to-begin. An AudioContext may only be created inside
 * a user gesture, and disambiguating a double tap means waiting ~300ms to see
 * whether a second tap arrives -- by which point the activation is spent and
 * the audio will not start. A single tap therefore acts immediately. Double
 * tap survives only where nothing else claims the screen: on the blackout and
 * whiteout sheets, which handle it themselves through onDoubleClick.
 */

export type Gesture =
  | "tap"
  | "twoFingerTap"
  | "edgeSwipeUp"
  | "twoFingerSwipeUp"
  | "twoFingerSwipeDown";

/**
 * `target` is the element the gesture started on. Nothing has to capture it:
 * the spec retargets every touchmove, touchend and touchcancel of a sequence
 * to the element that received its touchstart, so it stays correct even after
 * the finger has slid somewhere else entirely. The caller needs it to tell
 * "tapped the background" from "tapped the Command button".
 */
export type GestureHandler = (
  gesture: Gesture,
  target: EventTarget | null
) => void;

/** Movement, in px, still considered a tap rather than a drag. */
const TAP_SLOP = 14;

/** Longest a tap may last, in ms. Beyond this it is a press, not a tap. */
const TAP_TIME = 450;

/** Travel, in px, before a drag counts as a swipe. */
const SWIPE_MIN = 60;

/**
 * Height of the bottom strip a command-centre swipe must start in, in px.
 * The gesture is anchored to the edge so that an ordinary upward flick in the
 * middle of the page -- which is how a person scrolls -- is never mistaken
 * for a request to open a dialog.
 */
const EDGE = 72;

/**
 * How much the distance between two contacts may change, in px, before the
 * gesture is treated as a pinch and released to the browser.
 */
const PINCH_TOL = 60;

/**
 * How much more vertical than horizontal a swipe must be. A diagonal drag is
 * an ambiguous drag, and acting on an ambiguous input is how an app acquires
 * a reputation for doing things by itself.
 */
const AXIS_RATIO = 1.4;

interface Pt {
  x: number;
  y: number;
}

function findTouch(list: TouchList, id: number): Touch | null {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].identifier === id) return list[i];
  }
  return null;
}

/**
 * @param enabled  Bind nothing at all when false. A desktop browser never
 *                 fires these events, but not binding is cheaper and makes
 *                 the "keyboard device gets no touch layer" rule explicit.
 * @param onGesture Called with the recognised gesture. Held in a ref, so a
 *                 caller may pass a fresh closure on every render without
 *                 causing the listeners to be torn down and rebound.
 */
export function useTouchGestures(enabled: boolean, onGesture: GestureHandler) {
  const handler = useRef(onGesture);

  useEffect(() => {
    handler.current = onGesture;
  }, [onGesture]);

  useEffect(() => {
    if (!enabled) return;

    /** Identifier of the first contact, and of the second if there is one. */
    let idA: number | null = null;
    let idB: number | null = null;
    let startA: Pt = { x: 0, y: 0 };
    let startB: Pt = { x: 0, y: 0 };
    let spread0 = 0;
    let startedAt = 0;
    /** Highest simultaneous contact count seen during this gesture. */
    let peak = 0;
    /** Any contact has travelled further than TAP_SLOP. */
    let moved = false;
    /**
     * The gesture is over as far as we are concerned: either it has already
     * been reported, or it was rejected (a pinch, a third finger, a cancel).
     * Nothing further fires until every finger is lifted.
     */
    let spent = false;

    const reset = () => {
      idA = null;
      idB = null;
      spread0 = 0;
      startedAt = 0;
      peak = 0;
      moved = false;
      spent = false;
    };

    const at = (t: Touch): Pt => ({ x: t.clientX, y: t.clientY });
    const gap = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);

    const onStart = (e: TouchEvent) => {
      const n = e.touches.length;
      if (n > peak) peak = n;

      if (n === 1) {
        // A fresh gesture. Anything left over from the last one is discarded
        // here rather than trusted to have been cleaned up.
        const t = e.touches[0];
        idA = t.identifier;
        idB = null;
        startA = at(t);
        startedAt = e.timeStamp;
        moved = false;
        spent = false;
        return;
      }

      if (n === 2 && !spent) {
        const a = e.touches[0];
        const b = e.touches[1];
        idA = a.identifier;
        idB = b.identifier;
        startA = at(a);
        startB = at(b);
        spread0 = gap(startA, startB);
        // Restarted, so the two-finger tap is timed from the moment the
        // SECOND finger landed. Timing it from the first would make a
        // deliberate two-finger tap fail whenever the fingers were not
        // perfectly simultaneous.
        startedAt = e.timeStamp;
        moved = false;
        return;
      }

      // Three or more contacts. Not a gesture this app has any use for, and
      // guessing at one would be worse than ignoring it.
      if (n > 2) spent = true;
    };

    const onMove = (e: TouchEvent) => {
      if (spent || idA === null) return;

      if (idB === null) {
        const t = findTouch(e.touches, idA);
        if (!t) return;
        const dx = t.clientX - startA.x;
        const dy = t.clientY - startA.y;
        if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) moved = true;

        // Upward, from the bottom edge, and decisively vertical.
        if (
          startA.y >= window.innerHeight - EDGE &&
          dy <= -SWIPE_MIN &&
          Math.abs(dy) > Math.abs(dx) * AXIS_RATIO
        ) {
          spent = true;
          handler.current("edgeSwipeUp", e.target);
        }
        return;
      }

      const a = findTouch(e.touches, idA);
      const b = findTouch(e.touches, idB);
      if (!a || !b) return;

      const pa = at(a);
      const pb = at(b);

      // Spread changed: the user is zooming, not commanding. Stand down and
      // let the browser have the gesture.
      if (Math.abs(gap(pa, pb) - spread0) > PINCH_TOL) {
        spent = true;
        return;
      }

      const dy1 = pa.y - startA.y;
      const dy2 = pb.y - startB.y;
      const dx1 = pa.x - startA.x;
      const dx2 = pb.x - startB.x;
      if (
        Math.abs(dy1) > TAP_SLOP ||
        Math.abs(dy2) > TAP_SLOP ||
        Math.abs(dx1) > TAP_SLOP ||
        Math.abs(dx2) > TAP_SLOP
      ) {
        moved = true;
      }

      // Both fingers must be going the same way. One up and one down is a
      // rotate or a squeeze, whatever the averages happen to say.
      if (dy1 * dy2 <= 0) return;

      const avgY = (dy1 + dy2) / 2;
      const avgX = (dx1 + dx2) / 2;
      if (
        Math.abs(avgY) >= SWIPE_MIN &&
        Math.abs(avgY) > Math.abs(avgX) * AXIS_RATIO
      ) {
        spent = true;
        handler.current(
          avgY > 0 ? "twoFingerSwipeDown" : "twoFingerSwipeUp",
          e.target
        );
      }
    };

    const onEnd = (e: TouchEvent) => {
      // Wait for the last finger. Reporting a two-finger tap when the first
      // of the two lifts would fire it a few milliseconds early and make the
      // second lift look like the start of a new gesture.
      if (e.touches.length > 0) return;

      const held = e.timeStamp - startedAt;
      if (!spent && !moved && held <= TAP_TIME) {
        if (peak === 2) handler.current("twoFingerTap", e.target);
        else if (peak === 1) handler.current("tap", e.target);
      }
      reset();
    };

    const onCancel = () => reset();

    // Bound on `document` rather than `window` so that `e.target` is the
    // element under the finger. Passive throughout -- see the note above.
    const opts: AddEventListenerOptions = { passive: true };
    document.addEventListener("touchstart", onStart, opts);
    document.addEventListener("touchmove", onMove, opts);
    document.addEventListener("touchend", onEnd, opts);
    document.addEventListener("touchcancel", onCancel, opts);

    return () => {
      document.removeEventListener("touchstart", onStart, opts);
      document.removeEventListener("touchmove", onMove, opts);
      document.removeEventListener("touchend", onEnd, opts);
      document.removeEventListener("touchcancel", onCancel, opts);
    };
  }, [enabled]);
}
