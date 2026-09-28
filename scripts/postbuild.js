'use strict';

/*
 * Finishes the `output: 'standalone'` build.
 *
 * Next emits .next/standalone with a server.js and a trimmed node_modules, but
 * deliberately does NOT copy the two things that server needs at runtime:
 *   public/       — logos, catalogues, the AV datasets
 *   .next/static  — the hashed JS/CSS chunks every page asks for
 * Without them the app boots and then serves a page whose scripts 404, which
 * looks like a broken site rather than a broken build.
 *
 * This replaces a one-line `node -e "fs.cpSync(...)"` in package.json. Same
 * copies, but it says what it did and why it stopped: that inline version
 * printed nothing at all on success and a bare stack trace on failure, so a
 * deploy log ended mid-air with no way to tell whether the step had worked,
 * crashed, or never run.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');

// Each entry: what to copy, where it lands inside the standalone output, and
// whether the build is unusable without it.
const COPIES = [
  { from: path.join(ROOT, 'public'), to: path.join(STANDALONE, 'public'), label: 'public/', required: false },
  { from: path.join(ROOT, '.next', 'static'), to: path.join(STANDALONE, '.next', 'static'), label: '.next/static', required: true }
];

function fail(message, hint) {
  console.error(`\npostbuild FAILED: ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

function measure(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files++;
        bytes += fs.statSync(full).size;
      }
    }
  };
  walk(dir);
  return { files, mb: (bytes / 1024 / 1024).toFixed(1) };
}

if (!fs.existsSync(STANDALONE)) {
  fail(
    '.next/standalone does not exist, so there is nothing to finish.',
    "next.config.ts must set output: 'standalone', and `next build` must have completed — check for an earlier error in this log."
  );
}

for (const copy of COPIES) {
  if (!fs.existsSync(copy.from)) {
    if (copy.required) {
      fail(`${copy.label} is missing, and the standalone server cannot run without it.`, 'Did `next build` finish, or was the working directory changed?');
    }
    console.log(`postbuild: ${copy.label} not present — skipped (nothing to copy).`);
    continue;
  }

  const { files, mb } = measure(copy.from);
  try {
    fs.cpSync(copy.from, copy.to, { recursive: true });
  } catch (error) {
    // ENOSPC and EACCES are the two that actually happen on a build server,
    // and both are unrecognisable from a raw stack trace.
    const code = error && error.code;
    fail(
      `could not copy ${copy.label} into the standalone output (${code || 'unknown error'}).`,
      code === 'ENOSPC'
        ? 'The build server has run out of disk space.'
        : code === 'EACCES'
          ? 'The build user lacks permission to write into .next/standalone.'
          : error && error.message
    );
  }
  console.log(`postbuild: copied ${copy.label} -> ${path.relative(ROOT, copy.to)}  (${files} files, ${mb} MB)`);
}

// A standalone build that is missing its entry point will fail at start-up
// instead of here, where the reason would have been obvious.
const server = path.join(STANDALONE, 'server.js');
if (!fs.existsSync(server)) {
  fail('.next/standalone/server.js is missing — the standalone output is incomplete.', 'The app would start with "Cannot find module" at runtime.');
}

console.log('postbuild: standalone output is complete and ready to start.');
