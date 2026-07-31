import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getAppConfig, updateAppConfig } from '@/lib/appConfigStore';
import { apiErrorResponse } from '@/lib/apiError';

// Base auth + admin/superadmin/manager gating happens in proxy.ts (matcher: /api/admin/:path*).
export async function GET() {
  try {
    const config = await getAppConfig();
    return NextResponse.json(config);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const updated = await updateAppConfig(body, session.username);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
