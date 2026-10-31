import { describe, it, expect } from 'vitest';
import {
  HR_ACTION_DUE_DAYS,
  HR_REMINDER_MAX,
  PendingEscalation,
  planEscalationReminders,
  reminderMessage
} from '../../lib/dailyReportEscalationFollowUp';

// Chasing HR when an escalation sits unactioned.
//
// Every rule here is a date comparison, which is where this kind of code
// goes wrong, and two of them are the difference between a useful nudge and
// a notification people filter: not chasing an escalation raised minutes ago,
// and stopping once nobody is ever going to act.

const NOW = new Date('2026-11-03T09:00:00.000Z');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const pending = (over: Partial<PendingEscalation> = {}): PendingEscalation => ({
  id: 'esc-1',
  employeeId: 'emp-1',
  employeeName: 'Medha Dave',
  monthKey: '2026-10',
  warningCount: 5,
  notifiedAt: daysBefore(3),
  acknowledgedAt: null,
  reminderLastSentAt: null,
  reminderCount: 0,
  ...over
});

describe('planEscalationReminders', () => {
  it('chases one that has waited past the window', () => {
    const planned = planEscalationReminders([pending()], NOW);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ escalationId: 'esc-1', daysWaiting: 3, reminderNumber: 1 });
  });

  // The whole point of the window: an escalation sent by this very sweep
  // must not be chased in the same breath.
  it('does not chase one raised just now', () => {
    expect(planEscalationReminders([pending({ notifiedAt: NOW })], NOW)).toEqual([]);
  });

  it('does not chase one still inside the window', () => {
    expect(planEscalationReminders([pending({ notifiedAt: daysBefore(1) })], NOW)).toEqual([]);
  });

  it(`chases exactly at ${HR_ACTION_DUE_DAYS} days`, () => {
    expect(planEscalationReminders([pending({ notifiedAt: daysBefore(HR_ACTION_DUE_DAYS) })], NOW)).toHaveLength(1);
  });

  // This is what acknowledgement is FOR — it is the only thing that stops
  // the chasing, which is why it had to be an explicit act rather than
  // inferred from a waiver.
  it('never chases an acknowledged escalation, however old', () => {
    expect(planEscalationReminders([pending({ notifiedAt: daysBefore(30), acknowledgedAt: daysBefore(1) })], NOW)).toEqual([]);
  });

  // A failed send is a delivery problem, not an HR problem.
  it('never chases one that was never notified', () => {
    expect(planEscalationReminders([pending({ notifiedAt: null })], NOW)).toEqual([]);
  });

  describe('repeat chases', () => {
    it('waits a further window after the last chase, not from the notification', () => {
      // Notified 5 days ago but chased yesterday — not due again yet.
      const recentlyChased = pending({ notifiedAt: daysBefore(5), reminderLastSentAt: daysBefore(1), reminderCount: 1 });
      expect(planEscalationReminders([recentlyChased], NOW)).toEqual([]);
    });

    it('chases again once that further window has passed', () => {
      const due = pending({ notifiedAt: daysBefore(5), reminderLastSentAt: daysBefore(2), reminderCount: 1 });
      const planned = planEscalationReminders([due], NOW);
      expect(planned).toHaveLength(1);
      expect(planned[0].reminderNumber).toBe(2);
      // daysWaiting still counts from the original notification, which is
      // the number that belongs in the message.
      expect(planned[0].daysWaiting).toBe(5);
    });

    it(`stops after ${HR_REMINDER_MAX} chases`, () => {
      const exhausted = pending({ notifiedAt: daysBefore(30), reminderLastSentAt: daysBefore(10), reminderCount: HR_REMINDER_MAX });
      expect(planEscalationReminders([exhausted], NOW)).toEqual([]);
    });

    it('still chases on the last allowed one', () => {
      const lastChance = pending({ notifiedAt: daysBefore(30), reminderLastSentAt: daysBefore(10), reminderCount: HR_REMINDER_MAX - 1 });
      expect(planEscalationReminders([lastChance], NOW)).toHaveLength(1);
    });
  });

  it('plans independently per escalation', () => {
    const planned = planEscalationReminders(
      [
        pending({ id: 'due', notifiedAt: daysBefore(4) }),
        pending({ id: 'fresh', notifiedAt: daysBefore(0) }),
        pending({ id: 'done', notifiedAt: daysBefore(9), acknowledgedAt: daysBefore(2) })
      ],
      NOW
    );
    expect(planned.map((p) => p.escalationId)).toEqual(['due']);
  });

  it('respects an overridden window', () => {
    expect(planEscalationReminders([pending({ notifiedAt: daysBefore(3) })], NOW, 7)).toEqual([]);
    expect(planEscalationReminders([pending({ notifiedAt: daysBefore(8) })], NOW, 7)).toHaveLength(1);
  });

  it('handles an empty list', () => {
    expect(planEscalationReminders([], NOW)).toEqual([]);
  });
});

describe('reminderMessage', () => {
  it('names the person, the count, the threshold and the wait', () => {
    const [reminder] = planEscalationReminders([pending()], NOW);
    const message = reminderMessage(reminder, 4);
    expect(message.title).toBe('Action still pending — Medha Dave');
    expect(message.body).toContain('5 missed-report warnings in 2026-10');
    expect(message.body).toContain('the limit is 4');
    expect(message.body).toContain('3 days ago');
  });

  it('says "1 day", not "1 days"', () => {
    const [reminder] = planEscalationReminders([pending({ notifiedAt: daysBefore(1) })], NOW, 1);
    expect(reminderMessage(reminder, 4).body).toContain('1 day ago');
  });

  // The message must not imply a waiver is required, because it is not.
  it('says a note is what is needed, not a waiver', () => {
    const [reminder] = planEscalationReminders([pending()], NOW);
    expect(reminderMessage(reminder, 4).body).toContain('waiving a warning is not required');
  });
});
