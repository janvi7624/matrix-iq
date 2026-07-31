import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore } from '@/lib/leadStore';
import { crmStore } from '@/lib/crmStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { CrmRecord } from '@/lib/types';

// Links a captured lead into the existing CRM pipeline (lib/crmStore.ts) —
// keeps the lead's card/notes context so the sales team doesn't retype
// anything once a trade-show contact is worth tracking as a real prospect.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const records = await leadStore.list(viewer.username, true);
    const lead = records.find((r) => r.id === id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    if (!viewer.isPrivileged && lead.created_by !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (lead.crm_id) return NextResponse.json({ error: 'Already converted to a CRM contact' }, { status: 400 });

    const noteParts = [
      lead.designation ? `Designation: ${lead.designation}` : '',
      lead.city ? `City: ${lead.city}` : '',
      lead.interests.length ? `Interested in: ${lead.interests.join(', ')}` : '',
      lead.sub_interests.length ? `Specifics: ${lead.sub_interests.join(', ')}` : '',
      lead.budget ? `Budget: ${lead.budget}` : '',
      lead.notes
    ].filter(Boolean);

    const crmRecord: CrmRecord = {
      id: `${Date.now()}`,
      created_at: new Date().toISOString(),
      created_by: viewer.username,
      company: lead.company,
      contact_person: lead.name,
      phone: lead.mobile,
      email: lead.email,
      status: 'lead',
      source: 'Event Lead Capture',
      notes: noteParts.join(' | ')
    };
    const createdCrm = await crmStore.create(crmRecord);
    const updatedLead = await leadStore.update(id, { crm_id: createdCrm.id, updated_at: new Date().toISOString() });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'lead',
      entityId: id,
      action: `Converted to CRM contact ${createdCrm.id}`,
      previousStatus: '',
      newStatus: '',
      ip: getClientIp(request)
    });

    return NextResponse.json({ lead: updatedLead, crm: createdCrm });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
