import type { NextConfig } from "next";

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
  output: 'standalone'
};

export default nextConfig;
