import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { deleteRole, findRoleById, updateRole } from '@/lib/roleStore';
import { RolePermissions } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

function parsePermissions(body: unknown): RolePermissions | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const modules: RolePermissions['modules'] = {};
  if (b.modules && typeof b.modules === 'object') {
    for (const [key, value] of Object.entries(b.modules as Record<string, unknown>)) {
      if (value && typeof value === 'object') {
        const set: RolePermissions['modules'][string] = {};
        for (const [action, flag] of Object.entries(value as Record<string, unknown>)) {
          if (typeof flag === 'boolean') set[action as keyof typeof set] = flag;
        }
        modules[key] = set;
      }
    }
  }
  return {
    modules,
    manageSettings: !!b.manageSettings,
    manageUsers: !!b.manageUsers,
    manageRoles: !!b.manageRoles,
    manageDepartments: !!b.manageDepartments
  };
}

// Base auth + admin-area gating happens in proxy.ts (matcher: /api/admin/:path*),
// including a blanket "DELETE under /api/admin requires superadmin" rule.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findRoleById(id);
    if (!existing) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

    const patch: { label?: string; description?: string; isPrivileged?: boolean; status?: 'active' | 'inactive'; permissions?: RolePermissions } = {};
    if (typeof body.label === 'string' && body.label.trim()) patch.label = body.label.trim();
    if (typeof body.description === 'string') patch.description = body.description.trim();
    if (typeof body.isPrivileged === 'boolean') patch.isPrivileged = body.isPrivileged;
    if (body.status === 'active' || body.status === 'inactive') patch.status = body.status;
    const permissions = parsePermissions(body.permissions);
    if (permissions) patch.permissions = permissions;

    const updated = await updateRole(id, patch, session.username);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await deleteRole(id);
    if (!result.ok) return NextResponse.json({ error: result.reason || 'Could not delete role' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
