import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule, isHrManager } from '@/lib/hrAccess';
import { createTemplate, listTemplates } from '@/lib/hrRecurringTaskStore';
import { employeeBelongsToDepartment } from '@/lib/departmentEmployeeStore';
import { apiErrorResponse } from '@/lib/apiError';
import { GeneralTaskPriority, HrRecurrenceType } from '@/lib/types';

const VALID_PRIORITY: GeneralTaskPriority[] = ['low', 'medium', 'high', 'critical'];
const VALID_RECURRENCE: HrRecurrenceType[] = ['daily', 'weekly', 'monthly'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-settings'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await listTemplates());
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
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
  const assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId.trim() : '';
  const recurrenceType: HrRecurrenceType = VALID_RECURRENCE.includes(body.recurrenceType) ? body.recurrenceType : 'daily';
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!departmentId || !assigneeId) return NextResponse.json({ error: 'Department and employee are required' }, { status: 400 });

  const belongs = await employeeBelongsToDepartment(assigneeId, departmentId);
  if (!belongs) return NextResponse.json({ error: 'The selected employee is not an active member of the selected department' }, { status: 400 });

  const recurrenceConfig: { weekday?: number; dayOfMonth?: number } = {};
  if (recurrenceType === 'weekly') recurrenceConfig.weekday = Math.min(7, Math.max(1, Number(body.weekday) || 1));
  if (recurrenceType === 'monthly') recurrenceConfig.dayOfMonth = Math.min(31, Math.max(1, Number(body.dayOfMonth) || 1));

  try {
    const created = await createTemplate({
      title,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      departmentId,
      assigneeId,
      categoryId: typeof body.categoryId === 'string' ? body.categoryId.trim() : undefined,
      priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
      requiresReview: body.requiresReview !== false,
      recurrenceType,
      recurrenceConfig,
      createdByUsername: viewer.username
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
