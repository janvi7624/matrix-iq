import { describe, it, expect } from 'vitest';
import { sectionDefaultExpanded } from '../../lib/useCollapsibleSections';
import { primarySectionForDepartment } from '../../lib/departmentCategoryMap';
import { PARTNER_SECTION } from '../../lib/partnerRoles';

// Which nav sections start open. The hook itself needs a DOM (this suite has
// none), so the decision lives as a pure function — same split as
// lib/useAutoRefresh.ts's shouldRefresh.
//
// The bug being pinned: a partner account has no department, so
// primarySectionForDepartment() returns null, nothing equalled
// initiallyExpandedLabel, and the Partner Portal sidebar rendered four
// collapsed section headers with not one nav link visible.

describe('internal users keep the department-matched section', () => {
  it('opens only the section their department maps to', () => {
    const primary = primarySectionForDepartment('Sales');
    expect(primary).toBe('Sales');
    expect(sectionDefaultExpanded('Sales', { initiallyExpandedLabel: primary })).toBe(true);
    expect(sectionDefaultExpanded('Marketing', { initiallyExpandedLabel: primary })).toBe(false);
    expect(sectionDefaultExpanded('TMS', { initiallyExpandedLabel: primary })).toBe(false);
  });
});

describe('partner accounts', () => {
  // The precondition that made this reachable at all.
  it('have no department, so no section can be matched', () => {
    expect(primarySectionForDepartment(undefined)).toBeNull();
    expect(primarySectionForDepartment('')).toBeNull();
  });

  it('REGRESSION: every section was collapsed, hiding the whole nav', () => {
    const primary = primarySectionForDepartment(undefined);
    for (const label of [PARTNER_SECTION, 'Sales', 'Marketing', 'Support']) {
      // This is the old behaviour — kept as the thing that must not return.
      expect(sectionDefaultExpanded(label, { initiallyExpandedLabel: primary })).toBe(false);
    }
  });

  it('open every section, because their whole nav fits on screen', () => {
    const primary = primarySectionForDepartment(undefined);
    for (const label of [PARTNER_SECTION, 'Sales', 'Marketing', 'Support']) {
      expect(sectionDefaultExpanded(label, { defaultExpanded: true, initiallyExpandedLabel: primary })).toBe(true);
    }
  });

  it('stays open regardless of what else is passed', () => {
    expect(sectionDefaultExpanded('Support', { defaultExpanded: true, initiallyExpandedLabel: 'Sales' })).toBe(true);
  });
});
