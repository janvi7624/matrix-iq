import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findQuotationById } from '@/lib/quotationStore';
import { appendProjectTimeline, findProjectById } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';

// Not under /api/admin — the sales person who created the quotation should
// be able to move their own project to the Demo stage right after saving a
// quotation, without needing quotation-history access.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const quotation = await findQuotationById(id);
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    if (!quotation.project_id) {
      return NextResponse.json({ error: 'This quotation is not linked to a project' }, { status: 400 });
    }

    const project = await findProjectById(quotation.project_id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!viewer.isPrivileged && project.created_by !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await appendProjectTimeline(
      project.id,
      { by: viewer.username, stage: 'demo', label: `Quotation ${quotation.quotation_number} moved to Demo stage` },
      'demo'
    );
    return NextResponse.json({ ok: true, project: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
