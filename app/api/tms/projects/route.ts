import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction, TMS_DEPARTMENTS } from '@/lib/tmsAccess';
import { tmsProjectStore, nextTmsProjectCode } from '@/lib/tmsProjectStore';
import { findDepartmentById } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';
import { TmsPriority, TmsProjectRecord, TmsProjectType } from '@/lib/types';

const VALID_PRIORITY: TmsPriority[] = ['low', 'medium', 'high'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function GET(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-projects', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const records = await tmsProjectStore.list(viewer);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-projects', 'create'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Project name is required' }, { status: 400 });

  const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
  const department = departmentId ? await findDepartmentById(departmentId) : undefined;
  if (!department || !TMS_DEPARTMENTS.includes(department.name as (typeof TMS_DEPARTMENTS)[number])) {
    return NextResponse.json({ error: 'A valid technical department (Robotics, AI, AV, or Marketing) is required' }, { status: 400 });
  }

  const projectType: TmsProjectType = body.projectType === 'combined' ? 'combined' : 'department';
  const requestedDeptIds = toStringArray(body.departmentIds);
  let departmentIds = [departmentId];
  if (projectType === 'combined') {
    const uniqueRequested = Array.from(new Set([departmentId, ...requestedDeptIds]));
    const resolvedDepartments = await Promise.all(uniqueRequested.map((did) => findDepartmentById(did)));
    const validIds = resolvedDepartments
      .filter((d): d is NonNullable<typeof d> => !!d && TMS_DEPARTMENTS.includes(d.name as (typeof TMS_DEPARTMENTS)[number]))
      .map((d) => d.id);
    if (validIds.length < 2) {
      return NextResponse.json({ error: 'A combined project needs at least 2 valid technical departments' }, { status: 400 });
    }
    departmentIds = validIds;
  }

  const now = new Date().toISOString();
  const estimatedCloseDate = typeof body.estimatedCloseDate === 'string' ? body.estimatedCloseDate : '';
  const deadline = typeof body.deadline === 'string' && body.deadline ? body.deadline : estimatedCloseDate;
  const record: TmsProjectRecord = {
    id: `${Date.now()}`,
    project_code: await nextTmsProjectCode(),
    created_at: now,
    created_by: viewer.username,
    name,
    client_name: typeof body.clientName === 'string' ? body.clientName.trim() : '',
    client_contact: typeof body.clientContact === 'string' ? body.clientContact.trim() : '',
    description: typeof body.description === 'string' ? body.description.trim() : '',
    department_id: department.id,
    department_name: department.name,
    project_type: projectType,
    department_ids: departmentIds,
    department_names: [],
    project_manager_id: typeof body.projectManagerId === 'string' ? body.projectManagerId.trim() : '',
    project_manager_name: '',
    team_member_ids: toStringArray(body.teamMemberIds),
    team_member_names: [],
    start_date: typeof body.startDate === 'string' ? body.startDate : '',
    estimated_close_date: estimatedCloseDate,
    actual_close_date: '',
    deadline,
    budget: typeof body.budget === 'number' ? body.budget : Number(body.budget) || 0,
    status: 'planning',
    priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
    progress_percent: 0,
    remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
    attachments: [],
    updated_at: now
  };

  try {
    const created = await tmsProjectStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
