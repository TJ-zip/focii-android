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
- **Capacitor APK** — the same `out/` inside a WebView, plus a foreground
  service for background audio.

`src/` is vendored from `TJ-zip/soundscape-v1-temp` at a pinned commit and
hash-verified. Application code is byte-identical between targets; the
divergence is entirely in the five forked files plus three new files that do not
exist upstream at all.

## Technology stack

- Next.js 16.3.0 (App Router, `output: 'export'`), React 19, TypeScript 5.6
- Web Audio API + Canvas 2D. No audio or graphics dependencies.
- Node 22 in CI, npm
- Capacitor — **not yet added**

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

## Current task

None in progress. Task 3, the touch gesture layer, was squash-merged to `main`
as `55ba8f9` and production now serves the gesture map. The next move is task 4,
but it is worth waiting for the owner's phone report first: task 4 is
MediaSession and wake lock, and how much of it is needed depends on what screen
lock currently does to the audio — which nobody has yet observed.

## Pending tasks

In deliberate order — each depends on the previous being confirmed.

1. **Scaffold + vendor + green build** — **done.** PR #1 squash-merged as
   `bbfa256`; Vercel connected and serving production from `main`.
2. **Static icon.** Replace the request-time `apple-icon.tsx` with a PNG
   generated from `src/lib/mark.ts`; add Android mipmap densities.
3. **Touch gesture layer** — **done.** PR #3 squash-merged as `55ba8f9`.
   Keyboard bindings kept in full: the same build runs in a desktop browser on
   Vercel. Design and thresholds are recorded below.
4. **MediaSession + wake lock + a visible pause state.** While `page.tsx` is
   open for this, collapse the dead `.cmdtip` ternary and guard the tip timers
   on `coarse` — see Known issues.
5. **User tests on their phone** via the Vercel deployment.
6. **Capacitor + foreground service + signed APK** from Actions. Keystore in
   Actions secrets, never in the repository. Universal **release APK** for
   sideloading — not an AAB, which only the Play Store consumes. **Blocked on
   the Application ID decision** under Distribution.

## Known issues

- **Absolute asset paths — 11 of them, measured.** `check:export` counts
  `href="/…"` / `src="/…"` references in `index.html`; the current build has
  **11**. Harmless on Vercel; under a WebView on `file://` a leading slash
  resolves to the device root. The Capacitor step will need `assetPrefix` or
  relative rewriting. The count is reported, not failed, because it is only a
  problem for the APK target — it is how we will know the fix worked.
- **`apple-icon.tsx` cannot be vendored.** Satori rasterises at request time; a
  static export has no request. Tracked as task 2.
- **A dead string in `page.tsx`.** The command-corner tip is removed in CSS,
  which takes it out of the layout but not out of the markup: the ternary
  `coarse ? "Swipe up from the bottom" : "Shift + C"` still renders the touch
  copy into a `display: none`, `aria-hidden` span, and the `TIP_DELAY` /
  `TIP_HOLD` timers still fire on touch with nothing to show. Invisible and
  unannounced, so it is tidiness rather than a defect — but the ternary should
  collapse to the keyboard string and the effect should take `coarse` as a
  guard. Task 4 edits `page.tsx` anyway; do it there rather than reflowing a
  1,500-line file for a one-line change.
- **Next rewrites `tsconfig.json` during the build.** It sets `jsx` to
  `react-jsx` and adds `.next/dev/types/**/*.ts` to `include`. CI stages only
  named paths, so this is not committed and does not fail anything — but it
  means the committed `tsconfig.json` is not quite what the build uses.
- **Three branches cannot be deleted from this session** — no tool exists for
  it. `fix/prove-vendor-drift-fails` (PR #2) contains a deliberately corrupted
  file and **must never be merged**; `feature/android-scaffold` and
  `feature/touch-gestures` are both merged and spent.

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

Deliberately **not** implemented: system back as Escape. It is a WebView concern
and belongs with Capacitor in task 6, not in the browser build.

## Required environment variables

None. The app makes no network calls and holds no secrets.

APK signing will later require Actions **secrets** (names only, values never
committed): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Distribution

Sideload. The signed APK is produced by a GitHub Actions run and downloaded to
the device; the phone needs "install unknown apps" enabled for whichever app
receives the file. Not published anywhere.

Open, to settle before task 6:

- **Application ID** — permanent. Changing it later is a different app as far as
  Android is concerned: separate install, no upgrade path. Proposal:
  `app.focii.mobile`. **Still unanswered; this blocks task 6.**
- **`targetSdk`.** No Play deadline applies when sideloading, but Android itself
  refuses to install apps targeting an old API on current devices, so this
  tracks the latest stable regardless.

## Deployment information

- Repository: `TJ-zip/focii-android` (public)
- Upstream pin: `TJ-zip/soundscape-v1-temp` @ `f03e1030fe59d12b744d0378ae1db2cf3c5d8e22`
- Vercel: connected. Framework preset **Next.js**, everything else default. The
  Output Directory must stay on the preset default — typing `out` into it while
  the Next.js preset is selected breaks the build. No serverless functions
  appear, which is correct under `output: 'export'`.
- The agent has no Vercel tooling in this session and can only see deployment
  results through the Vercel bot's PR comment or the owner's report. A push to
  `main` produces no PR, so **production deployments are invisible to the
  agent** — they have to be confirmed by the owner.

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
- **Distribution is sideload, not the Play Store** (owner decision,
  2026-08-31). Consequences, all accepted: we self-sign, so there is no Play App
  Signing escrow and **losing the keystore means no user can upgrade in place** —
  a new signing key forces uninstall/reinstall, which wipes app storage. There
  is no auto-update channel, so a new build means re-sending an APK. No review,
  no store listing, no data-safety form. The artifact is a universal release
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
  device. Keeping them pinned would have meant the app being unable to describe
  itself. Now 17 pinned, 5 forked. `vendor.mjs check()` reads `mode` from the
  manifest rather than the lock, so the move required no re-fetch.
- **All Android-only CSS lives in `src/app/touch.css`**, which does not exist
  upstream and is therefore absent from the manifest. `globals.css` is marked
  forked but is still byte-identical to upstream, deliberately: the less the
  forked files actually differ, the cheaper a future re-vendor is. Same reason
  the two new hooks are their own files rather than additions to existing ones.
- **Begin is a single tap, not a double.** An `AudioContext` may only be created
  inside a user gesture, and waiting ~300 ms to rule out a second finger spends
  that activation — the session would fail to start. Verified that `startAudio`
  constructs the engine with no preceding `await`, so calling it from a passive
  `touchend` listener preserves user activation.
- **Pinch is declined, not blocked.** Suppressing zoom would fail WCAG 1.4.4,
  and a non-passive `touchmove` on window would make the scroll-snap mode bar
  janky. Every listener in the recogniser is passive and none call
  `preventDefault`; a gesture whose finger spread changes by more than 60 px is
  simply abandoned to the browser.
- **The command-corner tip is removed on touch, not restyled** (2026-08-31,
  owner report from a real phone). `.cmdtip` is a hover affordance: a
  single-line pill absolutely positioned under the word "Command" and pinned to
  the right edge, a shape that works because `SHIFT + C` is five characters.
  A phone has no hover, so the only thing that ever opened it there was the
  recall flash the app fires at itself — and the touch copy is a sentence, so
  the pill wrapped to three lines and hung out of the corner. An earlier
  `max-width` rule tried to make the sentence fit; that produced the wrap.
  Deleting it costs nothing, because the gesture is already taught in two
  better places: the dot hint sequence ends on "Swipe up from the bottom", and
  the command centre lists it as a `.cmdgesture` pill. The word remains a
  button, which is a more direct affordance than the tip was. The
  `data-flash` brightening is suppressed with it — a corner that lights up to
  reveal nothing reads as a twitch.

## Verified in this repo

By local execution in the authoring sandbox (Node 24), before any push:

- `vendor.mjs` rejects a branch name where a sha is required, `../../etc/passwd`,
  `/etc/shadow; rm -rf /`, and a bogus mode — all **before** any fetch or write.
- `vendor.mjs --check` with no lockfile exits 1 with an actionable message.
- `ci-report.mjs` rejects `rm -rf /`, `typecheck && curl … | sh`, `$(whoami)`,
  `../../etc/passwd` and undeclared script names, spawning nothing. A canary file
  survived. It correctly reports a passing script, a failing script, a
  launch failure, and excerpts a 500-line log.

By GitHub Actions (`CI report`, commit `0bbbbee`): `vendor --fetch` fetched all
22 files at the pin; `vendor --check` passed; `npm install`, `typecheck`,
`build` and `check:export` all exited 0.

By GitHub Actions (`validate`, commits `671d074` and `86bb732`, the last two on
`feature/touch-gestures`): both concluded **success**, i.e. each ran past the
vendor check and built. `touch.css` is not vendored, so the tip removal could
not disturb the pin. Note what `validate` does **not** cover: the repository
declares no `lint` and no `test` script, so no test has ever run here and none
should be claimed.

On the merge of PR #3 (squash commit `55ba8f9`): the three files that differ
from `main`'s previous state were compared by blob sha against the tree
`validate` passed on `86bb732` — `touch.css` `4096289c…`, `page.tsx`
`65970d06…`, `layout.tsx` `de7c7e7e…` — and are identical. So what is on `main`
is the tree that built. **Unread:** the `validate` conclusion for `55ba8f9`
itself and the production Vercel deployment, because this session has no tool
that reads check runs for a commit outside a pull request.

The vendor drift check was proven to **fail closed**, not assumed to:
`src/app/icon.svg` was changed by one character (`#050505` → `#050506`) on
throwaway branch `fix/prove-vendor-drift-fails` (commit `591f77d`). `validate`
concluded **failure in 5 s** — against 24–27 s for the passing runs, i.e. it
died at the vendor check, before `npm install`, exactly as designed. PR #2 was
opened only to make that conclusion readable and must never be merged.

Still not verified: that audio plays, that any gesture does what it is supposed
to on a real finger, or what screen lock does. Of the gesture table above, the
only thing a human has reported is what the corner looked like — and the fix for
that has itself only been verified as *built*, not as *seen*.

## Last completed change

PR #3 squash-merged to `main` as `55ba8f9`: the touch gesture layer, including
the removal of the command-corner tip on coarse pointers. Production serves the
gesture map from `main`. The vendor workflow then ran on `main` and committed
`ae05690`, which touches `vendor.lock.json` only — two lines, re-recording
`ModeDot.tsx` and `CommandCenter.tsx` under their new forked mode.
