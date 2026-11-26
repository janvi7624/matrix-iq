import { describe, it, expect } from 'vitest';
import { narrowDepartmentScope } from '../../lib/dailyReportDepartmentFilter';

describe('narrowDepartmentScope', () => {
  const scope = ['d1', 'd2', 'd3'];

  it('is the whole scope, not narrowed, when nothing is asked for', () => {
    expect(narrowDepartmentScope(scope, undefined)).toEqual({ departmentIds: scope, narrowed: false });
    expect(narrowDepartmentScope(scope, '')).toEqual({ departmentIds: scope, narrowed: false });
    expect(narrowDepartmentScope(scope, [])).toEqual({ departmentIds: scope, narrowed: false });
  });

  it('narrows to a single legacy id', () => {
    expect(narrowDepartmentScope(scope, 'd2')).toEqual({ departmentIds: ['d2'], narrowed: true });
  });

  it('narrows to several ids, dropping any outside the scope', () => {
    expect(narrowDepartmentScope(scope, ['d3', 'other', 'd1'])).toEqual({ departmentIds: ['d1', 'd3'], narrowed: true });
  });

  it('falls back to the scope (never widens) when no requested id is in it', () => {
    expect(narrowDepartmentScope(scope, ['other'])).toEqual({ departmentIds: scope, narrowed: true });
    expect(narrowDepartmentScope([], ['d1'])).toEqual({ departmentIds: [], narrowed: true });
  });
});
