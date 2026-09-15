import { NextRequest, NextResponse } from 'next/server';
import { assertReportViewer } from '@/lib/adminExpenseAccess';
import { getAdminExpenseReport, isValidMonthKey } from '@/lib/adminExpenseReportStore';
import { apiErrorResponse } from '@/lib/apiError';

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  const viewer = await assertReportViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const month = request.nextUrl.searchParams.get('month') || currentMonthKey();
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: 'Invalid month — expected YYYY-MM' }, { status: 400 });
  }

  try {
    const report = await getAdminExpenseReport(month);
    return NextResponse.json(report);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
