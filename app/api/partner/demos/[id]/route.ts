import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { cancelPartnerDemo, findPartnerDemo, PartnerDemoError } from '@/lib/partnerDemoStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const demo = await findPartnerDemo(viewer.partnerId, id);
    if (!demo) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(demo);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Withdrawing a request. The ONLY write a partner may make to a demo — they
// cannot reschedule, assign, or change its internal status.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const ok = await cancelPartnerDemo(viewer.partnerId, id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PartnerDemoError) return NextResponse.json({ error: error.message }, { status: 409 });
    return apiErrorResponse(error);
  }
}
