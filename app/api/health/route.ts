import { NextResponse } from 'next/server';
import { sequelize } from '@/lib/db';

// REL-DEPLOY-004: an unauthenticated infra-level liveness/readiness probe —
// distinct from /api/dashboard/health, which is an authenticated BUSINESS
// feature (per-department performance scoring), not a health check. A load
// balancer, uptime monitor, or deploy script hits this one to answer "is the
// process up and can it actually reach Postgres", nothing more. Deliberately
// has no auth gate: that's the whole point of an infra probe, and it leaks
// nothing beyond a boolean plus a timestamp.
export async function GET() {
  try {
    await sequelize.authenticate();
    return NextResponse.json({ status: 'ok', db: 'ok', time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: 'error', db: 'unreachable', time: new Date().toISOString() }, { status: 503 });
  }
}
