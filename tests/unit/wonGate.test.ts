import { describe, it, expect, vi, beforeEach } from 'vitest';

// The single gate that decides whether a deal may close as Won.
//
// These tests exist because of a measured production hole, not a hypothetical
// one. STATUS_GATES.won has always required a Project Brief, but the gate was
// enforced inline in PATCH /api/projects/[id] only — while POST /api/po and
// PATCH /api/installation/[id] closed deals by calling
// projectStore.update({ status: 'won' }) themselves. Since receiving the PO is
// how deals actually get closed, the checklist that asks for the brief was
// almost never shown: on 2026-10-28, 14 of 16 won projects had no Project
// Brief and 9 had no Project Name.
//
// evaluateWonGate is now the one definition all three callers share, so what
// is pinned here is the thing that was broken: a blank brief must fail, and it
// must fail the same way no matter which route is asking.

const m = vi.hoisted(() => ({ poFindOne: vi.fn(), quotationFindAll: vi.fn() }));
vi.mock('../../lib/db', () => ({
  db: { PurchaseOrder: { findOne: m.poFindOne, findAll: vi.fn() }, Quotation: { findAll: m.quotationFindAll } },
  isUuid: () => true,
  sequelize: {}
}));

import { evaluateWonGate } from '../../lib/salesStageGateSources';
import { stageGateFailures, wonBriefFailure } from '../../lib/salesStageRules';

const PROJECT = '11111111-1111-4111-8111-111111111111';

/** A Sequelize-ish row: only .get({ plain: true }) is ever used. */
function row(plain: Record<string, unknown>) {
  return { get: () => plain } as never;
}

/** The handover checklist, complete. po_* are NOT project columns — they come from the PO row. */
const COMPLETE = {
  project_name: 'Standee - 3x6 ft',
  company: 'YMCA',
  project_brief: 'Active LED Standee 3*6 ft - P2.5 SMD with Speaker'
};

const fields = (failures: { field: string }[]) => failures.map((f) => f.field).sort();

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a linked PO and a quotation both exist, so only the project's
  // own blank fields can fail. Each test removes what it is about.
  m.poFindOne.mockResolvedValue(row({ id: 'po1', po_number: 'UNMICRC/P.O./2026/10/0005369', po_date: '2026-10-27', amount: 213705 }));
  m.quotationFindAll.mockResolvedValue([
    row({ id: 'q1', quotation_number: 'QT-00001', total: 213705, status: 'approved', status_changed_at: '2026-10-20', revision_number: 0, created_at: '2026-10-19' })
  ]);
});

describe('evaluateWonGate', () => {
  it('passes a complete checklist', async () => {
    const { failures } = await evaluateWonGate(PROJECT, 'po_received', COMPLETE);
    expect(failures).toEqual([]);
  });

  // The defect this whole change exists for.
  it('blocks a blank Project Brief', async () => {
    const { failures } = await evaluateWonGate(PROJECT, 'po_received', { ...COMPLETE, project_brief: '' });
    expect(fields(failures)).toEqual(['project_brief']);
    expect(failures[0].message).toContain('Project Brief');
  });

  it('blocks a brief that is only whitespace', async () => {
    const { failures } = await evaluateWonGate(PROJECT, 'po_received', { ...COMPLETE, project_brief: '   \n ' });
    expect(fields(failures)).toEqual(['project_brief']);
  });

  // 223 of 241 projects carry NULL here, and 16 carry '' — both must block.
  it.each([null, undefined])('blocks a brief that is %s', async (value) => {
    const { failures } = await evaluateWonGate(PROJECT, 'po_received', { ...COMPLETE, project_brief: value });
    expect(fields(failures)).toEqual(['project_brief']);
  });

  it('satisfies po_number/po_value/po_date from the linked PO rather than the project row', async () => {
    // Those three are gate fields but not project columns; a project row that
    // knows nothing about them still passes when a PO exists.
    const { failures, winningPo } = await evaluateWonGate(PROJECT, 'po_received', COMPLETE);
    expect(failures).toEqual([]);
    expect(winningPo).toBeNull(); // nothing to write: the PO is already there
  });

  it('accepts PO details carried on the transition when no PO row exists yet', async () => {
    m.poFindOne.mockResolvedValue(null);
    const { failures, winningPo } = await evaluateWonGate(PROJECT, 'negotiation', COMPLETE, {
      po_number: 'PO-9',
      po_value: 500,
      po_date: '2026-10-28'
    });
    expect(failures).toEqual([]);
    expect(winningPo).toEqual({ po_number: 'PO-9', po_value: 500, po_date: '2026-10-28' });
  });

  it('blocks when there is no PO at all', async () => {
    m.poFindOne.mockResolvedValue(null);
    const { failures } = await evaluateWonGate(PROJECT, 'negotiation', COMPLETE);
    expect(fields(failures)).toEqual(['po_date', 'po_number', 'po_value']);
  });

  it('requires a quotation to exist, which is a row check and not a blank-field check', async () => {
    m.quotationFindAll.mockResolvedValue([]);
    const { failures } = await evaluateWonGate(PROJECT, 'po_received', COMPLETE);
    expect(fields(failures)).toEqual(['quotation']);
  });

  it('reports every missing item at once rather than one per round trip', async () => {
    m.quotationFindAll.mockResolvedValue([]);
    const { failures } = await evaluateWonGate(PROJECT, 'po_received', {});
    expect(fields(failures)).toEqual(['company', 'project_brief', 'project_name', 'quotation']);
  });

  // The exact shape of the two records this was found on.
  it('blocks the U. N. Mehta case: a PO and a quotation, but brief and name blank', async () => {
    const { failures } = await evaluateWonGate(PROJECT, 'po_received', {
      company: 'U. N. Mehta Institute of Cardiology & Research centre',
      project_name: '',
      project_brief: ''
    });
    expect(fields(failures)).toEqual(['project_brief', 'project_name']);
  });

  it('does not invent failures for fields the Won gate never asked about', async () => {
    // Won answers only to its own checklist — a deal arriving with no
    // expected closing date or price must not be held up by the forward
    // pipeline's gates.
    const { failures } = await evaluateWonGate(PROJECT, 'negotiation', {
      ...COMPLETE,
      approx_price: '',
      expected_closing_date: '',
      quote_value: ''
    });
    expect(failures).toEqual([]);
  });
});

// The narrow invariant the PO and installation routes enforce. Separate from
// evaluateWonGate on purpose: those two routes must demand the brief WITHOUT
// demanding a quotation row, because quotes routinely go out by email and
// never become a row — gating them on the full checklist would have blocked
// 15 of the 16 wins that exist today.
describe('wonBriefFailure', () => {
  it.each([['empty', ''], ['whitespace', '   \n'], ['null', null], ['undefined', undefined]])(
    'blocks a %s brief',
    (_label, value) => {
      expect(wonBriefFailure('po_received', { ...COMPLETE, project_brief: value })?.field).toBe('project_brief');
    }
  );

  it('passes a written brief', () => {
    expect(wonBriefFailure('po_received', COMPLETE)).toBeNull();
  });

  // This is the property that keeps the PO path working.
  it('ignores everything else the full checklist would demand', () => {
    // No quotation row, no project name, no company, no PO fields — and the
    // brief alone still decides.
    expect(wonBriefFailure('po_received', { project_brief: 'A meeting-room AV rollout across three sites.' })).toBeNull();
  });

  it('is exactly the brief entry the full checklist produces, never a reworded copy', () => {
    const narrow = wonBriefFailure('po_received', {});
    const full = stageGateFailures('po_received', 'won', {}).find((f) => f.field === 'project_brief');
    expect(narrow).toEqual(full);
  });

  it('answers the Won checklist even when the deal sits in an open stage', () => {
    // Installation completion closes deals from whatever stage they are in.
    expect(wonBriefFailure('negotiation', { project_brief: '' })?.field).toBe('project_brief');
    expect(wonBriefFailure('prospect', { project_brief: 'Three-site rollout.' })).toBeNull();
  });
});
