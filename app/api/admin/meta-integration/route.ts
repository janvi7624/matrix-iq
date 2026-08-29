import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getMetaIntegrationConfig, updateMetaIntegrationConfig } from '@/lib/metaIntegrationConfigStore';
import { metaCredentialStatus } from '@/lib/metaConfig';
import { apiErrorResponse } from '@/lib/apiError';

// Base auth + admin/superadmin/manager gating happens in proxy.ts (matcher:
// /api/admin/:path*), but Meta credentials/routing config must be even
// narrower — superadmin/admin only, excluding plain 'manager' (spec
// section 27: "Normal Sales users should NOT see Meta credentials/settings"
// — Sales managers are included in that restriction here, same narrowing
// the 'audit-log' module already uses).
function isMetaAdmin(role: string): boolean {
  return role === 'superadmin' || role === 'admin';
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !isMetaAdmin(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const config = await getMetaIntegrationConfig();
    return NextResponse.json({ config, credentials: metaCredentialStatus() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !isMetaAdmin(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const updated = await updateMetaIntegrationConfig(
      {
        assignmentMode: body.assignmentMode,
        defaultDepartmentId: body.defaultDepartmentId,
        defaultOwnerId: body.defaultOwnerId,
        roundRobinPool: body.roundRobinPool,
        campaignRoutingMap: body.campaignRoutingMap
      },
      session.username
    );
    return NextResponse.json({ config: updated, credentials: metaCredentialStatus() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
