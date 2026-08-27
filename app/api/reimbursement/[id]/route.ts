import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementStore } from '@/lib/reimbursementStore';
import { numberToIndianWords } from '@/lib/numberToWords';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const record = await reimbursementStore.findById(id);
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const existing = await reimbursementStore.findById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.created_by !== viewer.username && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.date !== undefined) patch.date = body.date;
  if (body.description !== undefined) patch.description = typeof body.description === 'string' ? body.description.trim() : '';
  if (body.employeeIds !== undefined) patch.employee_ids = Array.isArray(body.employeeIds) ? body.employeeIds.filter((v: unknown) => typeof v === 'string') : [];
  if (body.fromLocation !== undefined) patch.from_location = typeof body.fromLocation === 'string' ? body.fromLocation.trim() : '';
  if (body.toLocation !== undefined) patch.to_location = typeof body.toLocation === 'string' ? body.toLocation.trim() : '';
  if (body.kilometers !== undefined) patch.kilometers = Number(body.kilometers) || 0;
  if (body.amount !== undefined) {
    const amt = Number(body.amount);
    if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });
    patch.amount = amt;
    patch.amount_in_words = numberToIndianWords(amt);
  }
  if (body.modeOfPayment !== undefined) patch.mode_of_payment = typeof body.modeOfPayment === 'string' ? body.modeOfPayment.trim() : '';
  if (body.attachmentUrls !== undefined) {
    const urls = Array.isArray(body.attachmentUrls) ? body.attachmentUrls.filter((v: unknown) => typeof v === 'string') : [];
    const desc = typeof body.description === 'string' ? body.description.trim() : (patch.description as string || '');
    const isConveyance2w4w = /^Conveyance \((2 Wheeler|4 Wheeler)\)$/.test(desc);
    if (!isConveyance2w4w && !urls.length) return NextResponse.json({ error: 'At least one attachment is required' }, { status: 400 });
    patch.attachment_urls = urls;
  }

  try {
    const updated = await reimbursementStore.update(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const existing = await reimbursementStore.findById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.created_by !== viewer.username && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await reimbursementStore.remove(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
