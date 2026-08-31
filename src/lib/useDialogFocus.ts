"use client";

import { useEffect, type RefObject } from "react";

/** Elements that can hold focus inside a dialog. */
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Focus management for a modal dialog. Three obligations, all easy to
 * forget and all invisible to anyone using a mouse:
 *
 *   1. move focus INTO the dialog, or a keyboard user is stranded outside a
 *      modal that is visually covering everything;
 *   2. cycle Tab within it, so focus cannot wander onto the mode bar
 *      underneath while the scrim is up;
 *   3. put focus BACK where it came from on close, or the next Tab starts
 *      from the top of the document.
 *
 * Pass the ref of the panel element. It must be focusable itself
 * (tabIndex={-1}) as the fallback for a dialog with no controls in it.
 */
export function useDialogFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return;
    const node = panelRef.current;
    if (!node) return;

    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled")
      );

    (focusables()[0] ?? node).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [open, panelRef]);
}

export default useDialogFocus;
