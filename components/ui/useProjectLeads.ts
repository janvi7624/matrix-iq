'use client';

import { useEffect, useState } from 'react';
import { ProjectLeadOption } from '@/lib/projectLeadOptions';

// One fetch of GET /api/projects/leads shared by every form on the page (the
// Project Lead dropdown, and the Opportunity Type default that needs the same
// list to know which id is Manoj / Pankaj). An empty or failed result isn't
// remembered, so a later open retries instead of being stuck with no leads.
let cached: Promise<ProjectLeadOption[]> | null = null;

function fetchLeads(): Promise<ProjectLeadOption[]> {
  if (!cached) {
    cached = fetch('/api/projects/leads')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ProjectLeadOption[]) => {
        if (!rows.length) cached = null;
        return rows;
      })
      .catch(() => {
        cached = null;
        return [] as ProjectLeadOption[];
      });
  }
  return cached;
}

// null while loading, then the list (possibly empty).
export function useProjectLeads(): ProjectLeadOption[] | null {
  const [leads, setLeads] = useState<ProjectLeadOption[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLeads().then((rows) => { if (!cancelled) setLeads(rows); });
    return () => { cancelled = true; };
  }, []);
  return leads;
}
