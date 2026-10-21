import { describe, it, expect } from 'vitest';
import {
  SUPPORT_TICKET_STATUSES,
  SUPPORT_STATUS_LABEL,
  SupportActor,
  SupportTicketStatus,
  allowedTransitions,
  canAssign,
  canCommentInternally,
  canSetPriority,
  canTransition,
  isTerminalStatus,
  partnerFacingStatus,
  transitionRequiresReason
} from '../../lib/supportTicketWorkflow';

const ACTORS: SupportActor[] = ['partner', 'engineer', 'manager'];

describe('the partner can do exactly four things', () => {
  // This is the security-critical half of the table. Everything a partner
  // may do is enumerated here; anything not listed must be refused.
  it('may reply to an information request by moving back to in progress', () => {
    expect(canTransition('awaiting_partner', 'in_progress', 'partner')).toBe(true);
  });

  it('may confirm a resolution, or say it is not fixed', () => {
    expect(canTransition('resolved', 'closed', 'partner')).toBe(true);
    expect(canTransition('resolved', 'reopened', 'partner')).toBe(true);
  });

  it('may never declare a ticket resolved', () => {
    // Declaring a technical fix is an engineering statement, not a
    // customer's.
    for (const from of SUPPORT_TICKET_STATUSES) {
      expect(canTransition(from, 'resolved', 'partner')).toBe(false);
    }
  });

  it('may never assign, triage, escalate or cancel', () => {
    for (const from of SUPPORT_TICKET_STATUSES) {
      for (const to of ['assigned', 'under_triage', 'escalated', 'cancelled', 'acknowledged'] as SupportTicketStatus[]) {
        expect(canTransition(from, to, 'partner')).toBe(false);
      }
    }
  });

  it('may never reopen a ticket that was properly closed', () => {
    // Closure is final from the partner's side — reopening a closed ticket
    // is a manager decision, otherwise "closed" means nothing.
    expect(canTransition('closed', 'reopened', 'partner')).toBe(false);
  });

  it('has no internal comment channel', () => {
    expect(canCommentInternally('partner')).toBe(false);
    expect(canCommentInternally('engineer')).toBe(true);
    expect(canCommentInternally('manager')).toBe(true);
  });

  it('may not assign or set priority', () => {
    expect(canAssign('partner')).toBe(false);
    expect(canSetPriority('partner')).toBe(false);
    expect(canAssign('engineer')).toBe(false);
    expect(canAssign('manager')).toBe(true);
  });
});

describe('engineer limits', () => {
  it('may resolve but never close', () => {
    // Closure follows the customer's confirmation or a manager's decision —
    // otherwise the team marks its own homework and the reopen rate becomes
    // meaningless.
    expect(canTransition('in_progress', 'resolved', 'engineer')).toBe(true);
    for (const from of SUPPORT_TICKET_STATUSES) {
      expect(canTransition(from, 'closed', 'engineer')).toBe(false);
    }
  });

  it('may never cancel a ticket', () => {
    for (const from of SUPPORT_TICKET_STATUSES) {
      expect(canTransition(from, 'cancelled', 'engineer')).toBe(false);
    }
  });

  it('may acknowledge and work an assigned ticket', () => {
    expect(canTransition('assigned', 'acknowledged', 'engineer')).toBe(true);
    expect(canTransition('acknowledged', 'in_progress', 'engineer')).toBe(true);
  });
});

describe('manager authority', () => {
  it('may close, cancel and reopen', () => {
    expect(canTransition('resolved', 'closed', 'manager')).toBe(true);
    expect(canTransition('in_progress', 'cancelled', 'manager')).toBe(true);
    expect(canTransition('closed', 'reopened', 'manager')).toBe(true);
  });

  it('cannot cancel a ticket that is already being worked beyond escalation', () => {
    // A ticket already resolved is closed, not cancelled, so the trail shows
    // what actually happened.
    expect(canTransition('resolved', 'cancelled', 'manager')).toBe(false);
  });
});

describe('table integrity', () => {
  it('never allows a transition out of a terminal status except a deliberate reopen', () => {
    for (const actor of ACTORS) {
      for (const to of allowedTransitions('closed', actor)) {
        expect(to).toBe('reopened');
      }
      for (const to of allowedTransitions('cancelled', actor)) {
        expect(to).toBe('open');
      }
    }
  });

  it('never lets any actor transition a status to itself', () => {
    for (const status of SUPPORT_TICKET_STATUSES) {
      for (const actor of ACTORS) {
        // 'assigned' -> 'assigned' is the one legitimate self-move
        // (reassignment to a different engineer), so it is exempt.
        if (status === 'assigned' && actor === 'manager') continue;
        expect(allowedTransitions(status, actor)).not.toContain(status);
      }
    }
  });

  it('labels every status', () => {
    for (const status of SUPPORT_TICKET_STATUSES) {
      expect(SUPPORT_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it('identifies terminal statuses', () => {
    expect(isTerminalStatus('closed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('resolved')).toBe(false);
  });
});

describe('transitionRequiresReason', () => {
  it('demands a reason for every consequential move', () => {
    for (const to of ['cancelled', 'escalated', 'resolved', 'reopened', 'awaiting_partner'] as SupportTicketStatus[]) {
      expect(transitionRequiresReason(to)).toBe(true);
    }
  });

  it('does not demand one for routine progress', () => {
    expect(transitionRequiresReason('in_progress')).toBe(false);
    expect(transitionRequiresReason('acknowledged')).toBe(false);
  });
});

describe('partnerFacingStatus', () => {
  it('hides internal queue mechanics behind "open"', () => {
    // Telling a partner their ticket is merely 'new' three days in reads as
    // neglect even when triage is actively happening.
    for (const status of ['new', 'open', 'under_triage', 'assigned'] as SupportTicketStatus[]) {
      expect(partnerFacingStatus(status)).toBe('open');
    }
  });

  it('presents internal waiting as in progress', () => {
    expect(partnerFacingStatus('awaiting_internal')).toBe('in_progress');
    expect(partnerFacingStatus('acknowledged')).toBe('in_progress');
  });

  it('passes through the statuses that genuinely concern the partner', () => {
    for (const status of ['awaiting_partner', 'resolved', 'closed', 'reopened', 'escalated', 'cancelled'] as SupportTicketStatus[]) {
      expect(partnerFacingStatus(status)).toBe(status);
    }
  });
});
