'use client';

import { useEffect, useState } from 'react';
import { DomainKey } from './types';
import { DOMAIN_DISPLAY_NAME } from './domainLabels';

// Maps a quotation/demo DomainKey to the real Department name that holds
// its manager(s) — si/visitiq have no technical domain manager concept,
// same as before this became real data.
const DOMAIN_DEPARTMENT: Partial<Record<DomainKey, string>> = {
  av: 'AV',
  robotics: 'Robotics',
  ai: 'AI'
};

type ManagersByDepartment = Record<string, { id: string; username: string; name: string }[]>;

// Informational routing label shown on demo requests — "this request is for
// the AI lead (Manali Akabari)" — now resolved from real Department.managerIds
// (lib/departmentStore.ts) via GET /api/departments/managers, replacing the
// old hardcoded first-name map.
export function useDomainLeadLabels(): (domains: DomainKey[]) => string {
  const [managersByDepartment, setManagersByDepartment] = useState<ManagersByDepartment>({});

  useEffect(() => {
    fetch('/api/departments/managers')
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: ManagersByDepartment) => setManagersByDepartment(data))
      .catch(() => setManagersByDepartment({}));
  }, []);

  function labelFor(domain: DomainKey): string {
    const deptName = DOMAIN_DEPARTMENT[domain];
    const managers = deptName ? managersByDepartment[deptName] : undefined;
    if (!managers || !managers.length) return 'Admin';
    return managers.map((m) => m.name).join(' / ');
  }

  return (domains: DomainKey[]) => {
    if (!domains.length) return 'Admin';
    return domains.map((d) => `${DOMAIN_DISPLAY_NAME[d]} (${labelFor(d)})`).join(', ');
  };
}
