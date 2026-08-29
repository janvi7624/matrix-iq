import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { Op } from 'sequelize';
import { ingestMetaLead } from '@/lib/metaLeadIngest';
import { touchSuccessfulSync } from '@/lib/metaIntegrationConfigStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

function isMetaAdmin(role: string): boolean {
  return role === 'superadmin' || role === 'admin';
}

// "Sync Meta Leads" — the recovery/backfill mechanism spec section 21 asks
// for: re-processes every meta_webhook_events row still 'pending' or
// 'failed' through the exact same ingestMetaLead pipeline the live webhook
// uses, so a missed or previously-failed delivery still lands correctly,
// with the same meta_lead_id idempotency guarantee (a lead that already
// succeeded on a later attempt is simply skipped, never duplicated).
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !isMetaAdmin(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    await logAudit({ by: session.username, role: session.role, entityType: 'meta_integration', entityId: '', action: 'Manual sync started', previousStatus: '', newStatus: '', ip: getClientIp(request) });

    const pending = await db.MetaWebhookEvent.findAll({ where: { status: { [Op.in]: ['pending', 'failed'] } } as never, order: [['created_at', 'ASC']] });
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of pending) {
      const leadgenId = row.get('leadgen_id') as string;
      const pageId = (row.get('page_id') as string) || undefined;
      const formId = (row.get('form_id') as string) || undefined;
      const result = await ingestMetaLead(leadgenId, { pageId, formId });
      if (result.status === 'created' || result.status === 'merged') processed++;
      else if (result.status === 'ignored_duplicate') skipped++;
      else failed++;
    }

    await touchSuccessfulSync();
    await logAudit({
      by: session.username,
      role: session.role,
      entityType: 'meta_integration',
      entityId: '',
      action: failed > 0 ? 'Manual sync completed with errors' : 'Manual sync completed',
      previousStatus: '',
      newStatus: '',
      remarks: JSON.stringify({ total: pending.length, processed, skipped, failed }),
      ip: getClientIp(request)
    });

    return NextResponse.json({ total: pending.length, processed, skipped, failed });
  } catch (error) {
    await logAudit({ by: session.username, role: session.role, entityType: 'meta_integration', entityId: '', action: 'Sync failed', previousStatus: '', newStatus: '', ip: getClientIp(request) }).catch(() => {});
    return apiErrorResponse(error);
  }
}
