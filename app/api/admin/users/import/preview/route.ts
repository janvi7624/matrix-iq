import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { parseEmployeeXlsxBuffer, processEmployeeImport } from '@/lib/userImportStore';
import { apiErrorResponse } from '@/lib/apiError';

// Admin/superadmin only — a Manager is privileged everywhere else in the app
// (proxy.ts) but must NOT reach bulk employee import or credentials.
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
      dryRun: true,
      importedBy: session.username,
      importedByRole: session.role,
      fileName: file.name
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
