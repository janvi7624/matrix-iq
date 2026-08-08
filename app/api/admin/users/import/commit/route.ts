import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { parseEmployeeXlsxBuffer, processEmployeeImport } from '@/lib/userImportStore';
import { apiErrorResponse } from '@/lib/apiError';

// Admin/superadmin only. Actually creates accounts + departments (unlike
// /preview) and writes one audit log entry for the whole batch. The
// temporary passwords in this response are the ONLY place they ever appear
// in plaintext — never persisted, never re-fetchable after this request.
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden — Admin or Super Admin only' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const rawRows = await parseEmployeeXlsxBuffer(await file.arrayBuffer());
    if (!rawRows.length) {
      return NextResponse.json({ error: 'No data rows found in this file' }, { status: 400 });
    }

    const result = await processEmployeeImport(rawRows, {
      dryRun: false,
      importedBy: session.username,
      importedByRole: session.role,
      fileName: file.name
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
