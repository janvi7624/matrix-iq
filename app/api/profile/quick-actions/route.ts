import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listVisibleModules } from '@/lib/moduleConfigStore';
import { isProductManager } from '@/lib/productManagerStore';
import { findUserNameAndDeptByUsername } from '@/lib/userStore';
import { getQuickActionKeys, setQuickActionKeys, MAX_QUICK_ACTIONS, QuickActionsUnavailableError } from '@/lib/quickActionStore';
import { apiErrorResponse } from '@/lib/apiError';

// The caller's OWN sidebar Quick Actions. Every user, any role — each person
// only ever reads and writes their own row; there is no way to address
// another user's choice through this route.

async function visibleModuleKeys(viewer: NonNullable<Awaited<ReturnType<typeof getViewerContext>>>): Promise<Set<string>> {
  const user = await findUserNameAndDeptByUsername(viewer.username);
  const modules = await listVisibleModules({
    role: viewer.role,
    username: viewer.username,
    isPrivileged: viewer.isPrivileged,
    department: user?.department,
    isProductManager: await isProductManager(viewer.userId)
  });
  return new Set(modules.map((m) => m.key));
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const [keys, visible] = await Promise.all([getQuickActionKeys(viewer.userId), visibleModuleKeys(viewer)]);
    // A module the person has since lost access to drops out silently rather
    // than rendering a shortcut into an Access Denied page.
    return NextResponse.json({ keys: keys.filter((k) => visible.has(k)), max: MAX_QUICK_ACTIONS });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.keys) || body.keys.some((k: unknown) => typeof k !== 'string')) {
    return NextResponse.json({ error: 'keys must be a list of module keys' }, { status: 400 });
  }
  const requested = Array.from(new Set<string>(body.keys));
  if (requested.length > MAX_QUICK_ACTIONS) {
    return NextResponse.json({ error: `Pick at most ${MAX_QUICK_ACTIONS} quick actions` }, { status: 400 });
  }

  try {
    const visible = await visibleModuleKeys(viewer);
    const notAllowed = requested.filter((k) => !visible.has(k));
    if (notAllowed.length) {
      return NextResponse.json({ error: 'You can only add modules you have access to' }, { status: 400 });
    }
    await setQuickActionKeys(viewer.userId, requested);
    return NextResponse.json({ keys: requested, max: MAX_QUICK_ACTIONS });
  } catch (error) {
    if (error instanceof QuickActionsUnavailableError) {
      return NextResponse.json({ error: 'Quick Actions cannot be saved yet — the database update has not been applied.' }, { status: 503 });
    }
    return apiErrorResponse(error);
  }
}
