import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import { clientMasterStore } from '@/lib/clientMasterStore';
import { apiErrorResponse } from '@/lib/apiError';

// Client Master is deliberately org-wide within its configured roles — see
// lib/clientMasterStore.ts's own comment for why there's no separate clients
// table, and lib/moduleConfigStore.ts's 'client-master' entry for who those
// roles are. isModuleAccessAllowed was previously never actually called
// here (a real, pre-existing gap — any authenticated user of any role could
// reach this route), so this is the fix, not a new restriction: it enforces
// the same visibleToRoles this module has always been configured with.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('client-master', viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const clients = await clientMasterStore.list();
    return NextResponse.json({ clients });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
