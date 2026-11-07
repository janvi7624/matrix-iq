import { describe, it, expect, vi, beforeEach } from 'vitest';

// REL-DB-002 regression: listInternalTickets() used to fire one SLA-policy
// query AND one status-history query PER ticket (2N+1 total). Fixed to
// batch both into one query each, regardless of list size. This pins the
// query COUNT, not just that the function still returns correct data.

const { ticketFindAllMock, policyFindAllMock, historyFindAllMock } = vi.hoisted(() => ({
  ticketFindAllMock: vi.fn(),
  policyFindAllMock: vi.fn(),
  historyFindAllMock: vi.fn()
}));

function ticketRow(id: string, priority: string) {
  return {
    get: ({ plain }: { plain?: boolean } = {}) =>
      plain
        ? {
            id,
            priority,
            status: 'open',
            createdAt: '2026-11-01T00:00:00.000Z',
            response_due_at: null,
            resolution_due_at: null,
            first_response_at: null,
            resolved_at: null,
            closed_at: null,
            attachments: [],
            reopened_count: 0
          }
        : undefined
  };
}

function policyRow(priority: string) {
  return {
    get: () => ({
      priority,
      first_response_minutes: 60,
      resolution_minutes: 480,
      pause_on_awaiting_partner: false,
      business_hours_only: false,
      escalate_after_minutes: null
    })
  };
}

vi.mock('../../lib/db', () => ({
  db: {
    SupportTicket: { findAll: ticketFindAllMock },
    SupportSlaPolicy: { findAll: policyFindAllMock },
    SupportTicketStatusHistory: { findAll: historyFindAllMock },
    Partner: {},
    User: {}
  },
  isUuid: () => true,
  sequelize: {}
}));
vi.mock('../../lib/departmentStore', () => ({ listActiveDepartments: vi.fn(), listDepartmentManagers: vi.fn() }));

import { listInternalTickets } from '../../lib/supportTicketStore';

beforeEach(() => {
  ticketFindAllMock.mockReset();
  policyFindAllMock.mockReset();
  historyFindAllMock.mockReset();
  policyFindAllMock.mockResolvedValue([policyRow('medium'), policyRow('high')]);
  historyFindAllMock.mockResolvedValue([]);
});

describe('listInternalTickets — N+1 regression', () => {
  it('fires exactly one SLA-policy query and one history query for a small ticket list', async () => {
    ticketFindAllMock.mockResolvedValue([ticketRow('t1', 'medium'), ticketRow('t2', 'high')]);
    await listInternalTickets({ queue: 'open' }, 'viewer-1');
    expect(policyFindAllMock).toHaveBeenCalledTimes(1);
    expect(historyFindAllMock).toHaveBeenCalledTimes(1);
  });

  it('still fires exactly one of each query for a much larger ticket list — query count does not scale with N', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ticketRow(`t${i}`, i % 2 === 0 ? 'medium' : 'high'));
    ticketFindAllMock.mockResolvedValue(many);
    await listInternalTickets({ queue: 'open' }, 'viewer-1');
    expect(policyFindAllMock).toHaveBeenCalledTimes(1);
    expect(historyFindAllMock).toHaveBeenCalledTimes(1);
  });

  it('fires zero history/policy-dependent queries when the ticket list is empty', async () => {
    ticketFindAllMock.mockResolvedValue([]);
    await listInternalTickets({ queue: 'open' }, 'viewer-1');
    expect(historyFindAllMock).not.toHaveBeenCalled();
  });
});
