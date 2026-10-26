import { subCategoryKeyFor } from './dailyReportTemplates';
import type { DailyReportFieldDef, TemplateDefinition, TemplateOverrides } from './dailyReportTemplates';

// Which of a department's task dropdowns a manager may edit, and how an edit
// turns back into TemplateOverrides.
//
// The override mechanism already existed (overrides.options and
// overrides.linkedOptions, applied by resolveTemplate) but nothing exposed
// it, so every department was stuck with the catalogue hard-coded in
// lib/dailyReportTemplates.ts.
//
// THE PAIRING RULE
// A "sub-category" field declares `dependsOn: <parentKey>` and carries the
// catalogue in `linkedOptions`, keyed BY THE PARENT'S VALUE
// (components/DailyReportForm.tsx reads field.linkedOptions[parentValue]).
// So the parent's own option list and the catalogue's keys must stay the
// same set — add a category to one without the other and you get either a
// category nobody can pick or a pick that yields no sub-categories.
//
// That is exactly the trap this module exists to close: a group is edited as
// ONE object, and the parent's options are always regenerated from the
// catalogue's keys rather than stored separately.
//
// Pure — no Sequelize — so the pairing rule is directly testable.

export interface CategoryGroup {
  /** The parent select — the "Category". */
  parentKey: string;
  parentLabel: string;
  /** The dependent select — the "Sub-category". Null when there isn't one. */
  childKey: string | null;
  childLabel: string | null;
  /** Category name -> its sub-categories. Values are [] when there is no sub-level. */
  catalogue: Record<string, string[]>;
  /**
   * True when the sub-level is one a MANAGER added rather than one the
   * built-in template declares. Only a custom level may be switched off
   * again — removing HR's Specific Activity would break a field the
   * template, the validator and every filed report already know about.
   */
  childIsCustom: boolean;
  /** Is a sub-level currently in use? Always true for a native child. */
  subLevelEnabled: boolean;
}

export class CategoryEditError extends Error {}

function isEditableSelect(field: DailyReportFieldDef): boolean {
  // Only a plain select. A computed field has nothing to pick, and a field
  // whose options are driven by live data (a user picker) is not a catalogue.
  return field.type === 'select' && !field.dependsOn;
}

/**
 * The editable category groups of a template, parent first.
 *
 * Reads headerFields as well as rowFields: a narrative template keeps its
 * selects at the header level, and a manager editing "the task categories"
 * means the same thing in both layouts.
 */
export function describeCategoryGroups(base: TemplateDefinition, overrides: TemplateOverrides = {}): CategoryGroup[] {
  // Built from the BASE template plus overrides, never from an already
  // resolved one: a manager-added sub-level resolves into an ordinary
  // dependent field, and from the resolved template it would be
  // indistinguishable from HR's built-in child — which may not be removed.
  const fields = [...base.headerFields, ...base.rowFields];
  const nativeChildByParent = new Map<string, DailyReportFieldDef>();
  for (const field of fields) {
    if (field.dependsOn && field.linkedOptions) nativeChildByParent.set(field.dependsOn, field);
  }

  const groups: CategoryGroup[] = [];
  for (const field of fields) {
    if (!isEditableSelect(field)) continue;

    const native = nativeChildByParent.get(field.key) ?? null;
    const custom = native ? undefined : overrides.subCategories?.[field.key];
    const categories = overrides.options?.[field.key]?.length ? overrides.options[field.key] : field.options ?? [];
    const subs = native ? overrides.linkedOptions?.[native.key] ?? native.linkedOptions ?? {} : custom?.catalogue ?? {};

    const catalogue: Record<string, string[]> = {};
    for (const category of categories) {
      // The catalogue is the authority on sub-categories; a category the
      // parent lists but the catalogue has never heard of is simply empty,
      // not an error — that is the state a brand-new category is in.
      catalogue[category] = [...(subs[category] ?? [])];
    }

    groups.push({
      parentKey: field.key,
      parentLabel: field.label,
      childKey: native?.key ?? (custom ? subCategoryKeyFor(field.key) : null),
      childLabel: native?.label ?? custom?.label ?? null,
      catalogue,
      childIsCustom: !native,
      subLevelEnabled: Boolean(native || custom)
    });
  }
  return groups;
}

/** Trim, drop blanks, and de-duplicate case-insensitively, keeping first spelling. */
function cleanList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Validate and normalise one edited group.
 *
 * Throws rather than silently dropping: a manager who typed a duplicate
 * category needs to be told, not to watch one of them vanish on save.
 */
export function normaliseGroup(group: CategoryGroup): CategoryGroup {
  const categories = cleanList(Object.keys(group.catalogue));
  if (!categories.length) {
    throw new CategoryEditError(`${group.parentLabel} needs at least one option.`);
  }
  if (categories.length !== Object.keys(group.catalogue).filter((c) => String(c).trim()).length) {
    throw new CategoryEditError(`Two ${group.parentLabel} options have the same name.`);
  }

  // Keys are looked up by their TRIMMED, case-folded form rather than by
  // guessing at the spelling the browser sent: cleanList has already
  // trimmed the names, so '  Recruitment  ' no longer matches its own key.
  const byTrimmed = new Map<string, string[]>();
  for (const [key, value] of Object.entries(group.catalogue)) {
    const trimmed = String(key).trim().toLowerCase();
    if (trimmed && !byTrimmed.has(trimmed)) byTrimmed.set(trimmed, Array.isArray(value) ? value : []);
  }

  const catalogue: Record<string, string[]> = {};
  for (const category of categories) {
    const raw = byTrimmed.get(category.toLowerCase()) ?? [];
    const subs = cleanList(raw);
    if (group.childKey && subs.length !== raw.filter((s) => String(s ?? '').trim()).length) {
      throw new CategoryEditError(`“${category}” lists the same ${group.childLabel ?? 'sub-category'} twice.`);
    }
    catalogue[category] = subs;
  }
  return { ...group, catalogue };
}

/**
 * Turn edited groups back into TemplateOverrides.
 *
 * The parent's options are ALWAYS regenerated from the catalogue's keys —
 * that is what keeps the two halves of a dependent pair in step. A group
 * whose catalogue still matches the built-in template contributes nothing,
 * so a department that never customised anything keeps an empty override and
 * continues to follow the built-in as it changes.
 */
export function overridesFromGroups(
  template: TemplateDefinition,
  groups: CategoryGroup[],
  existing: TemplateOverrides = {}
): TemplateOverrides {
  const base = describeCategoryGroups(template);
  const baseByParent = new Map(base.map((g) => [g.parentKey, g]));

  // Anything this module does not own — minEntries, measures, channels — is
  // carried through untouched rather than dropped.
  const options: Record<string, string[]> = { ...(existing.options ?? {}) };
  const linkedOptions: Record<string, Record<string, string[]>> = { ...(existing.linkedOptions ?? {}) };
  const subCategories: Record<string, { label: string; catalogue: Record<string, string[]> }> = {
    ...(existing.subCategories ?? {})
  };

  for (const raw of groups) {
    const group = normaliseGroup(raw);
    const baseline = baseByParent.get(group.parentKey);
    if (!baseline) throw new CategoryEditError(`“${group.parentKey}” is not an editable dropdown on this format.`);
    if (!baseline.childIsCustom && !group.subLevelEnabled) {
      // HR's Specific Activity and GEM's Current Status are declared by the
      // template; the validator and every filed report already depend on
      // them. Only a level a manager invented may be switched off.
      throw new CategoryEditError(`${baseline.childLabel} is part of this report format and cannot be removed.`);
    }

    const categories = Object.keys(group.catalogue);
    const hasAnySub = Object.values(group.catalogue).some((v) => v.length > 0);

    // --- the parent's own option list ---
    const defaultCategories = Object.keys(baseline.catalogue);
    if (JSON.stringify(categories) === JSON.stringify(defaultCategories)) delete options[group.parentKey];
    else options[group.parentKey] = categories;

    // --- the sub-level ---
    if (baseline.childIsCustom) {
      // Manager-defined. Switched off, or left with nothing in it, means
      // remove the field entirely rather than leave an empty dropdown on
      // everyone's form.
      if (!group.subLevelEnabled || !hasAnySub) {
        delete subCategories[group.parentKey];
      } else {
        subCategories[group.parentKey] = {
          label: (group.childLabel || '').trim() || 'Sub-category',
          catalogue: group.catalogue
        };
      }
    } else if (group.childKey) {
      if (JSON.stringify(group.catalogue) === JSON.stringify(baseline.catalogue)) delete linkedOptions[group.childKey];
      else linkedOptions[group.childKey] = group.catalogue;
    }
  }

  const out: TemplateOverrides = { ...existing };
  if (Object.keys(options).length) out.options = options;
  else delete out.options;
  if (Object.keys(linkedOptions).length) out.linkedOptions = linkedOptions;
  else delete out.linkedOptions;
  if (Object.keys(subCategories).length) out.subCategories = subCategories;
  else delete out.subCategories;
  return out;
}
