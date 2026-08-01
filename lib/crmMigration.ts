import { readJsonBlob, writeJsonBlob } from './blobStore';
import { ProjectRecord } from './types';

const CRM_PATHNAME = 'data/crm.json';
const PROJECTS_PATHNAME = 'data/projects.json';

// The one-off shape of a legacy CrmRecord — CrmRecord itself was removed
// from lib/types.ts when CRM was merged into Projects (section 23); this
// local type only exists to read whatever's still sitting in data/crm.json.
interface LegacyCrmRecord {
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

// Idempotent: reads whatever's left in the retired CRM blob, folds each
// contact into a new Project (so no data is lost when the CRM menu goes
// away), then empties the CRM blob so this never re-runs. Safe to call on
// every /api/projects GET — after the first run it's just one cheap read of
// an empty array.
export async function migrateCrmToProjects(): Promise<number> {
  const legacyCrm = await readJsonBlob<LegacyCrmRecord[]>(CRM_PATHNAME, []);
  if (legacyCrm.length === 0) return 0;

  const projects = await readJsonBlob<ProjectRecord[]>(PROJECTS_PATHNAME, []);
  const migrated: ProjectRecord[] = legacyCrm.map((c) => {
    const now = new Date().toISOString();
    return {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      created_at: c.created_at,
      created_by: c.created_by,
      client_name: c.contact_person,
      company: c.company,
      contact_person: c.contact_person,
      phone: c.phone,
      email: c.email,
      address: '',
      sales_person: c.created_by,
      source: c.source,
      status: 'active',
      stage: 'site_visit',
      priority: 'medium',
      expected_closing_date: '',
      next_follow_up_date: '',
      remarks: c.notes,
      notes: [],
      attachments: [],
      timeline: [{ id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`, at: c.created_at, by: c.created_by, stage: 'created', label: `Migrated from CRM (was "${c.status}")`, remarks: c.notes }],
      updated_at: now
    };
  });

  await writeJsonBlob(PROJECTS_PATHNAME, [...projects, ...migrated]);
  await writeJsonBlob(CRM_PATHNAME, []);
  return migrated.length;
}
