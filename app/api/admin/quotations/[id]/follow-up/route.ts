import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { logQuotationFollowUp } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Auth + admin-role enforcement happens in proxy.ts (matcher: /api/admin/:path*).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const note = typeof body?.note === 'string' ? body.note.trim() : '';

  try {
    const updated = await logQuotationFollowUp(id, session.username, note);
    if (!updated) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
