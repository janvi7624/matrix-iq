import { UserRole } from './types';

// Documents the access rules that are actually enforced in proxy.ts and the
// individual API routes (own-scoped vs org-wide visibility, who can delete,
// who can approve/dispatch, etc.) — a readable reference, not a config that
// drives behavior. Roles are a fixed TypeScript union today (see UserRole in
// lib/types.ts); turning this into an editable permission matrix would mean
// replacing every hardcoded role check across the API routes with a
// data-driven lookup — a larger change, tracked as a future step rather than
// done here.
export type CapabilityLevel = 'yes' | 'no' | 'own';

export interface RoleCapability {
  capability: string;
  roles: Record<UserRole, CapabilityLevel>;
  note?: string;
}

const ALL_YES: Record<UserRole, CapabilityLevel> = { superadmin: 'yes', admin: 'yes', manager: 'yes', technical: 'yes', backoffice: 'yes', user: 'yes' };

export const ROLE_CAPABILITIES: RoleCapability[] = [
  {
    capability: 'Create quotations, site visits, demo requests',
    roles: ALL_YES
  },
  {
    capability: 'View quotation / site visit / project history',
    roles: { superadmin: 'yes', admin: 'yes', manager: 'yes', technical: 'own', backoffice: 'own', user: 'own' },
    note: 'Admin/Manager see every record; other roles only see records they created.'
  },
  {
    capability: 'Approve demo request — Technical Availability',
    roles: { superadmin: 'yes', admin: 'yes', manager: 'yes', technical: 'yes', backoffice: 'no', user: 'no' }
  },
  {
    capability: 'Approve demo request — Manager Approval',
    roles: { superadmin: 'yes', admin: 'yes', manager: 'yes', technical: 'no', backoffice: 'no', user: 'no' }
  },
  {
    capability: 'Generate / dispatch / close Delivery Challans',
    roles: { superadmin: 'yes', admin: 'yes', manager: 'yes', technical: 'no', backoffice: 'yes', user: 'no' }
  },
  {
    capability: 'Mark a demo completed / file the demo report',
    roles: { superadmin: 'yes', admin: 'yes', manager: 'yes', technical: 'yes', backoffice: 'yes', user: 'own' },
    note: 'Technical/Back Office can act on any demo in the pipeline; a plain User only on their own.'
  },
  {
    capability: 'Manage users (create, edit, activate/deactivate, reset password)',
    roles: { superadmin: 'yes', admin: 'yes', manager: 'yes', technical: 'no', backoffice: 'no', user: 'no' }
  },
  {
    capability: 'Delete records (quotations, users, DCs, etc.)',
    roles: { superadmin: 'yes', admin: 'no', manager: 'no', technical: 'no', backoffice: 'no', user: 'no' }
  },
  {
    capability: 'Grant or edit a Super Admin account',
    roles: { superadmin: 'yes', admin: 'no', manager: 'no', technical: 'no', backoffice: 'no', user: 'no' }
  },
  {
    capability: 'View the Audit Log',
    roles: { superadmin: 'yes', admin: 'yes', manager: 'yes', technical: 'no', backoffice: 'no', user: 'no' }
  }
];
