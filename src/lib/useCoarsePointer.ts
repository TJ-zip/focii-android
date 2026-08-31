"use client";

import { useEffect, useState } from "react";

/**
 * True when the primary input is a finger rather than a mouse or a keyboard.
 *
 * This repo ships ONE build to two places: Vercel, where it is opened on a
 * desktop browser as often as on a phone, and the APK, where it is only ever
 * touched. So the input model cannot be decided at build time. It is decided
 * per device, at runtime, and the keyboard map stays wired either way.
 *
 * `(hover: none) and (pointer: coarse)` is deliberately the conjunction rather
 * than `pointer: coarse` alone. A laptop with a touchscreen reports a coarse
 * pointer while still having a keyboard and a hover-capable mouse; telling
 * that user to "tap to begin" would be replacing one wrong instruction with
 * another. Requiring `hover: none` narrows it to devices where there is no
 * other way in.
 *
 * The initial value is false, and must be: the page is statically exported and
 * prerendered on a machine with no pointer at all. If the first client render
 * disagreed with that HTML, React would throw a hydration mismatch and discard
 * the tree. So the keyboard copy paints first and is replaced a frame later,
 * which is invisible in practice and correct in principle.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    const apply = () => setCoarse(mq.matches);
    apply();

    // `addEventListener` on a MediaQueryList is the modern spelling and is
    // what every browser this app targets supports. No `addListener`
    // fallback: the app requires the Web Audio API and a canvas, and nothing
    // old enough to lack this is going to run it anyway.
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return coarse;
}
