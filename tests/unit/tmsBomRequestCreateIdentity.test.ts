import { describe, it, expect, vi, beforeEach } from 'vitest';

// OPSQA-DEF-001 regression: BOM request creation used to silently write
// NULL into created_by whenever the username->id lookup it did internally
// came back empty (observed deterministically within ~1-2s of login). The
// fix passes the already-authenticated user's id straight through instead
// of re-deriving it, and throws rather than writing an unattributed row if
// no id can be established at all.

const { findOneMock, createMock, findByPkMock } = vi.hoisted(() => ({
  findOneMock: vi.fn(),
  createMock: vi.fn(),
  findByPkMock: vi.fn()
}));

vi.mock('../../lib/db', () => ({
  db: {
    User: { findOne: findOneMock },
    TmsBomRequest: { create: createMock, findByPk: findByPkMock }
  },
  isUuid: () => true,
  sequelize: {}
}));
vi.mock('../../lib/tmsProcurementStore', () => ({ nextTmsProcurementCode: vi.fn() }));

import { tmsBomRequestStore } from '../../lib/tmsBomRequestStore';
import { TmsBomRequestRecord } from '../../lib/types';

const baseRecord = (): TmsBomRequestRecord =>
  ({
    id: '1',
    bom_request_code: 'BOM-1',
    created_at: '2026-11-07T00:00:00.000Z',
    created_by: 'some.user',
    project_id: 'p1',
    project_name: 'Project',
    requested_by_id: 'user-id-123',
    requested_by_name: '',
    department_id: 'd1',
    department_name: '',
    request_date: '2026-11-07',
    required_date: '',
    item_name: 'Bolt',
    item_description: '',
    part_number: '',
    quantity: 1,
    specification: '',
    preferred_brand: '',
    estimated_cost: 0,
    remarks: '',
    attachments: [],
    status: 'submitted',
    rejection_reason: '',
    reviewed_by_id: '',
    reviewed_by_name: '',
    reviewed_at: '',
    admin_reviewed_by_id: '',
    admin_reviewed_by_name: '',
    admin_reviewed_at: '',
    finance_reviewed_by_id: '',
    finance_reviewed_by_name: '',
    finance_reviewed_at: '',
    payment_marked_by_id: '',
    payment_marked_by_name: '',
    payment_marked_at: '',
    payment_proof_attachments: [],
    received_by_id: '',
    received_by_name: '',
    received_at: '',
    updated_at: '2026-11-07T00:00:00.000Z'
  }) as unknown as TmsBomRequestRecord;

beforeEach(() => {
  findOneMock.mockReset();
  createMock.mockReset();
  findByPkMock.mockReset();
  createMock.mockResolvedValue({ get: (k: string) => (k === 'id' ? 'row-1' : undefined) });
  findByPkMock.mockResolvedValue({
    get: (opts?: { plain?: boolean }) => (opts?.plain ? { id: 'row-1', createdAt: null, updatedAt: null } : undefined)
  });
});

describe('tmsBomRequestStore.create — requester identity', () => {
  it('uses the passed-in authenticated id directly, without any username lookup', async () => {
    await tmsBomRequestStore.create(baseRecord(), 'user-id-123');
    expect(findOneMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ created_by: 'user-id-123' }));
  });

  it('falls back to a username lookup when no id is passed, and still succeeds if it resolves', async () => {
    findOneMock.mockResolvedValue({ get: () => 'resolved-id-456' });
    await tmsBomRequestStore.create(baseRecord());
    expect(findOneMock).toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ created_by: 'resolved-id-456' }));
  });

  it('throws instead of silently writing a NULL creator when no id can be established at all', async () => {
    findOneMock.mockResolvedValue(null);
    await expect(tmsBomRequestStore.create(baseRecord())).rejects.toThrow();
    expect(createMock).not.toHaveBeenCalled();
  });
});
