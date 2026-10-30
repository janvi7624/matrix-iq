import { describe, it, expect } from 'vitest';
import { bomApprovalTrail, bomPendingWithLabel, BomChainInput } from '../../lib/tmsBomApprovalChain';

// The BOQ chain: Requester -> own Department Manager -> Management ->
// [Finance, if configured] -> Accounts -> received.
//
// Pinned because the chain is described in three places that must agree —
// the trail on the detail page, the "Pending With" column on the list, and
// which role each route notifies. The specific defect these tests exist for
// is the Finance step: with no Finance Approver configured it has no owner,
// and treating it as mandatory left a management-approved request pending a
// person who does not exist, notified to nobody, payable by nobody.

const req = (over: Partial<BomChainInput> = {}): BomChainInput => ({
  status: 'submitted',
  department_name: 'Robotics',
  requested_by_name: 'Rahul',
  created_at: '2026-10-20T06:00:00.000Z',
  ...over
});

const stateOf = (record: BomChainInput, finance: boolean, key: string) =>
  bomApprovalTrail(record, finance).find((s) => s.key === key)?.state;

describe('bomApprovalTrail', () => {
  it('names the requester’s own department as the first approver', () => {
    const trail = bomApprovalTrail(req(), true);
    expect(trail[1].owner).toBe('Robotics manager');
  });

  it('marks the awaited step current and later steps upcoming', () => {
    const r = req({ status: 'submitted' });
    expect(stateOf(r, true, 'request')).toBe('done');
    expect(stateOf(r, true, 'department_manager')).toBe('current');
    expect(stateOf(r, true, 'management')).toBe('upcoming');
    expect(stateOf(r, true, 'payment')).toBe('upcoming');
  });

  it('keeps a draft sitting on its author', () => {
    expect(stateOf(req({ status: 'draft' }), true, 'request')).toBe('current');
    expect(stateOf(req({ status: 'draft' }), true, 'department_manager')).toBe('upcoming');
  });

  it('moves to Management once the department manager has approved', () => {
    const r = req({ status: 'approved', reviewed_by_name: 'Noor', reviewed_at: '2026-10-21T06:00:00.000Z' });
    expect(stateOf(r, true, 'department_manager')).toBe('done');
    expect(stateOf(r, true, 'management')).toBe('current');
  });

  // The defect. With a Finance Approver configured the step is real...
  it('waits on Finance after Management when one is configured', () => {
    const r = req({ status: 'admin_approved' });
    expect(stateOf(r, true, 'finance')).toBe('current');
    expect(stateOf(r, true, 'payment')).toBe('upcoming');
  });

  // ...and without one it is skipped and Accounts holds it instead, rather
  // than the request pending a nonexistent approver forever.
  it('hands Management approval straight to Accounts when Finance is unconfigured', () => {
    const r = req({ status: 'admin_approved' });
    expect(stateOf(r, false, 'finance')).toBe('skipped');
    expect(stateOf(r, false, 'payment')).toBe('current');
  });

  it('still shows a Finance approval that did happen, even if now unconfigured', () => {
    const r = req({ status: 'payment_done', finance_reviewed_by_name: 'Mayank', finance_reviewed_at: '2026-10-22T06:00:00.000Z' });
    expect(stateOf(r, false, 'finance')).toBe('done');
  });

  it('ends with nothing pending once received', () => {
    const trail = bomApprovalTrail(req({ status: 'received' }), false);
    expect(trail.some((s) => s.state === 'current')).toBe(false);
    expect(stateOf(req({ status: 'received' }), false, 'received')).toBe('done');
  });

  it('stops the chain at the step that rejected it', () => {
    const r = req({ status: 'rejected', reviewed_by_name: 'Noor', reviewed_at: '2026-10-21T06:00:00.000Z' });
    expect(stateOf(r, true, 'department_manager')).toBe('rejected');
    expect(stateOf(r, true, 'management')).toBe('upcoming');
    expect(bomApprovalTrail(r, true).some((s) => s.state === 'current')).toBe(false);
  });

  it('attributes a rejection after Management approval to the later step', () => {
    const r = req({
      status: 'rejected',
      reviewed_by_name: 'Noor',
      reviewed_at: '2026-10-21T06:00:00.000Z',
      admin_reviewed_by_name: 'Mayank',
      admin_reviewed_at: '2026-10-22T06:00:00.000Z'
    });
    expect(stateOf(r, true, 'department_manager')).toBe('done');
    expect(stateOf(r, true, 'management')).toBe('rejected');
  });

  // Sent to Procurement leaves the payment chain — the remaining steps are
  // not pending anybody and must not read as overdue.
  it('treats a request sent to Procurement as off the payment chain', () => {
    const r = req({ status: 'sent_for_procurement', reviewed_by_name: 'Noor', reviewed_at: '2026-10-21T06:00:00.000Z' });
    const trail = bomApprovalTrail(r, true);
    expect(trail.some((s) => s.state === 'current')).toBe(false);
    expect(stateOf(r, true, 'payment')).toBe('skipped');
  });

  it('falls back to a generic owner when the department has no name', () => {
    expect(bomApprovalTrail(req({ department_name: '' }), true)[1].owner).toBe('Department manager');
  });
});

describe('bomPendingWithLabel', () => {
  it('names the department manager by department', () => {
    expect(bomPendingWithLabel(req(), true)).toBe('Pending: Department Manager approval — Robotics manager');
  });

  it('names Accounts, not Finance, when Finance is unconfigured', () => {
    expect(bomPendingWithLabel(req({ status: 'admin_approved' }), false)).toBe('Pending: Payment — Accounts');
  });

  it('names Finance when one is configured', () => {
    expect(bomPendingWithLabel(req({ status: 'admin_approved' }), true)).toBe('Pending: Finance approval — Finance Approver');
  });

  it('reports the terminal states plainly', () => {
    expect(bomPendingWithLabel(req({ status: 'draft' }), false)).toBe('Not yet submitted');
    expect(bomPendingWithLabel(req({ status: 'received' }), false)).toBe('Complete — nothing pending');
    expect(bomPendingWithLabel(req({ status: 'rejected' }), false)).toBe('Rejected');
    expect(bomPendingWithLabel(req({ status: 'sent_for_procurement' }), false)).toBe('With Procurement');
  });
});
