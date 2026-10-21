import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { logMaterialAccess, partnerCanOpenMaterial } from '@/lib/partnerMaterialStore';
import { apiErrorResponse } from '@/lib/apiError';

// Records that a partner opened a document, and confirms they were entitled
// to. The publication check runs BEFORE the log: an access log that records
// opens of documents the partner could not actually see would be worse than
// no log, since Marketing would read it as demand.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    if (!(await partnerCanOpenMaterial(viewer.partnerId, id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await logMaterialAccess(id, viewer.userId, viewer.partnerId, 'view');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
