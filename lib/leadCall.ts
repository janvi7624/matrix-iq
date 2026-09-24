import { db, isUuid } from './db';
import { findLeadById, canWorkLead, leadStore } from './leadStore';
import { createProjectFromLead } from './leadProjectAutomation';
import { findUserByUsername } from './userStore';
import { canAssignLeads } from './permissions';
import { canAccessOwnedRecord } from './departmentScope';
import { logAudit } from './auditLogStore';
import { notifyUsers } from './notificationStore';
import { LeadCallOutcome, LeadRecord, UserRole, LEAD_CALL_OUTCOMES } from './types';

// The qualification call — the step that decides whether a captured card is
// worth a Sales project.
//
// Assigning a lead used to create a project on the spot. After an expo that
// turns 600 business cards into 600 projects, which buries the real pipeline
// and drags every conversion/win-rate chart to the floor. Now:
//   assign -> the rep CALLS -> records the outcome here
//     'suitable'      -> a project is created (the only path that makes one)
//     'not_suitable'  -> no project, ever. The contact stays in the Leads list
//                        and in Client Master, and stops being chased.
//     'callback'      -> nothing yet; ring back on callback_at.
// A lead can be called again — a 'callback' or a 'not_suitable' can later
// become 'suitable'; only the project creation is one-way.

export class LeadCallError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface LeadCallActor {
  userId: string;
  username: string;
  name: string;
  role: string;
  isPrivileged: boolean;
}

export interface LeadCallInput {
  outcome: LeadCallOutcome;
  remark: string;
  callbackAt: string;
}

export interface LeadCallResult {
  lead: LeadRecord;
  projectId: string;
  /** True when this call is what created the project. */
  projectCreated: boolean;
}

// Who may record a call. Once a lead is assigned, the outcome is the
// assignee's to report — a call log is a claim about a conversation that
// person had. Sales managers can still record one (a rep who has left, or is
// on the road), and an unassigned lead falls back to whoever may work it
// (its capturer or their department), so a card can be qualified before
// anyone routes it.
export async function canLogLeadCall(actor: LeadCallActor, lead: Pick<LeadRecord, 'created_by' | 'assigned_to'>): Promise<boolean> {
  if (lead.assigned_to === actor.username) return true;
  if (await canWorkLead(actor.username, lead)) {
    // Its capturer / their department: fine to qualify while nobody else owns
    // it, but once it is somebody's lead, the outcome is theirs to report.
    if (!lead.assigned_to) return true;
  }
  // A sales manager can step in (a rep who left, or is on the road) — but
  // only for a lead inside their own visibility scope. Being allowed to route
  // leads is not permission to reach every lead in the org by guessing an id;
  // app/api/leads/assign enforces exactly the same boundary.
  const inScope = (await canAccessOwnedRecord(actor.username, lead.created_by))
    || (!!lead.assigned_to && (await canAccessOwnedRecord(actor.username, lead.assigned_to)));
  if (!inScope) return false;
  return canAssignLeads(actor);
}

function validate(input: LeadCallInput): { outcome: LeadCallOutcome; remark: string; callbackAt: string } {
  if (!LEAD_CALL_OUTCOMES.includes(input.outcome)) {
    throw new LeadCallError('Pick what came of the call.', 400);
  }
  const remark = (input.remark || '').trim();
  const callbackAt = (input.callbackAt || '').trim();
  if (input.outcome === 'callback') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(callbackAt)) throw new LeadCallError('Pick the date to call back on.', 400);
    // The shape alone isn't enough: '2026-02-31' matches it and would reach
    // the date column as nonsense, failing as a 500 with no call recorded.
    const parsed = new Date(`${callbackAt}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== callbackAt) {
      throw new LeadCallError('Pick a real date to call back on.', 400);
    }
  }
  // A "not suitable" verdict takes the contact out of the pipeline for good,
  // so the reason has to be written down — it's the only record of why.
  if (input.outcome === 'not_suitable' && !remark) {
    throw new LeadCallError('Say why this lead is not suitable, so the next person knows.', 400);
  }
  return { outcome: input.outcome, remark, callbackAt: input.outcome === 'callback' ? callbackAt : '' };
}

export async function logLeadCall(leadId: string, actor: LeadCallActor, input: LeadCallInput, ip: string): Promise<LeadCallResult> {
  if (!isUuid(leadId)) throw new LeadCallError('Lead not found', 404);
  const lead = await findLeadById(leadId);
  if (!lead) throw new LeadCallError('Lead not found', 404);
  if (!(await canLogLeadCall(actor, lead))) {
    throw new LeadCallError('Only the person this lead is assigned to (or a sales manager) can record its call.', 403);
  }
  const { outcome, remark, callbackAt } = validate(input);

  // Once a lead is a project, a later call cannot un-convert it. Re-recording
  // 'suitable' is harmless (the project already exists and is kept), but
  // 'not_suitable' or 'callback' would write a verdict that contradicts a
  // live project: the Leads list, Client Master and the CSV would all report
  // the contact as out of the pipeline while the project stayed active in
  // Projects, with no screen able to reconcile the two. The UI already hides
  // Log Call on a converted lead — this is the case where two people had the
  // list open at once and one of them clicked first.
  if (lead.project_id && outcome !== 'suitable') {
    throw new LeadCallError(
      'This lead is already a project, so the call outcome can’t be changed. Close the project as lost instead if it turned out not to be suitable.',
      409
    );
  }

  const now = new Date().toISOString();
  await leadStore.update(leadId, {
    call_outcome: outcome,
    called_at: now,
    called_by_id: actor.userId,
    call_remark: remark,
    callback_at: callbackAt,
    updated_at: now
  } as Partial<LeadRecord>);

  const label = lead.name || lead.company || 'this lead';
  let projectId = lead.project_id || '';
  let projectCreated = false;

  // 'suitable' is the ONLY path that creates a project, and only once — a
  // lead that already has one (converted earlier, or called twice) keeps it.
  if (outcome === 'suitable' && !projectId) {
    // The project belongs to whoever is working the lead; the caller is the
    // fallback when nobody is assigned (a manager qualifying it themselves).
    const owner = lead.assigned_to || actor.username;
    const fresh = await findLeadById(leadId);
    const result = fresh ? await createProjectFromLead(fresh, { attributeToUsername: owner, autoCreated: false }) : null;
    if (result) {
      projectId = result.project.id;
      projectCreated = true;
      if (owner !== actor.username) {
        await notifyUsers([owner], {
          title: 'Lead qualified — project created',
          body: `${actor.name} marked ${label} suitable after a call. It's now a project in your pipeline.`,
          type: 'lead_qualified',
          entityType: 'project',
          entityId: result.project.id
        });
      }
    }
  }

  await logAudit({
    by: actor.username,
    role: actor.role as UserRole,
    entityType: 'lead',
    entityId: leadId,
    action: `Call logged (${outcome.replace('_', ' ')}): ${label}`,
    previousStatus: lead.call_outcome || 'not called',
    newStatus: outcome,
    remarks: [remark, callbackAt ? `Call back on ${callbackAt}` : '', projectCreated ? 'Converted to a project' : ''].filter(Boolean).join(' · '),
    ip
  });

  // Tell the capturer what came of the card they scanned — otherwise nobody
  // outside the assignee ever learns whether an expo card was worth anything.
  if (lead.created_by && lead.created_by !== actor.username) {
    const capturer = await findUserByUsername(lead.created_by);
    if (capturer) {
      await notifyUsers([capturer.username], {
        title: outcome === 'suitable' ? 'Lead you captured was qualified' : outcome === 'not_suitable' ? 'Lead you captured was closed' : 'Lead you captured needs a call back',
        body: `${actor.name} called ${label}: ${outcome.replace('_', ' ')}${remark ? ` — ${remark}` : ''}`,
        type: 'lead_call_logged',
        entityType: 'lead',
        entityId: leadId
      });
    }
  }

  const updated = await findLeadById(leadId);
  return { lead: updated ?? lead, projectId, projectCreated };
}

// Counts for the Leads page tiles: the funnel an expo actually needs —
// captured -> assigned -> called -> suitable / not suitable — rather than a
// project count that used to be inflated by one project per card.
export interface LeadCallStats {
  toCall: number;
  suitable: number;
  notSuitable: number;
  callbackDue: number;
}

export function computeLeadCallStats(leads: LeadRecord[], today = new Date()): LeadCallStats {
  // Local wall-clock, not UTC: callback_at is a plain calendar date the rep
  // picked, and isLeadUnattended reads it locally too. With a UTC key, an IST
  // user between midnight and 05:30 would see a call-back due today still
  // counted as tomorrow's.
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let toCall = 0;
  let suitable = 0;
  let notSuitable = 0;
  let callbackDue = 0;
  for (const lead of leads) {
    if (lead.call_outcome === 'suitable') suitable += 1;
    else if (lead.call_outcome === 'not_suitable') notSuitable += 1;
    else if (lead.call_outcome === 'callback') {
      if (!lead.callback_at) {
        // A call-back with no date can't come due, so it would vanish from
        // every tile — it belongs back in the queue to be dealt with.
        if (lead.assigned_to_id && !lead.project_id) toCall += 1;
      } else if (lead.callback_at <= todayKey) callbackDue += 1;
    } else if (lead.assigned_to_id && !lead.project_id) toCall += 1;
  }
  return { toCall, suitable, notSuitable, callbackDue };
}

// Used by the Leads list/stat queries that only need the call columns.
export async function countLeadsByOutcome(): Promise<Record<string, number>> {
  const rows = (await db.sequelize.query(
    'SELECT call_outcome, COUNT(*)::int AS n FROM leads WHERE deleted_at IS NULL GROUP BY call_outcome',
    { type: (db.Sequelize as unknown as { QueryTypes: { SELECT: string } }).QueryTypes.SELECT }
  )) as unknown as { call_outcome: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.call_outcome || 'not_called', r.n]));
}
