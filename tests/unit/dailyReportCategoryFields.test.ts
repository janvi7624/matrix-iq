import { describe, it, expect } from 'vitest';
import {
  CategoryEditError,
  describeCategoryGroups,
  normaliseGroup,
  overridesFromGroups
} from '../../lib/dailyReportCategoryFields';
import { BUILT_IN_TEMPLATES, resolveTemplate } from '../../lib/dailyReportTemplates';

// The failure this module exists to prevent is silent: add a category to the
// catalogue but not to the parent's option list and the category is
// unpickable; add it to the parent only and picking it yields an empty
// sub-category dropdown. Both look like "the form is broken" to the person
// filing, and neither throws.

const HR = BUILT_IN_TEMPLATES.hr;
const AI = BUILT_IN_TEMPLATES.ai;

describe('describeCategoryGroups', () => {
  it('pairs HR Activity Category with its dependent Specific Activity', () => {
    const groups = describeCategoryGroups(HR);
    const category = groups.find((g) => g.parentKey === 'category');
    expect(category).toBeTruthy();
    expect(category!.parentLabel).toBe('Activity Category');
    expect(category!.childKey).toBe('activity');
    expect(category!.childLabel).toBe('Specific Activity');
    // Every category carries its own sub-list.
    expect(Object.keys(category!.catalogue).length).toBeGreaterThan(1);
    expect(category!.catalogue[Object.keys(category!.catalogue)[0]].length).toBeGreaterThan(0);
  });

  it('describes a plain select as a group with no child', () => {
    const groups = describeCategoryGroups(AI);
    const project = groups.find((g) => g.parentKey === 'project');
    expect(project).toBeTruthy();
    expect(project!.childKey).toBeNull();
    expect(Object.keys(project!.catalogue)).toEqual(['Client', 'Internal', 'Other']);
    // No child means no sub-categories, not missing ones.
    expect(Object.values(project!.catalogue).every((v) => v.length === 0)).toBe(true);
  });

  it('never offers a dependent field as a category of its own', () => {
    // 'activity' is a sub-category; editing it standalone would let someone
    // set options that the parent's catalogue immediately overrides.
    const groups = describeCategoryGroups(HR);
    expect(groups.some((g) => g.parentKey === 'activity')).toBe(false);
  });

  it('never offers a computed or free-text field', () => {
    const groups = describeCategoryGroups(AI);
    for (const key of ['task_code', 'task_description', 'due_date', 'days_left', 'notes', 'project_other']) {
      expect(groups.some((g) => g.parentKey === key), key).toBe(false);
    }
  });
});

describe('normaliseGroup', () => {
  const group = { parentKey: 'category', parentLabel: 'Activity Category', childKey: 'activity', childLabel: 'Specific Activity', catalogue: {} as Record<string, string[]> };

  it('trims and drops blank rows the form leaves behind', () => {
    const out = normaliseGroup({ ...group, catalogue: { '  Recruitment  ': ['  Screening ', '', '   '] } });
    expect(Object.keys(out.catalogue)).toEqual(['Recruitment']);
    expect(out.catalogue.Recruitment).toEqual(['Screening']);
  });

  it('refuses an empty dropdown rather than saving one nobody can use', () => {
    expect(() => normaliseGroup({ ...group, catalogue: {} })).toThrow(CategoryEditError);
    expect(() => normaliseGroup({ ...group, catalogue: { '   ': [] } })).toThrow(/needs at least one option/);
  });

  it('rejects a duplicated sub-category instead of quietly dropping one', () => {
    expect(() => normaliseGroup({ ...group, catalogue: { Recruitment: ['Screening', 'screening'] } })).toThrow(
      /lists the same/
    );
  });

  it('allows a brand-new category with no sub-categories yet', () => {
    const out = normaliseGroup({ ...group, catalogue: { Recruitment: ['Screening'], Payroll: [] } });
    expect(out.catalogue.Payroll).toEqual([]);
  });
});

describe('overridesFromGroups', () => {
  it('keeps the parent options and the catalogue keys identical', () => {
    // THE pairing rule. A category present in one and not the other is the
    // bug this whole module is built around.
    const groups = describeCategoryGroups(HR);
    const category = groups.find((g) => g.parentKey === 'category')!;
    category.catalogue['Employee Engagement'] = ['Town hall', 'Survey'];

    const overrides = overridesFromGroups(HR, [category]);
    expect(overrides.options!.category).toContain('Employee Engagement');
    expect(Object.keys(overrides.linkedOptions!.activity)).toEqual(overrides.options!.category);
  });

  it('round-trips through resolveTemplate so the form actually offers the new option', () => {
    const groups = describeCategoryGroups(HR);
    const category = groups.find((g) => g.parentKey === 'category')!;
    category.catalogue['Employee Engagement'] = ['Town hall'];

    const resolved = resolveTemplate('hr', overridesFromGroups(HR, [category]));
    const parent = resolved.rowFields.find((f) => f.key === 'category')!;
    const child = resolved.rowFields.find((f) => f.key === 'activity')!;
    expect(parent.options).toContain('Employee Engagement');
    expect(child.linkedOptions!['Employee Engagement']).toEqual(['Town hall']);
  });

  it('writes nothing when the catalogue still matches the built-in', () => {
    // A department that never customised anything must keep following the
    // built-in template as it changes, rather than freezing a copy of it.
    const overrides = overridesFromGroups(HR, describeCategoryGroups(HR));
    expect(overrides.options).toBeUndefined();
    expect(overrides.linkedOptions).toBeUndefined();
  });

  it('clears its override when an edit is reverted to the built-in', () => {
    const groups = describeCategoryGroups(HR);
    const category = groups.find((g) => g.parentKey === 'category')!;
    category.catalogue['Temporary'] = ['Thing'];
    const customised = overridesFromGroups(HR, [category]);
    expect(customised.options).toBeDefined();

    delete category.catalogue['Temporary'];
    const reverted = overridesFromGroups(HR, [category], customised);
    expect(reverted.options).toBeUndefined();
    expect(reverted.linkedOptions).toBeUndefined();
  });

  it('leaves overrides it does not own alone', () => {
    const existing = { minEntries: 3, measures: ['A'], channels: ['X'] };
    const out = overridesFromGroups(HR, describeCategoryGroups(HR), existing);
    expect(out.minEntries).toBe(3);
    expect(out.measures).toEqual(['A']);
    expect(out.channels).toEqual(['X']);
  });

  it('refuses a field that is not an editable dropdown on this format', () => {
    expect(() =>
      overridesFromGroups(HR, [
        { parentKey: 'task_description', parentLabel: 'x', childKey: null, childLabel: null, catalogue: { A: [] } }
      ])
    ).toThrow(/not an editable dropdown/);
  });

  it('handles a plain select with no child field', () => {
    const groups = describeCategoryGroups(AI);
    const project = groups.find((g) => g.parentKey === 'project')!;
    project.catalogue['Partner'] = [];
    const overrides = overridesFromGroups(AI, [project]);
    expect(overrides.options!.project).toEqual(['Client', 'Internal', 'Other', 'Partner']);
    // No child key, so nothing may be written to linkedOptions.
    expect(overrides.linkedOptions).toBeUndefined();
  });
});

describe('a sub-category level a manager adds', () => {
  it('marks a flat select as having no sub-level yet, and HR as having a native one', () => {
    const ai = describeCategoryGroups(AI).find((g) => g.parentKey === 'project')!;
    expect(ai.subLevelEnabled).toBe(false);
    expect(ai.childIsCustom).toBe(true);

    const hr = describeCategoryGroups(HR).find((g) => g.parentKey === 'category')!;
    expect(hr.subLevelEnabled).toBe(true);
    expect(hr.childIsCustom).toBe(false);
  });

  it('turns into a real dependent dropdown on the form', () => {
    const group = describeCategoryGroups(AI).find((g) => g.parentKey === 'project')!;
    group.subLevelEnabled = true;
    group.childLabel = 'Module';
    group.catalogue.Internal = ['MatrixIQ', 'Website'];
    group.catalogue.Client = ['Deployment'];

    const overrides = overridesFromGroups(AI, [group]);
    expect(overrides.subCategories!.project.label).toBe('Module');

    const resolved = resolveTemplate('ai', overrides);
    const sub = resolved.rowFields.find((f) => f.key === 'project_sub')!;
    expect(sub).toBeTruthy();
    expect(sub.type).toBe('select');
    expect(sub.dependsOn).toBe('project');
    expect(sub.linkedOptions!.Internal).toEqual(['MatrixIQ', 'Website']);
    // It must sit directly after its parent, or it reads as unrelated.
    const keys = resolved.rowFields.map((f) => f.key);
    expect(keys.indexOf('project_sub')).toBe(keys.indexOf('project') + 1);
  });

  it('does not appear at all until the manager adds one', () => {
    const resolved = resolveTemplate('ai', overridesFromGroups(AI, describeCategoryGroups(AI)));
    expect(resolved.rowFields.some((f) => f.key === 'project_sub')).toBe(false);
  });

  it('can be switched off again, removing the field', () => {
    const group = describeCategoryGroups(AI).find((g) => g.parentKey === 'project')!;
    group.subLevelEnabled = true;
    group.childLabel = 'Module';
    group.catalogue.Internal = ['MatrixIQ'];
    const on = overridesFromGroups(AI, [group]);
    expect(resolveTemplate('ai', on).rowFields.some((f) => f.key === 'project_sub')).toBe(true);

    const back = describeCategoryGroups(AI, on).find((g) => g.parentKey === 'project')!;
    back.subLevelEnabled = false;
    const off = overridesFromGroups(AI, [back], on);
    expect(off.subCategories).toBeUndefined();
    expect(resolveTemplate('ai', off).rowFields.some((f) => f.key === 'project_sub')).toBe(false);
  });

  it('refuses to remove a sub-level the template itself declares', () => {
    const hr = describeCategoryGroups(HR).find((g) => g.parentKey === 'category')!;
    hr.subLevelEnabled = false;
    expect(() => overridesFromGroups(HR, [hr])).toThrow(/cannot be removed/);
  });

  it('keeps the stored field key stable when only the label is renamed', () => {
    // Renaming must not orphan values already filed under the old key.
    const group = describeCategoryGroups(AI).find((g) => g.parentKey === 'project')!;
    group.subLevelEnabled = true;
    group.childLabel = 'Module';
    group.catalogue.Internal = ['MatrixIQ'];
    const first = overridesFromGroups(AI, [group]);

    const renamed = describeCategoryGroups(AI, first).find((g) => g.parentKey === 'project')!;
    renamed.childLabel = 'Work stream';
    const second = overridesFromGroups(AI, [renamed], first);

    expect(second.subCategories!.project.label).toBe('Work stream');
    expect(resolveTemplate('ai', second).rowFields.some((f) => f.key === 'project_sub')).toBe(true);
  });

  it('round-trips a manager edit back into the editor unchanged', () => {
    const group = describeCategoryGroups(AI).find((g) => g.parentKey === 'project')!;
    group.subLevelEnabled = true;
    group.childLabel = 'Module';
    group.catalogue.Internal = ['MatrixIQ', 'Website'];
    const overrides = overridesFromGroups(AI, [group]);

    const reloaded = describeCategoryGroups(AI, overrides).find((g) => g.parentKey === 'project')!;
    expect(reloaded.subLevelEnabled).toBe(true);
    expect(reloaded.childLabel).toBe('Module');
    expect(reloaded.catalogue.Internal).toEqual(['MatrixIQ', 'Website']);
  });
});
