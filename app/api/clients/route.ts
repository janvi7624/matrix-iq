import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import { clientMasterStore } from '@/lib/clientMasterStore';
import { paginateClients, ClientSortKey } from '@/lib/clientMasterQuery';
import { apiErrorResponse } from '@/lib/apiError';

// Client Master's project-derived half is deliberately org-wide within its
// configured roles — see lib/clientMasterStore.ts's own comment for why
// there's no separate clients table, and lib/moduleConfigStore.ts's
// 'client-master' entry for who those roles are. isModuleAccessAllowed was
// previously never actually called here (a real, pre-existing gap — any
// authenticated user of any role could reach this route), so this is the fix,
// not a new restriction: it enforces the same visibleToRoles this module has
// always been configured with.
// The viewer is passed down because the directory's second source — leads
// with no project — is department-scoped per viewer, the way leads are
// everywhere else in the app.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('client-master', viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const clients = await clientMasterStore.list(viewer.username);

    // `page` is the opt-in for the filtered/paginated answer, the same
    // convention /api/projects and /api/leads already use: a caller that does
    // not ask for a page (the CSV export, any older client) gets the exact
    // previous response, the whole directory, unchanged.
    const params = request.nextUrl.searchParams;
    if (!params.has('page')) return NextResponse.json({ clients });

    return NextResponse.json(paginateClients(clients, {
      search: params.get('search') || undefined,
      company: params.get('company') || undefined,
      owner: params.get('owner') || undefined,
      handlerName: params.get('handlerName') || undefined,
      type: (params.get('type') as 'customer' | 'prospect' | '') || undefined,
      outcome: params.get('outcome') || undefined,
      active: params.get('active') || undefined,
      handler: params.get('handler') || undefined,
      dateFrom: params.get('dateFrom') || undefined,
      dateTo: params.get('dateTo') || undefined,
      sortKey: (params.get('sortKey') as ClientSortKey) || undefined,
      sortDesc: params.get('sortDesc') !== '0',
      page: Number(params.get('page')) || 1,
      pageSize: Number(params.get('pageSize')) || 20,
      withOptions: params.get('options') !== '0'
    }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// "+ Add Client" — a plain contact record with no lead/call workflow
// attached. This used to silently POST to /api/leads instead (and always
// failed, since that route requires a leadSource this form never sent) —
// see lib/clientMasterStore.ts's createManualClient for the full story.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('client-master', viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const company = typeof body.company === 'string' ? body.company.trim() : '';
  if (!clientName && !company) {
    return NextResponse.json({ error: 'Client name or company is required' }, { status: 400 });
  }

  try {
    await clientMasterStore.createManualClient(
      {
        clientName,
        company,
        phone: typeof body.phone === 'string' ? body.phone : '',
        email: typeof body.email === 'string' ? body.email : '',
        address: typeof body.address === 'string' ? body.address : ''
      },
      viewer.userId
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
