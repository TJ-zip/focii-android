# PROJECT_STATUS — Focii Android

Persistent project memory. Factual, current, no secrets.

---

## Product objective

Ship Focii as an Android APK whose audio survives screen lock, without
re-deriving the tuned audio engine. Test on a real phone via Vercel throughout;
package to APK only once the app behaves correctly in a mobile browser.

## Current architecture

Single Next.js static export (`output: 'export'`) serving two targets:

- **Vercel** — continuous testing on a real device.
- **Capacitor APK** — the same `out/` inside a WebView. The foreground service
  for background audio is **not built yet**.

`src/` is vendored from `TJ-zip/soundscape-v1-temp` at a pinned commit and
hash-verified. Application code is byte-identical between targets; the
divergence is entirely in the five forked files plus three new files that do not
exist upstream at all.

The Android project (`android/`) is **generated in CI, not committed**. See the
decision and its cost below.

## Technology stack

- Next.js 16.3.0 (App Router, `output: 'export'`), React 19, TypeScript 5.6
- Web Audio API + Canvas 2D. No audio or graphics dependencies.
- Node 22 in CI, npm
- Capacitor 7 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`),
  Java 21 in CI, Gradle wrapper from the Capacitor template

## Working features

The vendored tree builds and exports. Confirmed by the CI report for commit
`0bbbbee` on `feature/android-scaffold`:

| script | exit |
|---|---|
| `typecheck` (`tsc --noEmit`) | 0 |
| `build` (`next build`, static export) | 0 |
| `check:export` | 0 |

The export contains 26 files; `index.html` is 11.3 KB and carries
`<link rel="icon">`; routes emitted are `/`, `/_not-found`, `/icon.svg`.

The app is live on Vercel from `main` and has been opened on the owner's phone.
**Not yet reported: whether audio plays, or what screen lock does to it.** That
answer sizes task 4.

**An installable APK now exists.** `APK` workflow, commit `bbd6831` on
`feature/capacitor-apk`: `focii-bbd6831-debug.apk`, 4,315,571 bytes, sha256
`cf9d8dfcd8e3f848cccbb44acda8e6b23d08343fae347e1c3ec819307c9fa55f`, published as
prerelease `apk-bbd6831`. Debug-signed, so it installs; nobody has yet reported
installing or opening it.

## Current task

Task 6a — packaging — done and open as PR #4, stacked on PR #3. Awaiting the
owner's first install report. Task 6b, the foreground service, is untouched.

## Pending tasks

In deliberate order — each depends on the previous being confirmed.

1. **Scaffold + vendor + green build** — **done.** PR #1 squash-merged as
   `bbfa256`; Vercel connected and serving production from `main`.
2. **Static icon.** Replace the request-time `apple-icon.tsx` with a PNG
   generated from `src/lib/mark.ts`; add Android mipmap densities. Until this
   lands the APK carries the **default Capacitor launcher icon**, which is the
   most visible unfinished thing about it.
3. **Touch gesture layer** — implemented, see below.
4. **MediaSession + wake lock + a visible pause state.**
5. **User tests on their phone** via the Vercel preview.
6. **Capacitor + foreground service + signed APK.** Split, because the halves
   have different blockers:
   - **6a — packaging.** **Done.** Debug-signed APK from Actions.
   - **6b — foreground service + release signing.** Not started. Needs a
     keystore in Actions secrets and a native patch step (see the `android/`
     decision). This is the half that delivers the product objective.

## Known issues

- **The APK does not survive screen lock.** No foreground service exists, so
  Android suspends the WebView and the audio with it. The APK is currently a
  packaged copy of the web app, not an improvement on it.
- **Default launcher icon** in the APK — task 2.
- **Debug signing key.** A future release-signed build will not upgrade this
  install in place; it must be uninstalled first, which wipes app storage.
- **Absolute asset paths — 11 of them, measured — do not affect this target.**
  Capacitor serves `out/` from `https://localhost` through its local server, so
  `/_next/…` resolves against the server root rather than the device root. The
  earlier note here assumed `file://`. `check:export` still counts them,
  because the count is the alarm if the scheme ever changes.
- **`apple-icon.tsx` cannot be vendored.** Satori rasterises at request time; a
  static export has no request. Tracked as task 2.
- **A dead string in `page.tsx`.** The command-corner tip is removed in CSS,
  which takes it out of the layout but not out of the markup: the ternary
  `coarse ? "Swipe up from the bottom" : "Shift + C"` still renders the touch
  copy into a `display: none`, `aria-hidden` span, and the `TIP_DELAY` /
  `TIP_HOLD` timers still fire on touch with nothing to show. Invisible and
  unannounced, so it is tidiness rather than a defect. Task 4 edits `page.tsx`
  anyway; do it there.
- **Next rewrites `tsconfig.json` during the build.** It sets `jsx` to
  `react-jsx` and adds `.next/dev/types/**/*.ts` to `include`. CI stages only
  named paths, so this is not committed and does not fail anything — but it
  means the committed `tsconfig.json` is not quite what the build uses.
- **System back is still not wired to Escape.** It was deferred out of task 3 as
  a WebView concern; the WebView now exists, so it belongs to 6b.
- **Two branches cannot be deleted from this session** — no tool exists for it.
  `fix/prove-vendor-drift-fails` (PR #2) contains a deliberately corrupted file
  and **must never be merged**; `feature/android-scaffold` is merged and spent.

## Gesture design (implemented)

Which map is live is decided at runtime by
`matchMedia("(hover: none) and (pointer: coarse)")` — not by a build flag, and
not by user agent. Both maps ship in the same bundle.

| Intent | Touch | Keyboard |
|---|---|---|
| Begin | Tap anywhere | `Space` |
| Pause | Two-finger tap | `P` |
| Change mode | Drag the mode bar | `Arrow` keys (armed), `Home`, `End` |
| Command centre | Swipe up from the bottom edge | `Shift + C` |
| Measure | Command centre -> Measure | `Shift + M` |
| Blackout | Two-finger swipe down | `Shift + B` |
| Whiteout | Two-finger swipe up | `Shift + W` |
| Leave a screen | Double tap | `Escape`, the same chord, or double click |
| Stop settling in | Tap the red word | Tap the red word, or `Alt + K` |

Arming (`ARM_WINDOW` 650 ms / `ARM_IDLE` 2500 ms) exists because a stray arrow
key is one finger away while reading. Reaching for the mode bar is not
ambiguous, so nothing on touch is armed — and the keyboard arming is untouched.

Recogniser thresholds, in `src/lib/useTouchGestures.ts`: `TAP_SLOP` 14 px,
`TAP_TIME` 450 ms, `SWIPE_MIN` 60 px, `EDGE` 72 px, `PINCH_TOL` 60 px,
`AXIS_RATIO` 1.4.

Two gestures needed no new code at all: double-tap-to-leave-a-screen was already
`onDoubleClick` on `Blackout.tsx` — upstream wrote it with the comment that a
phone has neither Shift nor Escape — and tapping the red word already worked
through `SkipPrompt`.

## Required environment variables

None. The app makes no network calls and holds no secrets.

Release signing (task 6b) will require Actions **secrets** (names only, values
never committed): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. None exist yet, which is why the
current artifact is debug-signed.

## Distribution

Sideload. The APK is produced by a GitHub Actions run (`apk.yml`) and published
twice: as a run artifact, and as a **prerelease asset**, because an artifact can
only be downloaded while signed in to the Actions UI and a phone browser wants a
plain URL.

The phone needs "install unknown apps" enabled for whichever app receives the
file.

Settled:

- **Application ID: `app.focii.mobile`** (2026-08-31). Permanent — Android
  identifies an app by this string, so changing it later is a different app:
  separate install, no upgrade path, storage wiped.

Still open:

- **`targetSdk`** is whatever the Capacitor 7 template sets. No Play deadline
  applies when sideloading, but Android refuses to install apps targeting an old
  API on current devices, so this should be read off a build and pinned
  deliberately rather than inherited.

## Deployment information

- Repository: `TJ-zip/focii-android` (public)
- Upstream pin: `TJ-zip/soundscape-v1-temp` @ `f03e1030fe59d12b744d0378ae1db2cf3c5d8e22`
- Vercel: connected. Framework preset **Next.js**, everything else default. The
  Output Directory must stay on the preset default — typing `out` into it while
  the Next.js preset is selected breaks the build. No serverless functions
  appear, which is correct under `output: 'export'`.
- The agent has no Vercel tooling in this session and can only see deployment
  results through the Vercel bot's PR comment or the owner's report.
- APK: `.github/workflows/apk.yml`, on push to `feature/capacitor-apk` or
  `release/apk**`, or on manual dispatch.

## Important architectural decisions

- **One static export, two targets.** The alternative — a separate mobile build
  — would let the two drift, and the drift would be inaudible until someone
  noticed Android sounded wrong.
- **Vendoring over a submodule or copy-paste.** Copy-paste drifts silently. A
  submodule prevents drift but makes Android-specific edits to `page.tsx`
  inexpressible. The pinned/forked split gives both.
- **`upstream.ref` must be a 40-character sha, enforced by regex.** A branch name
  would make "pinned" a moving target and the lockfile a lie.
- **No Kotlin rewrite of the engine.** It would mean re-deriving constants by
  ear: `TICK_DELAY` 4.0 s held deliberately apart from `MODE_FADE`, `TICK_GAIN`
  0.07, two noise bursts 22 ms apart inside the auditory fusion window,
  `quantizeRoot()`'s even-cycle rule (removing it shifted Pump's tempo by
  −3.32 %), and the `bus`/`out` gain split that removed the mode-change click.
- **`vendor.yml` validates its own commit.** `GITHUB_TOKEN` commits do not
  trigger workflows; upstream recorded this exact trap biting `measure.yml`.
- **The Android project is generated in CI, not committed** (2026-08-31).
  `android/` is template output plus `capacitor.config.ts`; committing ~200
  files it would create a second source of truth that drifts from the config
  meant to define it. **The cost is real and must not be forgotten: native
  customisation — the foreground service, launcher icons, manifest permissions,
  the back-button handler — cannot be hand-edited into a directory that is
  deleted on every run.** When 6b lands, it arrives as a scripted patch step in
  `apk.yml`, or this decision is reversed and `android/` is committed. It cannot
  be both, and a half-applied version of it would produce an APK whose native
  behaviour depends on whether the runner had a cached directory.
- **Debug-signed first, release-signed later.** An unsigned APK cannot be
  installed at all, so "unsigned until the keystore exists" was never an option;
  the real choice was between a debug key now and no artifact until secrets are
  configured. Accepted consequence: the eventual release build will not upgrade
  this one in place.
- **The lockfile is generated by CI and committed back.** This sandbox cannot
  write one — integrity hashes come from the registry and cannot be inferred, so
  a handwritten lockfile would be a fabrication. `apk.yml` tries `npm ci` first
  and falls back to `npm install` only when the lockfile predates a dependency,
  then commits the result.
- **Distribution is sideload, not the Play Store** (owner decision,
  2026-08-31). Consequences, all accepted: we self-sign, so there is no Play App
  Signing escrow and **losing the keystore means no user can upgrade in place**.
  There is no auto-update channel, so a new build means re-sending an APK. No
  review, no store listing, no data-safety form. The artifact is a universal
  APK; an AAB would be dead weight.
- **Sideloading changes none of the runtime requirements.** Android enforces
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and the Android 13+ runtime
  `POST_NOTIFICATIONS` prompt regardless of install source. Skipping the store
  does not skip the foreground-service work — that remains the only real
  guarantee against screen lock killing audio.
- **MediaSession is task 4, not APK polish.** Same code on both targets, and
  headset buttons need it.
- **`ModeDot.tsx` and `CommandCenter.tsx` moved pinned → forked** (2026-08-31).
  The pin protects tuned constants that cannot be recovered by reading code.
  What these two hold is *words* — the hint sequence and the shortcut list —
  and every one of those words names a key that does not exist on the target
  device. Now 17 pinned, 5 forked.
- **All Android-only CSS lives in `src/app/touch.css`**, which does not exist
  upstream and is therefore absent from the manifest. `globals.css` is marked
  forked but is still byte-identical to upstream, deliberately: the less the
  forked files actually differ, the cheaper a future re-vendor is.
- **Begin is a single tap, not a double.** An `AudioContext` may only be created
  inside a user gesture, and waiting ~300 ms to rule out a second finger spends
  that activation.
- **Pinch is declined, not blocked.** Suppressing zoom would fail WCAG 1.4.4.
  Every listener in the recogniser is passive and none call `preventDefault`; a
  gesture whose finger spread changes by more than 60 px is abandoned to the
  browser.
- **The command-corner tip is removed on touch, not restyled** (2026-08-31,
  owner report from a real phone). `.cmdtip` is a hover affordance; the touch
  copy is a sentence, so the pill wrapped to three lines and hung out of the
  corner. The gesture is already taught in two better places, and the word
  itself remains a button.

## Verified in this repo

By local execution in the authoring sandbox (Node 24), before any push:

- `vendor.mjs` rejects a branch name where a sha is required, `../../etc/passwd`,
  `/etc/shadow; rm -rf /`, and a bogus mode — all **before** any fetch or write.
- `vendor.mjs --check` with no lockfile exits 1 with an actionable message.
- `ci-report.mjs` rejects `rm -rf /`, `typecheck && curl … | sh`, `$(whoami)`,
  `../../etc/passwd` and undeclared script names, spawning nothing.

By GitHub Actions (`CI report`, commit `0bbbbee`): `vendor --fetch` fetched all
22 files at the pin; `vendor --check` passed; `npm install`, `typecheck`,
`build` and `check:export` all exited 0.

By GitHub Actions (`validate`, commit `671d074`): success in 31 s.

By GitHub Actions (`APK`, commit `bbd6831`): the Android SDK check, vendor
check, install, typecheck, `next build`, `check:export`, `cap add android`,
`cap sync android`, the assets-copied assertion and `gradlew assembleDebug` all
succeeded, and the release asset was uploaded. Evidence that the run reached the
end: prerelease `apk-bbd6831` exists and carries a 4,315,571-byte
`focii-bbd6831-debug.apk`. The workflow fails the job if no APK is found or if
`index.html` is missing from the packaged assets, so neither an empty APK nor an
empty WebView could have produced that asset.

The vendor drift check was proven to **fail closed**, not assumed to:
`src/app/icon.svg` was changed by one character on throwaway branch
`fix/prove-vendor-drift-fails` (commit `591f77d`). `validate` concluded
**failure in 5 s** — against 24–31 s for the passing runs, i.e. it died at the
vendor check, before `npm install`. PR #2 exists only to make that conclusion
readable and must never be merged.

Still not verified: that audio plays, that any gesture does what it is supposed
to on a real finger, what screen lock does, and **whether the APK installs or
opens**. A built APK is a file, not a working app.

## Last completed change

Added Capacitor packaging (`capacitor.config.ts`, `apk.yml`, `android/`
ignored) and produced the first installable artifact: debug-signed, 4.1 MB,
published as prerelease `apk-bbd6831`. The application ID is settled at
`app.focii.mobile`. Background audio under screen lock — the product objective —
remains unimplemented and is now tracked as task 6b.
