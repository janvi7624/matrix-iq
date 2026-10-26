import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Op } from 'sequelize';

// Permission to edit a filed report. The two properties that matter are that
// an approval can be spent exactly ONCE and that it stops working when it
// expires — everything else is bookkeeping.

const m = vi.hoisted(() => ({
  create: vi.fn(),
  findByPk: vi.fn(),
  findOne: vi.fn(),
  findAll: vi.fn(),
  update: vi.fn()
}));

vi.mock('../../lib/db', () => ({
  db: {
    DailyReportEditRequest: m,
    User: {},
    Department: {},
    Sequelize: { literal: (s: string) => ({ literal: s }) }
  },
  sequelize: {},
  isUuid: (v: unknown) => typeof v === 'string' && v.length > 0
}));

import { db as dbMock } from '../../lib/db';
import {
  consumeEditGrant,
  createEditRequest,
  decideEditRequest,
  findLiveEditRequest,
  EDIT_GRANT_HOURS,
  DailyReportEditRequestError
} from '../../lib/dailyReportEditRequestStore';

function row(over: Record<string, unknown> = {}) {
  return {
    get: () => ({
      id: 'req-1',
      report_id: 'rep-1',
      employee_id: 'emp-1',
      employee: { name: 'Asha' },
      department: { name: 'Sales' },
      report_date: '2026-10-24',
      reason: 'Wrong figure in the AV column',
      status: 'PENDING',
      decided_at: null,
      decision_reason: '',
      grant_expires_at: null,
      used_at: null,
      createdAt: new Date('2026-10-26T06:00:00Z'),
      ...over
    })
  };
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.findOne.mockResolvedValue(null);
  m.findByPk.mockResolvedValue(row());
  m.create.mockResolvedValue({ get: () => 'req-1' });
  m.update.mockResolvedValue([1]);
});

describe('asking for permission', () => {
  it('insists on a reason — the manager decides on it', async () => {
    await expect(createEditRequest({ reportId: 'rep-1', employeeId: 'emp-1', departmentId: null, reportDate: '2026-10-24', reason: '   ' }))
      .rejects.toThrow(DailyReportEditRequestError);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('refuses a second request while one is still pending', async () => {
    m.findOne.mockResolvedValue(row({ status: 'PENDING' }));
    await expect(createEditRequest({ reportId: 'rep-1', employeeId: 'emp-1', departmentId: null, reportDate: '2026-10-24', reason: 'Fix it' }))
      .rejects.toThrow(/not decided yet/i);
  });

  it('refuses a second request while a grant is still unspent', async () => {
    m.findOne.mockResolvedValue(row({ status: 'APPROVED', grant_expires_at: new Date(Date.now() + 3600_000) }));
    await expect(createEditRequest({ reportId: 'rep-1', employeeId: 'emp-1', departmentId: null, reportDate: '2026-10-24', reason: 'Fix it' }))
      .rejects.toThrow(/already been granted/i);
  });
});

describe('the manager deciding', () => {
  it('insists on a reason for BOTH outcomes', async () => {
    await expect(decideEditRequest('req-1', 'APPROVED', 'mgr-1', '')).rejects.toThrow(DailyReportEditRequestError);
    await expect(decideEditRequest('req-1', 'REJECTED', 'mgr-1', '  ')).rejects.toThrow(DailyReportEditRequestError);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('only ever flips a request that is still pending', async () => {
    await decideEditRequest('req-1', 'APPROVED', 'mgr-1', 'Go ahead');
    const where = (m.update.mock.calls[0][1] as { where: Record<string, unknown> }).where;
    // The condition rides on the UPDATE itself: two managers pressing Approve
    // at the same moment cannot both win.
    expect(where).toMatchObject({ id: 'req-1', status: 'PENDING' });
  });

  it('says so rather than silently overwriting a decision already made', async () => {
    m.update.mockResolvedValue([0]);
    await expect(decideEditRequest('req-1', 'APPROVED', 'mgr-1', 'Go ahead')).rejects.toThrow(/already been decided/i);
  });

  it('gives an approval an expiry, and a refusal none', async () => {
    await decideEditRequest('req-1', 'APPROVED', 'mgr-1', 'Go ahead');
    const approved = m.update.mock.calls[0][0] as { grant_expires_at: Date | null };
    expect(approved.grant_expires_at).toBeInstanceOf(Date);
    const hours = (approved.grant_expires_at!.getTime() - Date.now()) / 3600_000;
    expect(Math.round(hours)).toBe(EDIT_GRANT_HOURS);

    m.update.mockClear();
    await decideEditRequest('req-1', 'REJECTED', 'mgr-1', 'File a fresh one instead');
    expect((m.update.mock.calls[0][0] as { grant_expires_at: Date | null }).grant_expires_at).toBeNull();
  });
});

describe('spending the grant', () => {
  it('is single use — the condition is on the UPDATE, not a prior read', async () => {
    const ok = await consumeEditGrant('rep-1');
    expect(ok).toBe(true);
    const where = (m.update.mock.calls[0][1] as { where: Record<string, unknown> }).where;
    expect(where.report_id).toBe('rep-1');
    expect(where.status).toBe('APPROVED');
  });

  it('refuses to spend an expired grant', async () => {
    const where = async () => {
      await consumeEditGrant('rep-1');
      return (m.update.mock.calls[0][1] as { where: Record<string, unknown> }).where;
    };
    const w = await where();
    // Expiry is enforced in the same statement, not by a separate read.
    const or = w[Op.or as unknown as string] as { grant_expires_at: unknown }[];
    expect(Array.isArray(or)).toBe(true);
    expect(or).toHaveLength(2);
  });

  it('reports failure when there is nothing to spend', async () => {
    m.update.mockResolvedValue([0]);
    expect(await consumeEditGrant('rep-1')).toBe(false);
  });

  it('declines a nonsense report id without touching the database', async () => {
    expect(await consumeEditGrant('')).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });
});

describe('reading the live request', () => {
  it('reports an approval past its expiry as EXPIRED, not APPROVED', async () => {
    // Otherwise the page offers an edit the save will refuse.
    m.findOne.mockResolvedValue(row({ status: 'APPROVED', grant_expires_at: new Date(Date.now() - 1000) }));
    const live = await findLiveEditRequest('rep-1');
    expect(live?.status).toBe('EXPIRED');
  });

  it('leaves an unexpired approval alone', async () => {
    m.findOne.mockResolvedValue(row({ status: 'APPROVED', grant_expires_at: new Date(Date.now() + 3600_000) }));
    expect((await findLiveEditRequest('rep-1'))?.status).toBe('APPROVED');
  });

  it('looks only for live statuses', async () => {
    await findLiveEditRequest('rep-1');
    const where = (m.findOne.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    const statuses = (where.status as Record<symbol, string[]>)[Op.in as unknown as symbol];
    expect(statuses).toEqual(['PENDING', 'APPROVED']);
  });
});

// Code and migration do not land at the same instant. Until the table exists
// the module must degrade rather than take the Daily Report page down with
// it — and it must degrade in the SAFE direction.
describe('before the migration has run', () => {
  it('reads as "nobody has asked", so the page still loads', async () => {
    const saved = (dbMock as Record<string, unknown>).DailyReportEditRequest;
    delete (dbMock as Record<string, unknown>).DailyReportEditRequest;
    try {
      expect(await findLiveEditRequest('rep-1')).toBeUndefined();
    } finally {
      (dbMock as Record<string, unknown>).DailyReportEditRequest = saved;
    }
  });

  it('refuses to hand out a grant, so a filed report stays locked', async () => {
    const saved = (dbMock as Record<string, unknown>).DailyReportEditRequest;
    delete (dbMock as Record<string, unknown>).DailyReportEditRequest;
    try {
      // No grant means no permittedEdit, means saveReport refuses the edit —
      // which is the behaviour that was asked for anyway.
      expect(await consumeEditGrant('rep-1')).toBe(false);
    } finally {
      (dbMock as Record<string, unknown>).DailyReportEditRequest = saved;
    }
  });

  it('tells the employee something readable instead of leaking SQL', async () => {
    const saved = (dbMock as Record<string, unknown>).DailyReportEditRequest;
    delete (dbMock as Record<string, unknown>).DailyReportEditRequest;
    try {
      await expect(
        createEditRequest({ reportId: 'rep-1', employeeId: 'emp-1', departmentId: null, reportDate: '2026-10-24', reason: 'Fix the AV figure' })
      ).rejects.toThrow(/migration still needs to run/i);
    } finally {
      (dbMock as Record<string, unknown>).DailyReportEditRequest = saved;
    }
  });
});
