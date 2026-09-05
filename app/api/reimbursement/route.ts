import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementStore } from '@/lib/reimbursementStore';
import { numberToIndianWords } from '@/lib/numberToWords';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const now = new Date();
  const year = Number(url.searchParams.get('year')) || now.getFullYear();
  const month = Number(url.searchParams.get('month')) || (now.getMonth() + 1);

  try {
    const ownOnly = url.searchParams.get('own') === 'true';
    const records = await reimbursementStore.list(viewer.username, ownOnly ? false : viewer.isPrivileged, year, month);
    const total = records.reduce((sum, r) => sum + r.amount, 0);
    return NextResponse.json({ records, total, totalInWords: numberToIndianWords(total), year, month });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const date = typeof body.date === 'string' ? body.date : '';
  const amount = Number(body.amount);
  const attachmentUrls: string[] = Array.isArray(body.attachmentUrls) ? body.attachmentUrls.filter((v: unknown) => typeof v === 'string') : [];

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!date) return NextResponse.json({ error: 'Date is required' }, { status: 400 });
  if (!description) return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });
  const isConveyance2w4w = /^Conveyance \((2 Wheeler|4 Wheeler)\)$/.test(description);
  if (!isConveyance2w4w && !attachmentUrls.length) return NextResponse.json({ error: 'At least one attachment (bill proof) is required' }, { status: 400 });

  try {
    const record = await reimbursementStore.create(viewer.username, {
      date,
      description,
      employee_ids: Array.isArray(body.employeeIds) ? body.employeeIds.filter((v: unknown) => typeof v === 'string') : [],
      guest_names: Array.isArray(body.guestNames) ? body.guestNames.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0).map((v: string) => v.trim()) : [],
      from_location: typeof body.fromLocation === 'string' ? body.fromLocation.trim() : '',
      to_location: typeof body.toLocation === 'string' ? body.toLocation.trim() : '',
      kilometers: Number(body.kilometers) || 0,
      amount,
      mode_of_payment: typeof body.modeOfPayment === 'string' ? body.modeOfPayment.trim() : '',
      amount_in_words: numberToIndianWords(amount),
      attachment_urls: attachmentUrls
    });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
