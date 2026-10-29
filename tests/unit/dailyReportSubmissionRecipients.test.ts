import { describe, it, expect, vi, beforeEach } from 'vitest';

// Who gets told that a daily report was filed.
//
// A department head files a report like everybody else, and the recipient
// list is "who manages this department" — so without a filter they appear in
// their own list and the app mails them "<you> submitted their daily report"
// about the button they just clicked. Pinned here because the defect is
// invisible to anybody who is not themselves a manager of their own
// department, which is exactly the person least likely to be testing.

const m = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
  findAll: vi.fn(),
  notifyUsers: vi.fn(),
  sendDailyReportEmail: vi.fn()
}));

vi.mock('../../lib/db', () => ({
  db: {
    DailyReportNotificationEvent: {
      create: m.create,
      update: m.update,
      destroy: m.destroy,
      findAll: m.findAll
    },
    User: {}
  },
  sequelize: {},
  isUuid: () => true
}));
vi.mock('../../lib/notificationStore', () => ({ notifyUsers: m.notifyUsers }));
vi.mock('../../lib/email/notifications', () => ({
  dailyReportUrl: (path: string) => `https://example.test${path}`,
  sendDailyReportEmail: m.sendDailyReportEmail
}));

import { approvalRecipients, notifyReportSubmitted, submissionRecipients, NotifyTarget } from '../../lib/dailyReportNotify';

const target = (id: string, username: string): NotifyTarget => ({
  id,
  username,
  name: username,
  email: `${username}@example.test`
});

const HEAD = target('emp-1', 'bharat.kumar');
const OTHER_MANAGER = target('mgr-2', 'mayank.jani');

function notice(overrides: Partial<Parameters<typeof notifyReportSubmitted>[0]> = {}) {
  return {
    reportId: 'rep-1',
    employeeId: 'emp-1',
    employeeName: 'Bharat Kumar',
    departmentName: 'GEM-Sales',
    reportDate: '2026-10-29',
    submittedAt: new Date('2026-10-29T12:00:00Z'),
    deadlineAt: new Date('2026-10-29T15:30:00Z'),
    late: false,
    entryCount: 7,
    managers: [HEAD],
    ...overrides
  };
}

describe('submissionRecipients', () => {
  it('drops the employee from their own recipient list', () => {
    expect(submissionRecipients('emp-1', [HEAD, OTHER_MANAGER])).toEqual([OTHER_MANAGER]);
  });

  it('leaves every other manager in place', () => {
    expect(submissionRecipients('emp-99', [HEAD, OTHER_MANAGER])).toEqual([HEAD, OTHER_MANAGER]);
  });

  it('returns nobody when the only manager is the employee', () => {
    expect(submissionRecipients('emp-1', [HEAD])).toEqual([]);
  });

  // Department Master supplies ids; a recipient without one is somebody
  // else's record and must not be filtered away by an undefined === undefined
  // accident.
  it('keeps a recipient that carries no id', () => {
    const noId: NotifyTarget = { username: 'x', name: 'X', email: 'x@example.test' };
    expect(submissionRecipients('emp-1', [noId])).toEqual([noId]);
  });
});

describe('approvalRecipients', () => {
  it('drops the subject when somebody else can decide', () => {
    expect(approvalRecipients('emp-1', [HEAD, OTHER_MANAGER])).toEqual([OTHER_MANAGER]);
  });

  // The difference from submissionRecipients, and the reason both exist: a
  // submission notice nobody needs can simply not be sent, but a request
  // waiting on a decision has to reach an inbox or it sits PENDING forever.
  it('keeps the subject when they are the only possible approver', () => {
    expect(approvalRecipients('emp-1', [HEAD])).toEqual([HEAD]);
  });

  it('is empty only when there was nobody to begin with', () => {
    expect(approvalRecipients('emp-1', [])).toEqual([]);
  });
});

describe('notifyReportSubmitted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.create.mockResolvedValue({ get: () => 'event-1' });
    m.update.mockResolvedValue(undefined);
    m.sendDailyReportEmail.mockResolvedValue(true);
  });

  it('sends nothing at all when the submitter is the only manager', async () => {
    await notifyReportSubmitted(notice());
    expect(m.notifyUsers).not.toHaveBeenCalled();
    expect(m.sendDailyReportEmail).not.toHaveBeenCalled();
    // And no ledger row: a claimed slot with no send looks the same as a
    // send that happened, which would mute a legitimate later notification.
    expect(m.create).not.toHaveBeenCalled();
  });

  it('still tells the other managers, but never the submitter', async () => {
    await notifyReportSubmitted(notice({ managers: [HEAD, OTHER_MANAGER] }));
    expect(m.notifyUsers).toHaveBeenCalledWith(['mayank.jani'], expect.anything());
    expect(m.sendDailyReportEmail).toHaveBeenCalledTimes(1);
    expect(m.sendDailyReportEmail).toHaveBeenCalledWith('mayank.jani@example.test', expect.objectContaining({ kind: 'submitted' }));
  });
});
