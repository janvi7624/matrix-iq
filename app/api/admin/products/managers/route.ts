import { NextResponse } from 'next/server';
import { listActiveInternalEmployees } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';

// Backs the Product Master screen's manager picker (assign at creation, or
// reassign an existing product) — every active internal employee is
// eligible, same as any other "pick a colleague" dropdown; there's no
// separate Product Manager role to filter by (see lib/productManagerStore.ts).
export async function GET() {
  try {
    const employees = await listActiveInternalEmployees();
    return NextResponse.json(employees);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
