import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore, canWorkLead } from '@/lib/leadStore';
import { createProjectFromLead } from '@/lib/leadProjectAutomation';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// Links a captured lead into the sales pipeline as a Project — CRM was
// merged into Projects (section 23), so this is now the single "turn a lead
// into a tracked pipeline record" action, replacing the old "Convert to CRM
// Contact" flow (which created a separate, thinner CrmRecord). The actual
// field mapping lives in lib/leadProjectAutomation.ts, shared with the
// automatic-on-assignment path in app/api/leads/assign/route.ts — this
// button's own behavior (attributes to whoever clicks it, no confirmation
// step) is unchanged from before that file existed.
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

    const result = await createProjectFromLead(lead, { attributeToUsername: viewer.username, autoCreated: false });
    if (!result) return NextResponse.json({ error: 'Already converted to a project' }, { status: 400 });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'lead',
      entityId: id,
      action: `Converted to project ${result.project.id}`,
      previousStatus: '',
      newStatus: '',
      ip: getClientIp(request)
    });

    return NextResponse.json({ lead: result.lead, project: result.project });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
