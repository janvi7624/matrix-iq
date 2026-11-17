// Single source of truth for the SaaS plan catalog — the public /pricing page
// reads it today, and the multi-organization platform (see
// docs/saas-platform-stages.md) is meant to read the same definitions for
// limit enforcement and module gating, so a price or limit is never typed in
// two places.
//
// Pure data, no imports: safe to use from proxy.ts, server components and
// client components alike.
//
// Payment model: there is no online checkout. The platform team issues an
// invoice, the organization pays offline (bank transfer / UPI / cheque), and a
// platform super admin marks the organization's subscription as paid/active.

export type PlanId = 'starter' | 'growth' | 'business' | 'enterprise';

export type ModuleKey =
  | 'leads'
  | 'quotations'
  | 'projects'
  | 'tasks'
  | 'dailyReports'
  | 'attendance'
  | 'tms'
  | 'expenses'
  | 'accounts'
  | 'marketingRequests'
  | 'fieldOps'
  | 'support'
  | 'analytics'
  | 'partnerPortal'
  | 'metaLeads'
  | 'festivalCampaigns'
  | 'customModules'
  | 'auditLog'
  | 'performanceReview';

export interface ModuleInfo {
  key: ModuleKey;
  name: string;
  summary: string;
}

// Grouped the way a buyer reads them, not the way the sidebar is ordered.
export const MODULE_GROUPS: { title: string; modules: ModuleInfo[] }[] = [
  {
    title: 'Sales & CRM',
    modules: [
      { key: 'leads', name: 'Leads & CRM', summary: 'Capture, assign, call and qualify leads through to a won project.' },
      { key: 'quotations', name: 'Quotations', summary: 'Product catalog, pricing, discounts and branded PDF quotations.' },
      { key: 'metaLeads', name: 'Meta lead ads', summary: 'Facebook / Instagram lead forms flow straight into the CRM.' },
      { key: 'partnerPortal', name: 'Partner portal', summary: 'A separate, isolated portal for resellers and channel partners.' },
    ],
  },
  {
    title: 'Projects & operations',
    modules: [
      { key: 'projects', name: 'Projects pipeline', summary: 'Stages from cold call to closure, with handovers and timelines.' },
      { key: 'tms', name: 'Task management (TMS)', summary: 'Phases, BOM approvals, procurement and deadline extensions.' },
      { key: 'fieldOps', name: 'Demos, site visits & installation', summary: 'Schedule and approve field work, track travel.' },
      { key: 'support', name: 'Support tickets', summary: 'Ticketing with SLA policies and status history.' },
    ],
  },
  {
    title: 'People & HR',
    modules: [
      { key: 'tasks', name: 'Tasks & planner', summary: 'Assign, review and reassign general tasks across teams.' },
      { key: 'dailyReports', name: 'Daily reports', summary: 'Templates, reminders, warnings and monthly summaries.' },
      { key: 'attendance', name: 'Attendance & leave', summary: 'Attendance records, leave requests and celebrations.' },
      { key: 'performanceReview', name: 'Performance review', summary: 'Per-employee review built from the work already logged.' },
    ],
  },
  {
    title: 'Finance',
    modules: [
      { key: 'expenses', name: 'Expenses & reimbursements', summary: 'Office, admin and travel expenses with approval chains.' },
      { key: 'accounts', name: 'Accounts & payments', summary: 'Payment queue, holds, history and CSV exports.' },
    ],
  },
  {
    title: 'Platform',
    modules: [
      { key: 'marketingRequests', name: 'Marketing requests', summary: 'Creative requests with assignment, review and delivery.' },
      { key: 'festivalCampaigns', name: 'Festival campaigns', summary: 'Approved greeting email campaigns to your clients.' },
      { key: 'analytics', name: 'Analytics & dashboards', summary: 'Department health, targets and person-level dashboards.' },
      { key: 'customModules', name: 'Custom modules', summary: 'Build your own record types and fields without code.' },
      { key: 'auditLog', name: 'Audit log', summary: 'Who changed what, and when, across the organization.' },
    ],
  },
];

export const ALL_MODULES: ModuleInfo[] = MODULE_GROUPS.flatMap((g) => g.modules);

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in INR, before GST. null = quoted per customer. */
  monthlyPrice: number | null;
  /** Annual price in INR, before GST (two months free). null = quoted. */
  yearlyPrice: number | null;
  /** Users included in the base price. null = unlimited. */
  includedUsers: number | null;
  /** Price per additional active user per month, in INR. null = not offered. */
  extraUserPrice: number | null;
  /** File storage included, in GB. null = custom. */
  storageGb: number | null;
  /** Departments that can be created. null = unlimited. */
  maxDepartments: number | null;
  modules: ModuleKey[];
  support: string;
  highlights: string[];
  featured?: boolean;
}

const STARTER_MODULES: ModuleKey[] = ['leads', 'quotations', 'projects', 'tasks', 'dailyReports', 'attendance'];
const GROWTH_MODULES: ModuleKey[] = [
  ...STARTER_MODULES,
  'tms',
  'expenses',
  'accounts',
  'marketingRequests',
  'fieldOps',
  'support',
  'analytics',
];
const BUSINESS_MODULES: ModuleKey[] = [
  ...GROWTH_MODULES,
  'partnerPortal',
  'metaLeads',
  'festivalCampaigns',
  'customModules',
  'auditLog',
  'performanceReview',
];

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For small teams moving sales and daily work off spreadsheets.',
    monthlyPrice: 4999,
    yearlyPrice: 49990,
    includedUsers: 15,
    extraUserPrice: 349,
    storageGb: 10,
    maxDepartments: 3,
    modules: STARTER_MODULES,
    support: 'Email support, 2 business days',
    highlights: ['Up to 15 users', 'CRM, quotations & projects', 'Daily reports & attendance', '10 GB file storage'],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For growing companies running projects, field work and finance.',
    monthlyPrice: 14999,
    yearlyPrice: 149990,
    includedUsers: 50,
    extraUserPrice: 299,
    storageGb: 50,
    maxDepartments: 10,
    modules: GROWTH_MODULES,
    support: 'Email & phone, next business day',
    highlights: ['Up to 50 users', 'Everything in Starter', 'TMS, expenses & accounts', 'Support tickets & analytics', '50 GB file storage'],
    featured: true,
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'For multi-department organizations with partners and channels.',
    monthlyPrice: 34999,
    yearlyPrice: 349990,
    includedUsers: 150,
    extraUserPrice: 249,
    storageGb: 200,
    maxDepartments: null,
    modules: BUSINESS_MODULES,
    support: 'Priority support with a named contact',
    highlights: ['Up to 150 users', 'Everything in Growth', 'Partner portal & Meta lead ads', 'Custom modules & audit log', '200 GB file storage'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For large teams that need their own limits, data location or SLA.',
    monthlyPrice: null,
    yearlyPrice: null,
    includedUsers: null,
    extraUserPrice: null,
    storageGb: null,
    maxDepartments: null,
    modules: BUSINESS_MODULES,
    support: 'Dedicated account manager & SLA',
    highlights: ['Unlimited users', 'Everything in Business', 'Dedicated database option', 'Assisted onboarding & data migration', 'Custom SLA'],
  },
];

export const TRIAL_DAYS = 14;
export const GST_RATE = 0.18;

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function planIncludesModule(plan: Plan, key: ModuleKey): boolean {
  return plan.modules.includes(key);
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}
