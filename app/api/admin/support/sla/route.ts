import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { hasCapability } from '@/lib/permissions';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

// SLA policy configuration. Gated on manageSettings — these are a commercial
// commitment, not a per-team preference.
async function canManageSla(viewer: { role: string; isPrivileged: boolean }): Promise<boolean> {
  return (await hasCapability(viewer.role, 'manageSettings')) || viewer.isPrivileged;
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageSla(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const rows = await db.SupportSlaPolicy.findAll({ order: [['resolution_minutes', 'ASC']] });
    return NextResponse.json(rows.map((r) => r.get({ plain: true })));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageSla(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const priority = typeof body?.priority === 'string' ? body.priority : '';
  if (!priority) return NextResponse.json({ error: 'priority is required' }, { status: 400 });

  try {
    const row = await db.SupportSlaPolicy.findOne({ where: { priority } as never });
    if (!row) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });

    const attrs: Record<string, unknown> = {};
    const positiveInt = (v: unknown) => {
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    };
    const fr = positiveInt(body.firstResponseMinutes);
    const res = positiveInt(body.resolutionMinutes);
    if (fr !== undefined) attrs.first_response_minutes = fr;
    if (res !== undefined) attrs.resolution_minutes = res;
    if (typeof body.pauseOnAwaitingPartner === 'boolean') attrs.pause_on_awaiting_partner = body.pauseOnAwaitingPartner;
    if (body.escalateAfterMinutes === null) attrs.escalate_after_minutes = null;
    else {
      const esc = positiveInt(body.escalateAfterMinutes);
      if (esc !== undefined) attrs.escalate_after_minutes = esc;
    }

    // Changing these alters what we have promised; refuse a response target
    // that exceeds its own resolution target, which would be unmeetable by
    // construction.
    const nextFr = (attrs.first_response_minutes as number) ?? Number(row.get('first_response_minutes'));
    const nextRes = (attrs.resolution_minutes as number) ?? Number(row.get('resolution_minutes'));
    if (nextFr > nextRes) {
      return NextResponse.json({ error: 'First response cannot be slower than resolution' }, { status: 400 });
    }

    await row.update(attrs as never);
    return NextResponse.json(row.get({ plain: true }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
