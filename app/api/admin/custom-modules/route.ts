import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { createCustomModule, listCustomModules, CustomModuleInput } from '@/lib/customModuleStore';
import { CustomFieldDef, CustomFieldType } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

const VALID_TYPES: CustomFieldType[] = ['text', 'number', 'currency', 'date', 'time', 'dropdown', 'multiselect', 'checkbox', 'radio', 'textarea', 'richtext', 'email', 'phone', 'file', 'image', 'user', 'project', 'product'];

export function parseFields(input: unknown): CustomFieldDef[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((f) => f && typeof f.label === 'string' && f.label.trim())
    .map((f, i) => ({
      id: typeof f.id === 'string' && f.id ? f.id : `f${i}-${Date.now()}`,
      label: f.label.trim(),
      type: VALID_TYPES.includes(f.type) ? f.type : 'text',
      required: Boolean(f.required),
      options: Array.isArray(f.options) ? f.options.filter((o: unknown): o is string => typeof o === 'string' && o.trim().length > 0) : [],
      order: i
    }));
}

// Base auth + admin/superadmin/manager gating happens in proxy.ts (matcher: /api/admin/:path*).
export async function GET() {
  try {
    const modules = await listCustomModules();
    return NextResponse.json(modules);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'Module name is required' }, { status: 400 });
  }

  try {
    const input: CustomModuleInput = {
      name: body.name.trim(),
      icon: typeof body.icon === 'string' ? body.icon.trim() : '🧩',
      section: typeof body.section === 'string' ? body.section.trim() : 'Custom Modules',
      fields: parseFields(body.fields),
      requiresApproval: Boolean(body.requiresApproval),
      approverRole: body.approverRole || '',
      enabled: body.enabled !== false
    };
    const module_ = await createCustomModule(input, session.username);
    return NextResponse.json(module_, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
