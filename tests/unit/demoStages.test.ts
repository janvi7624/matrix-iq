import { describe, it, expect } from 'vitest';
import { DEMO_STAGES, DEMO_STATUS_LABEL, VIRTUAL_DEMO_STAGES, demoStageIndex, stagesForMode } from '../../lib/demoStages';

// One definition, two consumers: the internal Demo Schedule view and the
// partner portal. These assertions are what stop them drifting back apart.

describe('stagesForMode', () => {
  it('gives an onsite demo the full physical chain', () => {
    expect(stagesForMode('onsite')).toBe(DEMO_STAGES);
    expect(DEMO_STAGES.map((s) => s.key)).toContain('material_dispatched');
    expect(DEMO_STAGES.map((s) => s.key)).toContain('dc_closed');
  });

  it('drops every physical step for a virtual demo', () => {
    // Nothing is challaned, dispatched or returned for a screen share —
    // showing those steps would make a finished demo look permanently
    // unfinished.
    expect(stagesForMode('virtual')).toBe(VIRTUAL_DEMO_STAGES);
    for (const key of ['pending_backoffice', 'dc_generated', 'material_dispatched', 'material_returned', 'dc_closed']) {
      expect(VIRTUAL_DEMO_STAGES.map((s) => s.key)).not.toContain(key);
    }
  });

  it('treats anything that is not explicitly virtual as onsite', () => {
    // The mode decides whether a request ever reaches Back Office, so it is
    // never guessed — same rule the POST route applies.
    expect(stagesForMode('')).toBe(DEMO_STAGES);
    expect(stagesForMode('something-else')).toBe(DEMO_STAGES);
  });
});

describe('demoStageIndex', () => {
  it('locates each onsite status on the chain', () => {
    expect(demoStageIndex('pending_technical', 'onsite')).toBe(0);
    expect(demoStageIndex('demo_completed', 'onsite')).toBe(5);
    expect(demoStageIndex('dc_closed', 'onsite')).toBe(7);
  });

  it('locates a virtual demo on its shorter chain', () => {
    expect(demoStageIndex('ready_for_demo', 'virtual')).toBe(2);
    expect(demoStageIndex('demo_completed', 'virtual')).toBe(3);
  });

  it('returns -1 for a draft, which has not entered the chain', () => {
    expect(demoStageIndex('draft', 'onsite')).toBe(-1);
  });

  it('returns -1 for a cancellation rather than inventing a position', () => {
    // Cancellation can happen from any status and records no stage; a
    // fabricated stepper position would claim progress that never happened.
    expect(demoStageIndex('cancelled', 'onsite')).toBe(-1);
    expect(demoStageIndex('cancelled', 'virtual')).toBe(-1);
  });

  it('returns -1 for a status that is not on the chosen chain', () => {
    // 'dc_generated' is onsite-only — a virtual demo can never be there, and
    // claiming index 0 would paint the stepper wrongly.
    expect(demoStageIndex('dc_generated', 'virtual')).toBe(-1);
  });
});

describe('DEMO_STATUS_LABEL', () => {
  it('labels every status both chains can reach', () => {
    for (const stage of [...DEMO_STAGES, ...VIRTUAL_DEMO_STAGES]) {
      expect(DEMO_STATUS_LABEL[stage.key]).toBeTruthy();
    }
    expect(DEMO_STATUS_LABEL.cancelled).toBe('Cancelled');
    expect(DEMO_STATUS_LABEL.draft).toBe('Draft');
  });
});
