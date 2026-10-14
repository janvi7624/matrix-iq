import { describe, it, expect, vi, beforeEach } from 'vitest';

// Excusing specific people from daily reports.
//
// The filter lives in ONE place — listEligibleEmployees, the single source
// of "who owes a report" — because the employee page, the manager dashboard,
// the scheduler and analytics all read it. Excusing someone in only some of
// those would leave them nagged by the scheduler while invisible on the
// dashboard, or counted as missing in a compliance figure nobody can
// reconcile. These tests pin that the filter is applied there and that it is
// narrow: being excused must not excuse a colleague who merely shares a name
// or a department.

const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../lib/db', () => ({ sequelize: { query: m.query }, db: {}, isUuid: () => true }));
vi.mock('../../lib/dailyReportTemplateStore', () => ({ listTemplateAssignments: vi.fn() }));
vi.mock('../../lib/dailyReportConfigStore', () => ({ getDailyReportConfig: vi.fn() }));

import { listTemplateAssignments } from '../../lib/dailyReportTemplateStore';
import { getDailyReportConfig } from '../../lib/dailyReportConfigStore';
import { listEligibleEmployees } from '../../lib/dailyReportEligibility';

const assignments = vi.mocked(listTemplateAssignments);
const config = vi.mocked(getDailyReportConfig);

const PRAGNESH = 'u-pragnesh';
const MANSI_JANI = 'u-mansi-jani';
const MANSI_MENON = 'u-mansi-menon';
const SAMEER = 'u-sameer';

beforeEach(() => {
  vi.clearAllMocks();
  assignments.mockResolvedValue([
    { id: 't1', departmentId: 'd-bo', departmentName: 'Back Office', templateKey: 'backoffice', status: 'active', overrides: {}, extraManagerIds: [], notes: '', updatedAt: '', updatedByName: '' },
    { id: 't2', departmentId: 'd-ai', departmentName: 'AI', templateKey: 'ai', status: 'active', overrides: {}, extraManagerIds: [], notes: '', updatedAt: '', updatedByName: '' },
    { id: 't3', departmentId: 'd-admin', departmentName: 'Administration', templateKey: 'not_configured', status: 'not_configured', overrides: {}, extraManagerIds: [], notes: '', updatedAt: '', updatedByName: '' }
  ] as never);
  m.query.mockResolvedValue([
    { id: PRAGNESH, username: 'pragneshkumar.trivedi', name: 'PragneshKumar Trivedi', email: '', department_id: 'd-bo', date_of_joining: null },
    { id: MANSI_MENON, username: 'mansi.menon', name: 'Mansi Menon', email: '', department_id: 'd-ai', date_of_joining: null },
    { id: SAMEER, username: 'sameer', name: 'Sameer Gediya', email: '', department_id: 'd-ai', date_of_joining: null }
  ]);
  config.mockResolvedValue({ exempt_employee_ids: [] } as never);
});

describe('the excused list', () => {
  it('leaves everyone expected when nobody is excused', async () => {
    const eligible = await listEligibleEmployees();
    expect(eligible.map((e) => e.username).sort()).toEqual(['mansi.menon', 'pragneshkumar.trivedi', 'sameer']);
  });

  it('drops an excused person even though their department files', async () => {
    // Back Office has an approved format, so the ONLY thing taking Pragnesh
    // out is the exemption — which is the case that matters.
    config.mockResolvedValue({ exempt_employee_ids: [PRAGNESH] } as never);
    const eligible = await listEligibleEmployees();
    expect(eligible.map((e) => e.username)).not.toContain('pragneshkumar.trivedi');
    expect(eligible).toHaveLength(2);
  });

  it('does not excuse a colleague in the same department', async () => {
    // Excusing one AI engineer must not quietly excuse the other.
    config.mockResolvedValue({ exempt_employee_ids: [MANSI_MENON] } as never);
    const eligible = await listEligibleEmployees();
    expect(eligible.map((e) => e.username)).toContain('sameer');
    expect(eligible.map((e) => e.username)).not.toContain('mansi.menon');
  });

  it('ignores an id for somebody who is not eligible anyway', async () => {
    // Mansi Jani sits in Administration, which has no format — she is
    // already outside the expected set, so listing her changes nothing and
    // must not disturb anyone else.
    config.mockResolvedValue({ exempt_employee_ids: [MANSI_JANI] } as never);
    const eligible = await listEligibleEmployees();
    expect(eligible).toHaveLength(3);
  });

  it('can excuse several people at once', async () => {
    config.mockResolvedValue({ exempt_employee_ids: [PRAGNESH, MANSI_JANI, MANSI_MENON] } as never);
    const eligible = await listEligibleEmployees();
    expect(eligible.map((e) => e.username)).toEqual(['sameer']);
  });

  it('still excludes an unconfigured department regardless of the list', async () => {
    // The two exclusions are independent: an empty excused list must not
    // drag Administration's staff back into scope.
    config.mockResolvedValue({ exempt_employee_ids: [] } as never);
    const eligible = await listEligibleEmployees();
    expect(eligible.map((e) => e.departmentName)).not.toContain('Administration');
  });
});
