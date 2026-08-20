import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { TmsBomRequestRecord } from '@/lib/types';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-bom-requests', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const record = await tmsBomRequestStore.findById(id);
    if (!record) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-bom-requests', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });

    if (body.action === 'addAttachment') {
      const urls = toStringArray(body.urls);
      if (!urls.length) return NextResponse.json({ error: 'No attachment URLs provided' }, { status: 400 });
      const updated = await tmsBomRequestStore.update(id, { attachments: [...existing.attachments, ...urls], updated_at: new Date().toISOString() });
      return NextResponse.json(updated);
    }

    // Field edits are only allowed while the request hasn't left draft yet —
    // once submitted, it's in the review workflow (see the submit/approve/
    // reject/send-to-procurement sub-routes for status changes from here on).
    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Only a draft request can be edited — use submit/approve/reject instead' }, { status: 400 });
    }

    const patch: Partial<TmsBomRequestRecord> = { updated_at: new Date().toISOString() };
    if (typeof body.itemName === 'string' && body.itemName.trim()) patch.item_name = body.itemName.trim();
    if (typeof body.itemDescription === 'string') patch.item_description = body.itemDescription.trim();
    if (typeof body.partNumber === 'string') patch.part_number = body.partNumber.trim();
    if (typeof body.quantity === 'number') patch.quantity = body.quantity;
    if (typeof body.specification === 'string') patch.specification = body.specification.trim();
    if (typeof body.preferredBrand === 'string') patch.preferred_brand = body.preferredBrand.trim();
    if (typeof body.estimatedCost === 'number') patch.estimated_cost = body.estimatedCost;
    if (typeof body.requiredDate === 'string') patch.required_date = body.requiredDate;
    if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();

    const updated = await tmsBomRequestStore.update(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const allowed = await requireTmsAction(viewer, 'tms-bom-requests', 'delete');
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const ok = await tmsBomRequestStore.remove(id, allowed);
    if (!ok) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
