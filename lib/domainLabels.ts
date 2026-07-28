import { DomainKey } from './types';

// Shared with the Site Visit Report "category" dropdown, which is required
// to mirror the quotation calculator's domain list.
export const DOMAIN_DISPLAY_NAME: Record<DomainKey, string> = {
  av: 'AV',
  robotics: 'Robotics',
  ai: 'AI Video Analytics',
  si: 'System Integration',
  visitiq: 'VisitIQ VMS'
};
