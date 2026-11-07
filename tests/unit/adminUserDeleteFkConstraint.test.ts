import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// OPSQA-DEF-003 regression: deleting a user with an assigned general task
// used to surface a raw SequelizeForeignKeyConstraintError (the FK is
// deliberately ON DELETE RESTRICT — a task must always have a real
// assignee) as a bare 500. The admin should get a clear, actionable 409
// instead, never a raw DB error.

vi.mock('@/lib/userStore', () => ({
  countSuperAdmins: vi.fn(async () => 2),
  deleteUser: vi.fn(),
  findUserById: vi.fn(async () => ({ id: 'u1', role: 'engineer' })),
  updateUser: vi.fn()
}));

import { deleteUser } from '@/lib/userStore';
import { DELETE } from '@/app/api/admin/users/[id]/route';

const deleteUserMock = vi.mocked(deleteUser);

function fkError() {
  const err = new Error('update or delete on table "users" violates foreign key constraint "general_tasks_assignee_id_fkey"');
  err.name = 'SequelizeForeignKeyConstraintError';
  (err as unknown as { table: string }).table = 'general_tasks';
  return err;
}

describe('DELETE /api/admin/users/[id] — FK constraint handling', () => {
  it('returns a clean 409 with an actionable message, not the raw DB error, when the user has an assigned general task', async () => {
    deleteUserMock.mockRejectedValueOnce(fkError());
    const request = new NextRequest('http://localhost/api/admin/users/u1', { method: 'DELETE' });
    const response = await DELETE(request, { params: Promise.resolve({ id: 'u1' }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).not.toMatch(/SequelizeForeignKeyConstraintError|violates foreign key constraint/i);
    expect(body.error).toMatch(/task/i);
  });

  it('still deletes successfully when there is no blocking task', async () => {
    deleteUserMock.mockResolvedValueOnce(undefined);
    const request = new NextRequest('http://localhost/api/admin/users/u1', { method: 'DELETE' });
    const response = await DELETE(request, { params: Promise.resolve({ id: 'u1' }) });
    expect(response.status).toBe(200);
  });
});
