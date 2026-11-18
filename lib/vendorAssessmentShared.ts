// Vendor Assessment — client-safe constants and types (no db imports), shared
// by the form, the API and the store.

export const VENDOR_CATEGORIES = ['AV', 'AI', 'Robotics'] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const VENDOR_RELATIONS = [
  { key: 'trading', label: 'Trading partner' },
  { key: 'distribution', label: 'Distribution partner' },
  { key: 'joint_venture', label: 'Joint Venture' },
  { key: 'project', label: 'Project partner only' }
] as const;
export type VendorRelation = (typeof VENDOR_RELATIONS)[number]['key'];

export const VENDOR_CONTACT_ROLES = [
  { key: 'management', label: 'Management' },
  { key: 'purchase', label: 'Purchase' },
  { key: 'finance', label: 'Finance' },
  { key: 'logistics', label: 'Logistics' }
] as const;
export type VendorContactRole = (typeof VENDOR_CONTACT_ROLES)[number]['key'];

export interface VendorContact {
  name: string;
  email: string;
  mobile: string;
  landline: string;
}

export const EMPTY_CONTACT: VendorContact = { name: '', email: '', mobile: '', landline: '' };

// "Signed copy of" — one upload slot each, attached once.
export const VENDOR_DOCUMENTS = [
  { key: 'distribution', label: 'Distribution agreement' },
  { key: 'trading', label: 'Trading partner agreement' },
  { key: 'joint_venture', label: 'Joint venture agreement' },
  { key: 'commercial', label: 'Business commercial agreement' }
] as const;
export type VendorDocumentKey = (typeof VENDOR_DOCUMENTS)[number]['key'];

export interface VendorFile {
  name: string;
  url: string;
}

// Approval: VP/GM Sales -> Finance -> MD (overview & legalisation).
export const VENDOR_APPROVAL_STAGES = ['sales', 'finance', 'md'] as const;
export type VendorApprovalStage = (typeof VENDOR_APPROVAL_STAGES)[number];

export const VENDOR_STAGE_LABEL: Record<VendorApprovalStage, string> = {
  sales: 'VP / GM Sales',
  finance: 'Finance',
  md: 'MD'
};

// The Department Master department whose manager signs each step.
export const VENDOR_STAGE_DEPARTMENT: Record<VendorApprovalStage, string> = {
  sales: 'Sales',
  finance: 'Accounts',
  md: 'Management'
};

export type VendorStatus = 'pending' | 'approved' | 'rejected';

export interface VendorTrailEntry {
  stage: VendorApprovalStage;
  decision: 'approved' | 'rejected';
  by_id: string;
  by_name: string;
  at: string;
  remarks: string;
}

export interface VendorAssessmentRecord {
  id: string;
  company_name: string;
  address: string;
  contacts: Record<VendorContactRole, VendorContact>;
  business_purpose: string;
  categories: VendorCategory[];
  relation_type: VendorRelation;
  collaboration_date: string | null;
  agreement_period: string;
  documents: Partial<Record<VendorDocumentKey, VendorFile[]>>;
  project_deal_details: string;
  initiated_by_ids: string[];
  initiated_by_names: string[];
  overview_remarks: string;
  approval_stage: VendorApprovalStage | null;
  status: VendorStatus;
  approval_trail: VendorTrailEntry[];
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export function nextVendorStage(stage: VendorApprovalStage): VendorApprovalStage | null {
  const i = VENDOR_APPROVAL_STAGES.indexOf(stage);
  return VENDOR_APPROVAL_STAGES[i + 1] ?? null;
}

export function isVendorStage(v: unknown): v is VendorApprovalStage {
  return typeof v === 'string' && (VENDOR_APPROVAL_STAGES as readonly string[]).includes(v);
}

export function relationLabel(key: string): string {
  return VENDOR_RELATIONS.find((r) => r.key === key)?.label ?? key;
}
