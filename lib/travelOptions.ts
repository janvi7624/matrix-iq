// Pure option lists shared between the create/edit Travel Schedule forms and
// (for PURPOSE_OPTIONS) server-side validation — no DB/fs imports, safe in
// 'use client' components. Plain strings, not a Postgres ENUM, matching this
// app's existing convention (see mode_of_payment on Reimbursement).

export const MODE_OF_TRAVEL_OPTIONS = ['Plane', 'Train', 'Cab'] as const;

export const PURPOSE_OPTIONS = ['Meeting', 'Demo', 'Site Survey', 'Event', 'Others'] as const;

// A stored purpose value that doesn't match any current option is legacy
// free text from before this dropdown existed — the edit form should show
// it as "Others" with the original text preloaded into Specify Purpose.
export function isKnownPurpose(purpose: string): boolean {
  return (PURPOSE_OPTIONS as readonly string[]).includes(purpose);
}
