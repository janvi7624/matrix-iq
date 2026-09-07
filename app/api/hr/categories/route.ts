import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule, isHrManager } from '@/lib/hrAccess';
import { db } from '@/lib/db';
import { apiErrorResponse } from '@/lib/apiError';
import { HrTaskCategoryRecord } from '@/lib/types';

function toRecord(row: InstanceType<typeof db.HrTaskCategory>): HrTaskCategoryRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return { id: plain.id as string, name: plain.name as string, active: !!plain.active, order: (plain.order as number) ?? 0 };
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-tasks'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const rows = await db.HrTaskCategory.findAll({ where: { active: true } as never, order: [['order', 'ASC']] });
    return NextResponse.json(rows.map(toRecord));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-settings')) || !(await isHrManager(viewer))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Category name is required' }, { status: 400 });

  try {
    const count = await db.HrTaskCategory.count();
    const row = await db.HrTaskCategory.create({ name, active: true, order: count } as never);
    return NextResponse.json(toRecord(row), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
