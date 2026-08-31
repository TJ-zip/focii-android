#!/usr/bin/env node
/**
 * Vendor the shared Focii sources from the web app, and prove they have not
 * drifted.
 *
 * Why this exists rather than a copy-paste or a git submodule:
 *
 * The expensive part of this project is not the volume of code, it is a set of
 * constants that were arrived at by ear and by measurement -- TICK_DELAY 4.0s
 * held deliberately apart from MODE_FADE, TICK_GAIN 0.07, the two noise bursts
 * 22ms apart inside the auditory fusion window, quantizeRoot()'s even-cycle
 * requirement (dropping it measurably shifted Pump's tempo by -3.32%), the
 * bus/out gain split that removed the click on mode change. None of that is
 * recoverable by reading the file. A silent divergence between the two apps
 * would not fail a build, it would just make Android sound subtly wrong, and
 * nobody would know which copy was right.
 *
 * So: pinned files are held byte-identical by sha256 and CI fails on drift.
 * A submodule would enforce the same thing but makes the Android-specific
 * edits (page.tsx must change substantially for touch) impossible to express.
 * This split lets one file be frozen and its neighbour be forked, which is
 * exactly the shape of this port.
 *
 *   node scripts/vendor.mjs --fetch     download and refresh the lock (needs network)
 *   node scripts/vendor.mjs --check     verify against the lock (offline, used by CI)
 *   node scripts/vendor.mjs --fetch --force-forked
 *                                       also overwrite forked files, discarding
 *                                       local Android edits
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const MANIFEST = join(ROOT, 'vendor.manifest.json');
const LOCK = join(ROOT, 'vendor.lock.json');

// This script fetches over the network and writes into the working tree, so it
// validates everything it is handed rather than trusting the manifest. The
// manifest is version-controlled, but a file being in git is not the same as a
// file being safe to interpolate into a URL or a filesystem path.
const REF_RE = /^[0-9a-f]{40}$/;                 // a full commit sha, never a branch:
                                                 // a branch would make "pinned" a
                                                 // moving target and the lock a lie.
const SLUG_RE = /^[A-Za-z0-9._-]+$/;             // owner and repo
const PATH_RE = /^[A-Za-z0-9._/-]+$/;            // repo-relative path

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function validate(manifest) {
  const u = manifest?.upstream;
  if (!u || !SLUG_RE.test(u.owner ?? '') || !SLUG_RE.test(u.repo ?? '')) {
    fail('vendor.manifest.json: upstream.owner / upstream.repo missing or malformed.');
  }
  if (!REF_RE.test(u.ref ?? '')) {
    fail(
      `vendor.manifest.json: upstream.ref must be a full 40-character commit sha, got ${JSON.stringify(u.ref)}.\n` +
      '  A branch name here would let "pinned" change underneath us without any commit in this repo.'
    );
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail('vendor.manifest.json: files must be a non-empty array.');
  }
  for (const entry of manifest.files) {
    if (!PATH_RE.test(entry?.path ?? '') || entry.path.includes('..')) {
      fail(`vendor.manifest.json: unsafe path ${JSON.stringify(entry?.path)}.`);
    }
    if (entry.mode !== 'pinned' && entry.mode !== 'forked') {
      fail(`vendor.manifest.json: ${entry.path} has mode ${JSON.stringify(entry.mode)}; expected "pinned" or "forked".`);
    }
  }
  return manifest;
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function fetchAll(manifest, { forceForked }) {
  const { owner, repo, ref } = manifest.upstream;
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/`;

  console.log(`  upstream ${owner}/${repo} @ ${ref.slice(0, 7)}\n`);

  const lock = {
    upstream: manifest.upstream,
    generated: new Date().toISOString(),
    files: {},
  };

  for (const { path, mode } of manifest.files) {
    const url = base + path;
    const res = await fetch(url);
    if (!res.ok) {
      fail(`GET ${url}\n  responded ${res.status} ${res.statusText}. The manifest lists a file that does not exist at this ref.`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    const upstreamHash = sha256(body);

    const dest = join(ROOT, path);
    const exists = existsSync(dest);

    // A forked file is expected to have been edited for Android. Overwriting it
    // on a routine re-vendor would silently throw that work away, so it is
    // written only when absent, or when explicitly forced.
    const write = mode === 'pinned' || !exists || forceForked;
    if (write) {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, body);
    }

    const localHash = sha256(await readFile(dest));
    lock.files[path] = { mode, upstream_sha256: upstreamHash, local_sha256: localHash };

    const note =
      mode === 'pinned' ? 'pinned' :
      write ? 'forked, written' :
      localHash === upstreamHash ? 'forked, unchanged so far' : 'forked, local edits kept';
    console.log(`  ${write ? 'wrote ' : 'kept  '} ${path.padEnd(38)} ${note}`);
  }

  await writeFile(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log(`\n  vendor.lock.json updated: ${Object.keys(lock.files).length} files.`);
}

async function check(manifest) {
  if (!existsSync(LOCK)) {
    fail(
      'vendor.lock.json is missing, so the vendored sources have never been fetched.\n' +
      '  Run the "Vendor" workflow (Actions -> Vendor -> Run workflow), which fetches them and commits the result.'
    );
  }
  const lock = await readJson(LOCK);

  if (lock.upstream?.ref !== manifest.upstream.ref) {
    fail(
      'vendor.manifest.json points at a different upstream ref than vendor.lock.json was built from.\n' +
      `  manifest: ${manifest.upstream.ref}\n  lock:     ${lock.upstream?.ref}\n` +
      '  Re-run the Vendor workflow so the two agree.'
    );
  }

  const problems = [];
  const diverged = [];

  for (const { path, mode } of manifest.files) {
    const recorded = lock.files?.[path];
    if (!recorded) {
      problems.push(`${path}: listed in the manifest but absent from the lock. Re-run the Vendor workflow.`);
      continue;
    }
    const dest = join(ROOT, path);
    if (!existsSync(dest)) {
      problems.push(`${path}: vendored file is missing from the working tree.`);
      continue;
    }
    const actual = sha256(await readFile(dest));

    if (mode === 'pinned') {
      if (actual !== recorded.upstream_sha256) {
        problems.push(
          `${path}: PINNED file has drifted from upstream.\n` +
          `      expected ${recorded.upstream_sha256}\n` +
          `      actual   ${actual}\n` +
          '      This file is held byte-identical to the web app on purpose. If the change is\n' +
          '      wanted, make it upstream and re-vendor; if the file genuinely needs to differ\n' +
          '      on Android, move it to "forked" in vendor.manifest.json and say why.'
        );
      }
    } else if (actual !== recorded.upstream_sha256) {
      diverged.push(path);
    }
  }

  if (problems.length) {
    console.error('\n  Vendor check failed:\n');
    for (const p of problems) console.error(`    - ${p}`);
    console.error('');
    process.exit(1);
  }

  const pinned = manifest.files.filter((f) => f.mode === 'pinned').length;
  console.log(`  ${pinned} pinned files match upstream ${lock.upstream.ref.slice(0, 7)} exactly.`);
  if (diverged.length) {
    console.log(`  ${diverged.length} forked files carry Android-specific edits (expected):`);
    for (const p of diverged) console.log(`    - ${p}`);
  }
}

const args = new Set(process.argv.slice(2));
const manifest = validate(await readJson(MANIFEST));

if (args.has('--fetch')) {
  await fetchAll(manifest, { forceForked: args.has('--force-forked') });
} else if (args.has('--check')) {
  await check(manifest);
} else {
  console.error('usage: node scripts/vendor.mjs [--fetch [--force-forked] | --check]');
  process.exit(2);
}
