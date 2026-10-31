import { TMS_PROJECT_CATEGORY_OPTIONS } from './tmsLabels';

// Pure, so the API route and a unit test can both call the exact same
// resolution the create form relies on — no db/fs imports.

export type ResolvedProjectCategory = { ok: true; value: string } | { ok: false; error: string };

/**
 * Resolves what the create form actually submits (projectCategory,
 * projectCategoryOther) into the single string stored as
 * TmsProjectRecord.project_category.
 *
 * 'Other' is never stored as the literal word — the typed text replaces it,
 * same pattern as the Office Operation Expense register's own 'Other'
 * fields. Blank is allowed (the field is optional); 'Other' with nothing
 * typed, or a value outside the fixed list, is refused.
 */
export function resolveProjectCategory(rawCategory: unknown, rawOther: unknown): ResolvedProjectCategory {
  const category = typeof rawCategory === 'string' ? rawCategory.trim() : '';
  if (!category) return { ok: true, value: '' };

  if (category === 'Other') {
    const other = typeof rawOther === 'string' ? rawOther.trim() : '';
    if (!other) return { ok: false, error: 'Specify the project category' };
    return { ok: true, value: other };
  }

  if (!TMS_PROJECT_CATEGORY_OPTIONS.includes(category as (typeof TMS_PROJECT_CATEGORY_OPTIONS)[number])) {
    return { ok: false, error: 'Invalid project category' };
  }
  return { ok: true, value: category };
}
