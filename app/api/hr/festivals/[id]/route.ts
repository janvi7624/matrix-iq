import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { apiErrorResponse } from '@/lib/apiError';
import { updateFestival, deleteFestival } from '@/lib/festivalStore';

function isValidDateOnly(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + 'T00:00:00Z').getTime());
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-festivals'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  if (body.date !== undefined && !isValidDateOnly(body.date)) {
    return NextResponse.json({ error: 'A valid date (YYYY-MM-DD) is required' }, { status: 400 });
  }
  if (body.key !== undefined && (typeof body.key !== 'string' || !/^[a-z0-9-]+$/.test(body.key.trim()))) {
    return NextResponse.json({ error: 'key must be lowercase letters, numbers, and hyphens only' }, { status: 400 });
  }

  try {
    const updated = await updateFestival(
      id,
      {
        key: typeof body.key === 'string' ? body.key : undefined,
        name: typeof body.name === 'string' ? body.name : undefined,
        date: typeof body.date === 'string' ? body.date : undefined,
        greeting: typeof body.greeting === 'string' ? body.greeting : undefined,
        provisional: typeof body.provisional === 'boolean' ? body.provisional : undefined
      },
      viewer.userId
    );
    if (!updated) return NextResponse.json({ error: 'Festival not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
      return NextResponse.json({ error: 'A festival with this key already exists' }, { status: 409 });
    }
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-festivals'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const ok = await deleteFestival(id);
    if (!ok) return NextResponse.json({ error: 'Festival not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
