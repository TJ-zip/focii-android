#!/usr/bin/env node
/**
 * Runs the npm scripts named in ci-request.txt and writes ci-reports/latest.md.
 *
 * The point is diagnosis, not gatekeeping. A workflow conclusion tells you THAT
 * something failed; it does not tell you why, and the authoring environment
 * cannot run a build to find out. This captures the actual stdout and stderr so
 * the error text comes back into the repository.
 *
 * ci-request.txt SELECTS FROM DECLARED SCRIPTS. It must never be able to
 * introduce a shell command, because a file that anyone can edit turning into
 * arbitrary code execution in a job holding contents: write is precisely how
 * repositories get taken over. Two defences, both required:
 *
 *   1. every line must match ^[A-Za-z0-9:_-]+$ and must already exist in
 *      package.json's scripts block;
 *   2. execution is spawnSync with an argument array and shell: false, so even
 *      if a name somehow passed validation there is no shell to interpret it.
 */

import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const REQUEST = join(ROOT, 'ci-request.txt');
const REPORT_DIR = join(ROOT, 'ci-reports');

const NAME_RE = /^[A-Za-z0-9:_-]+$/;
const HEAD_LINES = 60;
const TAIL_LINES = 160;

function excerpt(text) {
  const lines = (text ?? '').replace(/\s+$/, '').split('\n');
  if (lines.length <= HEAD_LINES + TAIL_LINES) return lines.join('\n');
  const omitted = lines.length - HEAD_LINES - TAIL_LINES;
  return [
    ...lines.slice(0, HEAD_LINES),
    '',
    `... ${omitted} lines omitted ...`,
    '',
    ...lines.slice(-TAIL_LINES),
  ].join('\n');
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const declared = Object.keys(pkg.scripts ?? {});

let requested = [];
if (existsSync(REQUEST)) {
  requested = (await readFile(REQUEST, 'utf8'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

const accepted = [];
const rejected = [];

for (const line of requested) {
  if (!NAME_RE.test(line)) {
    rejected.push({ line, why: 'not a bare script name - rejected before it could reach a shell' });
  } else if (!declared.includes(line)) {
    rejected.push({ line, why: `no such script in package.json (declared: ${declared.join(', ')})` });
  } else {
    accepted.push(line);
  }
}

// Overridable only so this script can be exercised where npm is absent. CI
// leaves it unset and gets plain `npm`.
const NPM_BIN = process.env.CI_REPORT_NPM || 'npm';

const results = [];
for (const name of accepted) {
  console.log(`\n=== npm run ${name} ===`);
  const started = Date.now();
  // shell: false is the load-bearing argument here.
  const proc = spawnSync(NPM_BIN, ['run', name], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (proc.stdout) console.log(proc.stdout);
  if (proc.stderr) console.error(proc.stderr);

  // A failure to *launch* npm is not the same as a script that ran and failed.
  // Collapsing both into "exit -1" would send someone hunting a type error that
  // does not exist, so it is reported as its own category.
  if (proc.error) {
    const why = `could not launch \`${NPM_BIN}\`: ${proc.error.message}`;
    console.error(`=== ${name}: ${why} ===`);
    results.push({ name, code: -1, seconds, spawnError: why, stdout: proc.stdout, stderr: proc.stderr });
    continue;
  }

  // Killed by a signal (OOM, timeout) also reports status null.
  const code = proc.status ?? -1;
  const signalNote = proc.signal ? ` (killed by ${proc.signal})` : '';
  console.log(`=== ${name}: exit ${code}${signalNote} in ${seconds}s ===`);
  results.push({ name, code, seconds, signal: proc.signal, stdout: proc.stdout, stderr: proc.stderr });
}

const failed = results.filter((r) => r.code !== 0);

const lines = [
  '# CI report',
  '',
  `Generated ${new Date().toISOString()}`,
  '',
  `Commit \`${(process.env.GITHUB_SHA ?? 'unknown').slice(0, 7)}\` on \`${process.env.GITHUB_REF_NAME ?? 'unknown'}\``,
  '',
  '## Summary',
  '',
  '| script | exit | duration |',
  '|---|---:|---:|',
  ...results.map((r) => {
    const status = r.spawnError ? 'not launched' : r.signal ? `${r.code} (${r.signal})` : String(r.code);
    return `| \`${r.name}\` | ${status} | ${r.seconds}s |`;
  }),
  '',
];

if (rejected.length) {
  lines.push('## Rejected requests', '');
  for (const r of rejected) lines.push(`- \`${r.line}\` - ${r.why}`);
  lines.push('');
}

if (!results.length) {
  lines.push('_No runnable scripts were requested._', '');
}

for (const r of results) {
  lines.push(`## \`npm run ${r.name}\` - exit ${r.code}`, '');
  if (r.spawnError) {
    lines.push(
      `> **The script never ran.** ${r.spawnError}`,
      '>',
      '> This is a runner/environment fault, not a fault in the project source.',
      '',
    );
  }
  if (r.signal) {
    lines.push(`> **Killed by signal \`${r.signal}\`** - usually the runner running out of memory.`, '');
  }
  const out = excerpt(r.stdout);
  const err = excerpt(r.stderr);
  lines.push('### stdout', '', '```', out || '(empty)', '```', '');
  lines.push('### stderr', '', '```', err || '(empty)', '```', '');
}

await mkdir(REPORT_DIR, { recursive: true });
await writeFile(join(REPORT_DIR, 'latest.md'), lines.join('\n') + '\n');

console.log(`\nWrote ci-reports/latest.md - ${results.length} run, ${failed.length} failed, ${rejected.length} rejected.`);

if (rejected.length) {
  console.error('\nRejected lines in ci-request.txt:');
  for (const r of rejected) console.error(`  - ${JSON.stringify(r.line)}: ${r.why}`);
}

process.exit(failed.length || rejected.length ? 1 : 0);
