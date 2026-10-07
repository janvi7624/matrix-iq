import { describe, it, expect } from 'vitest';
import {
  PROJECT_DEPARTMENTS,
  ProjectDepartment,
  departmentValueOf,
  formatProjectDepartments,
  isProjectDepartment,
  parseDepartmentAmounts,
  sumDepartmentAmounts,
  matchesDepartmentFilter,
  parseProjectDepartments
} from '../../lib/projectDepartmentOptions';

describe('PROJECT_DEPARTMENTS', () => {
  // Pinned: the keys are stored in projects.departments as JSONB and reused
  // as DomainKey elsewhere, so renaming one silently orphans existing rows.
  it('is the four delivery departments, in display order', () => {
    expect([...PROJECT_DEPARTMENTS]).toEqual(['ai', 'av', 'robotics', 'si']);
  });
});

describe('parseProjectDepartments', () => {
  it('accepts each of the real departments', () => {
    for (const d of PROJECT_DEPARTMENTS) {
      expect(parseProjectDepartments([d])).toEqual([d]);
    }
  });

  it('accepts a bare string as well as the stored array form', () => {
    expect(parseProjectDepartments('av')).toEqual(['av']);
    expect(parseProjectDepartments(['av'])).toEqual(['av']);
  });

  it('normalizes order so the same pair always stores identically', () => {
    expect(parseProjectDepartments(['si', 'ai'])).toEqual(['ai', 'si']);
    expect(parseProjectDepartments(['si', 'si', 'robotics'])).toEqual(['robotics', 'si']);
  });

  it('drops anything not on the fixed list rather than trusting the client', () => {
    expect(parseProjectDepartments(['sales'])).toEqual([]);
    expect(parseProjectDepartments(['hr', 'ai'])).toEqual(['ai']);
  });

  it('keeps every real department on a multi-department deal', () => {
    expect(parseProjectDepartments(['ai', 'av'])).toEqual(['ai', 'av']);
    expect(parseProjectDepartments(['robotics', 'ai', 'av'])).toEqual(['ai', 'av', 'robotics']);
  });

  // Order must not depend on which box was ticked first, or the same deal
  // would store two different ways.
  it('normalises order and collapses duplicates', () => {
    expect(parseProjectDepartments(['av', 'ai'])).toEqual(parseProjectDepartments(['ai', 'av']));
    expect(parseProjectDepartments(['av', 'av'])).toEqual(['av']);
  });

  it('returns empty for junk and missing values', () => {
    expect(parseProjectDepartments(undefined)).toEqual([]);
    expect(parseProjectDepartments(null)).toEqual([]);
    expect(parseProjectDepartments([])).toEqual([]);
    expect(parseProjectDepartments([1, {}, true])).toEqual([]);
  });
});

describe('isProjectDepartment', () => {
  it('recognises only the three departments', () => {
    expect(isProjectDepartment('ai')).toBe(true);
    expect(isProjectDepartment('combined')).toBe(false);
    expect(isProjectDepartment('')).toBe(false);
    expect(isProjectDepartment(null)).toBe(false);
  });
});

describe('formatProjectDepartments', () => {
  it('shows the department label', () => {
    expect(formatProjectDepartments(['ai'])).toBe('AI');
    expect(formatProjectDepartments(['robotics'])).toBe('Robotics');
    expect(formatProjectDepartments(['ai', 'av'])).toBe('AI + AV');
  });

  it('shows a dash for a project predating the field', () => {
    expect(formatProjectDepartments([])).toBe('-');
    expect(formatProjectDepartments(undefined)).toBe('-');
    expect(formatProjectDepartments(null)).toBe('-');
  });
});

describe('matchesDepartmentFilter', () => {
  it('matches everything when no filter is set', () => {
    expect(matchesDepartmentFilter(['ai'], '')).toBe(true);
    expect(matchesDepartmentFilter([], '')).toBe(true);
  });

  it('matches a department the project is on', () => {
    expect(matchesDepartmentFilter(['ai'], 'ai')).toBe(true);
    expect(matchesDepartmentFilter(['ai'], 'av')).toBe(false);
  });

  // A 50L AI+AV deal IS AI work and must show under the AI filter.
  it('matches multi-department projects under each of their departments', () => {
    expect(matchesDepartmentFilter(['ai', 'av'], 'ai')).toBe(true);
    expect(matchesDepartmentFilter(['ai', 'av'], 'av')).toBe(true);
    expect(matchesDepartmentFilter(['ai', 'av'], 'robotics')).toBe(false);
  });

  it('every department is individually filterable', () => {
    for (const d of PROJECT_DEPARTMENTS) {
      expect(matchesDepartmentFilter([d as ProjectDepartment], d)).toBe(true);
    }
  });

  // Projects created before this field existed have none at all; they must
  // simply not match a department filter, never crash it.
  it('handles a project with no department set', () => {
    expect(matchesDepartmentFilter([], 'ai')).toBe(false);
    expect(matchesDepartmentFilter(undefined, 'ai')).toBe(false);
    expect(matchesDepartmentFilter(null, 'ai')).toBe(false);
  });
});

describe('parseDepartmentAmounts', () => {
  it('keeps amounts only for departments the project actually has', () => {
    expect(parseDepartmentAmounts({ ai: 2700000, av: 2300000 }, ['ai', 'av'])).toEqual({ ai: 2700000, av: 2300000 });
  });

  // Otherwise a project could carry "AV is owed 23L" after AV was removed.
  it('drops amounts for departments not on the project', () => {
    expect(parseDepartmentAmounts({ ai: 2700000, robotics: 500000 }, ['ai'])).toEqual({ ai: 2700000 });
  });

  it('accepts numeric strings, as the number input round-trips them', () => {
    expect(parseDepartmentAmounts({ ai: '2700000' }, ['ai'])).toEqual({ ai: 2700000 });
  });

  // Zero means "not set", not "this department's share is nil" — storing 0
  // would make an unfilled box look like a deliberate answer.
  it('drops zero, negative and unparseable values', () => {
    expect(parseDepartmentAmounts({ ai: 0, av: -5, robotics: 'abc' }, ['ai', 'av', 'robotics'])).toEqual({});
  });

  it('returns empty for junk', () => {
    expect(parseDepartmentAmounts(null, ['ai'])).toEqual({});
    expect(parseDepartmentAmounts(['ai'], ['ai'])).toEqual({});
  });
});

describe('sumDepartmentAmounts', () => {
  it('adds the split back up to the project total', () => {
    expect(sumDepartmentAmounts({ ai: 2700000, av: 2300000 })).toBe(5000000);
    expect(sumDepartmentAmounts({})).toBe(0);
    expect(sumDepartmentAmounts(undefined)).toBe(0);
  });
});

describe('departmentValueOf', () => {
  const adani = { approx_price: 5000000, departments: ['ai', 'av'] as ProjectDepartment[], department_amounts: { ai: 2700000, av: 2300000 } };

  // The headline requirement: no filter shows the whole deal, a department
  // filter shows only that department's share.
  it('gives the full value unfiltered and the share when filtered', () => {
    expect(departmentValueOf(adani, '')).toBe(5000000);
    expect(departmentValueOf(adani, 'ai')).toBe(2700000);
    expect(departmentValueOf(adani, 'av')).toBe(2300000);
  });

  it('gives nothing for a department the project is not on', () => {
    expect(departmentValueOf(adani, 'robotics')).toBe(0);
  });

  // A single-department project has nothing to divide, so its share is its
  // whole price — this is why the form doesn't ask for the number twice.
  it('credits the full price to a single-department project', () => {
    const single = { approx_price: 800000, departments: ['av'] as ProjectDepartment[], department_amounts: {} };
    expect(departmentValueOf(single, 'av')).toBe(800000);
    expect(departmentValueOf(single, 'ai')).toBe(0);
  });

  // Guards against double counting: without a split, crediting the full 50L
  // to BOTH departments would report 100L of pipeline from one project.
  it('credits nothing to a multi-department project with no split recorded', () => {
    const unsplit = { approx_price: 5000000, departments: ['ai', 'av'] as ProjectDepartment[], department_amounts: {} };
    expect(departmentValueOf(unsplit, 'ai')).toBe(0);
    expect(departmentValueOf(unsplit, 'av')).toBe(0);
    expect(departmentValueOf(unsplit, '')).toBe(5000000);
  });

  it('handles a project with no price or no departments', () => {
    expect(departmentValueOf({ approx_price: '', departments: ['ai'] }, 'ai')).toBe(0);
    expect(departmentValueOf({ approx_price: 100 }, 'ai')).toBe(0);
    expect(departmentValueOf({ approx_price: 100 }, '')).toBe(100);
  });

  // The whole point of the split: the per-department figures add back up to
  // the unfiltered total, so no value is invented or lost.
  it('splits without inventing or losing value', () => {
    const perDepartment = PROJECT_DEPARTMENTS.reduce((sum, d) => sum + departmentValueOf(adani, d), 0);
    expect(perDepartment).toBe(departmentValueOf(adani, ''));
  });
});
