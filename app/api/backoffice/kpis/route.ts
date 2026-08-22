import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { deliveryChallanStore } from '@/lib/deliveryChallanStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { apiErrorResponse } from '@/lib/apiError';

// Back Office dashboard cards. Restricted to backoffice/admin/manager/superadmin
// — a plain sales/technical account has no reason to see fulfillment stats.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (viewer.role !== 'backoffice' && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Same team-queue visibility as /api/delivery-challans and
    // /api/demo-schedule — this route is already backoffice/privileged-only
    // (checked above), so canSeeQueue is effectively always true here, but
    // written the same way for consistency with those two routes.
    const canSeeQueue = viewer.isPrivileged || viewer.role === 'backoffice';
    const [dcs, demos] = await Promise.all([
      deliveryChallanStore.list(viewer.username, canSeeQueue),
      demoScheduleStore.list(viewer.username, canSeeQueue)
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const dispatchedDemoIds = new Set(demos.filter((d) => d.status === 'demo_completed').map((d) => d.id));

    const pendingDc = demos.filter((d) => d.status === 'pending_backoffice').length;
    const materialsOut = dcs.filter((d) => d.status === 'dispatched').length;
    const materialsReturned = dcs.filter((d) => d.status === 'returned' || d.status === 'closed').length;
    const damagedMaterials = dcs.filter((d) => d.material_return.damaged).length;
    const pendingVerification = dcs.filter((d) => d.status === 'dispatched' && dispatchedDemoIds.has(d.demo_id)).length;
    const todaysDispatch = dcs.filter((d) => d.status !== 'prepared' && d.updated_at.slice(0, 10) === today).length;
    // A DC that's been prepared (manually, or from a demo) but not yet
    // dispatched — distinct from pendingDc above, which is "a demo needs a
    // DC created for it," not "a DC exists and needs to go out." Neither the
    // Dashboard's attention panel nor this route surfaced this before, so a
    // DC could sit at 'prepared' indefinitely with no visible reminder.
    const pendingDispatch = dcs.filter((d) => d.status === 'prepared').length;

    return NextResponse.json({ pendingDc, materialsOut, materialsReturned, damagedMaterials, pendingVerification, todaysDispatch, pendingDispatch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
