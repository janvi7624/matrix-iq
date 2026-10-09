import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { searchAuditLog } from '@/lib/auditLogStore';
import { canViewAuditLog } from '@/lib/permissions';
import { apiErrorResponse } from '@/lib/apiError';
import { AuditLogEntry } from '@/lib/types';

// Base auth + admin/manager/superadmin gating happens in proxy.ts (matcher:
// /api/admin/:path*) — but Audit Log is tightened past that blanket gate,
// which 'manager' also passes. The allowed roles are shared with
// app/admin/audit-log/page.tsx via lib/permissions.ts so the page and its
// data source can't drift apart.
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !canViewAuditLog(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const params = request.nextUrl.searchParams;
    // Filtering and paging happen in SQL (lib/auditLogStore.ts). This table
    // only ever grows — it was returning every row on every page load.
    const result = await searchAuditLog({
      entityType: (params.get('entityType') as AuditLogEntry['entity_type']) || undefined,
      entityId: params.get('entityId') || undefined,
      search: params.get('search') || undefined,
      by: params.get('by') || undefined,
      role: params.get('role') || undefined,
      dateFrom: params.get('dateFrom') || undefined,
      dateTo: params.get('dateTo') || undefined,
      page: Number(params.get('page')) || 1,
      pageSize: Number(params.get('pageSize')) || 50
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
