import { describe, it, expect } from 'vitest';
import { resolveSalesPersonName } from '../../lib/projectSalesPersonName';

// The actual bug report: in Sales Project, the sales person showed as their
// USERNAME while the assigned technical person correctly showed their NAME
// — because sales_person/created_by are stored/compared as username (the
// real ownership key, used across filters), with no resolved display name
// anywhere, unlike assigned_technical_person_name's own join. This pins the
// shared resolution now used by both lib/projectStore.ts's toRecord and
// lib/partnerProjectStore.ts's salespersonNameOf.
describe('resolveSalesPersonName', () => {
  it('prefers the creator\'s real name over their username', () => {
    expect(resolveSalesPersonName({ name: 'Priya Sharma', username: 'priya.sharma' }, 'priya.sharma')).toBe('Priya Sharma');
  });

  it('falls back to the username when the account has no display name set', () => {
    expect(resolveSalesPersonName({ name: '', username: 'priya.sharma' }, 'priya.sharma')).toBe('priya.sharma');
    expect(resolveSalesPersonName({ username: 'priya.sharma' }, 'priya.sharma')).toBe('priya.sharma');
  });

  it('falls back to the raw sales_person column when there is no creator join at all', () => {
    // A deactivated/deleted account, or data predating this resolution.
    expect(resolveSalesPersonName(null, 'priya.sharma')).toBe('priya.sharma');
    expect(resolveSalesPersonName(undefined, 'priya.sharma')).toBe('priya.sharma');
  });

  it('is empty when nobody owns the project at all', () => {
    expect(resolveSalesPersonName(null, '')).toBe('');
    expect(resolveSalesPersonName(null, null)).toBe('');
    expect(resolveSalesPersonName(null, undefined)).toBe('');
  });
});
