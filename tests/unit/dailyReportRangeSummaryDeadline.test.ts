import { describe, it, expect, vi, beforeEach } from 'vitest';

// The actual live bug: the admin-wide Daily Report brief widget and the Team
// Daily Reports page's Month/Quarter/Year filters both go through
// computeDailyReportRangeSummary (lib/dailyReportService.ts), which — unlike
// the single-day Team view and lib/dailyReportPeriodSummary.ts's range fold —
// had NO missingIsVisibleYet gate at all. Picking "This Month" while the
// month is still in progress (every month, until its last day) counted today
// and every remaining working day as owed-and-unfiled, i.e. missing, before
// anyone could possibly have filed them.

vi.mock('../../lib/db', () => ({ db: {}, isUuid: () => true }));
vi.mock('../../lib/dailyReportConfigStore', () => ({ getDeadlinePolicy: vi.fn(), getDailyReportConfig: vi.fn() }));
vi.mock('../../lib/dailyReportTemplateStore', () => ({ resolveTemplateForDepartment: vi.fn() }));
vi.mock('../../lib/dailyReportStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/dailyReportStore')>();
  return { ...actual, buildHistory: vi.fn(), findReportForDate: vi.fn(), listRevisions: vi.fn(), loadReportStatuses: vi.fn() };
});
vi.mock('../../lib/dailyReportLeaveClaimStore', () => ({ findLiveClaim: vi.fn(), loadClaimStatusByDate: vi.fn(), loadLeaveCoveredKeys: vi.fn() }));
vi.mock('../../lib/dailyReportEditRequestStore', () => ({ findLiveEditRequest: vi.fn() }));
vi.mock('../../lib/dailyReportWarningStore', () => ({ buildWarningSummary: vi.fn(), loadWarningStatusByDate: vi.fn(), loadWarningKeys: vi.fn() }));
vi.mock('../../lib/dailyReportEligibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/dailyReportEligibility')>();
  return { ...actual, listEligibleEmployees: vi.fn() };
});
vi.mock('../../lib/dailyReportAccess', () => ({ resolveDailyReportScope: vi.fn() }));
vi.mock('../../lib/salesDailyAutoFetch', () => ({ computeSalesAutoMatrix: vi.fn(), mergeAutoMatrix: vi.fn() }));
vi.mock('../../lib/gemProposalAutoFetch', () => ({ computeGemProposalEntries: vi.fn(), mergeAutoGemEntries: vi.fn() }));
vi.mock('../../lib/dailyReportTemplates', () => ({ computeDerivedValues: vi.fn(), isEntryOverdue: vi.fn() }));
// lib/dailyReportTime is left REAL on purpose — workingDaysBetween and
// missingIsVisibleYet are pure date math, and real date math is exactly what
// this bug was about.

import { getDeadlinePolicy } from '../../lib/dailyReportConfigStore';
import { loadReportStatuses } from '../../lib/dailyReportStore';
import { loadLeaveCoveredKeys } from '../../lib/dailyReportLeaveClaimStore';
import { listEligibleEmployees } from '../../lib/dailyReportEligibility';
import { computeDailyReportRangeSummary, aggregateRangeRowsByDepartment } from '../../lib/dailyReportService';

const policyMock = vi.mocked(getDeadlinePolicy);
const statusesMock = vi.mocked(loadReportStatuses);
const leaveMock = vi.mocked(loadLeaveCoveredKeys);
const employeesMock = vi.mocked(listEligibleEmployees);

// A working-week policy with no public holidays, so every weekday in the
// fixed window below is a working day — keeps the fixture's day count
// predictable without needing to know this policy's real defaults.
const POLICY = { workingDays: [1, 2, 3, 4, 5], holidays: [], trackingStartDate: '2026-01-01' };

function employee(id: string, departmentId = 'dept-1', departmentName = 'AI') {
  return { id, name: id, username: id, departmentId, departmentName, templateKey: 'ai', dateOfJoining: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
  policyMock.mockResolvedValue(POLICY as never);
  leaveMock.mockResolvedValue(new Map());
  statusesMock.mockResolvedValue(new Map());
});

describe('computeDailyReportRangeSummary — a day not yet due is not counted as missing', () => {
  // A full week, Mon 26th through Fri 30th — all 5 are working days under
  // POLICY. "Now" sits on Thursday the 29th, after the (updated) 19:00 IST
  // cut-off — so the 26th-29th are missing-visible, the 30th is not.
  const FROM = '2026-10-26';
  const TO = '2026-10-30';
  const NOW = new Date('2026-10-29T19:30:00+05:30');

  it('excludes the not-yet-due day from expected/missing entirely, for a range extending past today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    employeesMock.mockResolvedValue([employee('alice')]);

    const summary = await computeDailyReportRangeSummary(['dept-1'], FROM, TO);
    const [row] = summary.rows;

    // 4 working days have reached their deadline (26,27,28,29); the 30th has
    // not — excluded from `expected`, not counted as missing.
    expect(row.expected).toBe(4);
    expect(row.missing).toBe(4);
    expect(row.submitted).toBe(0);

    vi.useRealTimers();
  });

  it('still credits a submission on a not-yet-due day — filing early is never ignored', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    employeesMock.mockResolvedValue([employee('alice')]);
    statusesMock.mockResolvedValue(new Map([['alice|2026-10-30', { submission_status: 'SUBMITTED', is_late: false }]]) as never);

    const summary = await computeDailyReportRangeSummary(['dept-1'], FROM, TO);
    const [row] = summary.rows;

    // The 30th's early submission is credited (expected+1, submitted+1) on
    // top of the 4 already-due days.
    expect(row.expected).toBe(5);
    expect(row.submitted).toBe(1);
    expect(row.missing).toBe(4);

    vi.useRealTimers();
  });

  it('a range entirely in the past is completely unaffected by the cut-off', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    employeesMock.mockResolvedValue([employee('alice')]);

    const summary = await computeDailyReportRangeSummary(['dept-1'], '2026-10-19', '2026-10-23');
    const [row] = summary.rows;

    expect(row.expected).toBe(5);
    expect(row.missing).toBe(5);

    vi.useRealTimers();
  });

  it('the department rollup the admin brief widget actually renders reflects the same exclusion', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    employeesMock.mockResolvedValue([employee('alice', 'dept-1', 'AI'), employee('bob', 'dept-1', 'AI')]);

    const summary = await computeDailyReportRangeSummary(['dept-1'], FROM, TO);
    const [dept] = aggregateRangeRowsByDepartment(summary.rows);

    // 2 employees x 4 due days = 8 expected, all missing — the two 30th
    // obligations are excluded from both employees' rows, and the rollup is
    // a plain sum, so it inherits the exclusion with no separate fix needed.
    expect(dept).toMatchObject({ expected: 8, missing: 8, submitted: 0 });

    vi.useRealTimers();
  });
});
