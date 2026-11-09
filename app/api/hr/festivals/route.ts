import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { apiErrorResponse } from '@/lib/apiError';
import { listFestivals, createFestival } from '@/lib/festivalStore';

function isValidDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + 'T00:00:00Z').getTime());
}

// HR's own Indian-festival-greeting calendar — gated the same way
// hr-employees/hr-reports are (HR + Admin + Super Admin, via
// requireHrModule/HR_MODULE_ROLES), not a separate capability. Festivals
// here are read by app/api/dashboard/celebrations/route.ts's own
// processTodaysFestival(), which any logged-in viewer's dashboard triggers —
// but managing the LIST is HR's call, same split as every other HR
// reference-data screen.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-festivals'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json(await listFestivals());
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-festivals'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const greeting = typeof body.greeting === 'string' ? body.greeting.trim() : '';
  if (!key || !/^[a-z0-9-]+$/.test(key)) {
    return NextResponse.json({ error: 'key is required and must be lowercase letters, numbers, and hyphens only' }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!greeting) return NextResponse.json({ error: 'greeting is required' }, { status: 400 });
  if (!isValidDateOnly(body.date)) return NextResponse.json({ error: 'A valid date (YYYY-MM-DD) is required' }, { status: 400 });

  try {
    const created = await createFestival(
      { key, name, date: body.date, greeting, provisional: body.provisional === true },
      viewer.userId
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
      return NextResponse.json({ error: 'A festival with this key already exists' }, { status: 409 });
    }
    return apiErrorResponse(error);
  }
}
