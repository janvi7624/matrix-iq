import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { projectStore } from '@/lib/projectStore';
import { searchQuotations } from '@/lib/quotationStore';
import { leadStore } from '@/lib/leadStore';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { apiErrorResponse } from '@/lib/apiError';

const PER_CATEGORY_LIMIT = 6;

export interface SearchResult {
  type: 'project' | 'quotation' | 'lead' | 'site-visit';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  return fields.some((f) => f && f.toLowerCase().includes(query));
}

// Real server-side search, gated to privileged viewers only (Manager/Admin/
// Super Admin) — a plain "user" login never sees the trigger for this in the
// header/sidebar, so this route existing doesn't change their experience.
// Quotations already have a dedicated search query (searchQuotations);
// Projects/Leads/Site Visits don't have one at the store layer, so this
// route does the text match server-side against the already-org-wide-scoped
// list (privileged=true) rather than shipping the raw list to the client.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!viewer.isPrivileged) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const query = (request.nextUrl.searchParams.get('q') || '').trim();
  if (query.length < 2) return NextResponse.json({ results: [] });

  const q = query.toLowerCase();

  try {
    const [projects, quotations, leads, siteVisits] = await Promise.all([
      projectStore.list(viewer.username, true),
      searchQuotations(query),
      leadStore.list(viewer.username, true),
      siteVisitStore.list(viewer.username, true)
    ]);

    const results: SearchResult[] = [];

    projects
      .filter((p) => matches(q, p.client_name, p.company, p.contact_person, p.id))
      .slice(0, PER_CATEGORY_LIMIT)
      .forEach((p) => results.push({
        type: 'project',
        id: p.id,
        title: p.client_name || p.company || `Project ${p.id}`,
        subtitle: [p.company, p.stage].filter(Boolean).join(' · '),
        href: `/projects/${p.id}`
      }));

    quotations.slice(0, PER_CATEGORY_LIMIT).forEach((qt) => results.push({
      type: 'quotation',
      id: qt.id,
      title: qt.quotation_number,
      subtitle: [qt.client_company || qt.client_name, `₹${qt.total.toLocaleString('en-IN')}`].filter(Boolean).join(' · '),
      href: `/my-quotations?focus=${qt.id}`
    }));

    leads
      .filter((l) => matches(q, l.name, l.company, l.email, l.mobile))
      .slice(0, PER_CATEGORY_LIMIT)
      .forEach((l) => results.push({
        type: 'lead',
        id: l.id,
        title: l.name || l.company || 'Unnamed lead',
        subtitle: [l.company, l.mobile].filter(Boolean).join(' · '),
        href: `/leads?focus=${l.id}`
      }));

    siteVisits
      .filter((v) => matches(q, v.company_name, v.contact_person, v.location))
      .slice(0, PER_CATEGORY_LIMIT)
      .forEach((v) => results.push({
        type: 'site-visit',
        id: v.id,
        title: v.company_name || v.location || 'Site visit',
        subtitle: [v.location, v.visit_date].filter(Boolean).join(' · '),
        href: `/site-visits?focus=${v.id}`
      }));

    return NextResponse.json({ results });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
