import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fully mocked — no real DB, no real email transport. Verifies the dedup
// guard, active-user filtering, and that email + notification are only
// fired once per festival per day, never against real recipients.

const { notificationCountMock, userFindAllMock, notifyUsersMock, sendFestivalEmailMock } = vi.hoisted(() => ({
  notificationCountMock: vi.fn(),
  userFindAllMock: vi.fn(),
  notifyUsersMock: vi.fn(),
  sendFestivalEmailMock: vi.fn()
}));

vi.mock('../../lib/db', () => ({
  db: {
    Notification: { count: notificationCountMock },
    Sequelize: { Op: { gte: Symbol('gte') } }
  }
}));
vi.mock('../../lib/userStore', () => ({ listUsers: vi.fn() }));
vi.mock('../../lib/notificationStore', () => ({ notifyUsers: notifyUsersMock }));
vi.mock('../../lib/email/notifications', () => ({ sendFestivalEmail: sendFestivalEmailMock }));
vi.mock('../../lib/festivalCalendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/festivalCalendar')>();
  return { ...actual, getTodaysFestival: vi.fn() };
});

import { listUsers } from '../../lib/userStore';
import { getTodaysFestival } from '../../lib/festivalCalendar';
import { processTodaysFestival } from '../../lib/festivalStore';

const listUsersMock = vi.mocked(listUsers);
const getTodaysFestivalMock = vi.mocked(getTodaysFestival);

const FESTIVAL = { key: 'diwali', name: 'Diwali', date: '2027-10-29', greeting: 'Happy Diwali!' };

const activeUser = (over: Partial<{ id: string; username: string; name: string; email: string; status: string }> = {}) => ({
  id: 'u1', username: 'QA_TEST_user1', name: 'QA Test User', email: 'qa-test@example.com', status: 'active', ...over
});

beforeEach(() => {
  notificationCountMock.mockReset();
  listUsersMock.mockReset();
  notifyUsersMock.mockReset();
  sendFestivalEmailMock.mockReset();
  userFindAllMock.mockReset();
  getTodaysFestivalMock.mockReset();
});

describe('processTodaysFestival', () => {
  it('returns null and does nothing when today is not a festival', async () => {
    getTodaysFestivalMock.mockReturnValue(null);
    const result = await processTodaysFestival();
    expect(result).toBeNull();
    expect(sendFestivalEmailMock).not.toHaveBeenCalled();
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it('sends the greeting to every ACTIVE user only, excluding suspended/exited accounts', async () => {
    getTodaysFestivalMock.mockReturnValue(FESTIVAL as never);
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
    getTodaysFestivalMock.mockReturnValue(FESTIVAL as never);
    notificationCountMock.mockResolvedValue(1); // marker already present
    listUsersMock.mockResolvedValue([activeUser()] as never);

    const result = await processTodaysFestival();

    expect(result?.key).toBe('diwali');
    expect(sendFestivalEmailMock).not.toHaveBeenCalled();
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it('skips users with no email address rather than calling sendFestivalEmail with an empty address', async () => {
    getTodaysFestivalMock.mockReturnValue(FESTIVAL as never);
    notificationCountMock.mockResolvedValue(0);
    listUsersMock.mockResolvedValue([activeUser({ id: 'u1', email: '' }), activeUser({ id: 'u2', username: 'QA_TEST_hasEmail' })] as never);

    await processTodaysFestival();

    expect(sendFestivalEmailMock).toHaveBeenCalledTimes(1);
  });
});
