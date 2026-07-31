import { NextRequest, NextResponse } from 'next/server';
import { deleteCustomModule, findCustomModuleById, updateCustomModule } from '@/lib/customModuleStore';
import { parseFields } from '../route';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const module_ = await findCustomModuleById(id);
    if (!module_) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    return NextResponse.json(module_);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (typeof body.icon === 'string') patch.icon = body.icon.trim();
    if (typeof body.section === 'string') patch.section = body.section.trim();
    if (Array.isArray(body.fields)) patch.fields = parseFields(body.fields);
    if (typeof body.requiresApproval === 'boolean') patch.requiresApproval = body.requiresApproval;
    if (body.approverRole !== undefined) patch.approverRole = body.approverRole;
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;

    const updated = await updateCustomModule(id, patch);
    if (!updated) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = await deleteCustomModule(id);
    if (!deleted) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
