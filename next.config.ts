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
  }
};

export default nextConfig;
