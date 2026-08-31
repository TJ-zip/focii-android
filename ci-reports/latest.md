# CI report

Generated 2026-08-31T15:22:32.744Z

Commit `0bbbbee` on `feature/android-scaffold`

## Summary

| script | exit | duration |
|---|---:|---:|
| `typecheck` | 0 | 2.5s |
| `build` | 0 | 8.3s |
| `check:export` | 0 | 0.1s |

## `npm run typecheck` - exit 0

### stdout

```

> focii-android@0.1.0 typecheck
> tsc --noEmit
```

### stderr

```
(empty)
```

## `npm run build` - exit 0

### stdout

```

> focii-android@0.1.0 build
> next build

▲ Next.js 16.3.0 (Turbopack)
✓ Running next.config.mjs took 12ms
⚠ No build cache found. Please configure build caching for faster rebuilds. Read more: https://nextjs.org/docs/messages/no-cache
Attention: Next.js now collects completely anonymous telemetry regarding usage.
This information is used to shape Next.js' roadmap and prioritize features.
You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:
https://nextjs.org/telemetry


  Creating an optimized production build ...
✓ Compiled successfully in 4.1s
  Running TypeScript ...

  We detected TypeScript in your project and reconfigured your tsconfig.json file for you.
  The following suggested values were added to your tsconfig.json. These values can be changed to fit your project's needs:

  	- include was updated to add '.next/dev/types/**/*.ts'

  The following mandatory changes were made to your tsconfig.json:

  	- jsx was set to react-jsx (next.js uses the React automatic runtime)

  Finished TypeScript in 2.4s ...
  Collecting page data using 3 workers ...
  Generating static pages using 3 workers (0/4) ...
  Generating static pages using 3 workers (1/4) 
  Generating static pages using 3 workers (2/4) 
  Generating static pages using 3 workers (3/4) 
✓ Generating static pages using 3 workers (4/4) in 224ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
└ ○ /icon.svg


○  (Static)  prerendered as static content
```

### stderr

```
(empty)
```

## `npm run check:export` - exit 0

### stdout

```

> focii-android@0.1.0 check:export
> node scripts/check-export.mjs


  Static export:
    26 files in out/
    index.html: 11.3 KB
    index.html carries <link rel="icon">
    icon asset: _next/static/media/icon.0x3snppdt15fi.svg, icon.svg
    absolute-path references in index.html: 11 (fine on Vercel; must be resolved before the APK loads over file://)

  Export looks shippable to a static host.
```

### stderr

```
(empty)
```

