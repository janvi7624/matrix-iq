import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore, canWorkLead } from '@/lib/leadStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DomainKey, LeadPriority, LeadRecord, LeadSource } from '@/lib/types';

const VALID_DOMAINS: DomainKey[] = ['av', 'robotics', 'ai', 'si', 'visitiq'];
const VALID_PRIORITIES: LeadPriority[] = ['hot', 'warm', 'cool', ''];
const VALID_SOURCES: LeadSource[] = ['manual', 'business_card', 'csv_import', 'meta_lead_ads'];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const records = await leadStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    // canWorkLead, not canAccessOwnedRecord — the rep a lead is assigned to
    // must be able to edit it even when they didn't capture it and sit outside
    // the capturer's department scope.
    if (!(await canWorkLead(viewer.username, existing))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const patch: Partial<LeadRecord> = { updated_at: new Date().toISOString() };
    const stringFields = ['name', 'mobile', 'email', 'designation', 'company', 'city', 'budget', 'notes'] as const;
    stringFields.forEach((field) => {
      if (typeof body[field] === 'string') patch[field] = body[field].trim();
    });
    if (Array.isArray(body.interests)) patch.interests = body.interests.filter((d: unknown): d is DomainKey => VALID_DOMAINS.includes(d as DomainKey));
    if (Array.isArray(body.subInterests)) patch.sub_interests = body.subInterests.filter((s: unknown): s is string => typeof s === 'string');
    if (Array.isArray(body.followUpActions)) patch.follow_up_actions = body.followUpActions.filter((s: unknown): s is string => typeof s === 'string');
    if (VALID_PRIORITIES.includes(body.priority)) patch.priority = body.priority;

    // Source (the acquisition channel) is editable like every other detail —
    // but "Meta Lead Ads" is attribution set by the Meta integration when a
    // lead actually arrives from it, so nobody can newly stamp it onto a lead
    // that didn't (a Meta lead can still be re-labelled to something else).
    if (body.source !== undefined) {
      if (!VALID_SOURCES.includes(body.source)) return NextResponse.json({ error: 'Invalid lead source' }, { status: 400 });
      if (body.source === 'meta_lead_ads' && existing.source !== 'meta_lead_ads') {
        return NextResponse.json({ error: 'A lead can only have the Meta Lead Ads source if it came in from Meta' }, { status: 400 });
      }
      patch.source = body.source;
    }

    // Now that every detail is editable, keep the one rule capture already
    // enforces: a lead needs at least a name or a company.
    if (!(patch.name ?? existing.name) && !(patch.company ?? existing.company)) {
      return NextResponse.json({ error: 'A lead needs at least a name or a company' }, { status: 400 });
    }

    const previousPriority = existing.priority || 'unrated';
    const updated = await leadStore.update(id, patch);

    if (patch.priority && patch.priority !== existing.priority) {
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'lead',
        entityId: id,
        action: `Lead priority changed`,
        previousStatus: previousPriority,
        newStatus: patch.priority || 'unrated',
        ip: getClientIp(request)
      });
    }
    if (patch.source && patch.source !== existing.source) {
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'lead',
        entityId: id,
        action: 'Lead source changed',
        previousStatus: existing.source,
        newStatus: patch.source,
        ip: getClientIp(request)
      });
    }

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
    const deleted = await leadStore.remove(id, viewer.username, viewer.isPrivileged);
    if (!deleted) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'lead',
      entityId: id,
      action: 'Lead deleted',
      previousStatus: '',
      newStatus: '',
      ip: getClientIp(request)
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
