import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { createQuotation } from '@/lib/quotationStore';
import { resolvePreparedBy } from '@/lib/quotationOnBehalf';
import { apiErrorResponse } from '@/lib/apiError';
import { isUuid } from '@/lib/db';
import { canAccessProject, findProjectById } from '@/lib/projectStore';
import { canActOnBehalf } from '@/lib/quotationOnBehalfAccess';

// Listing/searching quotations requires admin login — see /api/admin/quotations
// (org-wide) and /api/quotations/mine (sales, own-only). This route only
// accepts POST, used by the calculator to log a new quotation.
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  // Same minimum-identity rule as project creation — without this, the API
  // (unlike the calculator wizard, which always fills these) could log a
  // completely blank ₹0 quotation with a real sequential number.
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const clientCompany = typeof body.clientCompany === 'string' ? body.clientCompany.trim() : '';
  if (!clientName && !clientCompany) {
    return NextResponse.json({ error: 'Client name or company is required' }, { status: 400 });
  }

  // A linked project must be one the creator can actually open — previously
  // any id was accepted as-is, so a quotation could be attached to (and so
  // surface on) someone else's project just by knowing its id. The on-behalf
  // team (lib/quotationOnBehalfAccess.ts) keeps linking reps' projects as
  // before — preparing quotations for other people's projects is their job,
  // and their own visibility scope doesn't cover those projects. So do
  // privileged viewers: a Sales manager can quick-create a project for any rep
  // and quote it straight away, even outside the departments they manage.
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (projectId) {
    if (!isUuid(projectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 });
    const project = await findProjectById(projectId);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!session.isPrivileged && !canActOnBehalf(session.username) && !(await canAccessProject(session.username, project))) {
      return NextResponse.json({ error: "You can't link a quotation to this project" }, { status: 403 });
    }
  }

  const requestedPreparedByUserId = typeof body.preparedByUserId === 'string' ? body.preparedByUserId.trim() : undefined;
  const resolved = await resolvePreparedBy(session.username, requestedPreparedByUserId, { projectId });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  try {
    const record = await createQuotation({
      ...body,
      projectId: projectId || undefined,
      createdBy: session.username,
      preparedByUserId: resolved.value.userId,
      preparedBy: resolved.value.name,
      preparedByPhone: resolved.value.phone,
      preparedByEmail: resolved.value.email
    });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
