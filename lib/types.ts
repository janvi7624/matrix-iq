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

// Roles are admin-defined from the UI (see lib/roleStore.ts / Role Management)
// — this is a plain string key matching RoleRecord.key, not a fixed union.
// Six built-in system roles are always seeded and keep these exact keys so
// every pre-existing role check in the app keeps working unchanged:
// superadmin: full rights (manage users incl. delete, view/delete quotation history, exports).
// admin: can create/edit users and view quotation history, but cannot delete users or quotations.
// manager: same broad visibility as admin across the sales-project pipeline (projects, demos,
//   approvals, etc.) — added for the Sales/Technical/Manager permission split, not a user-management role.
// technical: technical-team login; same own-scoped visibility as "user" today (see note in
//   lib/viewerContext.ts — assignment-based visibility isn't possible while team rosters are
//   free-text names, not real accounts).
// backoffice: prepares/dispatches/closes Delivery Challans once a demo request clears manager
//   approval; same own-scoped general visibility as "user"/"technical", but with Back Office
//   module access.
// user: can only use the calculator to create quotations; no history or user-management access.
// Any additional role an admin creates in Role Management is just another string key here,
// with its own isPrivileged tier and permission matrix (see RoleRecord below).
export type UserRole = string;

// active: can log in normally. inactive: login is blocked (verifyLogin rejects it) —
// used instead of deleting an account so history/attribution (created_by, audit log,
// etc.) stays intact for someone who's left or is on leave.
export type UserStatus = 'active' | 'inactive';

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  employeeId: string;
  department: string;
  designation: string;
  location: string;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string;
  // True only for accounts created via bulk employee import until the
  // employee changes their temporary password (see lib/auth.ts, proxy.ts).
  mustChangePassword: boolean;
}

export type PublicUser = Omit<UserRecord, 'passwordHash'>;

// Append-only login attempt log — separate from the Back Office audit log
// since it's keyed by username/pre-session rather than by entity id.
export interface LoginHistoryEntry {
  id: string;
  username: string;
  at: string;
  success: boolean;
  ip: string;
}

// draft: saved but not yet finalized. sent: PDF generated/handed to client (default on save).
// approved/rejected: client decision recorded manually. "Expired" isn't stored — it's computed
// from validity_days vs created_at whenever status is still 'sent' (see quotationStore.ts).
export type QuotationStatus = 'draft' | 'sent' | 'approved' | 'rejected';
export type QuotationEffectiveStatus = QuotationStatus | 'expired';

export interface QuotationRecord {
  id: string;
  quotation_number: string;
  created_at: string;
  project_id: string;
  created_by: string;
  status: QuotationStatus;
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
  // Quotation versioning (section 23) — '' / 0 for an original quotation.
  // A revision points original_quotation_id at the ROOT original's id (not
  // the previous revision), so "every version of QT-00123" is one filter.
  // quotation_number for a revision is the root's number with a .01/.02/...
  // suffix appended; the root's own quotation_number/fields are never edited.
  original_quotation_id: string;
  revision_number: number;
  revision_reason: string;
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
  products_interested: string[];
  visit_details: string;
  image_urls: string[];
  action_plan: string;
  reminder_date: string;
  stage: VisitStage | '';
  status: 'open' | 'closed';
  updates: SiteVisitUpdateEntry[];
  updated_at: string;
}

// Back Office workflow (see lib/domainLeads.ts for the informational lead
// label): Sales creates a request (draft or straight to pending_technical) →
// assigned Technical person approves/rejects/reschedules availability →
// Manager approves/rejects/modifies → approved requests move to Back Office,
// which generates a Delivery Challan, dispatches materials, and — once the
// demo happens and materials come back — verifies and closes the DC.
export type DemoRequestStatus =
  | 'draft'
  | 'pending_technical'
  | 'pending_manager'
  | 'pending_backoffice'
  | 'dc_generated'
  | 'material_dispatched'
  | 'demo_completed'
  | 'material_returned'
  | 'dc_closed'
  | 'cancelled';

export type DemoPriority = 'low' | 'medium' | 'high';

// Filled in after the demo actually happens — separate from `status` (the
// approval/fulfillment pipeline above it).
export type DemoOutcome = 'successful' | 'need_followup' | 'pending_decision' | 'cancelled' | '';

export interface DemoProductLine {
  product: string;
  quantity: number;
}

export interface DemoTechnicalApproval {
  decision: 'approved' | 'rejected' | 'reschedule' | '';
  availability: 'available' | 'not_available' | '';
  remarks: string;
  expected_arrival_time: string;
  decided_by: string;
  decided_at: string;
}

export interface DemoManagerApproval {
  decision: 'approved' | 'rejected' | 'modified' | '';
  remarks: string;
  reassigned_engineer: string;
  decided_by: string;
  decided_at: string;
}

export interface DemoScheduleRecord {
  id: string;
  created_at: string;
  created_by: string;
  project_id: string;
  quotation_id: string;
  client_name: string;
  company: string;
  location: string;
  product_domains: DomainKey[];
  products_demonstrated: string[];
  products_required: DemoProductLine[];
  priority: DemoPriority;
  assigned_technical_person: string;
  technical_members: string[];
  scheduled_at: string;
  assigned_rep: string;
  status: DemoRequestStatus;
  technical_approval: DemoTechnicalApproval;
  manager_approval: DemoManagerApproval;
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
// Marketing Requests — any employee asks the Marketing team for something
// (brochure, banner, social post, video, etc.); a reviewer (Manager+, or a
// role explicitly granted the "approve" capability on this module — see
// lib/permissions.ts's isModuleActionAllowed) commits a delivery timeline
// that then becomes permanently locked. There is no edit/override path for
// `timeline` anywhere in the app once it's set — see set-timeline route.
// ---------------------------------------------------------------------------

export type MarketingRequestType =
  | 'brochure_flyer'
  | 'social_media'
  | 'banner_standee'
  | 'video_reel'
  | 'email_campaign'
  | 'website_update'
  | 'product_photography'
  | 'event_collateral'
  | 'other';

export type MarketingRequestPriority = 'low' | 'medium' | 'high' | 'urgent';

export type MarketingRequestStatus =
  | 'submitted'
  | 'timeline_set'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface MarketingRequestTimeline {
  expectedDeliveryDate: string;
  setBy: string;
  setAt: string;
  remarks: string;
}

export interface MarketingRequestComment {
  id: string;
  at: string;
  by: string;
  text: string;
}

export interface MarketingRequestRecord {
  id: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  project_id: string;
  title: string;
  request_type: MarketingRequestType;
  description: string;
  priority: MarketingRequestPriority;
  needed_by_date: string;
  attachments: string[];
  status: MarketingRequestStatus;
  // null until a reviewer commits it — once non-null, permanently locked.
  timeline: MarketingRequestTimeline | null;
  rejection_reason: string;
  completion_notes: string;
  delivered_files: string[];
  comments: MarketingRequestComment[];
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

export interface ProjectNote {
  id: string;
  at: string;
  by: string;
  text: string;
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
  // Where this project/contact originated (referral, website, cold call...) —
  // carried over from the retired CRM module (section 23), which had this as
  // its one distinct field beyond what Projects already tracked.
  source: string;
  status: ProjectStatus;
  stage: ProjectStage;
  priority: ProjectPriority;
  expected_closing_date: string;
  next_follow_up_date: string;
  remarks: string;
  notes: ProjectNote[];
  attachments: string[];
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

// Append-only record of every status-changing action across the Back Office
// workflow (demo approvals, DC lifecycle) — see lib/auditLogStore.ts.
export interface AuditLogEntry {
  id: string;
  at: string;
  by: string;
  role: UserRole;
  entity_type: 'demo' | 'delivery_challan' | 'custom_module' | 'lead' | 'quotation' | 'marketing_request' | 'user_import';
  entity_id: string;
  action: string;
  previous_status: string;
  new_status: string;
  remarks: string;
  ip: string;
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

// ---------------------------------------------------------------------------
// Back Office — Delivery Challan (DC). Generated once a demo request clears
// manager approval; tracks materials out, dispatch, and — after the demo —
// verified return and closure. See lib/deliveryChallanStore.ts.
// ---------------------------------------------------------------------------

export type DcStatus = 'prepared' | 'dispatched' | 'returned' | 'closed';

export interface DcLineItem {
  product: string;
  serialNumber: string;
  quantity: number;
}

// One of the fixed example tags from the spec, or 'custom' for free text.
export type BackOfficeRemarkTag =
  | 'good_condition'
  | 'minor_scratch'
  | 'major_damage'
  | 'adapter_missing'
  | 'power_cable_missing'
  | 'wrong_serial_number'
  | 'packing_damaged'
  | 'custom';

export interface MaterialReturnChecklist {
  returned: boolean;
  condition: 'good' | 'minor_damage' | 'major_damage' | '';
  missing: boolean;
  damaged: boolean;
  accessories: {
    powerCable: boolean;
    remote: boolean;
    adapter: boolean;
    stand: boolean;
    packing: boolean;
  };
  serialNumberVerified: boolean;
  remarkTags: BackOfficeRemarkTag[];
  remarks: string;
}

export interface DeliveryChallanRecord {
  id: string;
  dc_number: string;
  created_at: string;
  created_by: string;
  project_id: string;
  demo_id: string;
  client_name: string;
  items: DcLineItem[];
  issued_by: string;
  issued_date: string;
  expected_return_date: string;
  assigned_engineer: string;
  status: DcStatus;
  material_return: MaterialReturnChecklist;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// No-code admin configuration (section 19) — Application Configuration,
// Product Master, Module Manager, Custom Module Builder.
// ---------------------------------------------------------------------------

export interface NotificationTemplate {
  key: string;
  label: string;
  subject: string;
  body: string;
}

// Single JSON blob of business settings an Admin can edit without a code
// change — company/GST/bank details, tax, quotation T&Cs, and the DC number
// prefix. Notification templates are stored here too, but nothing actually
// sends email today (no SMTP integration exists) — they're plain text with
// {{placeholder}} tokens, ready for whenever that's wired up.
export interface AppConfig {
  companyName: string;
  companyLegalName: string;
  gstNumber: string;
  panNumber: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  contactPhone: string;
  contactEmail: string;
  website: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
  bankBranch: string;
  currencyCode: string;
  currencySymbol: string;
  defaultTaxPercent: number;
  taxLabel: string;
  quotationTerms: string[];
  dcNumberPrefix: string;
  notificationTemplates: NotificationTemplate[];
  updated_at: string;
  updated_by: string;
}

// Fields shared with the browser (quotation PDF generation) — excludes bank
// details, which have no reason to leave the server.
export type PublicAppConfig = Omit<AppConfig, 'bankAccountName' | 'bankAccountNumber' | 'bankIfsc' | 'bankName' | 'bankBranch' | 'notificationTemplates' | 'updated_at' | 'updated_by'>;

export type ProductStatus = 'active' | 'inactive';

export interface ProductRecord {
  id: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  name: string;
  sku: string;
  category: string;
  brand: string;
  description: string;
  unit: string;
  defaultQty: number;
  basePrice: number;
  sellingPrice: number;
  taxPercent: number;
  hsnSac: string;
  discountPercent: number;
  imageUrl: string;
  status: ProductStatus;
}

// Drives the Dashboard tiles / sidebar for both built-in routes and enabled
// custom modules — Admin manages this from Module Manager instead of it
// being hardcoded per component. `key` for a built-in module matches the
// hardcoded id it used to have (e.g. 'projects', 'quotation'); custom module
// keys are `custom:<CustomModuleDef.key>`.
export interface ModuleConfigRecord {
  id: string;
  key: string;
  label: string;
  desc: string;
  icon: string;
  href: string;
  section: string;
  order: number;
  enabled: boolean;
  isCustom: boolean;
  visibleToRoles: UserRole[];
}

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'time'
  | 'dropdown'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'textarea'
  | 'richtext'
  | 'email'
  | 'phone'
  | 'file'
  | 'image'
  | 'user'
  | 'project'
  | 'product';

export interface CustomFieldDef {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options: string[]; // dropdown / multiselect / radio choices
  order: number;
}

// A module defined entirely from the UI (Custom Module Builder) — one
// generic engine (app/modules/[key]) renders list/detail/create/edit for
// every CustomModuleDef instead of generating per-module code/routes/tables,
// since Next.js file-based routing can't create new routes at runtime.
export interface CustomModuleDef {
  id: string;
  key: string;
  name: string;
  icon: string;
  section: string;
  created_at: string;
  created_by: string;
  fields: CustomFieldDef[];
  requiresApproval: boolean;
  approverRole: UserRole | '';
  enabled: boolean;
}

export type CustomRecordStatus = 'active' | 'pending_approval' | 'approved' | 'rejected';

export interface CustomModuleRecord {
  id: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  status: CustomRecordStatus;
  values: Record<string, unknown>;
  attachments: string[];
}

// ---------------------------------------------------------------------------
// Lead Capture (section 20) — converted from the standalone "Nanta Leads"
// event/trade-show lead-capture HTML tool into a native module. Same
// created_by-owned pattern as every other record store.
// ---------------------------------------------------------------------------

export type LeadPriority = 'hot' | 'warm' | 'cool' | '';

export interface LeadRecord {
  id: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  name: string;
  mobile: string;
  email: string;
  designation: string;
  company: string;
  city: string;
  card_image_url: string;
  interests: DomainKey[];
  sub_interests: string[];
  priority: LeadPriority;
  follow_up_actions: string[];
  budget: string;
  notes: string;
  // Set once "Convert to Project" runs (section 23 — CRM was merged into
  // Projects, so this is now the single "already converted" marker;
  // previously there was a separate crm_id for a since-retired CRM module).
  project_id: string;
}

// ---------------------------------------------------------------------------
// Department Master & dynamic Role Management (section 21) — replaces the
// free-text Department field and the fixed UserRole union with UI-managed
// masters. See lib/departmentStore.ts / lib/roleStore.ts / lib/permissions.ts.
// ---------------------------------------------------------------------------

export type DepartmentStatus = 'active' | 'inactive';

export interface DepartmentRecord {
  id: string;
  name: string;
  description: string;
  order: number;
  status: DepartmentStatus;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

// One row of a role's permission matrix, keyed by module (ModuleConfigRecord.key,
// e.g. 'crm', 'product-master', 'custom:site-inspection').
export type ModulePermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'print' | 'approve' | 'reject' | 'assign';
export type ModulePermissionSet = Partial<Record<ModulePermissionAction, boolean>>;

export type GlobalCapability = 'manageSettings' | 'manageUsers' | 'manageRoles' | 'manageDepartments';

export interface RolePermissions {
  modules: Record<string, ModulePermissionSet>;
  manageSettings: boolean;
  manageUsers: boolean;
  manageRoles: boolean;
  manageDepartments: boolean;
}

export type RoleStatus = 'active' | 'inactive';

export interface RoleRecord {
  id: string;
  key: string; // stable slug — this is what UserRecord.role stores
  label: string;
  description: string;
  isSystem: boolean; // one of the 6 built-in roles — key can't change, can't be deleted
  isPrivileged: boolean; // reaches /admin/* and sees org-wide data, not just own records
  status: RoleStatus;
  order: number;
  permissions: RolePermissions;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}
