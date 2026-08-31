#!/usr/bin/env node
/**
 * Ask the exported site whether it is actually shippable, rather than trusting
 * that `next build` exiting 0 means it is.
 *
 * This repo inherits a lesson from the web app, which took two pull requests to
 * learn: a green build proves files were emitted, not that a browser receives
 * anything usable. Upstream #21 asserted the icon routes existed in the build
 * output and shipped an app with no visible icon, because what a browser acts
 * on is a <link rel="icon"> tag in the HTML -- and nothing writes that by hand.
 *
 * A static export makes that failure mode worse, not better, because there is
 * no server left to paper over a missing file. So this reads out/ and checks
 * the things that must be true for the export to work both on Vercel and,
 * later, inside a WebView.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT = join(ROOT, 'out');

const problems = [];
const notes = [];

async function walk(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

if (!existsSync(OUT)) {
  console.error(
    '\n  out/ does not exist. `next build` with output: "export" should have produced it.\n' +
    '  If the build logged "export encountered errors", that is the real failure.\n'
  );
  process.exit(1);
}

const files = await walk(OUT);
const rel = files.map((f) => relative(OUT, f));

// 1. The entry point the WebView will load.
const indexPath = join(OUT, 'index.html');
if (!existsSync(indexPath)) {
  problems.push('out/index.html is missing. The WebView has nothing to load and Vercel has no root page.');
}

let html = '';
if (existsSync(indexPath)) {
  html = await readFile(indexPath, 'utf8');
  const { size } = await stat(indexPath);
  if (size < 1000) {
    problems.push(`out/index.html is only ${size} bytes, which is too small to be the real page. Suspect an export that silently produced a stub.`);
  } else {
    notes.push(`index.html: ${(size / 1024).toFixed(1)} KB`);
  }

  // 2. The assertion that actually corresponds to a visible icon.
  if (!/rel="icon"/.test(html)) {
    problems.push(
      'out/index.html contains no <link rel="icon">. Next injects this from the src/app/icon.svg\n' +
      '      file convention; if it stopped doing so under output: "export", the build stays green\n' +
      '      and every page silently loses its icon. This is exactly the bug upstream shipped once.'
    );
  } else {
    notes.push('index.html carries <link rel="icon">');
  }

  // 3. The bundle. An export with no JS is a static screenshot of an app that
  //    happens to need Web Audio to do anything at all.
  if (!rel.some((f) => f.startsWith('_next/static'))) {
    problems.push('out/_next/static is missing, so no JavaScript was emitted. Nothing would run.');
  }
}

// 4. The icon asset itself must be present, not merely referenced.
const icons = rel.filter((f) => /(^|\/)icon[^/]*\.svg$/i.test(f));
if (icons.length === 0) {
  problems.push('No icon*.svg was emitted into out/. The <link> would point at a 404.');
} else {
  notes.push(`icon asset: ${icons.join(', ')}`);
}

// 5. Not a failure -- a measurement of known future work.
//
//    Vercel serves from /, so absolute paths are correct there and this must
//    not fail the build. A WebView loading index.html over file:// resolves a
//    leading slash to the device filesystem root, where nothing exists. The
//    Capacitor step will need assetPrefix or a relative rewrite, and this
//    number is how we will know whether that step worked.
if (html) {
  const absolute = html.match(/(?:href|src)="\//g);
  notes.push(`absolute-path references in index.html: ${absolute ? absolute.length : 0} (fine on Vercel; must be resolved before the APK loads over file://)`);
}

console.log('\n  Static export:');
console.log(`    ${files.length} files in out/`);
for (const n of notes) console.log(`    ${n}`);

if (problems.length) {
  console.error('\n  Export check failed:\n');
  for (const p of problems) console.error(`    - ${p}`);
  console.error('');
  process.exit(1);
}

console.log('\n  Export looks shippable to a static host.\n');
