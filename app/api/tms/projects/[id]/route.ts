import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction, TMS_DEPARTMENTS } from '@/lib/tmsAccess';
import { canAccessTmsProjectRow, computeTaskDerivedProgress, tmsProjectStore } from '@/lib/tmsProjectStore';
import { tmsTaskStore } from '@/lib/tmsTaskStore';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { tmsProcurementStore } from '@/lib/tmsProcurementStore';
import { findDepartmentById } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';
import { TmsPriority, TmsProjectRecord, TmsProjectStatus } from '@/lib/types';
import { findUserById } from '@/lib/userStore';
import { sendProjectLifecycleEmail } from '@/lib/email/notifications';
import { listForProject as listDeadlineExtensions } from '@/lib/tmsDeadlineExtensionStore';
import { listAuditLog } from '@/lib/auditLogStore';

const VALID_STATUS: TmsProjectStatus[] = ['planning', 'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'];
const VALID_PRIORITY: TmsPriority[] = ['low', 'medium', 'high'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-projects', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const project = await tmsProjectStore.findById(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!canAccessTmsProjectRow(viewer, project)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [tasks, bomRequests, procurements, deadlineExtensions, activity, taskDerivedProgress] = await Promise.all([
      tmsTaskStore.readAll(),
      tmsBomRequestStore.list(),
      tmsProcurementStore.list(),
      listDeadlineExtensions(id),
      listAuditLog('tms_project', id),
      computeTaskDerivedProgress(id)
    ]);

    return NextResponse.json({
      project,
      tasks: tasks.filter((t) => t.project_id === id),
      bomRequests: bomRequests.filter((b) => b.project_id === id),
      procurements: procurements.filter((p) => p.project_id === id),
      deadlineExtensions,
      activity,
      taskDerivedProgress
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-projects', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await tmsProjectStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!canAccessTmsProjectRow(viewer, existing)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (body.action === 'addAttachment') {
      const urls = toStringArray(body.urls);
      if (!urls.length) return NextResponse.json({ error: 'No attachment URLs provided' }, { status: 400 });
      const updated = await tmsProjectStore.update(id, { attachments: [...existing.attachments, ...urls], updated_at: new Date().toISOString() });
      return NextResponse.json(updated);
    }

    const patch: Partial<TmsProjectRecord> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.clientName === 'string') patch.client_name = body.clientName.trim();
    if (typeof body.clientContact === 'string') patch.client_contact = body.clientContact.trim();
    if (typeof body.description === 'string') patch.description = body.description.trim();
    if (typeof body.projectManagerId === 'string') patch.project_manager_id = body.projectManagerId.trim();
    if (Array.isArray(body.teamMemberIds)) patch.team_member_ids = toStringArray(body.teamMemberIds);
    if (typeof body.startDate === 'string') patch.start_date = body.startDate;
    if (typeof body.estimatedCloseDate === 'string') patch.estimated_close_date = body.estimatedCloseDate;
    if (typeof body.actualCloseDate === 'string') patch.actual_close_date = body.actualCloseDate;
    if (typeof body.budget === 'number') patch.budget = body.budget;
    if (VALID_STATUS.includes(body.status)) {
      patch.status = body.status;
      if (body.status === 'completed' && !existing.actual_close_date && typeof body.actualCloseDate !== 'string') {
        patch.actual_close_date = new Date().toISOString().slice(0, 10);
      }
    }
    if (VALID_PRIORITY.includes(body.priority)) patch.priority = body.priority;
    if (typeof body.progressPercent === 'number') patch.progress_percent = Math.max(0, Math.min(100, body.progressPercent));
    if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();

    if (typeof body.departmentId === 'string' && body.departmentId.trim()) {
      const department = await findDepartmentById(body.departmentId.trim());
      if (!department || !TMS_DEPARTMENTS.includes(department.name as (typeof TMS_DEPARTMENTS)[number])) {
        return NextResponse.json({ error: 'A valid technical department (Robotics, AI, AV, or Marketing) is required' }, { status: 400 });
      }
      patch.department_id = department.id;
    }

    if (body.projectType === 'department' || body.projectType === 'combined') {
      patch.project_type = body.projectType;
    }
    if (Array.isArray(body.departmentIds)) {
      const requestedIds = toStringArray(body.departmentIds);
      const resolvedDepartments = await Promise.all(requestedIds.map((did) => findDepartmentById(did)));
      const validIds = resolvedDepartments
        .filter((d): d is NonNullable<typeof d> => !!d && TMS_DEPARTMENTS.includes(d.name as (typeof TMS_DEPARTMENTS)[number]))
        .map((d) => d.id);
      const effectiveType = patch.project_type || existing.project_type;
      if (effectiveType === 'combined' && validIds.length < 2) {
        return NextResponse.json({ error: 'A combined project needs at least 2 valid technical departments' }, { status: 400 });
      }
      if (effectiveType === 'department' && validIds.length !== 1) {
        return NextResponse.json({ error: 'A department project needs exactly 1 department' }, { status: 400 });
      }
      patch.department_ids = validIds;
      if (!patch.department_id) patch.department_id = validIds[0];
    }

    const updated = await tmsProjectStore.update(id, patch);

    // Use the POST-patch manager: if this same request also reassigned
    // project_manager_id (above), the newly assigned manager is who should
    // hear about completion/cancellation, not the one just replaced.
    const currentManagerId = patch.project_manager_id !== undefined ? patch.project_manager_id : existing.project_manager_id;
    if (patch.status && (patch.status === 'completed' || patch.status === 'cancelled') && patch.status !== existing.status && currentManagerId) {
      const manager = await findUserById(currentManagerId);
      if (manager?.email && manager.username !== viewer.username) {
        void sendProjectLifecycleEmail({
          name: manager.name,
          email: manager.email,
          projectId: id,
          projectKind: 'tms',
          event: 'tms_status_changed',
          projectLabel: existing.name || existing.client_name || 'Project',
          detail: `Status: ${patch.status.replace(/_/g, ' ')}`
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const allowed = await requireTmsAction(viewer, 'tms-projects', 'delete');
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const existing = await tmsProjectStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!canAccessTmsProjectRow(viewer, existing)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const result = await tmsProjectStore.remove(id, allowed);
    if (!result.ok) {
      const status = result.reason === 'Project not found' ? 404 : 400;
      return NextResponse.json({ error: result.reason }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
