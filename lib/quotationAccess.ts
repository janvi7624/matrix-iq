import { QuotationRecord } from './types';
import { canAccessOwnedRecord, resolveVisibilityScope } from './departmentScope';
import { canAccessProject, findProjectById } from './projectStore';

// Single-quotation access checks. A quotation used to be reachable only by
// whoever created it (plus their department manager/org-wide viewers, via
// canAccessOwnedRecord), but a technical-staff member can now create one
// prepared on behalf of a project's sales owner (lib/quotationOnBehalf.ts) —
// so the sales person it's prepared for, and the people on its linked
// project, need a way in too. The cheap created_by check always runs first,
// so the common "my own quotation" case costs exactly what it did before.

async function isPreparedByInScope(viewerUsername: string, preparedByUserId: string): Promise<boolean> {
  if (!preparedByUserId) return false;
  const scope = await resolveVisibilityScope(viewerUsername);
  return scope.seesOrgWide || (scope.scopedUserIds ?? []).includes(preparedByUserId);
}

// Read access (detail, version history, revising): created it, it's prepared
// by someone in the viewer's scope, or the viewer can open its linked
// project (so an engineer assigned to the project can see its quotations).
export async function canViewQuotation(viewerUsername: string, q: QuotationRecord): Promise<boolean> {
  if (await canAccessOwnedRecord(viewerUsername, q.created_by)) return true;
  if (await isPreparedByInScope(viewerUsername, q.prepared_by_user_id)) return true;
  if (!q.project_id) return false;
  const project = await findProjectById(q.project_id);
  return !!project && (await canAccessProject(viewerUsername, project));
}

// Write access (status changes, follow-ups) — narrower than canViewQuotation
// on the project branch: only the project's OWNER (the sales person, and
// whoever manages them) counts, deliberately NOT an engineer who is merely
// assigned to the project. Chasing the client stays a sales job.
export async function canManageQuotation(viewerUsername: string, q: QuotationRecord): Promise<boolean> {
  if (await canAccessOwnedRecord(viewerUsername, q.created_by)) return true;
  if (await isPreparedByInScope(viewerUsername, q.prepared_by_user_id)) return true;
  if (!q.project_id) return false;
  const project = await findProjectById(q.project_id);
  return !!project && (await canAccessOwnedRecord(viewerUsername, project.created_by));
}
