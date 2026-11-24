import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fully mocked — no real DB, no real email transport. Verifies the dedup
// guard, active-user filtering, and that email + notification are only
// fired once per festival per day, never against real recipients.

const { notificationCountMock, festivalFindOneMock, notifyUsersMock, sendFestivalEmailMock } = vi.hoisted(() => ({
  notificationCountMock: vi.fn(),
  festivalFindOneMock: vi.fn(),
  notifyUsersMock: vi.fn(),
  sendFestivalEmailMock: vi.fn()
}));

vi.mock('../../lib/db', () => ({
  db: {
    Notification: { count: notificationCountMock },
    Festival: { findOne: festivalFindOneMock },
    Sequelize: { Op: { gte: Symbol('gte') } }
  }
}));
vi.mock('../../lib/userStore', () => ({ listUsers: vi.fn() }));
vi.mock('../../lib/notificationStore', () => ({ notifyUsers: notifyUsersMock }));
vi.mock('../../lib/email/notifications', () => ({ sendFestivalEmail: sendFestivalEmailMock }));

import { listUsers } from '../../lib/userStore';
import { processTodaysFestival, getTodaysFestival } from '../../lib/festivalStore';

const listUsersMock = vi.mocked(listUsers);

const FESTIVAL_ROW = {
  id: 'f1',
  key: 'diwali',
  name: 'Diwali',
  date: '2027-10-29',
  greeting: 'Happy Diwali!',
  provisional: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z')
};
const festivalRow = (plain: Record<string, unknown> = FESTIVAL_ROW) => ({ get: () => plain });

const activeUser = (over: Partial<{ id: string; username: string; name: string; email: string; status: string }> = {}) => ({
  id: 'u1', username: 'QA_TEST_user1', name: 'QA Test User', email: 'qa-test@example.com', status: 'active', ...over
});

beforeEach(() => {
  notificationCountMock.mockReset();
  festivalFindOneMock.mockReset();
  listUsersMock.mockReset();
  notifyUsersMock.mockReset();
  sendFestivalEmailMock.mockReset();
});

describe('getTodaysFestival', () => {
  it('queries by the IST calendar day, not the raw UTC date', async () => {
    festivalFindOneMock.mockResolvedValue(null);
    // 2026-12-24T19:00:00Z is 2026-12-25T00:30 IST — already the next day in IST.
    await getTodaysFestival(new Date('2026-12-24T19:00:00.000Z'));
    expect(festivalFindOneMock).toHaveBeenCalledWith({ where: { date: '2026-12-25' } });
  });

  it('returns null when no festival matches today', async () => {
    festivalFindOneMock.mockResolvedValue(null);
    expect(await getTodaysFestival(new Date('2027-02-15T06:00:00.000Z'))).toBeNull();
  });
});

describe('processTodaysFestival', () => {
  it('returns null and does nothing when today is not a festival', async () => {
    festivalFindOneMock.mockResolvedValue(null);
    const result = await processTodaysFestival();
    expect(result).toBeNull();
    expect(sendFestivalEmailMock).not.toHaveBeenCalled();
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it('sends the greeting to every ACTIVE user only, excluding suspended/exited accounts', async () => {
    festivalFindOneMock.mockResolvedValue(festivalRow());
    notificationCountMock.mockResolvedValue(0);
    listUsersMock.mockResolvedValue([
      activeUser({ id: 'u1', username: 'QA_TEST_active1' }),
      activeUser({ id: 'u2', username: 'QA_TEST_suspended', status: 'inactive' }),
      activeUser({ id: 'u3', username: 'QA_TEST_active2' })
    ] as never);

    const result = await processTodaysFestival();

    expect(result?.key).toBe('diwali');
    expect(sendFestivalEmailMock).toHaveBeenCalledTimes(2);
    expect(notifyUsersMock).toHaveBeenCalledWith(['QA_TEST_active1', 'QA_TEST_active2'], expect.objectContaining({ type: 'festival_diwali' }));
  });

  it('does NOT re-send when the dedup marker already exists for today — idempotent per festival per day', async () => {
    festivalFindOneMock.mockResolvedValue(festivalRow());
    notificationCountMock.mockResolvedValue(1); // marker already present
    listUsersMock.mockResolvedValue([activeUser()] as never);

    const result = await processTodaysFestival();

    expect(result?.key).toBe('diwali');
    expect(sendFestivalEmailMock).not.toHaveBeenCalled();
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it('skips users with no email address rather than calling sendFestivalEmail with an empty address', async () => {
    festivalFindOneMock.mockResolvedValue(festivalRow());
    notificationCountMock.mockResolvedValue(0);
    listUsersMock.mockResolvedValue([activeUser({ id: 'u1', email: '' }), activeUser({ id: 'u2', username: 'QA_TEST_hasEmail' })] as never);

    await processTodaysFestival();

    expect(sendFestivalEmailMock).toHaveBeenCalledTimes(1);
  });
});
