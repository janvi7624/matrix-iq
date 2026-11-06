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
// Two workers, not the eleven a per-core count gives on this machine. The
// static pass takes about a second either way on a build this size, so the
// wall-clock cost is nil, while peak memory is a fraction of what killed the
// Hostinger builds. It is deliberately conservative rather than tuned: the
// package.json build script also sets --max-old-space-size, and that ceiling
// applies to EVERY worker, so worker count multiplies the memory a build can
// demand. NEXT_BUILD_CPUS raises or lowers it per environment.
const DEFAULT_BUILD_WORKERS = 2;

function buildWorkerCount(): number {
  const override = Number(process.env.NEXT_BUILD_CPUS);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return Math.max(1, Math.min(os.cpus().length, DEFAULT_BUILD_WORKERS));
}

// Security headers applied to EVERY response (pages and API routes alike).
// Deliberately NOT including Content-Security-Policy here: a wrong CSP
// silently breaks real functionality (a blocked inline script/style/font
// just fails quietly in the console) on a live app real staff depend on,
// and building one correctly means auditing every actual source this app
// loads from first — that's a dedicated follow-up, not a guess bundled into
// a general security-header pass. Everything below is the subset that is
// essentially risk-free: none of it can break working functionality, it can
// only remove things an attacker could otherwise do.
const SECURITY_HEADERS = [
  // Stops the browser from MIME-sniffing a response into executing as a
  // different content-type than declared — the same class of protection
  // already added to the file-upload-serving routes earlier, applied here
  // app-wide as defense in depth.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // This app has no legitimate reason to be framed by another site —
  // blocks clickjacking via an invisible iframe.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Sends the full referrer on same-origin navigation (useful for this
  // app's own analytics/navigation) but only the origin, not the full path
  // (which could leak an internal id/query string), to a different site.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Tells browsers to only ever reach this host over HTTPS for the next
  // year, including subdomains — a no-op over plain HTTP locally/in a
  // container, but load-bearing once this is served behind HTTPS in
  // production. preload omitted deliberately: that requires submission to
  // browsers' hardcoded preload list and is not reversible quickly if ever
  // needed.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Explicitly denies browser features this app never uses, rather than
  // leaving them at the browser's permissive default.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' }
];

const nextConfig: NextConfig = {
  // Removes the `X-Powered-By: Next.js` response header — gratuitous
  // framework-fingerprinting information an attacker doesn't need handed
  // to them for free.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
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
    cpus: buildWorkerCount(),
    // Paired with `next build --webpack` in package.json. The build is on
    // webpack rather than Turbopack SPECIFICALLY to survive a memory-limited
    // container, and this flag only exists for webpack:
    //
    // Turbopack compiles in native Rust, outside the V8 heap, so
    // --max-old-space-size does not constrain it — measured: a Turbopack build
    // compiled fine under a 256MB heap cap and then died in the static pass,
    // while the Hostinger builds died DURING compilation with no error at all,
    // which is what an unconstrained native allocation hitting a cgroup limit
    // looks like. Webpack compiles inside V8, so the heap ceiling actually
    // applies to the phase that was failing; verified compiling under a 1GB cap.
    //
    // The cost is wall-clock: roughly 70s against Turbopack's 21s here. A build
    // that finishes slowly beats one that is killed.
    webpackMemoryOptimizations: true
  }
};

export default nextConfig;
