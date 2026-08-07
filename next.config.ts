import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sequelize does its own dynamic require() to load the pg dialect module at
  // runtime — bundling it breaks that (`Please install pg package manually`
  // even though pg is installed). `pg` itself is auto-externalized by Next.js
  // already; `sequelize`/`pg-hstore` aren't, so they need to be listed here.
  serverExternalPackages: ['sequelize', 'pg-hstore']
};

export default nextConfig;
