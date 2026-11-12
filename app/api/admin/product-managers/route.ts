import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listAllProductManagerRollups } from '@/lib/productManagerStore';
import { apiErrorResponse } from '@/lib/apiError';

// Admin/Superadmin-only overview — every person who has created at least
// one product, and their Pending/Won/Lost rollup across every quotation.
//
// Under /api/admin/* (blanket isPrivileged gate in proxy.ts), but that flag
// is also true for the generic 'manager' role — same reasoning as
// /api/admin/feedback's FEEDBACK_ADMIN_ROLES check: "visible to admin and
// super admin only" means a strict role list here, not the isPrivileged
// bypass.
const PRODUCT_MANAGER_ADMIN_ROLES: string[] = ['superadmin', 'admin'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!PRODUCT_MANAGER_ADMIN_ROLES.includes(viewer.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const rollups = await listAllProductManagerRollups();
    return NextResponse.json(rollups);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
