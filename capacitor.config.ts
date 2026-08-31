import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration.
 *
 * There is no second application here. The APK ships the *same* `out/`
 * directory that Vercel serves, loaded into a WebView. That is the whole point
 * of `output: 'export'` in next.config.mjs -- see the comment there.
 */
const config: CapacitorConfig = {
  // Permanent. Android identifies an app by this string: changing it later is a
  // different app entirely -- separate install, no upgrade path, storage wiped.
  // Settled in PROJECT_STATUS.md before the first build for exactly that
  // reason.
  appId: 'app.focii.mobile',
  appName: 'Focii',

  // The Next.js static export. Not `.next` -- that is build cache, not output.
  webDir: 'out',

  android: {
    // Capacitor serves the web directory from https://localhost through its
    // local server rather than from file://. This is why the 11 absolute asset
    // paths recorded in PROJECT_STATUS.md as a known issue are NOT a problem
    // for this target: `/_next/...` resolves against the local server root, not
    // the device filesystem root. `check:export` still counts them, because if
    // the scheme ever changes to file:// they become fatal again.
    //
    // It also means Web Audio and Canvas run under a secure origin, which is
    // what AudioContext requires.
    allowMixedContent: false,
  },

  // The app draws its own background before first paint; a white flash between
  // the launcher and the canvas would be the first thing a user sees of a piece
  // of software whose entire subject is calm.
  backgroundColor: '#050505',
};

export default config;
