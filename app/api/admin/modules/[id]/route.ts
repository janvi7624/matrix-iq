import { NextRequest, NextResponse } from 'next/server';
import { updateModuleConfig } from '@/lib/moduleConfigStore';
import { UserRole } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

const VALID_ROLES: UserRole[] = ['superadmin', 'admin', 'manager', 'technical', 'backoffice', 'user'];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const patch: Record<string, unknown> = {};
    if (typeof body.label === 'string') patch.label = body.label.trim();
    if (typeof body.desc === 'string') patch.desc = body.desc.trim();
    if (typeof body.icon === 'string') patch.icon = body.icon.trim();
    if (typeof body.section === 'string') patch.section = body.section.trim();
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.order === 'number') patch.order = body.order;
    if (Array.isArray(body.visibleToRoles)) {
      patch.visibleToRoles = body.visibleToRoles.filter((r: unknown): r is UserRole => VALID_ROLES.includes(r as UserRole));
    }

    const updated = await updateModuleConfig(id, patch);
    if (!updated) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
