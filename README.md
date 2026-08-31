# Focii - Android

An Android build of [Focii](https://github.com/TJ-zip/soundscape-v1-temp), the
generative soundscape app. Same audio engine, same visuals, a touch-native
gesture layer instead of the keyboard one.

## What this repo is

One static export that serves two targets:

| Target | Purpose |
|---|---|
| Vercel | Test the real thing on a real phone, on every push, before any packaging |
| APK (Capacitor) | The shipped artefact - the identical `out/` inside a WebView |

Both run byte-identical application code. Testing on Vercel is therefore
meaningful, with one honest exception noted under *Screen lock* below.

## Controls

The app has no transport button - that is a design decision inherited from
upstream, not an omission. Input is gestural on both targets.

Which map is live is decided at **runtime**, by
`matchMedia("(hover: none) and (pointer: coarse)")`, not by a build flag. The
same bundle is served from Vercel to desktop browsers and bundled into the APK,
so both maps ship and the device chooses. Every string that names an input is
gated on the same check, so a phone is never told to press a key it does not
have.

| Intent | Touch | Keyboard |
|---|---|---|
| Begin | Tap anywhere | `Space` |
| Pause | Two-finger tap | `P` |
| Change mode | Drag the mode bar sideways | `Arrow` keys (press twice to arm), `Home`, `End` |
| Command centre | Swipe up from the bottom edge | `Shift + C` |
| Measure | Command centre -> Measure | `Shift + M` |
| Blackout | Two-finger swipe down | `Shift + B` |
| Whiteout | Two-finger swipe up | `Shift + W` |
| Leave a screen | Double tap | `Shift + B` / `Shift + W`, `Escape`, or double click |
| Stop settling in | Tap the red word | Tap the red word, or `Alt + K` |

Notes on three of these, because the reasoning is not obvious from the table:

- **Tap is a single tap, not a double.** An `AudioContext` may only be created
  inside a user gesture, and waiting ~300 ms to rule out a second finger spends
  that activation. The session starts on the first tap.
- **Pinch is declined, not blocked.** Disabling pinch zoom would fail WCAG 1.4.4,
  and intercepting `touchmove` non-passively would make the scroll-snap mode bar
  janky. If the fingers change spread by more than 60 px the gesture is
  abandoned and the browser keeps it. Every listener in the recogniser is
  passive; none call `preventDefault`.
- **Measure is a command-centre row on touch only.** `Shift + M` is the sole
  keyboard route to the pane and there is no touch gesture for it, so without
  that row the pane would be unreachable on a phone. The keyboard list is
  unchanged.

The touch layer is three files - `src/lib/useCoarsePointer.ts`,
`src/lib/useTouchGestures.ts`, `src/app/touch.css` - none of which exist
upstream, so none are listed in the manifest and none can ever conflict at
re-vendor. All Android-only CSS goes in `touch.css` for that reason;
`globals.css` is marked forked but is deliberately still byte-identical to
upstream.

## Where the code comes from

`src/` is **vendored** from upstream, not hand-copied and not a submodule. The
pin lives in `vendor.manifest.json`.

The audio engine's value is not its structure, it is its **tuned constants** -
delays and gains derived by ear over many sessions, which cannot be recovered by
reading the code. If Android's copy drifted, no build would fail; the app would
just sound subtly wrong. So each vendored file is hashed:

- **`pinned`** - must stay byte-identical to upstream. CI fails on drift.
- **`forked`** - records the upstream hash but tolerates local edits. This is
  where Android-specific work lives: `page.tsx`, `layout.tsx`, `globals.css`,
  and - since the gesture work - `ModeDot.tsx` and `CommandCenter.tsx`, whose
  content is words rather than tuned constants.

`vendor.mjs --fetch` will never overwrite a forked file unless `--force-forked`
is passed, so a routine re-vendor cannot silently destroy the Android work.

`src/app/apple-icon.tsx` is deliberately **not** vendored: it rasterises at
request time, which a static export cannot do. It is replaced with a committed
image.

## Building

There is no `start` script. `output: 'export'` makes `next start` invalid, and a
script that cannot work is worse than an absent one.

```bash
npm run vendor      # fetch src/ at the pinned commit (needs network)
npm install
npm run build       # -> out/
npm run check:export
```

## Verification

This project is authored in an environment with no package manager and no
network egress. **No build, type-check or test claim is ever made from reading
code** - every such claim cites a GitHub Actions run.

- **`validate.yml`** - the gate. Vendor check, install, typecheck, build,
  export check. Runs on push and PR.
- **`vendor.yml`** - fetches and commits `src/`, then validates the result in
  the same run. It has to validate itself: commits made with `GITHUB_TOKEN` do
  not trigger further workflows, so a vendored commit would otherwise sit
  unchecked.
- **`ci-report.yml`** - the feedback channel. Edit `ci-request.txt`, push, and
  the full stdout/stderr of the listed scripts is committed to
  `ci-reports/latest.md`. A run conclusion says *that* something failed; this
  says *why*.

`ci-request.txt` selects from scripts already declared in `package.json`. It
cannot introduce a shell command - names are filtered against
`^[A-Za-z0-9:_-]+$`, checked for membership in `package.json`, and spawned with
`shell: false`.

The vendor check runs **before** `npm install`, which makes its timing
diagnostic: a `validate` run that fails in about five seconds failed on hash
drift, not on the build.

## Screen lock

The one behaviour that genuinely differs between the two targets, stated
honestly:

| Where | With the screen off |
|---|---|
| Vercel + Android Chrome | Usually keeps playing **if** MediaSession is wired. Browser policy, not a contract - the OS may still reclaim it. |
| Vercel + iOS Safari | Suspends the AudioContext. Not fixable from the web. |
| APK + foreground service | An actual guarantee. |

MediaSession is therefore wired early rather than saved for APK polish: it is
the same code on both targets, and it is where pause/play must live for headset
buttons, since the app has no transport button by design.

Note that the existing Screen Wake Lock in the blackout screen does **not** help
here. It prevents the screen sleeping, and the OS releases it the moment the
power button is pressed.

## Status

See `PROJECT_STATUS.md` for current state, verified/unverified items, and open
questions.
