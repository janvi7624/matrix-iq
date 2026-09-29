import { describe, it, expect } from 'vitest';
import {
  PROJECT_DEPARTMENTS,
  ProjectDepartment,
  departmentModeFor,
  formatProjectDepartments,
  isCombinedDepartments,
  matchesDepartmentFilter,
  parseProjectDepartments
} from '../../lib/projectDepartmentOptions';

describe('parseProjectDepartments', () => {
  it('keeps only the three real departments', () => {
    expect(parseProjectDepartments(['ai', 'av', 'robotics'])).toEqual(['ai', 'av', 'robotics']);
  });

  it('drops anything not on the fixed list rather than trusting the client', () => {
    expect(parseProjectDepartments(['ai', 'sales', 'hr', ''])).toEqual(['ai']);
  });

  it('collapses duplicates', () => {
    expect(parseProjectDepartments(['av', 'av', 'av'])).toEqual(['av']);
  });

  // Order must not depend on which checkbox was ticked first, or the same
  // combined deal would store two different ways and compare unequal.
  it('normalises order so AI+AV and AV+AI store identically', () => {
    expect(parseProjectDepartments(['av', 'ai'])).toEqual(parseProjectDepartments(['ai', 'av']));
    expect(parseProjectDepartments(['robotics', 'ai'])).toEqual(['ai', 'robotics']);
  });

  it('returns empty for non-arrays and junk', () => {
    expect(parseProjectDepartments(undefined)).toEqual([]);
    expect(parseProjectDepartments(null)).toEqual([]);
    expect(parseProjectDepartments('ai')).toEqual([]);
    expect(parseProjectDepartments([1, {}, true])).toEqual([]);
  });
});

describe('isCombinedDepartments', () => {
  it('is combined only with more than one', () => {
    expect(isCombinedDepartments([])).toBe(false);
    expect(isCombinedDepartments(['ai'])).toBe(false);
    expect(isCombinedDepartments(['ai', 'av'])).toBe(true);
  });
});

describe('formatProjectDepartments', () => {
  it('joins a combined project with +', () => {
    expect(formatProjectDepartments(['ai', 'robotics'])).toBe('AI + Robotics');
  });

  it('shows a dash for a project predating the field', () => {
    expect(formatProjectDepartments([])).toBe('-');
    expect(formatProjectDepartments(undefined)).toBe('-');
    expect(formatProjectDepartments(null)).toBe('-');
  });
});

describe('departmentModeFor', () => {
  it('reports the single department, or combined, or nothing', () => {
    expect(departmentModeFor([])).toBe('');
    expect(departmentModeFor(['av'])).toBe('av');
    expect(departmentModeFor(['av', 'robotics'])).toBe('combined');
  });
});

describe('matchesDepartmentFilter', () => {
  it('matches everything when no filter is set', () => {
    expect(matchesDepartmentFilter([], '')).toBe(true);
    expect(matchesDepartmentFilter(['ai'], '')).toBe(true);
  });

  // The point of the department filter is "what is this department working
  // on" — a combined AI+AV deal genuinely is AI work, so excluding it would
  // under-count that department.
  it('includes combined projects when filtering by one of their departments', () => {
    expect(matchesDepartmentFilter(['ai', 'av'], 'ai')).toBe(true);
    expect(matchesDepartmentFilter(['ai', 'av'], 'av')).toBe(true);
  });

  it('excludes projects the department is not on', () => {
    expect(matchesDepartmentFilter(['ai', 'av'], 'robotics')).toBe(false);
    expect(matchesDepartmentFilter(['ai'], 'av')).toBe(false);
  });

  it('narrows to multi-department deals only when filtering by combined', () => {
    expect(matchesDepartmentFilter(['ai', 'av'], 'combined')).toBe(true);
    expect(matchesDepartmentFilter(['ai'], 'combined')).toBe(false);
    expect(matchesDepartmentFilter([], 'combined')).toBe(false);
  });

  // Projects created before this field exists have no departments at all;
  // they must simply not match a department filter, never crash it.
  it('handles a project with no departments set', () => {
    expect(matchesDepartmentFilter(undefined, 'ai')).toBe(false);
    expect(matchesDepartmentFilter(null, 'ai')).toBe(false);
    expect(matchesDepartmentFilter(undefined, '')).toBe(true);
  });

  it('every department is individually filterable', () => {
    for (const d of PROJECT_DEPARTMENTS) {
      expect(matchesDepartmentFilter([d as ProjectDepartment], d)).toBe(true);
    }
  });
});
