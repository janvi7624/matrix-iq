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
const fs = require('node:fs');
const os = require('node:os');

/*
 * Build-environment diagnostics.
 *
 * A build server that kills the compiler prints nothing about why: the log
 * just stops, and the platform reports a generic failure. These few lines make
 * the next build log answer the three questions that otherwise need a support
 * ticket — how much memory the container actually has, whether the build was
 * OOM-killed, and how long it ran before dying.
 *
 * os.totalmem() is NOT the answer on its own: inside a container it reports the
 * HOST's memory, not the cgroup limit the build is actually held to. The cgroup
 * files below are the real limit. All of it is best-effort — none of these
 * paths exist on Windows or macOS, so every read is guarded and silence simply
 * means "not a Linux container".
 */
function readCgroup(...paths) {
  for (const p of paths) {
    try {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw && raw !== 'max') return raw;
      if (raw === 'max') return 'max (no limit set)';
    } catch {
      // Next candidate path.
    }
  }
  return null;
}

function gb(bytes) {
  return (Number(bytes) / 1024 ** 3).toFixed(2) + ' GB';
}

function reportEnvironment() {
  console.log('--- build environment ---');
  console.log(`  node            ${process.version}   platform ${process.platform}`);
  console.log(`  cpus reported   ${os.cpus().length}`);
  console.log(`  memory (host)   ${gb(os.totalmem())} total, ${gb(os.freemem())} free`);

  // cgroup v2 first, then v1.
  const limit = readCgroup('/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if (limit) {
    const isNumeric = /^\d+$/.test(limit);
    // cgroup v1 reports an absurd number when unlimited; treat it as such.
    const unlimited = isNumeric && Number(limit) > 1024 ** 4;
    console.log(`  memory (LIMIT)  ${unlimited ? 'no cgroup limit' : isNumeric ? gb(limit) : limit}   <- what this build is actually held to`);
  } else {
    console.log('  memory (LIMIT)  not reported (not a Linux cgroup environment)');
  }
  console.log('-------------------------');
}

// Peak usage and the kernel's own OOM counter, read after the build. If
// oom_kill is above zero the question "was it OOM-killed" is answered outright.
function reportAftermath(startedAt) {
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`--- build finished after ${seconds}s ---`);

  const peak = readCgroup('/sys/fs/cgroup/memory.peak', '/sys/fs/cgroup/memory/memory.max_usage_in_bytes');
  if (peak && /^\d+$/.test(peak)) console.log(`  peak memory used  ${gb(peak)}`);

  try {
    const events = fs.readFileSync('/sys/fs/cgroup/memory.events', 'utf8');
    const killed = /oom_kill (\d+)/.exec(events);
    if (killed) {
      console.log(`  kernel oom_kill count  ${killed[1]}${Number(killed[1]) > 0 ? '   <- THE BUILD WAS KILLED FOR MEMORY' : ''}`);
    }
  } catch {
    // Not available; the exit signal below still tells us.
  }
}

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
reportEnvironment();

const startedAt = Date.now();
const result = spawnSync(process.execPath, [nextBin, 'build', ...args], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions }
});

if (result.error) {
  console.error(`build FAILED to start: ${result.error.message}`);
  process.exit(1);
}

reportAftermath(startedAt);

// A process killed by a signal has a null exit status. SIGKILL here is almost
// always the kernel's OOM killer taking the compiler — the single most useful
// thing a failing build log can say, and exactly what a generic "Failed to
// build the application" hides.
if (result.signal) {
  console.error(`\nbuild was KILLED by ${result.signal} (exit ${result.signal === 'SIGKILL' ? 137 : 'n/a'}).`);
  if (result.signal === 'SIGKILL') {
    console.error('  SIGKILL during compilation means the build ran out of memory — it was terminated');
    console.error('  by the system, it did not fail on your code. Lower NEXT_BUILD_CPUS (currently');
    console.error('  controlled by experimental.cpus in next.config.ts) or raise the container memory.');
  }
  process.exit(137);
}

// Propagate the real outcome — a build server decides whether to deploy from
// this exit code, so swallowing a failure here would ship a broken build.
process.exit(result.status === null ? 1 : result.status);
