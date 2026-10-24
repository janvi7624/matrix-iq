import { describe, it, expect } from 'vitest';
import { isPartnerPath } from '../../lib/partnerRoles';
import { partnerMayReadUpload, partnerUploadPrefix } from '../../lib/partnerUploads';
import { materialVisibleToPartner } from '../../lib/materialPublication';
import { canTransition } from '../../lib/supportTicketWorkflow';
import { resolveSupportActor } from '../../lib/supportTicketAccess';
import { toPartnerVisibleProject } from '../../lib/partnerVisibility';
import { PARTNER_SUBMITTABLE_FIELDS } from '../../lib/partnerVisibility';
import type { ProjectRecord } from '../../lib/types';

// The Partner Portal's cross-tenant guarantees, asserted in one place.
//
// Each individual rule is tested in its own file; this suite exists so the
// guarantees are stated once as a set, and so a regression in any one of
// them fails a test whose name says what was actually broken.
//
// Scope note: these cover the PURE rules. Query-level tenancy (partner_id in
// every WHERE) is enforced in the stores and cannot be asserted without a
// database; the stores are written so that no partner-facing query exists
// without it, and the route files pass partnerId from the session rather
// than from the request.

const PARTNER_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const PARTNER_B = 'bbbbbbbb-0000-0000-0000-00000000000b';

describe('isolation: Partner A cannot reach Partner B', () => {
  it('cannot read B’s uploaded files', () => {
    expect(partnerMayReadUpload(`${partnerUploadPrefix(PARTNER_B)}misc/file.pdf`, PARTNER_A)).toBe(false);
  });

  it('cannot read internal staff uploads', () => {
    expect(partnerMayReadUpload('uploads/reimbursement/priya/bill.jpg', PARTNER_A)).toBe(false);
  });

  it('cannot see collateral published only to B', () => {
    const material = { id: 'm', folderId: null, partnerVisible: true, partnerAudience: [PARTNER_B] };
    expect(materialVisibleToPartner(material, [], PARTNER_A)).toBe(false);
    expect(materialVisibleToPartner(material, [], PARTNER_B)).toBe(true);
  });
});

describe('isolation: partners cannot leave the portal', () => {
  it('is refused every internal route area', () => {
    for (const path of [
      '/',
      '/projects',
      '/api/projects',
      '/quotation',
      '/api/quotations',
      '/admin/users',
      '/api/admin/users',
      '/admin/partners',
      '/api/admin/partners',
      '/support',
      '/api/support/tickets',
      '/tms/tasks',
      '/api/search',
      '/api/dashboard'
    ]) {
      expect(isPartnerPath(path)).toBe(false);
    }
  });

  it('is allowed the portal and the shared account routes it needs', () => {
    for (const path of ['/partner', '/partner/support', '/api/partner/support/tickets', '/api/auth/logout', '/api/notifications', '/change-password']) {
      expect(isPartnerPath(path)).toBe(true);
    }
  });
});

describe('isolation: internal data never reaches a partner payload', () => {
  const project = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    created_at: '2026-10-01T00:00:00.000Z',
    created_by: 'priya.rm',
    company: 'Acme',
    client_name: 'Ravi',
    stage: 'quotation',
    status: 'active',
    sales_person: 'deepak',
    approx_price: 5_000_000,
    quote_value: 4_800_000,
    closing_probability_percent: 65,
    remarks: 'Internal: customer is price shopping',
    tender_emd: 250_000,
    partner_submission_status: 'approved',
    partner_submitted_value: 4_500_000,
    notes: [{ id: 'n', at: '2026-10-02T00:00:00.000Z', by: 'deepak', text: 'hold firm on price', partner_visible: false }],
    timeline: [{ id: 't', at: '2026-10-02T00:00:00.000Z', by: 'deepak', stage: 'quotation', label: 'Internal review', remarks: 'undercut by 8%', partner_visible: false }]
  } as unknown as ProjectRecord;

  it('redacts pricing, internal notes and usernames', () => {
    const serialised = JSON.stringify(
      toPartnerVisibleProject(project, { hasSharedQuotation: false, hasDemo: false, salespersonName: 'Deepak Shah' })
    );
    for (const secret of ['5000000', '4800000', '65', 'price shopping', '250000', 'hold firm', 'undercut', 'priya.rm', 'deepak']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('does not accept internal fields from a partner submission', () => {
    for (const field of ['approx_price', 'sales_person', 'stage', 'status', 'partner_id', 'partner_submission_status', 'created_by']) {
      expect(PARTNER_SUBMITTABLE_FIELDS as readonly string[]).not.toContain(field);
    }
  });
});

describe('isolation: a partner role alone grants nothing', () => {
  it('treats any account carrying partnerId as a partner, whatever its role', () => {
    // Defence in depth: the binding wins over the role string everywhere, so
    // a mis-assigned internal role cannot widen an external account.
    expect(resolveSupportActor({ userId: 'u', username: 'x', role: 'superadmin', isPrivileged: true, partnerId: PARTNER_A })).toBe('partner');
    expect(resolveSupportActor({ userId: 'u', username: 'x', role: 'technical-manager', isPrivileged: false, partnerId: PARTNER_A })).toBe('partner');
  });

  it('gives an internal account with a partner-ish role no partner powers', () => {
    expect(resolveSupportActor({ userId: 'u', username: 'x', role: 'partner-admin', isPrivileged: false, partnerId: '' })).toBeNull();
  });
});

describe('isolation: partners cannot act on internal workflows', () => {
  it('cannot assign, triage, escalate, cancel or resolve a ticket', () => {
    for (const to of ['assigned', 'under_triage', 'escalated', 'cancelled', 'resolved', 'acknowledged'] as const) {
      expect(canTransition('in_progress', to, 'partner')).toBe(false);
    }
  });

  it('can only confirm or dispute a resolution, and reply when asked', () => {
    expect(canTransition('resolved', 'closed', 'partner')).toBe(true);
    expect(canTransition('resolved', 'reopened', 'partner')).toBe(true);
    expect(canTransition('awaiting_partner', 'in_progress', 'partner')).toBe(true);
  });
});

describe('isolation: a shared quotation is read-only and margin-free', () => {
  // Verified against the source rather than a mock, because the guarantee is
  // structural: it holds because certain handlers and fields do not exist.
  const partnerRoutes = [
    'app/api/partner/quotations/route.ts',
    'app/api/partner/quotations/[id]/route.ts'
  ];

  it('exposes no write handler on any partner quotation route', async () => {
    // Read-only by construction. A partner cannot create, edit, reprice,
    // approve, revise or delete a quotation because there is no code path
    // through which to do so — not because a permission check says no.
    const fs = await import('node:fs/promises');
    for (const route of partnerRoutes) {
      const src = await fs.readFile(route, 'utf8');
      for (const verb of ['export async function POST', 'export async function PATCH', 'export async function PUT', 'export async function DELETE']) {
        expect(src).not.toContain(verb);
      }
      expect(src).toContain('export async function GET');
    }
  });

  it('never selects markup_percent for a partner', async () => {
    // markup_percent is this company's margin; handing it to a channel
    // partner would disclose our cost structure.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('lib/partnerQuotationStore.ts', 'utf8');
    const attributeBlock = src.slice(src.indexOf('const quotationAttributes'), src.indexOf('/** Everything the client-side PDF generator needs'));
    expect(attributeBlock).not.toContain("'markup_percent'");
    expect(attributeBlock).not.toContain("'prepared_by_user_id'");
  });

  it('sends a zero markup in the download payload', async () => {
    // The PDF generator's Totals type requires the field; lib/pdf.ts never
    // prints it. Hard-coding 0 keeps the real figure out of the response.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('lib/partnerQuotationStore.ts', 'utf8');
    expect(src).toContain('markup: 0');
  });
});
