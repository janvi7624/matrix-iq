import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sequelize does its own dynamic require() to load the pg dialect module at
  // runtime — bundling/tracing it breaks that (`Please install pg package
  // manually` even though pg is installed), because Next's file tracer can't
  // statically see a runtime require(variableName) inside Sequelize's dialect
  // loader. `pg` is NOT reliably auto-externalized in every build (confirmed:
  // still traced out under Turbopack production builds), so list it
  // explicitly alongside sequelize/pg-hstore rather than depending on that.
  serverExternalPackages: ['sequelize', 'pg', 'pg-hstore']
};

export default nextConfig;
