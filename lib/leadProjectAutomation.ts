import { LeadRecord, ProjectRecord } from './types';
import { findLeadById } from './leadStore';
import { projectStore } from './projectStore';
import { db } from './db';

export interface CreateProjectFromLeadOptions {
  // Who the created project is owned by (created_by/sales_person). The
  // manual "Convert to Project" button attributes to whoever clicks it; the
  // automatic-on-assignment path attributes to the assignee, not the
  // manager who assigned it (Part 11 — "a Project for Rahul", not for the
  // manager).
  attributeToUsername: string;
  // True only for the automatic-on-assignment path — sets
  // lead_confirmation_status: 'pending_confirmation' so the assignee has to
  // confirm before the project reads as "handled". The manual button's
  // behavior is unchanged: no confirmation step, exactly like today.
  autoCreated: boolean;
}

export interface CreateProjectFromLeadResult {
  lead: LeadRecord;
  project: ProjectRecord;
}

// The exact Lead -> Project field mapping the pre-existing manual
// Convert-to-Project route used (app/api/leads/[id]/convert-to-project/route.ts,
// before this file existed) — factored out here so the automatic-on-
// assignment path (app/api/leads/assign/route.ts) shares it instead of
// duplicating it. Only maps fields that actually exist on Lead; a Lead's
// `budget` is unstructured free text, never parsed into the numeric
// approx_price field — that's deliberately left blank for the assignee to
// fill in (see checkProjectCompleteness in lib/projectStore.ts).
//
// Duplicate-project guard (Part 14): returns null if this lead already has
// a linked project — the caller is expected to reassign the existing
// project instead (see reassignLinkedProject below), never call this again.
export async function createProjectFromLead(lead: LeadRecord, opts: CreateProjectFromLeadOptions): Promise<CreateProjectFromLeadResult | null> {
  if (lead.project_id) return null;

  const noteParts = [
    lead.designation ? `Designation: ${lead.designation}` : '',
    lead.city ? `City: ${lead.city}` : '',
    lead.interests.length ? `Interested in: ${lead.interests.join(', ')}` : '',
    lead.sub_interests.length ? `Specifics: ${lead.sub_interests.join(', ')}` : '',
    lead.budget ? `Budget: ${lead.budget}` : '',
    lead.notes
  ].filter(Boolean);

  const now = new Date().toISOString();
  const projectSource = lead.source === 'meta_lead_ads'
    ? `Meta Lead Ads (${lead.meta_platform === 'ig' ? 'Instagram' : 'Facebook'})`
    : opts.autoCreated ? 'Lead Assignment' : 'Event Lead Capture';

  const project: ProjectRecord = {
    id: `${Date.now()}`,
    created_at: now,
    created_by: opts.attributeToUsername,
    client_name: lead.name,
    company: lead.company,
    contact_person: lead.name,
    alt_contact_phone: '',
    phone: lead.mobile,
    email: lead.email,
    address: lead.city,
    sales_person: opts.attributeToUsername,
    source: projectSource,
    status: 'active',
    stage: 'cold_call',
    cold_call_responded: '',
    priority: lead.priority === 'hot' ? 'high' : lead.priority === 'warm' ? 'medium' : 'low',
    expected_closing_date: '',
    next_follow_up_date: '',
    remarks: noteParts.join(' | '),
    closing_probability_percent: '',
    approx_price: '',
    notes: [],
    attachments: [],
    assigned_technical_person_id: '',
    assigned_technical_person_name: '',
    tms_project_id: '',
    lead_confirmation_status: opts.autoCreated ? 'pending_confirmation' : '',
    confirmed_by: '',
    confirmed_at: '',
    timeline: [{
      id: `${Date.now()}`, at: now, by: opts.attributeToUsername, stage: 'created',
      label: opts.autoCreated ? 'Project auto-created from an assigned lead' : 'Project created from a captured lead',
      remarks: noteParts.join(' | ')
    }],
    updated_at: now,
    last_remark: '',
    last_remark_at: '',
    last_remark_by: ''
  };

  const createdProject = await projectStore.create(project);

  try {
    // Claim the lead only if it STILL has no project. The in-memory check at
    // the top of this function can't stop two callers racing (the assignee
    // and a manager both marking the same lead suitable, or a retried
    // request): both would read project_id as empty and create a project, and
    // the loser's would be an orphan nothing links to — sitting in the
    // pipeline being counted forever, which is the exact pollution this
    // feature exists to prevent. Letting the database decide the winner makes
    // that impossible.
    const [claimed] = await db.Lead.update(
      { project_id: createdProject.id, updated_at: now } as never,
      { where: { id: lead.id, project_id: null } as never }
    );
    if (!claimed) {
      // Someone else linked a project first — throw away the one just made
      // and report "already converted" the same way the guard above does.
      await db.Project.destroy({ where: { id: createdProject.id } as never, force: true }).catch(() => {});
      return null;
    }
    const updatedLead = await findLeadById(lead.id);
    if (!updatedLead) throw new Error('Lead not found when linking created project');
    return { lead: updatedLead, project: createdProject };
  } catch (error) {
    // Transactional safety (Part 29): projectStore.create() and
    // leadStore.update() are two separate underlying transactions (they
    // touch different, unrelated tables and projectStore.create doesn't
    // accept an external transaction handle) — if linking the lead back
    // fails, delete the just-created project rather than leave an orphan
    // project with no lead pointing at it and a lead that still looks
    // unconverted. A hard delete (not projectStore.remove()'s
    // permission-gated soft-delete, which requires a human viewer and
    // blocks on linked records) — this row was never meant to exist for
    // even a moment as far as the rest of the app is concerned.
    await db.Project.destroy({ where: { id: createdProject.id } as never, force: true }).catch(() => {});
    throw error;
  }
}

// Lead reassignment (Part 24): the existing linked project is updated to
// the new assignee rather than a second project being created. Ownership
// (created_by/sales_person) moves; ID/history/remarks/everything else about
// the project is untouched. Re-opens confirmation if the project was
// auto-created and already confirmed by the PREVIOUS assignee — the new
// assignee has to confirm too, same as a fresh assignment would.
export async function reassignLinkedProject(projectId: string, newAssigneeUsername: string): Promise<ProjectRecord | null> {
  return projectStore.update(projectId, {
    created_by: newAssigneeUsername,
    sales_person: newAssigneeUsername,
    lead_confirmation_status: 'pending_confirmation',
    confirmed_by: '',
    confirmed_at: ''
  });
}
