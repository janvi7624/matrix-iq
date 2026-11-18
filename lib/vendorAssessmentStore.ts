import { QueryTypes } from 'sequelize';
import { sequelize } from './db';
import { listDepartmentManagers } from './departmentStore';
import {
  EMPTY_CONTACT,
  VENDOR_APPROVAL_STAGES,
  VENDOR_CATEGORIES,
  VENDOR_CONTACT_ROLES,
  VENDOR_DOCUMENTS,
  VENDOR_RELATIONS,
  VENDOR_STAGE_DEPARTMENT,
  VendorApprovalStage,
  VendorAssessmentRecord,
  VendorContact,
  VendorContactRole,
  VendorFile,
  VendorTrailEntry,
  nextVendorStage
} from './vendorAssessmentShared';

// Vendor Assessment storage (table vendor_assessments — see
// db/migrations/20261118120000-create-vendor-assessments.js). Raw SQL, the
// same way lib/appreciationStore.ts does it: a deploy that lands before the
// migration breaks only this module, with a clear message.

export class VendorAssessmentsUnavailableError extends Error {
  constructor() {
    super('Vendor Assessment is not set up yet — the database update has not been applied.');
  }
}
export class VendorAssessmentError extends Error {}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const e = error as { original?: { code?: string }; parent?: { code?: string } };
    if ((e?.original?.code ?? e?.parent?.code) === '42P01') throw new VendorAssessmentsUnavailableError();
    throw error;
  }
}

const COLUMNS = `id, company_name, address, contacts, business_purpose, categories, relation_type,
  to_char(collaboration_date, 'YYYY-MM-DD') AS collaboration_date, agreement_period, documents,
  project_deal_details, initiated_by_ids, overview_remarks, approval_stage, status, approval_trail,
  created_by, created_by_name, created_at, updated_at`;

type Row = Omit<VendorAssessmentRecord, 'initiated_by_names'>;

async function withNames(rows: Row[]): Promise<VendorAssessmentRecord[]> {
  const ids = [...new Set(rows.flatMap((r) => (Array.isArray(r.initiated_by_ids) ? r.initiated_by_ids : [])))];
  const names = new Map<string, string>();
  if (ids.length) {
    const users = await sequelize.query<{ id: string; name: string }>('SELECT id, name FROM users WHERE id IN (:ids)', {
      replacements: { ids },
      type: QueryTypes.SELECT
    });
    users.forEach((u) => names.set(u.id, u.name));
  }
  return rows.map((r) => ({ ...r, initiated_by_names: (r.initiated_by_ids || []).map((id) => names.get(id) || '').filter(Boolean) }));
}

export async function listVendorAssessments(): Promise<VendorAssessmentRecord[]> {
  return run(async () => {
    const rows = await sequelize.query<Row>(`SELECT ${COLUMNS} FROM vendor_assessments ORDER BY created_at DESC`, { type: QueryTypes.SELECT });
    return withNames(rows);
  });
}

export async function findVendorAssessment(id: string): Promise<VendorAssessmentRecord | null> {
  return run(async () => {
    const rows = await sequelize.query<Row>(`SELECT ${COLUMNS} FROM vendor_assessments WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
    return rows[0] ? (await withNames(rows))[0] : null;
  });
}

// ---------- input validation ----------

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface VendorAssessmentInput {
  company_name: string;
  address: string;
  contacts: Record<VendorContactRole, VendorContact>;
  business_purpose: string;
  categories: string[];
  relation_type: string;
  collaboration_date: string | null;
  agreement_period: string;
  documents: Record<string, VendorFile[]>;
  project_deal_details: string;
  initiated_by_ids: string[];
  overview_remarks: string;
}

export function validateVendorInput(body: unknown): { ok: true; value: VendorAssessmentInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const company_name = str(b.company_name, 255);
  if (!company_name) return { ok: false, error: 'Company name is required.' };

  const rawContacts = (b.contacts && typeof b.contacts === 'object' ? b.contacts : {}) as Record<string, Record<string, unknown>>;
  const contacts = {} as Record<VendorContactRole, VendorContact>;
  for (const { key } of VENDOR_CONTACT_ROLES) {
    const c = rawContacts[key] || {};
    contacts[key] = { ...EMPTY_CONTACT, name: str(c.name, 255), email: str(c.email, 255), mobile: str(c.mobile, 40), landline: str(c.landline, 40) };
    if (contacts[key].email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacts[key].email)) {
      return { ok: false, error: `Check the ${key} contact's email address.` };
    }
  }
  if (!VENDOR_CONTACT_ROLES.some(({ key }) => contacts[key].name)) return { ok: false, error: 'Add at least one contact person.' };

  const categories = (Array.isArray(b.categories) ? b.categories : []).filter((c): c is string => (VENDOR_CATEGORIES as readonly string[]).includes(c as string));
  if (!categories.length) return { ok: false, error: 'Choose at least one category (AV / AI / Robotics).' };

  const relation_type = str(b.relation_type, 40);
  if (!VENDOR_RELATIONS.some((r) => r.key === relation_type)) return { ok: false, error: 'Choose the Nanta relation.' };

  const date = str(b.collaboration_date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Collaboration date is not valid.' };

  const rawDocs = (b.documents && typeof b.documents === 'object' ? b.documents : {}) as Record<string, unknown>;
  const documents: Record<string, VendorFile[]> = {};
  for (const { key } of VENDOR_DOCUMENTS) {
    const files = Array.isArray(rawDocs[key]) ? (rawDocs[key] as Record<string, unknown>[]) : [];
    const clean = files
      .map((f) => ({ name: str(f?.name, 255) || 'document', url: str(f?.url, 1000) }))
      .filter((f) => f.url.startsWith('uploads/vendor-assessments/') || f.url.startsWith('/uploads/vendor-assessments/') || /\/uploads\/vendor-assessments\//.test(f.url));
    if (clean.length) documents[key] = clean.slice(0, 10);
  }

  const initiated_by_ids = (Array.isArray(b.initiated_by_ids) ? b.initiated_by_ids : [])
    .filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v))
    .slice(0, 30);
  if (!initiated_by_ids.length) return { ok: false, error: 'Choose who in the Nanta team initiated this.' };

  return {
    ok: true,
    value: {
      company_name,
      address: str(b.address, 2000),
      contacts,
      business_purpose: str(b.business_purpose),
      categories,
      relation_type,
      collaboration_date: date || null,
      agreement_period: str(b.agreement_period, 255),
      documents,
      project_deal_details: str(b.project_deal_details, 8000),
      initiated_by_ids: [...new Set(initiated_by_ids)],
      overview_remarks: str(b.overview_remarks, 8000)
    }
  };
}

function jsonParams(v: VendorAssessmentInput) {
  return {
    ...v,
    contacts: JSON.stringify(v.contacts),
    categories: JSON.stringify(v.categories),
    documents: JSON.stringify(v.documents),
    initiated_by_ids: JSON.stringify(v.initiated_by_ids)
  };
}

export async function createVendorAssessment(v: VendorAssessmentInput, by: { id: string; name: string }): Promise<VendorAssessmentRecord> {
  return run(async () => {
    const rows = await sequelize.query<{ id: string }>(
      `INSERT INTO vendor_assessments (company_name, address, contacts, business_purpose, categories, relation_type,
         collaboration_date, agreement_period, documents, project_deal_details, initiated_by_ids, overview_remarks,
         approval_stage, status, created_by, created_by_name)
       VALUES (:company_name, :address, CAST(:contacts AS jsonb), :business_purpose, CAST(:categories AS jsonb), :relation_type,
         :collaboration_date, :agreement_period, CAST(:documents AS jsonb), :project_deal_details, CAST(:initiated_by_ids AS jsonb),
         :overview_remarks, 'sales', 'pending', :created_by, :created_by_name)
       RETURNING id`,
      { replacements: { ...jsonParams(v), created_by: by.id, created_by_name: by.name }, type: QueryTypes.SELECT }
    );
    return (await findVendorAssessment(rows[0].id))!;
  });
}

/** Edit — restarts approval from VP/GM Sales, since approvers saw the old version. */
export async function updateVendorAssessment(id: string, v: VendorAssessmentInput): Promise<VendorAssessmentRecord | null> {
  return run(async () => {
    await sequelize.query(
      `UPDATE vendor_assessments SET company_name = :company_name, address = :address, contacts = CAST(:contacts AS jsonb),
         business_purpose = :business_purpose, categories = CAST(:categories AS jsonb), relation_type = :relation_type,
         collaboration_date = :collaboration_date, agreement_period = :agreement_period, documents = CAST(:documents AS jsonb),
         project_deal_details = :project_deal_details, initiated_by_ids = CAST(:initiated_by_ids AS jsonb),
         overview_remarks = :overview_remarks, approval_stage = 'sales', status = 'pending', updated_at = NOW()
       WHERE id = :id`,
      { replacements: { ...jsonParams(v), id } }
    );
    return findVendorAssessment(id);
  });
}

export async function deleteVendorAssessment(id: string): Promise<void> {
  await run(() => sequelize.query('DELETE FROM vendor_assessments WHERE id = :id', { replacements: { id } }));
}

// ---------- approval chain ----------

export async function vendorStageApprovers(): Promise<Record<VendorApprovalStage, { id: string; username: string; name: string }[]>> {
  const managers = await listDepartmentManagers();
  const out = {} as Record<VendorApprovalStage, { id: string; username: string; name: string }[]>;
  for (const s of VENDOR_APPROVAL_STAGES) out[s] = managers[VENDOR_STAGE_DEPARTMENT[s]] ?? [];
  return out;
}

export async function decideVendorAssessment(input: {
  id: string;
  stage: VendorApprovalStage;
  decision: 'approved' | 'rejected';
  by: { id: string; name: string };
  remarks: string;
}): Promise<{ record: VendorAssessmentRecord; next: VendorApprovalStage | null }> {
  const remarks = input.remarks.trim().slice(0, 2000);
  if (input.decision === 'rejected' && !remarks) throw new VendorAssessmentError('Add a remark saying why it is rejected.');
  return run(async () =>
    sequelize.transaction(async (t) => {
      const rows = await sequelize.query<{ approval_stage: string | null; approval_trail: VendorTrailEntry[] }>(
        'SELECT approval_stage, approval_trail FROM vendor_assessments WHERE id = :id FOR UPDATE',
        { replacements: { id: input.id }, type: QueryTypes.SELECT, transaction: t }
      );
      if (!rows[0]) throw new VendorAssessmentError('Vendor assessment not found.');
      if (rows[0].approval_stage !== input.stage) throw new VendorAssessmentError('This step is not awaiting a decision — refresh and try again.');
      const entry: VendorTrailEntry = { stage: input.stage, decision: input.decision, by_id: input.by.id, by_name: input.by.name, at: new Date().toISOString(), remarks };
      const trail = [...(rows[0].approval_trail || []), entry];
      const next = input.decision === 'approved' ? nextVendorStage(input.stage) : null;
      const status = input.decision === 'rejected' ? 'rejected' : next ? 'pending' : 'approved';
      await sequelize.query(
        'UPDATE vendor_assessments SET approval_stage = :next, status = :status, approval_trail = CAST(:trail AS jsonb), updated_at = NOW() WHERE id = :id',
        { replacements: { id: input.id, next, status, trail: JSON.stringify(trail) }, transaction: t }
      );
      return { next, record: null as unknown as VendorAssessmentRecord };
    })
  ).then(async (r) => ({ ...r, record: (await findVendorAssessment(input.id))! }));
}
