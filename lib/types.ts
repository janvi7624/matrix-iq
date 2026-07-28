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
// user: can only use the calculator to create quotations; no history or user-management access.
export type UserRole = 'superadmin' | 'admin' | 'user';

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
  company_name: string;
  contact_person: string;
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

export interface DemoScheduleRecord {
  id: string;
  created_at: string;
  created_by: string;
  client_name: string;
  product_domain: string;
  scheduled_at: string;
  assigned_rep: string;
  status: 'scheduled' | 'done' | 'cancelled';
  notes: string;
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
