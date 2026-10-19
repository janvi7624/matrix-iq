import { describe, it, expect, vi, beforeEach } from 'vitest';

// The dashboard shortcut's decision: should this person be prompted to file
// today, and have they already.
//
// Every `required: false` branch mirrors a rule the scheduler applies. If
// they drift apart the shortcut starts inviting people to open a page that
// only tells them they are not expected to file — or, worse, stops
// prompting somebody the scheduler will warn tomorrow. That is invisible on
// screen, so it is pinned here.

const m = vi.hoisted(() => ({ findByPk: vi.fn() }));

vi.mock('../../lib/db', () => ({
  db: { User: { findByPk: m.findByPk }, Department: {}, DailyReportLeaveClaim: {} },
  sequelize: {},
  isUuid: () => true
}));
vi.mock('../../lib/dailyReportConfigStore', () => ({
  getDailyReportConfig: vi.fn(),
  getDeadlinePolicy: vi.fn()
}));
vi.mock('../../lib/dailyReportTemplateStore', () => ({ resolveTemplateForDepartment: vi.fn() }));
vi.mock('../../lib/dailyReportStore', () => ({
  SUBMITTED_STATUSES: ['SUBMITTED', 'SUBMITTED_LATE'],
  findReportForDate: vi.fn(),
  buildHistory: vi.fn(),
  listRevisions: vi.fn(),
  loadReportStatuses: vi.fn()
}));
vi.mock('../../lib/dailyReportLeaveClaimStore', () => ({
  findLiveClaim: vi.fn(),
  loadClaimStatusByDate: vi.fn(),
  loadLeaveCoveredKeys: vi.fn()
}));
vi.mock('../../lib/dailyReportWarningStore', () => ({
  buildWarningSummary: vi.fn(),
  loadWarningStatusByDate: vi.fn(),
  loadWarningKeys: vi.fn()
}));
vi.mock('../../lib/dailyReportEligibility', () => ({
  employeeOwesDate: vi.fn(),
  listEligibleEmployees: vi.fn()
}));
vi.mock('../../lib/dailyReportAccess', () => ({ resolveDailyReportScope: vi.fn() }));

import { getDailyReportConfig, getDeadlinePolicy } from '../../lib/dailyReportConfigStore';
import { resolveTemplateForDepartment } from '../../lib/dailyReportTemplateStore';
import { findReportForDate } from '../../lib/dailyReportStore';
import { findLiveClaim } from '../../lib/dailyReportLeaveClaimStore';
import { buildMyDailyReportStatus } from '../../lib/dailyReportService';
import { istDate } from '../../lib/dailyReportTime';

const config = vi.mocked(getDailyReportConfig);
const policy = vi.mocked(getDeadlinePolicy);
const template = vi.mocked(resolveTemplateForDepartment);
const report = vi.mocked(findReportForDate);
const claim = vi.mocked(findLiveClaim);

const EMPLOYEE = 'u-1';

/** Mon–Sat, so a weekday test date is a working day. */
const MON_SAT = {
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: [],
  observeHolidays: false,
  offNthWeekdays: [],
  deadlineTime: '11:00',
  eveningReminderTime: '21:00',
  finalReminderTime: '10:00'
};

function employeeRow(departmentId: string | null) {
  return {
    get: () => ({
      id: EMPLOYEE,
      username: 'priya',
      name: 'Priya',
      departmentId,
      department: 'AI',
      departmentRef: departmentId ? { id: departmentId, name: 'AI' } : null
    })
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  policy.mockResolvedValue(MON_SAT as never);
  config.mockResolvedValue({ exempt_employee_ids: [] } as never);
  template.mockResolvedValue({ configured: true } as never);
  report.mockResolvedValue(null);
  claim.mockResolvedValue(null);
  m.findByPk.mockResolvedValue(employeeRow('d-ai'));
});

describe('when the shortcut should prompt', () => {
  it('prompts an ordinary employee with nothing filed', async () => {
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.required).toBe(true);
    expect(status.submission_status).toBe('MISSING');
    expect(status.not_required_reason).toBe('');
  });

  it('still prompts when only a DRAFT exists', async () => {
    // A draft is not filed. Treating it as done would be the shortcut
    // telling somebody they are finished when the scheduler will warn them.
    report.mockResolvedValue({ submission_status: 'DRAFT' } as never);
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.required).toBe(true);
    expect(status.submission_status).toBe('DRAFT');
  });

  it('reports a filed report as done', async () => {
    report.mockResolvedValue({ submission_status: 'SUBMITTED' } as never);
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.required).toBe(true);
    expect(status.submission_status).toBe('SUBMITTED');
    // Already filed, so never flagged overdue however late it is.
    expect(status.past_deadline).toBe(false);
  });

  it('does not flag a late submission as still overdue', async () => {
    report.mockResolvedValue({ submission_status: 'SUBMITTED_LATE' } as never);
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.past_deadline).toBe(false);
  });
});

describe('when the shortcut must stay silent', () => {
  it('says nothing to an excused account', async () => {
    config.mockResolvedValue({ exempt_employee_ids: [EMPLOYEE] } as never);
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.required).toBe(false);
    expect(status.not_required_reason).toBe('exempt');
  });

  it('says nothing when the department has no approved format', async () => {
    template.mockResolvedValue({ configured: false } as never);
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.required).toBe(false);
    expect(status.not_required_reason).toBe('not_configured');
  });

  it('says nothing to an account with no department', async () => {
    // Superadmin accounts carry none.
    m.findByPk.mockResolvedValue(employeeRow(null));
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.required).toBe(false);
    expect(status.not_required_reason).toBe('no_department');
  });

  it('says nothing on a non-working day', async () => {
    // Today declared a holiday, rather than an empty working week — an
    // empty week is a misconfiguration the config store refuses to save,
    // and nextWorkingDay rightly throws on it. This is the real case.
    policy.mockResolvedValue({ ...MON_SAT, holidays: [istDate(new Date())], observeHolidays: true } as never);
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.required).toBe(false);
    expect(status.not_required_reason).toBe('non_working_day');
  });

  it('says nothing while a leave claim covers the day', async () => {
    // Pending counts, exactly as it does for the scheduler — nobody should
    // be chased while HR is still deciding.
    claim.mockResolvedValue({ status: 'PENDING' } as never);
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.required).toBe(false);
    expect(status.not_required_reason).toBe('non_working_day');
  });

  it('still reports a report filed on an excused day', async () => {
    // Saying MISSING when something was filed would be a plain lie.
    claim.mockResolvedValue({ status: 'APPROVED' } as never);
    report.mockResolvedValue({ submission_status: 'SUBMITTED' } as never);
    const status = await buildMyDailyReportStatus(EMPLOYEE);
    expect(status.required).toBe(false);
    expect(status.submission_status).toBe('SUBMITTED');
  });

  it('checks exemption before the template, so an excused account in an unconfigured department reads as excused', async () => {
    config.mockResolvedValue({ exempt_employee_ids: [EMPLOYEE] } as never);
    template.mockResolvedValue({ configured: false } as never);
    expect((await buildMyDailyReportStatus(EMPLOYEE)).not_required_reason).toBe('exempt');
  });
});
