export type DomainKey = 'av' | 'robotics' | 'ai' | 'si' | 'visitiq';

export type AvProjectType = 'standee' | 'led' | 'interactive-panel' | 'conference' | 'cables' | 'av-solution';

export interface LineItem {
  description: string;
  qty: number | string;
  rate: number;
  amount: number;
  unit: string;
}

export interface ProductGroup {
  label: string;
  start: number;
  end: number;
  // Optional sales note attached to this product — see CartItem.remark.
  remark?: string;
}

export interface DomainResult {
  label: string;
  domainKey: DomainKey;
  lineItems: LineItem[];
  subtotal: number;
  summary?: SummaryEntry[];
}

export interface CartItem extends DomainResult {
  id: number;
  // Optional free-text note a sales person can attach to this specific
  // product once it's in the quote (e.g. "customer requested faster
  // install"). Shown in the cart list and printed on the PDF/quotation record.
  remark?: string;
}

export interface Discount {
  id: number;
  label: string;
  type: 'percent' | 'flat';
  value: number;
}

export interface CustomProduct {
  id: number;
  name: string;
  qty: number;
  price: number;
}

export interface SiItem {
  id: number;
  name: string;
  qty: number;
  price: number;
}

export interface Totals {
  subtotal: number;
  markup: number;
  markupAmount: number;
  discountTotal: number;
  preGstTotal: number;
  gstAmount: number;
  total: number;
}

export interface SummaryEntry {
  label: string;
  value: string;
  highlight?: boolean;
}

export interface QuotationDetails {
  quotationNumber: string;
  preparedBy: string;
  preparedByPhone: string;
  preparedByEmail: string;
  clientName: string;
  clientCompany: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  projectVertical: string;
  validityDays: number;
  customTerms: string;
}

export interface CostInputs {
  installationCost: number;
  fabricationCost: number;
  scaffoldingCost: number;
  markupPercent: number;
}

// superadmin: full rights (manage users incl. delete, view/delete quotation history, exports).
// admin: can create/edit users and view quotation history, but cannot delete users or quotations.
// manager: same broad visibility as admin across the sales-project pipeline (projects, demos,
//   approvals, etc.) — added for the Sales/Technical/Manager permission split, not a user-management role.
// technical: technical-team login; same own-scoped visibility as "user" today (see note in
//   lib/viewerContext.ts — assignment-based visibility isn't possible while team rosters are
//   free-text names, not real accounts).
// user: can only use the calculator to create quotations; no history or user-management access.
export type UserRole = 'superadmin' | 'admin' | 'manager' | 'technical' | 'user';

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export type PublicUser = Omit<UserRecord, 'passwordHash'>;

export interface QuotationRecord {
  id: string;
  quotation_number: string;
  created_at: string;
  project_id: string;
  prepared_by: string;
  prepared_by_phone: string;
  prepared_by_email: string;
  client_name: string;
  client_company: string;
  client_email: string;
  client_phone: string;
  client_address: string;
  project_vertical: string;
  domain_summary: string;
  products_summary: string;
  products_json: string;
  subtotal: number;
  markup_percent: number;
  discount_total: number;
  gst_amount: number;
  total: number;
  validity_days: number;
  last_follow_up_at: string;
  follow_up_notes_json: string;
}

// Lead-temperature tag captured at registration and revisited on every update.
export type VisitStage = 'hot' | 'warm' | 'cold';

// One entry in a site visit's ongoing project log — added after the initial
// registration, e.g. "team went back, here's what's changed since".
export interface SiteVisitUpdateEntry {
  id: string;
  updated_at: string;
  updated_by: string;
  team_technical: string[];
  team_sales: string[];
  project_details: string;
  ongoing_activities: string;
}

export interface SiteVisitRecord {
  id: string;
  created_at: string;
  created_by: string;
  project_id: string;
  company_name: string;
  contact_person: string;
  client_email: string;
  client_phone: string;
  location: string;
  visit_date: string;
  team_technical: string[];
  team_sales: string[];
  purpose: string;
  category: DomainKey | '';
  visit_details: string;
  image_urls: string[];
  action_plan: string;
  reminder_date: string;
  stage: VisitStage | '';
  status: 'open' | 'closed';
  updates: SiteVisitUpdateEntry[];
  updated_at: string;
}

export interface CrmRecord {
  id: string;
  created_at: string;
  created_by: string;
  company: string;
  contact_person: string;
  phone: string;
  email: string;
  status: 'lead' | 'prospect' | 'customer';
  source: string;
  notes: string;
}

// Sales requests a demo for a domain (picked from the same product list as
// the quotation calculator) plus an optional technical team member; the
// request sits 'pending' until an admin/superadmin (standing in for the
// domain lead — see lib/domainLeads.ts) confirms or rejects it.
export type DemoRequestStatus = 'pending' | 'confirmed' | 'rejected' | 'done' | 'cancelled';

// Filled in after the demo actually happens — separate from `status` (the
// pending/confirmed approval flow above it).
export type DemoOutcome = 'successful' | 'need_followup' | 'pending_decision' | 'cancelled' | '';

export interface DemoScheduleRecord {
  id: string;
  created_at: string;
  created_by: string;
  project_id: string;
  quotation_id: string;
  client_name: string;
  company: string;
  location: string;
  product_domain: DomainKey | '';
  technical_members: string[];
  scheduled_at: string;
  assigned_rep: string;
  status: DemoRequestStatus;
  approved_by: string;
  approved_at: string;
  decision_note: string;
  notes: string;
  // Post-demo report fields — filled in once the demo has taken place.
  demo_objective: string;
  outcome: DemoOutcome;
  customer_rating: number; // 0 = not rated, else 1-5
  key_queries: string;
  technical_challenges: string;
  unanswered_queries: string;
  suggested_next_action: string;
  next_follow_up_date: string;
  attachments: string[];
}

export interface TravelScheduleRecord {
  id: string;
  created_at: string;
  created_by: string;
  origin: string;
  destination: string;
  start_date: string;
  end_date: string;
  purpose: string;
  linked_client: string;
  expense_note: string;
}

// ---------------------------------------------------------------------------
// Sales Project Workflow — a Project is the master record every stage below
// (Site Visit, Quotation, Demo, Customer Response, Negotiation, PO,
// Installation) attaches to via project_id, so a project's full history can
// be reconstructed and shown as one timeline.
// ---------------------------------------------------------------------------

export const PROJECT_STAGES = [
  'site_visit',
  'quotation',
  'demo',
  'customer_response',
  'negotiation',
  'po_received',
  'installation',
  'completed',
  'closed_lost'
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export type ProjectStatus = 'active' | 'on_hold' | 'won' | 'lost';
export type ProjectPriority = 'low' | 'medium' | 'high';

export interface ProjectTimelineEvent {
  id: string;
  at: string;
  by: string;
  stage: ProjectStage | 'created';
  label: string;
  remarks: string;
}

export interface ProjectRecord {
  id: string;
  created_at: string;
  created_by: string;
  client_name: string;
  company: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  sales_person: string;
  status: ProjectStatus;
  stage: ProjectStage;
  priority: ProjectPriority;
  expected_closing_date: string;
  next_follow_up_date: string;
  remarks: string;
  timeline: ProjectTimelineEvent[];
  updated_at: string;
}

export type CustomerResponseType = 'interested' | 'not_interested' | 'need_revision' | 'need_new_quotation' | 'budget_issue' | 'competitor';

export interface CustomerResponseRecord {
  id: string;
  created_at: string;
  created_by: string;
  project_id: string;
  demo_id: string;
  feedback: string;
  response_type: CustomerResponseType | '';
  expected_decision_date: string;
  remarks: string;
}

export interface NegotiationRecord {
  id: string;
  created_at: string;
  created_by: string;
  project_id: string;
  discussion_date: string;
  person: string;
  discussion: string;
  offer_given: string;
  discount: string;
  revised_price: number;
  expected_closure: string;
}

export interface PoRecord {
  id: string;
  created_at: string;
  created_by: string;
  project_id: string;
  po_number: string;
  po_date: string;
  amount: number;
  attachment_url: string;
  advance_received: number;
  payment_terms: string;
}

export type InstallationStatus = 'scheduled' | 'in_progress' | 'completed';

export interface InstallationRecord {
  id: string;
  created_at: string;
  created_by: string;
  project_id: string;
  installation_date: string;
  assigned_engineer: string;
  status: InstallationStatus;
  completion_report: string;
  client_signature: string;
}
