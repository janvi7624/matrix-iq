import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';

// The partner demo form mirrors the internal one — EXCEPT for staffing.
// These assertions are source-level because the guarantee is structural:
// it holds because certain fields are absent from the intake contract and
// certain controls are absent from the form.

const STORE = fs.readFileSync('lib/partnerDemoStore.ts', 'utf8');
const ROUTE = fs.readFileSync('app/api/partner/demos/route.ts', 'utf8');
const FORM = fs.readFileSync('components/PartnerDemosView.tsx', 'utf8');
const PATCH = fs.readFileSync('app/api/demo-schedule/[id]/route.ts', 'utf8');

describe('a partner can supply everything the internal form asks for', () => {
  it('accepts the full request shape', () => {
    for (const field of [
      'projectId',
      'quotationId',
      'company',
      'clientName',
      'mode',
      'location',
      'preferredDate',
      'priority',
      'productDomains',
      'productsRequired',
      'demoObjective',
      'requirements'
    ]) {
      expect(STORE).toContain(`${field}`);
      expect(ROUTE).toContain(field);
    }
  });

  it('offers the same domain list and product catalogue as the internal form', () => {
    // Imported from the shared libs, not re-listed — so a catalogue change
    // reaches both forms at once.
    expect(FORM).toContain("from '@/lib/domainLabels'");
    expect(FORM).toContain("from '@/lib/domainProducts'");
    expect(FORM).toContain('getDomainProducts(d)');
  });
});

describe('a partner can never choose the technical staffing', () => {
  it('has no staffing field in the intake contract', () => {
    // The three pickers the internal form has and this one must not.
    for (const field of ['assignedTechnicalPersonId', 'technicalMembers', 'assignedRep']) {
      expect(STORE).not.toContain(field);
      expect(ROUTE).not.toContain(field);
    }
  });

  it('writes an empty technical roster on every partner request', () => {
    expect(STORE).toContain('technical_members: []');
  });

  it('renders no technical-person or team control in the partner form', () => {
    expect(FORM).not.toContain('Assigned technical person');
    expect(FORM).not.toContain('Technical team member');
    expect(FORM).not.toContain('Assigned rep');
  });

  it('gates assignment on the demo’s own sales owner', () => {
    // Set only via the internal PATCH route, and only by the sales person
    // the demo belongs to (or a privileged viewer) — explicitly not the
    // engineer/back-office pipeline operators that route otherwise admits.
    expect(PATCH).toContain('existing.created_by === viewer.username');
    expect(PATCH).toContain('Only the sales person this demo belongs to can assign the technical person.');
  });
});

describe('what the partner asked for is preserved', () => {
  it('keeps the original requested date alongside the proposed one', () => {
    // scheduled_at is provisional and our team may move it; the original ask
    // must stay visible rather than being silently overwritten.
    expect(STORE).toContain('scheduled_at: requestedAt');
    expect(STORE).toContain('partner_requested_date: requestedAt');
  });

  it('keeps partner notes out of the internal notes field', () => {
    // `notes` is where the sales team writes internal coordination.
    expect(STORE).toContain('partner_requirements: input.requirements.trim()');
    expect(STORE).not.toContain('notes: input.requirements');
  });
});
