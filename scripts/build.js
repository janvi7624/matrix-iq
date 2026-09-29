'use strict';

/*
 * Runs `next build` with a raised heap limit, on every platform.
 *
 * This replaces `"build": "NODE_OPTIONS='--max-old-space-size=2048' next build"`
 * in package.json. That form is valid POSIX shell, so it works on the Linux
 * build server — but npm runs scripts through cmd.exe on Windows, which reads
 * NODE_OPTIONS='...' as a command name and fails with:
 *
 *   'NODE_OPTIONS' is not recognized as an internal or external command
 *
 * ...so nobody on Windows could build at all. Setting the variable here, in
 * Node, and passing it to the child process does the same thing without
 * depending on which shell npm happens to use.
 *
 * Why raise the heap: the build server is memory-constrained and was killing
 * builds mid-compile. The ceiling pairs with experimental.cpus in
 * next.config.ts, which limits how many workers can each claim up to this
 * much — see the comment there before raising either number.
 *
 *   NEXT_BUILD_HEAP_MB=3072 npm run build    # override the ceiling
 *   NODE_OPTIONS=...        npm run build    # respected, and appended to
 */

const { spawnSync } = require('node:child_process');

const heapMb = (() => {
  const requested = Number(process.env.NEXT_BUILD_HEAP_MB);
  return Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 2048;
})();

// Keep anything the caller already set; only add the heap flag if it is not
// already specified, so an explicit NODE_OPTIONS always wins.
const existing = process.env.NODE_OPTIONS || '';
const nodeOptions = /--max-old-space-size/.test(existing)
  ? existing
  : `${existing} --max-old-space-size=${heapMb}`.trim();

// Resolved through Node rather than relying on `next` being on PATH, which
// differs between npm, pnpm and a bare shell.
const nextBin = require.resolve('next/dist/bin/next');
const args = process.argv.slice(2);

console.log(`build: next ${['build', ...args].join(' ')}  (heap ${heapMb} MB)`);

const result = spawnSync(process.execPath, [nextBin, 'build', ...args], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions }
});

if (result.error) {
  console.error(`build FAILED to start: ${result.error.message}`);
  process.exit(1);
}
// Propagate the real outcome — a build server decides whether to deploy from
// this exit code, so swallowing a failure here would ship a broken build.
process.exit(result.status === null ? 1 : result.status);
