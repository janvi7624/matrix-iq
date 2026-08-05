import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { apiErrorResponse } from '@/lib/apiError';
import { MarketingRequestComment } from '@/lib/types';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ error: 'Comment text is required' }, { status: 400 });

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    const canSeeAll = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'approve'));
    if (existing.created_by !== viewer.username && !canSeeAll) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const comment: MarketingRequestComment = { id: `${Date.now()}`, at: new Date().toISOString(), by: viewer.username, text };
    const updated = await marketingRequestStore.update(id, { comments: [...existing.comments, comment], updated_at: new Date().toISOString() });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
