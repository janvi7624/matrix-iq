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
  // Real FK to the assigned person's user account — assigned_technical_person
  // (above) stays a dual-written display/back-compat name string, same
  // pattern as users.department/departmentId. Empty string when unset or on
  // demos created before this field existed.
  assigned_technical_person_id: string;
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

export const MARKETING_PRODUCT_CATEGORIES = [
  'AV',
  'Robotics',
  'AI Video Analytics (Video Management System)',
  'System Integration',
  'VisitIQ VMS (Visitor Management System)'
] as const;
export type MarketingProductCategory = (typeof MARKETING_PRODUCT_CATEGORIES)[number] | string;

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
  | 'approved'
  | 'marketing_in_progress'
  | 'pending_technical_review'
  | 'technical_approved'
  | 'tech_changes_requested'
  | 'marketing_final_review'
  | 'completed'
  | 'timeline_set'
  | 'in_progress'
  | 'waiting_info'
  | 'ready_for_review'
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
  creator_name?: string;
  updated_at: string;
  project_id: string;
  // Marketing member working on this ticket
  assigned_to: string;
  assigned_to_id?: string;
  assigned_to_name?: string;
  // Selected technical team reviewer
  technical_member_id: string;
  technical_member_username: string;
  technical_member_name: string;
  title: string;
  product_category: MarketingProductCategory;
  request_type: MarketingRequestType;
  description: string;
  additional_info: string;
  priority: MarketingRequestPriority;
  needed_by_date: string;
  attachments: string[];
  status: MarketingRequestStatus;
  // Marketing workspace & technical handoff
  marketing_prepared_content: string;
  marketing_attachments: string[];
  marketing_remarks: string;
  technical_instructions: string;
  // Technical review feedback
  technical_review_decision: 'approved' | 'changes_requested' | '';
  technical_remarks: string;
  technical_reviewed_at: string;
  technical_reviewed_by: string;
  // Assignment acceptance — set to 'pending' whenever the Marketing Manager
  // assigns/reassigns this to a marketing member; that member must accept
  // before they can act on it (send-to-technical, final-submission, or
  // self-progress the status). Declining bounces it back to 'submitted' and
  // clears the assignment so the manager can pick someone else. A member
  // claiming an unassigned ticket themselves (status route's 'claim'/'start'
  // actions) never goes through this gate — choosing to claim it already is
  // their availability confirmation.
  assignment_status: 'pending' | 'accepted' | 'declined' | '';
  assignment_decline_reason: string;
  // Final submission to original requester
  final_submission_notes: string;
  final_submission_files: string[];
  // Legacy / metadata fields
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
  assigned_technical_person_id: string;
  assigned_technical_person_name: string;
}

// ---------------------------------------------------------------------------
// Project handover requests
// ---------------------------------------------------------------------------
export type ProjectHandoverStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ProjectHandoverRecord {
  id: string;
  project_id: string;
  from_user_id: string;
  from_username: string;
  from_name: string;
  to_user_id: string;
  to_username: string;
  to_name: string;
  status: ProjectHandoverStatus;
  remarks: string;
  response_remarks: string;
  project_title: string;
  created_at: string;
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
  entity_type: 'demo' | 'delivery_challan' | 'custom_module' | 'lead' | 'quotation' | 'marketing_request' | 'user_import' | 'project' | 'department' | 'tms_project' | 'tms_task' | 'tms_bom_request' | 'tms_procurement';
  entity_id: string;
  action: string;
  previous_status: string;
  new_status: string;
  remarks: string;
  ip: string;
}

// In-app only — no email/SMS integration exists in this app. See
// lib/notificationStore.ts.
export interface NotificationRecord {
  id: string;
  created_at: string;
  title: string;
  body: string;
  type: string;
  entity_type: string;
  entity_id: string;
  is_read: boolean;
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
  // Optional/skippable — no validation requires this to be filled in.
  hsnCode: string;
  serialNumber: string;
  quantity: number;
  // Set only by Back Office — shown on the generated PDF.
  price: number;
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
  // Set only when project_id is empty — a free-text project label Back
  // Office typed in for a manual DC with no real linked Project.
  custom_project_name: string;
  // Empty for a manual DC — Back Office creating one directly with no
  // Sales Request/approval chain behind it.
  demo_id: string;
  client_name: string;
  client_address: string;
  client_phone: string;
  items: DcLineItem[];
  issued_by: string;
  issued_by_phone: string;
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
  // The default person new Marketing Requests are assigned to — set in
  // Administration > Application Settings > Marketing Settings. Empty
  // string when unset (id) / unresolved (username).
  marketingOwnerId: string;
  marketingOwnerUsername: string;
  // Who approves the Finance stage of a TMS BOM Request — set in
  // Application Settings > TMS Settings. Empty when unset (id) / unresolved
  // (username).
  bomFinanceApproverId: string;
  bomFinanceApproverUsername: string;
  updated_at: string;
  updated_by: string;
}

// Fields shared with the browser (quotation PDF generation) — excludes bank
// details, which have no reason to leave the server.
export type PublicAppConfig = Omit<AppConfig, 'bankAccountName' | 'bankAccountNumber' | 'bankIfsc' | 'bankName' | 'bankBranch' | 'notificationTemplates' | 'marketingOwnerId' | 'marketingOwnerUsername' | 'bomFinanceApproverId' | 'bomFinanceApproverUsername' | 'updated_at' | 'updated_by'>;

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
  // Optional department gate layered on top of visibleToRoles — absent/empty
  // means unrestricted (every module except the 7 TMS tiles). See
  // lib/moduleConfigStore.ts's departmentAllowsModule().
  visibleToDepartments?: string[];
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
  // Who manages this department — supports more than one (e.g. Sales has
  // two). Drives demo-schedule domain-manager routing/notifications and
  // Dashboard "awaiting your approval" visibility; not a login-role concept.
  managerIds: string[];
  managerNames: string[];
}

// One row of a role's permission matrix, keyed by module (ModuleConfigRecord.key,
// e.g. 'crm', 'product-master', 'custom:site-inspection').
// 'manage' is the TMS Tab Access "full administrative control of this
// module" bit — also doubles as the exact mechanism for Engineer/Technician
// seeing only their own tasks (see lib/tmsAccess.ts's canManageAllTmsTasks).
export type ModulePermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'print' | 'approve' | 'reject' | 'assign' | 'manage';
export type ModulePermissionSet = Partial<Record<ModulePermissionAction, boolean>>;

export type GlobalCapability = 'manageSettings' | 'manageUsers' | 'manageRoles' | 'manageDepartments' | 'viewAllDepartments';

export interface RolePermissions {
  modules: Record<string, ModulePermissionSet>;
  manageSettings: boolean;
  manageUsers: boolean;
  manageRoles: boolean;
  manageDepartments: boolean;
  // Decoupled from `isPrivileged` (which still gates admin-panel access,
  // pricing-edit rights, and deletes): this is the ONLY thing that decides
  // org-wide vs department-scoped DATA VISIBILITY across Projects,
  // Quotations, Site Visits, Leads, Delivery Challans, and Marketing
  // Requests (see lib/departmentScope.ts). A role without this sees only
  // its own records, plus its managed department(s)' records if any
  // (Department.managerIds) — never every department's data by default.
  viewAllDepartments: boolean;
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

// ---------------------------------------------------------------------------
// TMS (Technical Management System) — a self-contained module for the
// Robotics/AI/AV/Marketing departments (see lib/tmsAccess.ts for the
// department + role gate, lib/tmsProjectStore.ts etc. for the stores). A
// TmsProjectRecord is a TECHNICAL EXECUTION project (team, budget, status
// Planning/Not Started/In Progress/On Hold/Completed/Cancelled) — a
// deliberately separate concept from ProjectRecord above (the sales
// pipeline), not a variant of it. No time-tracking/hours/billable field
// exists anywhere in this module by explicit product requirement — do not
// add one.
// ---------------------------------------------------------------------------

export type TmsProjectStatus = 'planning' | 'not_started' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
export type TmsPriority = 'low' | 'medium' | 'high';

export interface TmsProjectRecord {
  id: string;
  project_code: string;
  created_at: string;
  created_by: string;
  name: string;
  client_name: string;
  client_contact: string;
  description: string;
  department_id: string;
  department_name: string;
  project_manager_id: string;
  project_manager_name: string;
  team_member_ids: string[];
  team_member_names: string[];
  start_date: string;
  estimated_close_date: string;
  actual_close_date: string;
  budget: number;
  status: TmsProjectStatus;
  priority: TmsPriority;
  progress_percent: number;
  remarks: string;
  attachments: string[];
  updated_at: string;
}

export type TmsTaskStatus = 'to_do' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';

export interface TmsTaskRecord {
  id: string;
  created_at: string;
  created_by: string;
  project_id: string;
  project_name: string;
  name: string;
  assignee_id: string;
  assignee_name: string;
  department_id: string;
  department_name: string;
  description: string;
  priority: TmsPriority;
  status: TmsTaskStatus;
  start_date: string;
  due_date: string;
  completion_date: string;
  remarks: string;
  attachments: string[];
  updated_at: string;
}

// Full chain: draft -> submitted -> approved (Technical Manager) ->
// finance_approved (the configured Finance Approver) -> payment_done
// (Accounts, with a payment-proof attachment) -> received (the original
// requester confirms material in hand). rejected is reachable from
// 'submitted'/'under_review' (Technical Manager) or 'approved' (Finance
// Approver) — terminal either way. sent_for_procurement/completed remain
// the separate, pre-existing Procurement-handoff path off 'approved',
// unrelated to (and not required before) the finance/payment chain.
export type TmsBomRequestStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'admin_approved'
  | 'finance_approved'
  | 'payment_done'
  | 'received'
  | 'rejected'
  | 'sent_for_procurement'
  | 'completed';

export interface TmsBomRequestRecord {
  id: string;
  bom_request_code: string;
  created_at: string;
  created_by: string;
  project_id: string;
  project_name: string;
  requested_by_id: string;
  requested_by_name: string;
  department_id: string;
  department_name: string;
  request_date: string;
  required_date: string;
  item_name: string;
  item_description: string;
  part_number: string;
  quantity: number;
  specification: string;
  preferred_brand: string;
  estimated_cost: number;
  remarks: string;
  attachments: string[];
  status: TmsBomRequestStatus;
  rejection_reason: string;
  reviewed_by_id: string;
  reviewed_by_name: string;
  reviewed_at: string;
  admin_reviewed_by_id: string;
  admin_reviewed_by_name: string;
  admin_reviewed_at: string;
  finance_reviewed_by_id: string;
  finance_reviewed_by_name: string;
  finance_reviewed_at: string;
  payment_marked_by_id: string;
  payment_marked_by_name: string;
  payment_marked_at: string;
  payment_proof_attachments: string[];
  received_by_id: string;
  received_by_name: string;
  received_at: string;
  updated_at: string;
  // Viewer-specific, not persisted — computed fresh per request by the
  // GET /api/tms/bom-requests/[id] route so the detail page can gate its
  // Approve/Reject/Approve (Finance) actions to who the server would
  // actually accept them from, instead of showing them to every viewer.
  viewer_can_approve?: boolean;
  viewer_can_reject?: boolean;
  viewer_can_admin_approve?: boolean;
  viewer_can_finance_approve?: boolean;
}

export type TmsPurchaseStatus = 'requested' | 'quotation_required' | 'quotation_received' | 'approval_pending' | 'approved' | 'po_created' | 'ordered' | 'cancelled';
export type TmsDeliveryStatus = 'pending' | 'partially_received' | 'received' | 'cancelled';

export interface TmsProcurementRecord {
  id: string;
  procurement_code: string;
  created_at: string;
  created_by: string;
  project_id: string;
  project_name: string;
  bom_request_id: string;
  bom_request_code: string;
  item_name: string;
  part_number: string;
  quantity: number;
  vendor: string;
  estimated_cost: number;
  quoted_cost: number;
  final_cost: number;
  request_date: string;
  required_date: string;
  expected_delivery_date: string;
  actual_delivery_date: string;
  purchase_status: TmsPurchaseStatus;
  delivery_status: TmsDeliveryStatus;
  remarks: string;
  documents: string[];
  updated_at: string;
}
