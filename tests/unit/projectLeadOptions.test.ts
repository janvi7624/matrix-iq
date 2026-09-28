import { describe, it, expect } from 'vitest';
import { defaultLeadIdFor, nextLeadOnTypeChange, parseOpportunityType, ProjectLeadOption } from '../../lib/projectLeadOptions';

const MANOJ: ProjectLeadOption = { id: 'id-manoj', username: 'manoj', name: 'Manoj Menon' };
const PANKAJ: ProjectLeadOption = { id: 'id-pankaj', username: 'pankaj', name: 'Pankaj Sharma' };
const LEADS = [MANOJ, PANKAJ];

describe('parseOpportunityType', () => {
  it('accepts exactly distribution and project', () => {
    expect(parseOpportunityType('distribution')).toBe('distribution');
    expect(parseOpportunityType('project')).toBe('project');
  });
  it('rejects anything else, blank and non-strings included', () => {
    for (const bad of ['', 'Distribution', 'projects', ' project', null, undefined, 1, {}]) expect(parseOpportunityType(bad)).toBeNull();
  });
});

describe('defaultLeadIdFor', () => {
  it('Distribution defaults to Manoj Menon, Project to Pankaj Sharma', () => {
    expect(defaultLeadIdFor('distribution', LEADS)).toBe(MANOJ.id);
    expect(defaultLeadIdFor('project', LEADS)).toBe(PANKAJ.id);
  });
  it('is blank with no type, or when that lead is not on the list (e.g. deactivated)', () => {
    expect(defaultLeadIdFor('', LEADS)).toBe('');
    expect(defaultLeadIdFor('distribution', [PANKAJ])).toBe('');
  });
});

describe('nextLeadOnTypeChange', () => {
  it('fills the default when the lead is still blank, touched or not', () => {
    expect(nextLeadOnTypeChange('', false, 'project', LEADS)).toBe(PANKAJ.id);
    expect(nextLeadOnTypeChange('', false, 'distribution', LEADS)).toBe(MANOJ.id);
    expect(nextLeadOnTypeChange('', true, 'project', LEADS)).toBe(PANKAJ.id);
  });
  it('moves the lead along with the type while nobody has picked one by hand', () => {
    expect(nextLeadOnTypeChange(PANKAJ.id, false, 'distribution', LEADS)).toBe(MANOJ.id);
    expect(nextLeadOnTypeChange(MANOJ.id, false, 'project', LEADS)).toBe(PANKAJ.id);
  });
  it('never moves a hand-picked lead — e.g. Manoj kept on a Project deal, even when he equals that type\'s default', () => {
    expect(nextLeadOnTypeChange(MANOJ.id, true, 'project', LEADS)).toBe(MANOJ.id);
    expect(nextLeadOnTypeChange(MANOJ.id, true, 'distribution', LEADS)).toBe(MANOJ.id);
    expect(nextLeadOnTypeChange(PANKAJ.id, true, 'distribution', LEADS)).toBe(PANKAJ.id);
  });
  it('clears an untouched lead when the type is cleared', () => {
    expect(nextLeadOnTypeChange(PANKAJ.id, false, '', LEADS)).toBe('');
  });
});
