// Back-navigation helpers for CommonHeader's back button. Pure functions,
// no React or DOM, so they are unit tested directly (tests/unit/backNavigation.test.ts).
//
// Two questions the back button has to answer:
//   1. Is there an in-app screen behind this one in THIS tab's history?
//      → yes: router.back(), so filters/scroll/history behave like the
//        browser's own Back button.
//   2. If not (deep link, new tab, page reload after login), where should it go?
//      → the nearest real parent page of the current URL, e.g.
//        /tms/tasks/123 → /tms/tasks, /admin/users/import → /admin/users,
//        /hr/attendance → / (there is no /hr page). A page can still pass its
//        own fallbackRoute when the URL parent is not the logical parent.

/**
 * Every static (non-redirect) page route under app/. Dynamic segments are
 * written as [param]. Kept in sync with the filesystem by
 * tests/unit/backNavigation.test.ts, which fails when a page is added or
 * removed without updating this list.
 */
export const PAGE_ROUTES: readonly string[] = [
  '/',
  '/accounts/payments',
  '/admin-expenses',
  '/admin-expenses/[batchId]/edit',
  '/admin-expenses/new',
  '/admin/audit-log',
  '/admin/custom-modules',
  '/admin/daily-report-config',
  '/admin/departments',
  '/admin/feedback',
  '/admin/meta-integration',
  '/admin/modules',
  '/admin/partners',
  '/admin/partners/[id]',
  '/admin/partners/analytics',
  '/admin/performance-review',
  '/admin/product-managers',
  '/admin/products',
  '/admin/roles',
  '/admin/settings',
  '/admin/task-planner',
  '/admin/users',
  '/admin/users/[id]',
  '/admin/users/import',
  '/analytics',
  '/backoffice',
  '/billing',
  '/change-password',
  '/clients',
  '/customer-response',
  '/daily-reports',
  '/demo-schedule',
  '/employee-exit',
  '/feedback',
  '/feedback-forms/[id]',
  '/festival-campaigns',
  '/hr/appreciation',
  '/hr/attendance',
  '/hr/celebrations',
  '/hr/daily-reports',
  '/hr/employees',
  '/hr/festivals',
  '/hr/reports',
  '/installation',
  '/leads',
  '/login',
  '/marketing-requests',
  '/materials',
  '/modules/[key]',
  '/my-tasks',
  '/my-tasks/[id]',
  '/negotiation',
  '/office-operation-expenses',
  '/office-operation-expenses/[id]/edit',
  '/office-operation-expenses/new',
  '/partner',
  '/partner/demos',
  '/partner/marketing-requests',
  '/partner/materials',
  '/partner/onboarding',
  '/partner/profile',
  '/partner/projects',
  '/partner/projects/[id]',
  '/partner/quotations',
  '/partner/support',
  '/partner/team',
  '/partners',
  '/partners/[id]',
  '/partners/new',
  '/po',
  '/pricing',
  '/product-manager',
  '/profile',
  '/projects',
  '/projects/[id]',
  '/quotation',
  '/quotation-history',
  '/reimbursement',
  '/request-demo',
  '/site-visits',
  '/support',
  '/support/[id]',
  '/targets',
  '/team-tasks',
  '/tms/bom-requests',
  '/tms/bom-requests/[id]',
  '/tms/my-sold-projects',
  '/tms/my-sold-projects/[id]',
  '/tms/procurement',
  '/tms/procurement/[id]',
  '/tms/projects',
  '/tms/projects/[id]',
  '/tms/tasks',
  '/tms/tasks/[id]',
  '/tms/team',
  '/travel-schedule',
  '/travel-schedule/[id]',
  '/vendor-assessment'
];

/** Routes that are never a sensible "go back to" target. */
const NON_FALLBACK_ROUTES = new Set(['/login', '/change-password', '/pricing', '/request-demo']);

/** Only static routes can be a fallback — a parent that needs an id we don't have is skipped. */
const STATIC_FALLBACKS = new Set(PAGE_ROUTES.filter((r) => !r.includes('[') && !NON_FALLBACK_ROUTES.has(r)));

function normalise(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/';
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return trimmed || '/';
}

/**
 * The nearest real ancestor page of `pathname`, falling back to `rootRoute`
 * (the dashboard, or the partner portal home for partner pages).
 */
export function resolveFallbackRoute(pathname: string, rootRoute = '/'): string {
  const segments = normalise(pathname).split('/').filter(Boolean);
  for (let i = segments.length - 1; i > 0; i--) {
    const candidate = `/${segments.slice(0, i).join('/')}`;
    if (STATIC_FALLBACKS.has(candidate)) return candidate;
  }
  return rootRoute;
}

/** Max entries kept in the per-tab stack — plenty for "is there a previous screen?". */
export const NAV_STACK_LIMIT = 50;
export const NAV_STACK_STORAGE_KEY = 'mx-nav-stack';

/**
 * Records a visit to `pathname` on this tab's in-app history stack.
 * - same path as the top (re-render, reload, query-only change) → unchanged
 * - same path as the entry below the top → treated as a Back navigation (pop)
 * - anything else → push
 */
export function recordNavigation(stack: readonly string[], pathname: string): string[] {
  const path = normalise(pathname);
  const top = stack[stack.length - 1];
  if (top === path) return [...stack];
  if (stack.length >= 2 && stack[stack.length - 2] === path) return stack.slice(0, -1);
  const next = [...stack, path];
  return next.length > NAV_STACK_LIMIT ? next.slice(next.length - NAV_STACK_LIMIT) : next;
}

/** True when the stack holds an in-app screen behind the current one. */
export function hasPreviousInAppScreen(stack: readonly string[]): boolean {
  return stack.length >= 2;
}

export function parseNavStack(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string').slice(-NAV_STACK_LIMIT) : [];
  } catch {
    return [];
  }
}
