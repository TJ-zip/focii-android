/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The single most consequential line in this repo.
  //
  // An APK has no Node process behind it: the WebView loads index.html off the
  // device filesystem. So the Android build cannot use any server feature, and
  // the honest way to guarantee that is to remove the server entirely rather
  // than to remember not to use it. `output: 'export'` makes a server feature a
  // build error instead of a surprise at packaging time.
  //
  // It costs nothing here. The app is one client component, four synthesis
  // modes and a canvas; there are no API routes and no server state. The one
  // thing it did cost is documented below.
  output: 'export',

  // Consequence of the above, and the reason src/app/apple-icon.tsx is not
  // vendored from the web app: it rasterises through Satori at *request* time,
  // which is a server route by definition. The Android icons come from the
  // Android manifest, and the web build gets a committed PNG generated from
  // src/lib/mark.ts.
  //
  // next/image is likewise unavailable without a server optimiser. The app
  // ships no raster images at all -- everything is canvas or inline SVG -- so
  // this is here to make the failure legible if that ever changes.
  images: { unoptimized: true },

  // Emits out/index.html rather than out.html, so the same tree serves
  // correctly from Vercel, from a plain static host, and from the WebView.
  trailingSlash: true,
};

export default nextConfig;
