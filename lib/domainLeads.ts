import { DomainKey } from './types';
import { DOMAIN_DISPLAY_NAME } from './domainLabels';

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

// Multi-domain version — a demo covering AV + AI shows "AV (Naresh), AI (Manali)".
export function domainLeadLabels(domains: DomainKey[]): string {
  if (!domains.length) return 'Admin';
  return domains.map((d) => `${DOMAIN_DISPLAY_NAME[d]} (${domainLeadLabel(d)})`).join(', ');
}
