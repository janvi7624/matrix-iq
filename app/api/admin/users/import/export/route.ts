import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { buildUserCredentialsXlsxBuffer, CredentialsRow } from '@/lib/userImportXlsx';
import { apiErrorResponse } from '@/lib/apiError';

// Formats the xlsx from data the client already has (the /commit response
// it's already rendering on screen) — never reads a password from the
// database, since only the hash is ever stored there. Admin/superadmin only.
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden — Admin or Super Admin only' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null);
    const rows: unknown = body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No credential rows to export' }, { status: 400 });
    }

    const credentialsRows: CredentialsRow[] = rows.map((r) => ({
      name: String((r as Record<string, unknown>)?.name ?? ''),
      employeeId: String((r as Record<string, unknown>)?.employeeId ?? ''),
      username: String((r as Record<string, unknown>)?.username ?? ''),
      tempPassword: String((r as Record<string, unknown>)?.tempPassword ?? ''),
      role: String((r as Record<string, unknown>)?.role ?? ''),
      department: String((r as Record<string, unknown>)?.department ?? ''),
      status: String((r as Record<string, unknown>)?.status ?? '')
    }));

    const buffer = await buildUserCredentialsXlsxBuffer(credentialsRows);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="user-credentials.xlsx"'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
