import { describe, it, expect, vi, beforeEach } from 'vitest';

// The transaction stub just runs its callback, so the store's real transaction
// body is exercised rather than skipped. Written inline inside the factory
// because vi.mock is hoisted above any const in this file.
vi.mock('../../lib/db', () => ({
  db: {
    sequelize: { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({ fake: 'tx' })) },
    TmsTask: { findByPk: vi.fn() },
    TmsTaskDeadlineExtension: { create: vi.fn(), findByPk: vi.fn(), findAll: vi.fn() },
    User: {}
  },
  isUuid: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}));

import { db } from '../../lib/db';
import {
  decideTaskExtension,
  InvalidTaskDeadlineExtensionError,
  requestTaskExtension
} from '../../lib/tmsTaskDeadlineExtensionStore';

const Task = db.TmsTask as unknown as { findByPk: ReturnType<typeof vi.fn> };
const Ext = db.TmsTaskDeadlineExtension as unknown as {
  create: ReturnType<typeof vi.fn>;
  findByPk: ReturnType<typeof vi.fn>;
};

// Re-applied after each clearAllMocks, which wipes the factory's implementation.
const txRun = async (fn: (t: unknown) => unknown) => fn({ fake: 'tx' });

const UUID = '11111111-1111-1111-1111-111111111111';

function fakeRow(plain: Record<string, unknown>) {
  const row = {
    get: vi.fn((arg?: unknown) => (arg === undefined || typeof arg === 'object' ? plain : plain[arg as string])),
    update: vi.fn(async (attrs: Record<string, unknown>) => {
      Object.assign(plain, attrs);
    })
  };
  return row;
}

function baseInput(over: Record<string, unknown> = {}) {
  return {
    taskId: UUID,
    previousDeadline: '2026-10-01',
    newDeadline: '2026-10-15',
    reason: 'client_end' as const,
    remark: 'Client pushed the site visit',
    requestedByUserId: 'user-1',
    requesterTier: 'plain' as const,
    ...over
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (db.sequelize.transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(txRun);
  Ext.findByPk.mockResolvedValue(fakeRow({ id: 'ext-1', task_id: UUID, new_deadline: '2026-10-15', status: 'pending_manager' }));
});

describe('requestTaskExtension — the approval tier', () => {
  // The whole point of routing by tier: a task's due_date is scored by
  // lib/departmentScoring.ts, so whoever benefits from the move must not be
  // the one who grants it.
  // A manager no longer waits on an Admin: a task date slipping is routine
  // delivery management, and the mandatory reason plus the audit row is what
  // an admin reviews afterwards instead.
  it.each([
    ['plain', 'pending_manager'],
    ['manager', 'approved'],
    ['admin', 'approved']
  ] as const)('a %s requester produces status %s', async (tier, expected) => {
    const task = fakeRow({ id: UUID, due_date: '2026-10-01' });
    Task.findByPk.mockResolvedValue(task);
    Ext.create.mockResolvedValue(fakeRow({ id: 'ext-1' }));

    await requestTaskExtension(baseInput({ requesterTier: tier }));

    expect(Ext.create.mock.calls[0][0]).toMatchObject({ status: expected });
  });

  it('leaves the due_date untouched for a plain requester — it waits for approval', async () => {
    vi.clearAllMocks();
    (db.sequelize.transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(txRun);
    const task = fakeRow({ id: UUID, due_date: '2026-10-01' });
    Task.findByPk.mockResolvedValue(task);
    Ext.create.mockResolvedValue(fakeRow({ id: 'ext-1' }));
    await requestTaskExtension(baseInput({ requesterTier: 'plain' }));
    expect(task.update).not.toHaveBeenCalled();
  });

  it.each(['manager', 'admin'] as const)('writes the due_date immediately for a %s', async (tier) => {
    vi.clearAllMocks();
    (db.sequelize.transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(txRun);
    const task = fakeRow({ id: UUID, due_date: '2026-10-01' });
    Task.findByPk.mockResolvedValue(task);
    Ext.create.mockResolvedValue(fakeRow({ id: 'ext-1' }));
    await requestTaskExtension(baseInput({ requesterTier: tier }));
    expect(task.update).toHaveBeenCalledWith({ due_date: '2026-10-15' }, expect.anything());
  });

  it('stamps the approver on a self-approved request and leaves it null otherwise', async () => {
    Task.findByPk.mockResolvedValue(fakeRow({ id: UUID }));
    Ext.create.mockResolvedValue(fakeRow({ id: 'ext-1' }));

    await requestTaskExtension(baseInput({ requesterTier: 'manager' }));
    expect(Ext.create.mock.calls[0][0]).toMatchObject({ approved_by: 'user-1' });

    vi.clearAllMocks();
    Task.findByPk.mockResolvedValue(fakeRow({ id: UUID }));
    Ext.create.mockResolvedValue(fakeRow({ id: 'ext-1' }));
    await requestTaskExtension(baseInput({ requesterTier: 'plain' }));
    expect(Ext.create.mock.calls[0][0]).toMatchObject({ approved_by: null, approved_at: null });
  });
});

describe('requestTaskExtension — validation', () => {
  it.each(['plain', 'manager', 'admin'] as const)('requires a remark from a %s too', async (tier) => {
    Task.findByPk.mockResolvedValue(fakeRow({ id: UUID }));
    Ext.create.mockResolvedValue(fakeRow({ id: 'ext-1' }));
    await expect(requestTaskExtension(baseInput({ remark: '   ', requesterTier: tier }))).rejects.toThrow(
      InvalidTaskDeadlineExtensionError
    );
    // Nothing written at all — not the row, not the date.
    expect(Ext.create).not.toHaveBeenCalled();
  });

  it('refuses a new date that is not later than the current one', async () => {
    await expect(requestTaskExtension(baseInput({ newDeadline: '2026-10-01' }))).rejects.toThrow(/must be later/);
    await expect(requestTaskExtension(baseInput({ newDeadline: '2026-09-30' }))).rejects.toThrow(/must be later/);
  });

  // A task with no due date can have one SET through this flow — there is
  // nothing for the new date to be later than.
  it('allows setting a first date when there was none', async () => {
    Task.findByPk.mockResolvedValue(fakeRow({ id: UUID }));
    Ext.create.mockResolvedValue(fakeRow({ id: 'ext-1' }));
    await expect(requestTaskExtension(baseInput({ previousDeadline: '' }))).resolves.toBeDefined();
    expect(Ext.create.mock.calls[0][0]).toMatchObject({ previous_deadline: null });
  });

  it('rejects a request against a task that does not exist', async () => {
    Task.findByPk.mockResolvedValue(null);
    await expect(requestTaskExtension(baseInput())).rejects.toThrow(/Task not found/);
  });
});

describe('decideTaskExtension', () => {
  it('lets a manager decide a pending_manager request', async () => {
    const ext = fakeRow({ id: 'ext-1', task_id: UUID, new_deadline: '2026-10-15', status: 'pending_manager' });
    Ext.findByPk.mockResolvedValue(ext);
    Task.findByPk.mockResolvedValue(fakeRow({ id: UUID }));

    await decideTaskExtension({ extensionId: UUID, decision: 'approve', deciderUserId: 'u2', deciderTier: 'manager' });
    expect(ext.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }), expect.anything());
  });

  it('refuses a plain viewer entirely', async () => {
    Ext.findByPk.mockResolvedValue(fakeRow({ id: 'ext-1', task_id: UUID, status: 'pending_manager' }));
    await expect(
      decideTaskExtension({ extensionId: UUID, decision: 'approve', deciderUserId: 'u2', deciderTier: 'plain' })
    ).rejects.toThrow(/Manager or Admin/);
  });

  // A manager's own request escalates to admin precisely so they cannot grant
  // it themselves.
  it('refuses a manager on a pending_admin request', async () => {
    Ext.findByPk.mockResolvedValue(fakeRow({ id: 'ext-1', task_id: UUID, status: 'pending_admin' }));
    await expect(
      decideTaskExtension({ extensionId: UUID, decision: 'approve', deciderUserId: 'u2', deciderTier: 'manager' })
    ).rejects.toThrow(/Only an Admin/);
  });

  it('will not decide something already decided', async () => {
    for (const status of ['approved', 'rejected']) {
      Ext.findByPk.mockResolvedValue(fakeRow({ id: 'ext-1', task_id: UUID, status }));
      await expect(
        decideTaskExtension({ extensionId: UUID, decision: 'approve', deciderUserId: 'u2', deciderTier: 'admin' })
      ).rejects.toThrow(/already been decided/);
    }
  });

  it('requires a remark to reject, but not to approve', async () => {
    Ext.findByPk.mockResolvedValue(fakeRow({ id: 'ext-1', task_id: UUID, status: 'pending_manager' }));
    await expect(
      decideTaskExtension({ extensionId: UUID, decision: 'reject', deciderUserId: 'u2', deciderTier: 'admin' })
    ).rejects.toThrow(/remark is required/);
  });

  it('moves the task due_date on approve and never on reject', async () => {
    const approved = fakeRow({ id: 'ext-1', task_id: UUID, new_deadline: '2026-10-15', status: 'pending_manager' });
    Ext.findByPk.mockResolvedValue(approved);
    const task = fakeRow({ id: UUID, due_date: '2026-10-01' });
    Task.findByPk.mockResolvedValue(task);
    await decideTaskExtension({ extensionId: UUID, decision: 'approve', deciderUserId: 'u2', deciderTier: 'admin' });
    expect(task.update).toHaveBeenCalledWith({ due_date: '2026-10-15' }, expect.anything());

    vi.clearAllMocks();
    (db.sequelize.transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(txRun);
    const rejected = fakeRow({ id: 'ext-2', task_id: UUID, new_deadline: '2026-10-15', status: 'pending_manager' });
    Ext.findByPk.mockResolvedValue(rejected);
    const task2 = fakeRow({ id: UUID, due_date: '2026-10-01' });
    Task.findByPk.mockResolvedValue(task2);
    await decideTaskExtension({
      extensionId: UUID,
      decision: 'reject',
      deciderUserId: 'u2',
      deciderTier: 'admin',
      decisionRemark: 'Not justified'
    });
    expect(task2.update).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid extension id without touching the database', async () => {
    await expect(
      decideTaskExtension({ extensionId: 'nope', decision: 'approve', deciderUserId: 'u2', deciderTier: 'admin' })
    ).rejects.toThrow(/not found/);
    expect(Ext.findByPk).not.toHaveBeenCalled();
  });
});
