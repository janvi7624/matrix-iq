import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoScheduleRecord, DomainKey } from '@/lib/types';

const VALID_DOMAINS: (DomainKey | '')[] = ['', 'av', 'robotics', 'ai', 'si', 'visitiq'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await demoScheduleStore.list(viewer.username, viewer.isPrivileged);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const scheduledAt = typeof body.scheduledAt === 'string' ? body.scheduledAt : '';
  if (!clientName || !scheduledAt) {
    return NextResponse.json({ error: 'Client name and scheduled date/time are required' }, { status: 400 });
  }

  const productDomain = VALID_DOMAINS.includes(body.productDomain) ? (body.productDomain as DomainKey | '') : '';

  // Every new request starts 'pending' regardless of what the client sends —
  // it only becomes 'confirmed'/'rejected' via the lead-approval PATCH below.
  const record: DemoScheduleRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    client_name: clientName,
    product_domain: productDomain,
    technical_members: toStringArray(body.technicalMembers),
    scheduled_at: scheduledAt,
    assigned_rep: typeof body.assignedRep === 'string' && body.assignedRep.trim() ? body.assignedRep.trim() : viewer.username,
    status: 'pending',
    approved_by: '',
    approved_at: '',
    decision_note: '',
    notes: typeof body.notes === 'string' ? body.notes.trim() : ''
  };

  try {
    const created = await demoScheduleStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
