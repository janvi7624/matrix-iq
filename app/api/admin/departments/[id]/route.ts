import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { deleteDepartment, findDepartmentById, updateDepartment } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// Base auth + admin-area gating happens in proxy.ts (matcher: /api/admin/:path*),
// including a blanket "DELETE under /api/admin requires superadmin" rule.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findDepartmentById(id);
    if (!existing) return NextResponse.json({ error: 'Department not found' }, { status: 404 });

    const patch: { name?: string; description?: string; status?: 'active' | 'inactive'; managerIds?: string[] } = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.description === 'string') patch.description = body.description.trim();
    if (body.status === 'active' || body.status === 'inactive') patch.status = body.status;
    if (Array.isArray(body.managerIds) && body.managerIds.every((x: unknown) => typeof x === 'string')) patch.managerIds = body.managerIds;

    const updated = await updateDepartment(id, patch, session.username);

    if (patch.managerIds && updated) {
      const before = new Set(existing.managerNames);
      const after = new Set(updated.managerNames);
      const changed = before.size !== after.size || [...before].some((n) => !after.has(n));
      if (changed) {
        await logAudit({
          by: session.username,
          role: session.role,
          entityType: 'department',
          entityId: id,
          action: existing.managerIds.length ? 'Department manager changed' : 'Department manager assigned',
          previousStatus: existing.managerNames.join(', ') || 'None',
          newStatus: updated.managerNames.join(', ') || 'None',
          remarks: existing.name,
          ip: getClientIp(request)
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteDepartment(id);
    if (!result.ok) return NextResponse.json({ error: result.reason || 'Could not delete department' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
