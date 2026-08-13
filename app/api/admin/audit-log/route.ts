import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { listAuditLog } from '@/lib/auditLogStore';
import { apiErrorResponse } from '@/lib/apiError';
import { AuditLogEntry } from '@/lib/types';

// Base auth + admin/manager/superadmin gating happens in proxy.ts (matcher:
// /api/admin/:path*) — but Audit Log itself is tightened further to Super
// Admin only (pre-launch hardening), so it needs its own in-route check on
// top of that blanket gate.
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const params = request.nextUrl.searchParams;
    const entityType = params.get('entityType') as AuditLogEntry['entity_type'] | null;
    const entityId = params.get('entityId') || undefined;
    const records = await listAuditLog(entityType || undefined, entityId);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
