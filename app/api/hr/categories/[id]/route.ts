import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule, isHrManager } from '@/lib/hrAccess';
import { db, isUuid } from '@/lib/db';
import { apiErrorResponse } from '@/lib/apiError';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-settings')) || !(await isHrManager(viewer))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const row = await db.HrTaskCategory.findByPk(id);
    if (!row) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    const attrs: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) attrs.name = body.name.trim();
    if (typeof body.active === 'boolean') attrs.active = body.active;
    if (typeof body.order === 'number') attrs.order = body.order;
    await row.update(attrs as never);
    return NextResponse.json({ id: row.get('id'), name: row.get('name'), active: row.get('active'), order: row.get('order') });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
