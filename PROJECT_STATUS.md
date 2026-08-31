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
hash-verified. Application code is byte-identical between targets except for the
three forked files.

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

**Not verified: that the app runs.** Nothing has been opened in a browser and no
audio has been heard. A green build says the files exist, not that the app
works — the exact distinction upstream learned the hard way on #21.

## Current task

Land the scaffold. Vendoring and the build are green; awaiting a Vercel preview
so the app can be opened on a real device.

## Pending tasks

In deliberate order — each depends on the previous being confirmed.

1. **Scaffold + vendor + green build** — done; PR #1 open, awaiting review and a
   Vercel connection.
2. **Static icon.** Replace the request-time `apple-icon.tsx` with a PNG
   generated from `src/lib/mark.ts`; add Android mipmap densities.
3. **Touch gesture layer** on the forked `page.tsx`. Drop arming; keep keyboard
   bindings (the same build runs in a desktop browser on Vercel).
4. **MediaSession + wake lock + a visible pause state.**
5. **User tests on their phone** via the Vercel preview.
6. **Capacitor + foreground service + signed APK** from Actions. Keystore in
   Actions secrets, never in the repository.

## Known issues

- **Absolute asset paths — 11 of them, measured.** `check:export` counts
  `href="/…"` / `src="/…"` references in `index.html`; the current build has
  **11**. Harmless on Vercel; under a WebView on `file://` a leading slash
  resolves to the device root. The Capacitor step will need `assetPrefix` or
  relative rewriting. The count is reported, not failed, because it is only a
  problem for the APK target — it is how we will know the fix worked.
- **`apple-icon.tsx` cannot be vendored.** Satori rasterises at request time; a
  static export has no request. Tracked as task 2.
- **Next rewrites `tsconfig.json` during the build.** It sets `jsx` to
  `react-jsx` and adds `.next/dev/types/**/*.ts` to `include`. CI stages only
  named paths, so this is not committed and does not fail anything — but it
  means the committed `tsconfig.json` is not quite what the build uses.

## Gesture design (proposed, not yet implemented)

Arming (`ARM_WINDOW` 650 ms / `ARM_IDLE` 2500 ms) exists because arrow keys are
ambiguous. Touch gestures are not, so arming is dropped on touch — a conclusion
the upstream docs already support.

| Gesture | Action |
|---|---|
| Tap | Begin |
| Two-finger tap | Pause |
| Horizontal swipe on mode bar | Change mode (already implemented) |
| Swipe up from bottom edge | Command centre |
| Two-finger swipe down / up | Blackout / whiteout |
| Tap the red word, or double-tap | Stop settling in |
| System back | Escape |

## Required environment variables

None. The app makes no network calls and holds no secrets.

APK signing will later require Actions **secrets** (names only, values never
committed): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Deployment information

- Repository: `TJ-zip/focii-android` (public)
- Upstream pin: `TJ-zip/soundscape-v1-temp` @ `f03e1030fe59d12b744d0378ae1db2cf3c5d8e22`
- Vercel: **must be connected by the repository owner.** The agent has no Vercel
  tooling in this session and cannot verify deployments except through the
  Vercel bot's PR comment.

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
- **MediaSession is task 4, not APK polish.** Same code on both targets, and
  headset buttons need it.

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

Still not verified: that the app renders, that audio plays, or that anything
behaves correctly on a phone. No browser has opened this build.

## Last completed change

Scaffold landed on `feature/android-scaffold` and opened as PR #1. `src/` is
vendored at the pin, `package-lock.json` was generated by CI and committed, and
typecheck/build/export are green.
