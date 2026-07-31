import { NextRequest, NextResponse } from 'next/server';
import { listAuditLog } from '@/lib/auditLogStore';
import { apiErrorResponse } from '@/lib/apiError';
import { AuditLogEntry } from '@/lib/types';

// Auth + admin/manager/superadmin gating happens in proxy.ts (matcher: /api/admin/:path*).
export async function GET(request: NextRequest) {
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
