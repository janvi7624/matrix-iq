import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getModuleForViewer } from '@/lib/customModuleStore';
import { listCustomModuleRecords } from '@/lib/customModuleRecordStore';
import { toCsv } from '@/lib/csv';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { key } = await params;
    const module_ = await getModuleForViewer(key, viewer);
    if (!module_) return NextResponse.json({ error: 'Module not found' }, { status: 404 });

    const records = await listCustomModuleRecords(module_, viewer);
    const headers = [...module_.fields.map((f) => f.label), 'Status', 'Created By', 'Created At'];
    const rows = records.map((r) => [
      ...module_.fields.map((f) => {
        const value = r.values[f.id];
        return Array.isArray(value) ? value.join('; ') : String(value ?? '');
      }),
      r.status,
      r.created_by,
      r.created_at
    ]);
    const csv = toCsv(headers, rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${module_.key}.csv"`
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
