import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { createRole, listRoles } from '@/lib/roleStore';
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

// Base auth + admin-area gating happens in proxy.ts (matcher: /api/admin/:path*).
export async function GET() {
  try {
    const roles = await listRoles();
    return NextResponse.json(roles);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  if (!label) return NextResponse.json({ error: 'Role name is required' }, { status: 400 });

  try {
    const role = await createRole(
      {
        label,
        description: typeof body?.description === 'string' ? body.description.trim() : '',
        isPrivileged: !!body?.isPrivileged,
        permissions: parsePermissions(body?.permissions)
      },
      session.username
    );
    return NextResponse.json(role, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
