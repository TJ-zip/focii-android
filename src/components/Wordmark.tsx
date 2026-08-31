/**
 * The Focii wordmark: a stylised script capital F followed by "ocii".
 *
 * The F is artwork, not a font. It ships as an inline SVG rather than a
 * file in public/ for two reasons: it is painted in `currentColor`, so it
 * dims and brightens with the surrounding text instead of needing a second
 * copy per colour, and it cannot flash in late as a separate request over
 * the top of an otherwise black screen.
 *
 * The path data lives in src/lib/mark.ts, which the app icon also draws
 * from, so the wordmark and the icon cannot drift apart.
 */
import { MARK_PATHS, MARK_VIEW_W, MARK_VIEW_H } from "@/lib/mark";
import styles from "./Wordmark.module.css";

export default function Wordmark() {
  return (
    // One image with one name. The glyphs are decorative once the whole
    // thing is labelled, otherwise a screen reader reads out a stray "ocii".
    <span className="wordmark" role="img" aria-label="Focii">
      <span className={styles.lockup} aria-hidden="true">
        <svg
          className={styles.mark}
          viewBox={`0 0 ${MARK_VIEW_W} ${MARK_VIEW_H}`}
          focusable="false"
        >
          <g fill="currentColor" fillRule="nonzero">
            {MARK_PATHS.map((d) => (
              <path key={d.slice(0, 12)} d={d} />
            ))}
          </g>
        </svg>
        <span className={styles.rest}>
          oci<span className={styles.accent}>i</span>
        </span>
      </span>
    </span>
  );
}
