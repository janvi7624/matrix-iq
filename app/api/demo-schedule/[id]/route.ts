import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoScheduleRecord } from '@/lib/types';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const records = await demoScheduleStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
    if (!viewer.isPrivileged && existing.created_by !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const patch: Partial<DemoScheduleRecord> = {};

    if (body.status === 'confirmed' || body.status === 'rejected') {
      // Only an admin/superadmin (standing in for the domain lead) may
      // confirm or reject a pending request.
      if (!viewer.isPrivileged) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      patch.status = body.status;
      patch.approved_by = viewer.username;
      patch.approved_at = new Date().toISOString();
      if (typeof body.decisionNote === 'string') patch.decision_note = body.decisionNote.trim();
    } else if (body.status === 'cancelled' || body.status === 'done') {
      patch.status = body.status;
    }

    if (typeof body.notes === 'string') patch.notes = body.notes.trim();

    const updated = await demoScheduleStore.update(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const deleted = await demoScheduleStore.remove(id, viewer.username, viewer.isPrivileged);
    if (!deleted) return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
