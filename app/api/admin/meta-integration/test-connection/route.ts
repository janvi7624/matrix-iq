import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getMetaEnvConfig, isMetaFullyConfigured } from '@/lib/metaConfig';
import { testConnection } from '@/lib/metaGraphClient';
import { touchConnectionTest } from '@/lib/metaIntegrationConfigStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

function isMetaAdmin(role: string): boolean {
  return role === 'superadmin' || role === 'admin';
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !isMetaAdmin(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    if (!isMetaFullyConfigured()) {
      const message = 'Meta integration is not fully configured — set META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN, META_PAGE_ID, and META_PAGE_ACCESS_TOKEN.';
      await touchConnectionTest(false, message);
      await logAudit({ by: session.username, role: session.role, entityType: 'meta_integration', entityId: '', action: 'Connection test failed (not configured)', previousStatus: '', newStatus: '', ip: getClientIp(request) });
      return NextResponse.json({ ok: false, checks: [{ label: 'Credentials configured', ok: false, detail: message }] });
    }

    const env = getMetaEnvConfig();
    const result = await testConnection(env.pageAccessToken, env.pageId);
    await touchConnectionTest(result.ok, result.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.label}: ${c.detail}`).join(' | '));
    await logAudit({
      by: session.username,
      role: session.role,
      entityType: 'meta_integration',
      entityId: '',
      action: result.ok ? 'Connection test succeeded' : 'Connection test failed',
      previousStatus: '',
      newStatus: '',
      ip: getClientIp(request)
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
