import type { ProjectRecord } from './types';

// What to call a project in a notification, a task title, or a handoff.
//
// One helper, because this was previously duplicated in five places
// (projectTechnicalRequest, projectSalesOwner, generalTaskStore, tmsHandoff)
// and every copy had the same gap: it answered with the CLIENT's name and
// ignored project_name entirely.
//
// That gap had a real cost. A technical person notified that "sales
// requested you for Test-Task" cannot match it against a project called
// "MeetIQ - Reliance" — the request looks like it was never sent, or was
// sent about something else. project_name is the field people actually name
// a deal by ("MEETIQ - Adani" is the placeholder on the intake form), so it
// comes first.
//
// The old order is preserved as the fallback chain, so every project created
// before project_name existed — the overwhelming majority — reads exactly as
// it did before.

// Partial, deliberately: several callers select only a couple of columns.
// They still get the best answer the data they fetched allows, rather than
// a compile error that would push them back to hand-rolling the chain.
export type ProjectLabelFields = Partial<Pick<ProjectRecord, 'project_name' | 'client_name' | 'company'>>;

export function projectLabel(project: ProjectLabelFields | null | undefined): string {
  if (!project) return 'Project';
  return project.project_name || project.client_name || project.company || 'Project';
}

/**
 * Longer form for places with room for it — the name plus who it is for.
 *
 * Avoids repeating itself when project_name and client_name are the same
 * string, which happens whenever someone typed the customer's name into
 * both fields.
 */
export function projectLabelWithClient(project: ProjectLabelFields | null | undefined): string {
  if (!project) return 'Project';
  const name = projectLabel(project);
  const client = project.client_name || project.company || '';
  return client && client !== name ? `${name} (${client})` : name;
}
