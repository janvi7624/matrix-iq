import { DomainKey } from './types';

// Informational routing label shown on demo requests — "this request is for
// the AI lead (Manali)". The named leads don't have portal accounts yet, so
// the actual confirm/reject action is available to any admin/superadmin;
// this is display-only until real lead accounts exist.
export const DOMAIN_LEAD: Partial<Record<DomainKey, string>> = {
  ai: 'Manali',
  av: 'Naresh',
  robotics: 'Noor'
};

export function domainLeadLabel(domain: DomainKey | ''): string {
  if (!domain) return 'Admin';
  return DOMAIN_LEAD[domain] || 'Admin';
}
