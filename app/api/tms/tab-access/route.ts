import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction, TMS_MODULE_KEYS, TMS_ROLE_KEYS, TmsModuleKey } from '@/lib/tmsAccess';
import { listModuleConfigs } from '@/lib/moduleConfigStore';
import { findRoleById, listRoles, updateRole } from '@/lib/roleStore';
import { apiErrorResponse } from '@/lib/apiError';
import { ModulePermissionSet, RolePermissions } from '@/lib/types';

// A focused, additional surface over the exact same RolePermissions.modules
// data /admin/roles already edits — not a new permission engine. Technical
// Manager can't reach /admin/roles (isPrivileged-only), so this is the
// TMS-scoped equivalent, hard-restricted to the 4 TMS roles and 7 TMS
// module keys only.
export async function GET(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-tab-access', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const [allRoles, allModules] = await Promise.all([listRoles(), listModuleConfigs()]);
    const roles = allRoles.filter((r) => TMS_ROLE_KEYS.includes(r.key as (typeof TMS_ROLE_KEYS)[number]));
    const modules = allModules.filter((m) => TMS_MODULE_KEYS.includes(m.key as TmsModuleKey));
    return NextResponse.json({ roles, modules });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-tab-access', 'manage'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const roleId = typeof body.roleId === 'string' ? body.roleId.trim() : '';
  const moduleKey = typeof body.moduleKey === 'string' ? body.moduleKey.trim() : '';
  const permissions = body.permissions as ModulePermissionSet | undefined;
  if (!roleId || !permissions || typeof permissions !== 'object') {
    return NextResponse.json({ error: 'roleId, moduleKey, and permissions are required' }, { status: 400 });
  }
  // Hard whitelist — this is what stops a Technical Manager from using this
  // endpoint to touch a non-TMS module's permissions.
  if (!TMS_MODULE_KEYS.includes(moduleKey as TmsModuleKey)) {
    return NextResponse.json({ error: 'moduleKey must be a TMS module' }, { status: 400 });
  }

  try {
    const role = await findRoleById(roleId);
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    if (!TMS_ROLE_KEYS.includes(role.key as (typeof TMS_ROLE_KEYS)[number])) {
      return NextResponse.json({ error: 'Only TMS roles can be edited here' }, { status: 400 });
    }

    // Splices in just this one module's permission set, leaving every other
    // key of the role's matrix untouched — reuses updateRole()'s existing
    // write path/cache invalidation entirely.
    const mergedPermissions: RolePermissions = { ...role.permissions, modules: { ...role.permissions.modules, [moduleKey]: permissions } };
    const updated = await updateRole(roleId, { permissions: mergedPermissions }, viewer.username);
    if (!updated) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
