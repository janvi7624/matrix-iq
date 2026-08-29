import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore, canWorkLead } from '@/lib/leadStore';
import { projectStore } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { ProjectRecord } from '@/lib/types';

// Links a captured lead into the sales pipeline as a Project — CRM was
// merged into Projects (section 23), so this is now the single "turn a lead
// into a tracked pipeline record" action, replacing the old "Convert to CRM
// Contact" flow (which created a separate, thinner CrmRecord).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const records = await leadStore.list(viewer.username, true);
    const lead = records.find((r) => r.id === id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    if (!(await canWorkLead(viewer.username, lead))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (lead.project_id) return NextResponse.json({ error: 'Already converted to a project' }, { status: 400 });

    const noteParts = [
      lead.designation ? `Designation: ${lead.designation}` : '',
      lead.city ? `City: ${lead.city}` : '',
      lead.interests.length ? `Interested in: ${lead.interests.join(', ')}` : '',
      lead.sub_interests.length ? `Specifics: ${lead.sub_interests.join(', ')}` : '',
      lead.budget ? `Budget: ${lead.budget}` : '',
      lead.notes
    ].filter(Boolean);

    const now = new Date().toISOString();
    // Every other lead source keeps the original "Event Lead Capture" label
    // (this route predates the Meta integration and that string is already
    // relied on elsewhere) — only a Meta-sourced lead gets its real channel
    // carried through, so a converted project doesn't misleadingly claim an
    // in-person capture for a Facebook/Instagram lead.
    const projectSource = lead.source === 'meta_lead_ads' ? `Meta Lead Ads (${lead.meta_platform === 'ig' ? 'Instagram' : 'Facebook'})` : 'Event Lead Capture';
    const project: ProjectRecord = {
      id: `${Date.now()}`,
      created_at: now,
      created_by: viewer.username,
      client_name: lead.name,
      company: lead.company,
      contact_person: lead.name,
      phone: lead.mobile,
      email: lead.email,
      address: lead.city,
      sales_person: viewer.username,
      source: projectSource,
      status: 'active',
      stage: 'cold_call',
      cold_call_responded: '',
      priority: lead.priority === 'hot' ? 'high' : lead.priority === 'warm' ? 'medium' : 'low',
      expected_closing_date: '',
      next_follow_up_date: '',
      remarks: noteParts.join(' | '),
      notes: [],
      attachments: [],
      assigned_technical_person_id: '',
      assigned_technical_person_name: '',
      timeline: [{ id: `${Date.now()}`, at: now, by: viewer.username, stage: 'created', label: 'Project created from a captured lead', remarks: noteParts.join(' | ') }],
      updated_at: now
    };
    const createdProject = await projectStore.create(project);
    const updatedLead = await leadStore.update(id, { project_id: createdProject.id, updated_at: now });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'lead',
      entityId: id,
      action: `Converted to project ${createdProject.id}`,
      previousStatus: '',
      newStatus: '',
      ip: getClientIp(request)
    });

    return NextResponse.json({ lead: updatedLead, project: createdProject });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
