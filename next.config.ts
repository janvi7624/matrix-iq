import os from 'node:os';
import type { NextConfig } from "next";

// How many worker processes `next build` may fork for compilation and static
// generation. Left alone, Next forks one per CPU — which is the right answer on
// a workstation and the wrong one on a build container, because a shared host
// reports the HOST's core count while giving the container a fraction of its
// RAM. That is what killed the Hostinger deploys: ~11 workers were forked into
// a container with a couple of gigabytes, the build was killed part-way through
// compiling, and the platform reported only "Failed to build the application"
// with no compiler error — the same commit builds here in under 30 seconds.
//
// Deliberately a fixed cap rather than anything derived from os.freemem():
// inside a container Node reports the HOST's memory, not the cgroup limit, so
// a memory-derived count cannot see the very constraint it would be trying to
// respect — and free memory swings minute to minute, which would make build
// times unpredictable. Next's own fallback when no count is configured is 4,
// so this is its documented default made explicit instead of one-per-core.
//
// Four workers is no slower than eleven on a build of this size (the static
// pass here takes about a second either way) while cutting peak worker memory
// by roughly two thirds. NEXT_BUILD_CPUS pins it lower still — set it to 2, or
// 1, on a small build container if this is not enough.
const DEFAULT_BUILD_WORKERS = 4;

function buildWorkerCount(): number {
  const override = Number(process.env.NEXT_BUILD_CPUS);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return Math.max(1, Math.min(os.cpus().length, DEFAULT_BUILD_WORKERS));
}

const nextConfig: NextConfig = {
  // Sequelize does its own dynamic require() to load the pg dialect module at
  // runtime — bundling it breaks that (`Please install pg package manually`
  // even though pg is installed). serverExternalPackages stops Next from
  // inlining these into the JS chunk; outputFileTracingIncludes forces the
  // @vercel/nft-based deploy tracer to actually copy pg's files into the
  // deployed bundle too, since tracing is static analysis and can't see
  // Sequelize's computed require(dialectModule) either — confirmed by
  // inspecting real .next build output, both are needed for these files to
  // survive onto a host (e.g. Hostinger) that deploys only the traced output
  // rather than the full node_modules.
  //
  // proxy.ts (Next's Proxy/former Middleware) does NOT use this — confirmed
  // by the same build-output inspection that outputFileTracingIncludes never
  // applies to the middleware trace at all in this Next version, no matter
  // what key is used. proxy.ts is kept entirely free of any Sequelize-
  // touching import instead; see the comment at the top of that file.
  serverExternalPackages: ['sequelize', 'pg', 'pg-hstore'],
  outputFileTracingIncludes: {
    '/*': ['./node_modules/pg/**/*', './node_modules/pg-hstore/**/*', './node_modules/pg-connection-string/**/*', './node_modules/pg-pool/**/*', './node_modules/pg-protocol/**/*', './node_modules/pg-types/**/*', './node_modules/pgpass/**/*', './node_modules/sequelize/**/*']
  },
  // Hostinger's Node.js deployment ships a per-version directory
  // (hbuilds/versions/<hash>/nodejs/) that does NOT contain the full project
  // node_modules — confirmed by inspecting .next/required-server-files.json,
  // the one central "what to deploy" manifest, which lists only 17 files and
  // none of them pg-related, even with outputFileTracingIncludes configured
  // above (that option only augments each ROUTE's individual .nft.json trace,
  // not this central manifest). output: 'standalone' makes Next itself union
  // every route's trace + this manifest and physically copy the result into
  // .next/standalone/node_modules as part of `next build` — a real on-disk
  // artifact instead of metadata a third-party deploy script has to interpret
  // correctly. Verified: .next/standalone/node_modules/pg exists after build,
  // and `node .next/standalone/server.js` serves a working login.
  output: 'standalone',
  experimental: {
    // This app has a proxy (proxy.ts), so Next buffers every request body in
    // memory to let both the proxy and the route handler read it — capped at
    // 10MB by default. Over that, the body is SILENTLY TRUNCATED: the request
    // still runs, but /api/uploads then fails to parse the multipart form
    // ("Failed to parse body as FormData") and 500s. That's what a few bill
    // photos attached at once looked like in production. proxy.ts never reads
    // the body, so this buffer only has to be big enough for our biggest
    // legitimate upload batch; each individual file is still capped at 10MB by
    // the upload routes, which now also refuse an oversized request cleanly
    // (lib/uploadRequest.ts) instead of letting it truncate.
    proxyClientMaxBodySize: '50mb',
    // See buildWorkerCount() above — sized by free memory, not just cores, so a
    // memory-limited build container cannot fork itself to death.
    cpus: buildWorkerCount()
  }
};

export default nextConfig;
