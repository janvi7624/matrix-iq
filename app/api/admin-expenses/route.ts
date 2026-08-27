import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { db } from '@/lib/db';
import { numberToIndianWords } from '@/lib/numberToWords';
import { apiErrorResponse } from '@/lib/apiError';

const ALLOWED_ROLES = new Set(['superadmin', 'admin']);

async function assertAdmin(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return null;
  if (!ALLOWED_ROLES.has(viewer.role)) return null;
  return viewer;
}

export async function GET(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  try {
    const rows = await db.Reimbursement.findAll({
      where: { is_admin_entry: true } as never,
      include: [{ model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }] as never,
      order: [['created_at', 'DESC']],
    });

    const records = rows.map((row: any) => row.get({ plain: true }));

    const grouped = new Map<string, any>();
    for (const rec of records) {
      const key = rec.admin_note || rec.id;
      if (!grouped.has(key)) {
        grouped.set(key, {
          batchId: key,
          date: rec.date,
          description: rec.description,
          from_location: rec.from_location || '',
          to_location: rec.to_location || '',
          total_amount: Number(rec.admin_total_amount) || 0,
          split_count: Number(rec.admin_split_count) || 0,
          per_person: Number(rec.amount) || 0,
          employees: [] as { id: string; name: string }[],
          created_at: rec.created_at,
        });
      }
      const g = grouped.get(key)!;
      const creator = rec.creator as Record<string, unknown> | undefined;
      const empId = rec.created_by as string;
      if (creator && !g.employees.find((e: any) => e.id === empId)) {
        g.employees.push({ id: empId, name: (creator.name as string) || (creator.username as string) || empId });
      }
    }

    return NextResponse.json({ entries: [...grouped.values()] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { type, date, location, fromLocation, toLocation, employeeIds, totalAmount, attachmentUrls } = body;

  if (!type || !date || !Array.isArray(employeeIds) || !employeeIds.length || !totalAmount) {
    return NextResponse.json({ error: 'Type, date, employees, and total amount are required' }, { status: 400 });
  }

  const amt = Number(totalAmount);
  if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });

  let description = '';
  let from = '';
  let to = '';

  if (type === 'Hotel') {
    description = 'Hotel';
    from = typeof location === 'string' ? location.trim() : '';
    if (!from) return NextResponse.json({ error: 'Location is required for Hotel' }, { status: 400 });
  } else if (['Bus Ticket', 'Train Ticket', 'Flight Ticket'].includes(type)) {
    description = type;
    from = typeof fromLocation === 'string' ? fromLocation.trim() : '';
    to = typeof toLocation === 'string' ? toLocation.trim() : '';
    if (!from || !to) return NextResponse.json({ error: 'From and To are required for ticket booking' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  const splitCount = employeeIds.length;
  const perPerson = Math.round((amt / splitCount) * 100) / 100;
  const batchId = `admin-${Date.now()}`;
  const urls: string[] = Array.isArray(attachmentUrls) ? attachmentUrls.filter((v: unknown) => typeof v === 'string') : [];

  try {
    const created = [];
    for (const empId of employeeIds) {
      // Find which user this is to get their ID for created_by
      const row = await db.Reimbursement.create({
        created_by: empId,
        date,
        description,
        employee_ids: [empId],
        from_location: from,
        to_location: to,
        kilometers: null,
        amount: perPerson,
        mode_of_payment: 'Company Paid',
        amount_in_words: numberToIndianWords(perPerson),
        attachment_urls: urls,
        is_admin_entry: true,
        admin_note: batchId,
        admin_total_amount: amt,
        admin_split_count: splitCount,
      } as never);
      created.push(row.get({ plain: true }));
    }

    return NextResponse.json({
      message: `Created ${created.length} entries (₹${perPerson} per person from total ₹${amt})`,
      batchId,
      perPerson,
      count: created.length,
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { batchId, type, date, location, fromLocation, toLocation, employeeIds, totalAmount } = body;
  if (!batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 400 });

  if (!type || !date || !Array.isArray(employeeIds) || !employeeIds.length || !totalAmount) {
    return NextResponse.json({ error: 'Type, date, employees, and total amount are required' }, { status: 400 });
  }

  const amt = Number(totalAmount);
  if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });

  let description = '';
  let from = '';
  let to = '';

  if (type === 'Hotel') {
    description = 'Hotel';
    from = typeof location === 'string' ? location.trim() : '';
    if (!from) return NextResponse.json({ error: 'Location is required for Hotel' }, { status: 400 });
  } else if (['Bus Ticket', 'Train Ticket', 'Flight Ticket'].includes(type)) {
    description = type;
    from = typeof fromLocation === 'string' ? fromLocation.trim() : '';
    to = typeof toLocation === 'string' ? toLocation.trim() : '';
    if (!from || !to) return NextResponse.json({ error: 'From and To are required for ticket booking' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  const splitCount = employeeIds.length;
  const perPerson = Math.round((amt / splitCount) * 100) / 100;

  try {
    // Delete old batch entries
    await db.Reimbursement.destroy({ where: { admin_note: batchId, is_admin_entry: true } as never });

    // Create new entries
    for (const empId of employeeIds) {
      await db.Reimbursement.create({
        created_by: empId,
        date,
        description,
        employee_ids: [empId],
        from_location: from,
        to_location: to,
        kilometers: null,
        amount: perPerson,
        mode_of_payment: 'Company Paid',
        amount_in_words: numberToIndianWords(perPerson),
        attachment_urls: [],
        is_admin_entry: true,
        admin_note: batchId,
        admin_total_amount: amt,
        admin_split_count: splitCount,
      } as never);
    }

    return NextResponse.json({
      message: `Updated batch (₹${perPerson} per person from total ₹${amt})`,
      batchId,
      perPerson,
      count: splitCount,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get('batchId');
  if (!batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 400 });

  try {
    const count = await db.Reimbursement.destroy({ where: { admin_note: batchId, is_admin_entry: true } as never });
    return NextResponse.json({ message: `Deleted ${count} entries`, count });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
