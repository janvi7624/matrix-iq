import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { upsertOverride } from '@/lib/productOverrideStore';
import { findCatalog } from '@/lib/catalogRegistry';
import { apiErrorResponse } from '@/lib/apiError';

// Base auth + admin/superadmin/manager gating happens in proxy.ts (matcher: /api/admin/:path*).
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const catalog = body && typeof body.catalog === 'string' ? findCatalog(body.catalog) : undefined;
  if (!catalog || typeof body.productKey !== 'string' || !body.productKey) {
    return NextResponse.json({ error: 'Unknown catalog or missing productKey' }, { status: 400 });
  }

  try {
    const record = await upsertOverride(
      {
        catalog: catalog.id,
        productKey: body.productKey,
        name: catalog.nameField && typeof body.name === 'string' ? body.name.trim() || null : null,
        fields: body.fields && typeof body.fields === 'object' ? body.fields : null
      },
      session.username
    );
    return NextResponse.json(record, { status: 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
