// Pure — no db/fs imports — so both lib/projectStore.ts's toRecord and
// lib/partnerProjectStore.ts's salespersonNameOf resolve the exact same
// display name instead of two copies that can drift.

/**
 * A project's sales_person COLUMN is free text that holds a username far
 * more often than a name (see lib/projectSalesOwner.ts's own comment: "the
 * sales_person column is only a label" — created_by/its creator join is the
 * real owner). This resolves what should actually be SHOWN to a person:
 * the owning user's real name, falling back to their username, and only
 * falling back to the raw column itself if the creator join came back
 * empty (a deactivated/deleted account, or data from before this existed).
 */
export function resolveSalesPersonName(creator: { name?: string; username?: string } | null | undefined, salesPersonColumn: string | null | undefined): string {
  return creator?.name || creator?.username || salesPersonColumn || '';
}
