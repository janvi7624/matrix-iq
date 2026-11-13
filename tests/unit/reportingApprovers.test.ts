import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/db', () => ({
  db: { User: { findByPk: vi.fn(), findAll: vi.fn() } },
  isUuid: () => true
}));

import { db } from '../../lib/db';
import { approversFor, canApproveFor } from '../../lib/reportingManagers';

const MANOJ = { id: 'manoj-id', username: 'manoj', name: 'Manoj Menon' };
const PANKAJ = { id: 'pankaj-id', username: 'pankaj', name: 'Pankaj' };
const ALL = { Sales: [MANOJ], Project: [PANKAJ] };

const findByPk = db.User.findByPk as unknown as ReturnType<typeof vi.fn>;

// A users row as Sequelize hands it back.
const row = (o: Record<string, unknown>) => ({ get: (k: string) => o[k] });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('approversFor', () => {
  it('falls back to the department managers when no reporting manager is set', async () => {
    findByPk.mockResolvedValueOnce(row({ reportingManagerId: null }));
    const out = await approversFor({ employeeId: 'emp', departmentName: 'Sales', allManagers: ALL });
    expect(out).toEqual([MANOJ]);
  });

  it('REPLACES the department managers when one is set — exclusive, not additive', async () => {
    findByPk
      .mockResolvedValueOnce(row({ reportingManagerId: 'mahendra-id' }))
      .mockResolvedValueOnce(row({ id: 'mahendra-id', username: 'mahendra.singh.chauhan', name: 'Mahendra Singh Chauhan', status: 'active' }));
    const out = await approversFor({ employeeId: 'ajay', departmentName: 'Sales', allManagers: ALL });
    expect(out).toEqual([{ id: 'mahendra-id', username: 'mahendra.singh.chauhan', name: 'Mahendra Singh Chauhan' }]);
    // The point of the whole change: the department manager is NOT included.
    expect(out.map((m) => m.username)).not.toContain('manoj');
  });

  it('names a reporting manager who manages no department at all', async () => {
    // Mahendra holds the plain 'user' role and appears in no department's
    // manager list — resolving him via the department map would find nothing.
    findByPk
      .mockResolvedValueOnce(row({ reportingManagerId: 'nobody-id' }))
      .mockResolvedValueOnce(row({ id: 'nobody-id', username: 'plain.user', name: 'Plain User', status: 'active' }));
    const out = await approversFor({ employeeId: 'emp', departmentName: 'Sales', allManagers: ALL });
    expect(out.map((m) => m.username)).toEqual(['plain.user']);
  });

  it('falls back to the department when the named manager is deactivated', async () => {
    // An exclusive approver must never be able to strand a request.
    findByPk
      .mockResolvedValueOnce(row({ reportingManagerId: 'gone-id' }))
      .mockResolvedValueOnce(row({ id: 'gone-id', username: 'gone', name: 'Gone', status: 'inactive' }));
    const out = await approversFor({ employeeId: 'emp', departmentName: 'Sales', allManagers: ALL });
    expect(out).toEqual([MANOJ]);
  });

  it('falls back to the department when the named manager row has vanished', async () => {
    findByPk
      .mockResolvedValueOnce(row({ reportingManagerId: 'ghost-id' }))
      .mockResolvedValueOnce(null);
    const out = await approversFor({ employeeId: 'emp', departmentName: 'Sales', allManagers: ALL });
    expect(out).toEqual([MANOJ]);
  });

  it('returns the department managers unchanged when no employee is given', async () => {
    const out = await approversFor({ employeeId: null, departmentName: 'Sales', allManagers: ALL });
    expect(out).toEqual([MANOJ]);
    expect(findByPk).not.toHaveBeenCalled();
  });

  it('returns nobody for a person with no department and no reporting manager', async () => {
    const out = await approversFor({ employeeId: null, departmentName: '', allManagers: ALL });
    expect(out).toEqual([]);
  });

  it('leaves everyone else in the department on the department manager', async () => {
    findByPk.mockResolvedValue(row({ reportingManagerId: null }));
    const out = await approversFor({ employeeId: 'colleague', departmentName: 'Sales', allManagers: ALL });
    expect(out).toEqual([MANOJ]);
  });
});

describe('canApproveFor', () => {
  it('grants the named reporting manager and refuses the department manager', async () => {
    findByPk
      .mockResolvedValueOnce(row({ reportingManagerId: 'mahendra-id' }))
      .mockResolvedValueOnce(row({ id: 'mahendra-id', username: 'mahendra.singh.chauhan', name: 'M', status: 'active' }));
    await expect(canApproveFor({
      viewerUsername: 'mahendra.singh.chauhan', employeeId: 'ajay', departmentName: 'Sales', allManagers: ALL
    })).resolves.toBe(true);

    findByPk
      .mockResolvedValueOnce(row({ reportingManagerId: 'mahendra-id' }))
      .mockResolvedValueOnce(row({ id: 'mahendra-id', username: 'mahendra.singh.chauhan', name: 'M', status: 'active' }));
    await expect(canApproveFor({
      viewerUsername: 'manoj', employeeId: 'ajay', departmentName: 'Sales', allManagers: ALL
    })).resolves.toBe(false);
  });
});
