import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/db', () => ({
  sequelize: { query: vi.fn() },
  db: {},
  isUuid: () => true
}));
vi.mock('../../lib/email/notifications', () => ({ sendMissingProjectDetailsEmail: vi.fn() }));

import { sequelize } from '../../lib/db';
import { sendMissingProjectDetailsEmail } from '../../lib/email/notifications';
import { buildProjectDetailReminderReport, sendProjectDetailReminders } from '../../lib/projectDetailReminders';

const query = vi.mocked(sequelize.query);
const sendMail = vi.mocked(sendMissingProjectDetailsEmail);

// A project with every field filled, so a test only has to state what is wrong.
const COMPLETE = {
  label: 'Acme Ltd',
  owner_username: 'alice',
  approx_price: '250000.00',
  expected_closing_date: '2026-11-01',
  remarks: 'Scope agreed',
  project_lead_id: 'lead-1',
  opportunity_type: 'project'
};

// buildProjectDetailReminderReport issues its three reads in a fixed order:
// sales, then TMS, then the owners it needs names/addresses for.
function mockReads(sales: unknown[], tms: unknown[], users: unknown[]) {
  query.mockReset();
  query
    .mockResolvedValueOnce(sales as never)
    .mockResolvedValueOnce(tms as never)
    .mockResolvedValueOnce(users as never);
}

const ALICE = { username: 'alice', name: 'Alice A', email: 'alice@example.com', status: 'active' };

describe('buildProjectDetailReminderReport', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('leaves out a project that has everything', async () => {
    mockReads([COMPLETE], [], []);
    const report = await buildProjectDetailReminderReport();
    expect(report.mailable).toEqual([]);
    expect(report.projectsWithGaps).toBe(0);
    expect(report.salesScanned).toBe(1);
  });

  it('names the blank sales fields the way the project page names them', async () => {
    mockReads([{ ...COMPLETE, approx_price: null, expected_closing_date: null }], [], [ALICE]);
    const report = await buildProjectDetailReminderReport();
    expect(report.mailable).toHaveLength(1);
    expect(report.mailable[0].items[0].missing).toEqual(['Approx. Project Price', 'Expected Closing Date']);
  });

  it('does not count a blank department, which is required at creation only', async () => {
    // No `departments` key at all — the report must not invent a gap from it.
    mockReads([COMPLETE], [], []);
    const report = await buildProjectDetailReminderReport();
    expect(report.projectsWithGaps).toBe(0);
  });

  // Worth pinning down because it differs from the obvious SQL reading
  // (`approx_price <= 0`): the app's own rule only counts a price as missing
  // when the column is NULL. A deliberate zero is a filled-in price, so the
  // owner is not chased about it.
  it('counts a zero price as filled, matching the app rule rather than <= 0', async () => {
    mockReads([{ ...COMPLETE, approx_price: '0' }], [], [ALICE]);
    expect((await buildProjectDetailReminderReport()).projectsWithGaps).toBe(0);
  });

  it('counts a null price as missing', async () => {
    mockReads([{ ...COMPLETE, approx_price: null }], [], [ALICE]);
    const report = await buildProjectDetailReminderReport();
    expect(report.mailable[0].items[0].missing).toEqual(['Approx. Project Price']);
  });

  it('flags a TMS project with no tasks, and attributes it to its manager', async () => {
    mockReads([], [{ project_code: 'TMS-PRJ-0011', label: 'Nimit shah', owner_username: 'alice', task_count: '0' }], [ALICE]);
    const report = await buildProjectDetailReminderReport();
    expect(report.mailable[0].items).toEqual([
      { kind: 'TMS', label: 'TMS-PRJ-0011 — Nimit shah', missing: ['Tasks broken down'] }
    ]);
  });

  it('puts an ownerless TMS project in unreachable, where there is nobody to email', async () => {
    mockReads([], [{ project_code: 'TMS-PRJ-0032', label: 'Whirlpool', owner_username: null, task_count: '0' }], []);
    const report = await buildProjectDetailReminderReport();
    expect(report.mailable).toEqual([]);
    expect(report.unreachable).toHaveLength(1);
    expect(report.unreachable[0].items[0].missing).toEqual(['Project owner', 'Tasks broken down']);
  });

  it('treats an inactive owner as unreachable rather than mailing them', async () => {
    mockReads([{ ...COMPLETE, approx_price: null }], [], [{ ...ALICE, status: 'inactive' }]);
    const report = await buildProjectDetailReminderReport();
    expect(report.mailable).toEqual([]);
    expect(report.unreachable).toHaveLength(1);
  });

  it('treats an owner with no address on file as unreachable', async () => {
    mockReads([{ ...COMPLETE, approx_price: null }], [], [{ ...ALICE, email: null }]);
    const report = await buildProjectDetailReminderReport();
    expect(report.mailable).toEqual([]);
    expect(report.unreachable).toHaveLength(1);
  });

  it('groups several projects under one person, biggest backlog first', async () => {
    mockReads(
      [
        { ...COMPLETE, owner_username: 'bob', approx_price: null },
        { ...COMPLETE, owner_username: 'alice', approx_price: null },
        { ...COMPLETE, owner_username: 'alice', expected_closing_date: null }
      ],
      [],
      [ALICE, { username: 'bob', name: 'Bob B', email: 'bob@example.com', status: 'active' }]
    );
    const report = await buildProjectDetailReminderReport();
    expect(report.mailable.map((p) => p.username)).toEqual(['alice', 'bob']);
    expect(report.mailable[0].items).toHaveLength(2);
    expect(report.projectsWithGaps).toBe(3);
  });
});

describe('sendProjectDetailReminders', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('sends one email per person, each carrying only their own projects', async () => {
    mockReads(
      [
        { ...COMPLETE, owner_username: 'alice', approx_price: null },
        { ...COMPLETE, owner_username: 'bob', approx_price: null }
      ],
      [],
      [ALICE, { username: 'bob', name: 'Bob B', email: 'bob@example.com', status: 'active' }]
    );
    sendMail.mockResolvedValue(true);

    const result = await sendProjectDetailReminders();

    expect(result.sent).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.failed).toEqual([]);
    expect(sendMail).toHaveBeenCalledTimes(2);
    for (const call of sendMail.mock.calls) {
      expect(call[0].items).toHaveLength(1);
    }
  });

  it('only mails the people asked for, so a send can never be wider than the preview', async () => {
    mockReads(
      [
        { ...COMPLETE, owner_username: 'alice', approx_price: null },
        { ...COMPLETE, owner_username: 'bob', approx_price: null }
      ],
      [],
      [ALICE, { username: 'bob', name: 'Bob B', email: 'bob@example.com', status: 'active' }]
    );
    sendMail.mockResolvedValue(true);

    const result = await sendProjectDetailReminders(['bob']);

    expect(result.sent).toEqual(['bob@example.com']);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].email).toBe('bob@example.com');
  });

  it('reports a delivery that failed instead of counting it as sent', async () => {
    mockReads([{ ...COMPLETE, owner_username: 'alice', approx_price: null }], [], [ALICE]);
    sendMail.mockResolvedValue(false);

    const result = await sendProjectDetailReminders();

    expect(result.sent).toEqual([]);
    expect(result.failed).toEqual([{ email: 'alice@example.com', name: 'Alice A' }]);
  });
});
