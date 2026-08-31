import type { Metadata, Viewport } from "next";
import "./globals.css";
// ANDROID FORK. Imported after globals so it wins ties, and kept separate so
// the entire CSS divergence from the web app is one readable file.
import "./touch.css";

export const metadata: Metadata = {
  title: "Focii",
  description:
    "Multiple modes of focus \u2014 generative soundscapes for Focus, Relax, Sleep and Pump.",
};

export const viewport: Viewport = {
  themeColor: "#050505",

  // ANDROID FORK.
  //
  // The app draws to the edges: the visualizer is a fixed full-bleed canvas
  // and the HUD already pads itself with env(safe-area-inset-bottom). That
  // padding is zero unless the viewport is told to cover the display cutouts
  // and system bars, so without this line the inset is compensation for
  // nothing and the mode bar sits above a black band.
  //
  // It also matters for the command-centre gesture, which must be started
  // within 72px of the bottom edge. The bottom edge should be the bottom of
  // the screen, not the top of the navigation bar.
  viewportFit: "cover",

  // Deliberately NOT setting maximumScale or userScalable. Suppressing zoom
  // would make the two-finger gestures unambiguous and would also fail WCAG
  // 1.4.4; the gesture recogniser declines pinches instead. See
  // src/lib/useTouchGestures.ts.
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
