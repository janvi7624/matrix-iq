import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getModuleForViewer } from '@/lib/customModuleStore';
import { createCustomModuleRecord, listCustomModuleRecords } from '@/lib/customModuleRecordStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { key } = await params;
    const module_ = await getModuleForViewer(key, viewer);
    if (!module_) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    const records = await listCustomModuleRecords(module_, viewer);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const { key } = await params;
    const module_ = await getModuleForViewer(key, viewer);
    if (!module_) return NextResponse.json({ error: 'Module not found' }, { status: 404 });

    const values: Record<string, unknown> = (body.values && typeof body.values === 'object') ? body.values : {};
    const missing = module_.fields.filter((f) => f.required && (values[f.id] === undefined || values[f.id] === '' || (Array.isArray(values[f.id]) && (values[f.id] as unknown[]).length === 0)));
    if (missing.length > 0) {
      return NextResponse.json({ error: `Required field(s) missing: ${missing.map((f) => f.label).join(', ')}` }, { status: 400 });
    }

    const attachments = Array.isArray(body.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : [];
    const record = await createCustomModuleRecord(module_, values, attachments, viewer.username);
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
