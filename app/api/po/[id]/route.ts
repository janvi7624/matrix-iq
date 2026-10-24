import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { poStore } from '@/lib/poStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { PoRecord } from '@/lib/types';

function formatMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

// A PO used to be log-once, delete-only: there was no way to come back and
// record that the remaining balance arrived after an advance, short of
// deleting the whole row (PO number, date, attachment and all) and starting
// over. This is the fix — same create/update/remove factory every sibling
// "log something against a project" module already uses (installation,
// negotiation, customer-response), just finally wired up to a PATCH here too.
//
// Deliberately does NOT re-run POST /api/po's "close the project as won"
// side effect: that is a one-time "the deal is won" event tied to the PO
// first being logged, not to amending figures on an already-logged one.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    // list(..., true) to see every PO regardless of who created it — the
    // permission check right below is what actually decides whether THIS
    // viewer may act on it, same two-step as installation/[id]'s PATCH.
    const records = await poStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'PO not found' }, { status: 404 });
    if (!viewer.isPrivileged && existing.created_by !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const patch: Partial<PoRecord> = {};
    if (typeof body.poNumber === 'string' && body.poNumber.trim()) patch.po_number = body.poNumber.trim();
    if (typeof body.poDate === 'string') patch.po_date = body.poDate;
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: 'Amount must be a number of 0 or more.' }, { status: 400 });
      patch.amount = amount;
    }
    if (body.advanceReceived !== undefined) {
      const advance = Number(body.advanceReceived);
      if (!Number.isFinite(advance) || advance < 0) return NextResponse.json({ error: 'Advance received must be a number of 0 or more.' }, { status: 400 });
      patch.advance_received = advance;
    }
    if (typeof body.paymentTerms === 'string') patch.payment_terms = body.paymentTerms.trim();
    if (typeof body.attachmentUrl === 'string') patch.attachment_url = body.attachmentUrl;
    if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();

    const updated = await poStore.update(id, patch);

    // A readable diff, not just "PO updated" — this is the one thing worth
    // seeing on the project's own history, especially the common case this
    // route exists for: an advance followed later by the balance.
    const changes: string[] = [];
    if (patch.amount !== undefined && patch.amount !== existing.amount) changes.push(`Amount: ${formatMoney(existing.amount)} → ${formatMoney(patch.amount)}`);
    if (patch.advance_received !== undefined && patch.advance_received !== existing.advance_received) {
      changes.push(`Received: ${formatMoney(existing.advance_received)} → ${formatMoney(patch.advance_received)}`);
    }
    if (patch.po_number !== undefined && patch.po_number !== existing.po_number) changes.push(`PO number: ${existing.po_number} → ${patch.po_number}`);
    if (patch.po_date !== undefined && patch.po_date !== existing.po_date) changes.push(`PO date: ${existing.po_date || '—'} → ${patch.po_date || '—'}`);
    if (patch.payment_terms !== undefined && patch.payment_terms !== existing.payment_terms) changes.push('Payment terms updated');
    if (patch.attachment_url !== undefined && patch.attachment_url !== existing.attachment_url) changes.push('Attachment updated');

    if (changes.length && existing.project_id) {
      await appendProjectTimeline(existing.project_id, {
        by: viewer.username,
        stage: 'po_received',
        label: `PO ${updated?.po_number || existing.po_number} updated`,
        remarks: changes.join('; ')
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const deleted = await poStore.remove(id, viewer.username, viewer.isPrivileged);
    if (!deleted) return NextResponse.json({ error: 'PO not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
