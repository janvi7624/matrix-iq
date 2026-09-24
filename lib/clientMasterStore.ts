import { Model } from 'sequelize';
import { db } from './db';
import { DOMAIN_DISPLAY_NAME } from './domainLabels';
import { resolveVisibilityScope } from './departmentScope';
import { ClientContact, ClientOwner, ClientProductHandler, ClientProject, ClientSummary, DomainKey, LeadCallOutcome } from './types';

// Sourced from db.Sequelize (the exact class the connection/models were built
// from) rather than a top-level `import { Op } from 'sequelize'` — see
// app/api/users/list/route.ts for the two-copies-of-sequelize reason.
const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };

// A directory row is either a real customer (has at least one Project) or a
// prospect (captured lead that hasn't earned a project yet — see
// lib/leadCall.ts: only a 'suitable' call outcome creates one).
export type ClientRowType = 'customer' | 'prospect';

export const CALL_OUTCOME_LABEL: Record<LeadCallOutcome, string> = {
  '': 'Not called yet',
  suitable: 'Suitable',
  not_suitable: 'Not suitable',
  callback: 'Call back'
};

// One unconverted lead behind a directory row — enough to say who owns it and
// what came of the qualification call, without duplicating the Leads module.
export interface ClientLead {
  id: string;
  name: string;
  callOutcome: LeadCallOutcome;
  calledAt: string;
  callbackAt: string;
  createdAt: string;
  ownerName: string;
  ownerUsername: string;
}

// ClientSummary (lib/types.ts) is the project-derived shape this API has
// always returned. A row can now also come from a lead that never became a
// project, so the lead-side fields live here instead of widening the shared
// type for every other consumer of ClientSummary.
export interface ClientMasterRow extends ClientSummary {
  type: ClientRowType;
  leads: ClientLead[];
  leadCount: number;
  /** Outcome of this client's most recently called lead; '' when none was called. */
  callOutcome: LeadCallOutcome;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

// Client Master is a read-only directory derived entirely from existing
// Project (+ their Quotations' line items) records and from leads that have
// no project yet — there is no separate clients table to maintain (see
// lib/types.ts's ClientSummary comment).
// Shared by the JSON API (app/api/clients/route.ts) and the CSV export
// (app/api/clients/export.csv/route.ts) so both stay in sync off one
// implementation.
//
// Visibility is deliberately asymmetric, and the two halves are NOT the same
// rule:
//   * project-derived rows stay org-wide, exactly as this directory has
//     always behaved for its configured roles (lib/moduleConfigStore.ts's
//     'client-master' entry);
//   * lead-derived rows are limited to the leads this viewer may see — the
//     same created_by-OR-assigned_to scope lib/leadStore.ts's listLeads
//     applies. An expo drops hundreds of cards into the Leads module; surfacing
//     them here org-wide would quietly hand every role a full copy of a list
//     that is department-scoped everywhere else in the app.
async function list(viewerUsername: string): Promise<ClientMasterRow[]> {
  const projects = await db.Project.findAll({
    include: [
      { model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] },
      {
        model: db.Quotation,
        as: 'quotations',
        include: [{ model: db.QuotationProduct, as: 'products' }]
      }
    ],
    order: [['created_at', 'DESC']]
  });

  const groups = new Map<string, ClientMasterRow>();

  function groupFor(company: string, personName: string): ClientMasterRow | null {
    const key = normalizeKey(company || personName);
    if (!key) return null;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        displayName: company || personName,
        contacts: [],
        productHandlers: [],
        projects: [],
        projectCount: 0,
        statusCounts: {},
        owners: [],
        remarks: [],
        createdAt: '',
        updatedAt: '',
        type: 'prospect',
        leads: [],
        leadCount: 0,
        callOutcome: ''
      };
      groups.set(key, group);
    }
    // Prefer the fullest company name seen across this client's records.
    if (company.length > group.displayName.length) group.displayName = company;
    return group;
  }

  function addContact(group: ClientMasterRow, contact: ClientContact) {
    const isDuplicateContact = group.contacts.some(
      (c) => c.clientName === contact.clientName && c.phone === contact.phone && c.email === contact.email &&
        c.altContactName === contact.altContactName && c.altContactPhone === contact.altContactPhone
    );
    if (!isDuplicateContact && (contact.clientName || contact.phone || contact.email)) {
      group.contacts.push(contact);
    }
  }

  function addOwner(group: ClientMasterRow, owner: ClientOwner) {
    if (!owner.id) return;
    if (!group.owners.some((o) => o.id === owner.id)) group.owners.push(owner);
  }

  function noteDates(group: ClientMasterRow, createdAt: string, updatedAt: string) {
    if (createdAt && (!group.createdAt || createdAt < group.createdAt)) group.createdAt = createdAt;
    if (updatedAt && (!group.updatedAt || updatedAt > group.updatedAt)) group.updatedAt = updatedAt;
  }

  for (const row of projects as Model[]) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    const company = String(p.company || '').trim();
    const clientName = String(p.client_name || '').trim();
    const group = groupFor(company, clientName);
    if (!group) continue;

    group.projectCount += 1;
    const status = String(p.status || 'active');
    group.statusCounts[status] = (group.statusCounts[status] || 0) + 1;

    const createdAt = isoOrEmpty(p.createdAt);
    const updatedAt = isoOrEmpty(p.updatedAt);
    noteDates(group, createdAt, updatedAt);

    addContact(group, {
      clientName,
      phone: String(p.phone || '').trim(),
      email: String(p.email || '').trim(),
      altContactName: String(p.contact_person || '').trim(),
      altContactPhone: String(p.alt_contact_phone || '').trim(),
      projectId: String(p.id)
    });

    const creator = p.creator as { id?: string; username?: string; name?: string } | null;
    if (creator?.id) {
      addOwner(group, { id: creator.id, username: creator.username || '', name: creator.name || creator.username || '' });
    }

    group.projects.push({
      id: String(p.id),
      status: status as ClientProject['status'],
      stage: String(p.stage || '') as ClientProject['stage'],
      priority: String(p.priority || 'medium') as ClientProject['priority'],
      createdAt,
      expectedClosingDate: isoOrEmpty(p.expected_closing_date),
      ownerName: creator?.name || creator?.username || '',
      ownerUsername: creator?.username || ''
    });

    const remarks = String(p.remarks || '').trim();
    if (remarks && !group.remarks.includes(remarks)) group.remarks.push(remarks);

    const quotations = (p.quotations as Record<string, unknown>[]) || [];
    for (const q of quotations) {
      const products = (q.products as Record<string, unknown>[]) || [];
      const domainKeys = new Set<string>();
      for (const item of products) {
        const domainKey = String(item.domain_key || '').trim();
        if (domainKey) domainKeys.add(domainKey);
      }
      // Older/custom quotations without normalized line items still have a
      // free-text domain_summary — fall back to that so they aren't silently
      // dropped from the product-handler breakdown.
      if (!domainKeys.size) {
        const summary = String(q.domain_summary || '').trim();
        if (summary) domainKeys.add(summary);
      }

      for (const domainKey of domainKeys) {
        if (!creator?.id) continue;
        const label = DOMAIN_DISPLAY_NAME[domainKey as DomainKey] || domainKey;
        const handledBy = creator.name || creator.username || '';
        const alreadyListed = group.productHandlers.some((h) => h.product === label && h.handledByUsername === creator.username);
        if (!alreadyListed) {
          const entry: ClientProductHandler = { product: label, handledBy, handledByUsername: creator.username || '' };
          group.productHandlers.push(entry);
        }
      }
    }
  }

  // Second source: leads that never became a project. project_id IS NULL is
  // the whole test — a converted lead is already represented by the project it
  // created, and merging on the same company/name key means a prospect that is
  // later qualified collapses into that one row rather than appearing twice.
  const leadWhere: Record<string | symbol, unknown> = { project_id: null };
  const scope = await resolveVisibilityScope(viewerUsername);
  if (scope.scopedUserIds) {
    leadWhere[Op.or] = [
      { created_by: { [Op.in]: scope.scopedUserIds } },
      { assigned_to_id: { [Op.in]: scope.scopedUserIds } }
    ];
  }

  const leads = await db.Lead.findAll({
    where: leadWhere as never,
    include: [
      // 'name' is fetched here (createRecordStore's shared creator include is
      // username-only) so a prospect's "Whose Client" reads as a person.
      { model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] },
      { model: db.User, as: 'assignee', attributes: ['id', 'username', 'name'] }
    ],
    order: [['created_at', 'DESC']]
  });

  for (const row of leads as Model[]) {
    const l = row.get({ plain: true }) as Record<string, unknown>;
    const company = String(l.company || '').trim();
    const leadName = String(l.name || '').trim();
    const group = groupFor(company, leadName);
    if (!group) continue;

    const createdAt = isoOrEmpty(l.createdAt);
    // On a row that already has projects, a lead may push "last activity"
    // forward but must NOT pull "client since" backwards. Project rows are
    // org-wide while leads are scoped to this viewer, so letting an
    // unqualified card rewrite when the relationship began would give two
    // people different "Client Since" dates — and different "Added this
    // month" counts — for the same customer, with no way to reconcile the two
    // exports. A pure prospect has no other source of dates, so there both
    // still come from its leads.
    if (group.projectCount > 0) {
      noteDates(group, '', isoOrEmpty(l.updatedAt));
    } else {
      noteDates(group, createdAt, isoOrEmpty(l.updatedAt));
    }

    addContact(group, {
      clientName: leadName,
      phone: String(l.mobile || '').trim(),
      email: String(l.email || '').trim(),
      altContactName: '',
      altContactPhone: '',
      // No project behind this contact — the UI keys its "open the project"
      // affordances off this being empty.
      projectId: ''
    });

    // Whoever is working the lead owns the prospect; the person who captured
    // the card is the fallback while it is still unassigned.
    const assignee = l.assignee as { id?: string; username?: string; name?: string } | null;
    const creator = l.creator as { id?: string; username?: string; name?: string } | null;
    const owner = assignee?.id ? assignee : creator;
    const ownerName = owner?.name || owner?.username || '';
    if (owner?.id) {
      addOwner(group, { id: owner.id, username: owner.username || '', name: ownerName });
    }

    const callOutcome = String(l.call_outcome || '') as LeadCallOutcome;
    group.leadCount += 1;
    group.leads.push({
      id: String(l.id),
      name: leadName,
      callOutcome,
      calledAt: isoOrEmpty(l.called_at),
      callbackAt: isoOrEmpty(l.callback_at).slice(0, 10),
      createdAt,
      ownerName,
      ownerUsername: owner?.username || ''
    });

    // The call remark is the only written record of WHY a card was parked or
    // dropped, so it belongs in the directory alongside project remarks.
    const callRemark = String(l.call_remark || '').trim();
    if (callRemark) {
      const labelled = `${CALL_OUTCOME_LABEL[callOutcome] || 'Call'}: ${callRemark}`;
      if (!group.remarks.includes(labelled)) group.remarks.push(labelled);
    }
    const notes = String(l.notes || '').trim();
    if (notes && !group.remarks.includes(notes)) group.remarks.push(notes);
  }

  const rows = Array.from(groups.values());
  for (const row of rows) {
    row.type = row.projectCount > 0 ? 'customer' : 'prospect';
    // The latest word on this client is the most recently CALLED lead, which
    // is not the most recently captured one: a card scanned at yesterday's
    // expo and never rung would otherwise outrank last week's card that was
    // called this morning and marked not suitable, and the directory would
    // show the stale verdict. Ties (and leads whose called_at predates the
    // column existing) fall back to capture order, which is how the rows
    // already arrive.
    let latest: ClientLead | null = null;
    for (const lead of row.leads) {
      if (!lead.callOutcome) continue;
      if (!latest || lead.calledAt > latest.calledAt) latest = lead;
    }
    row.callOutcome = latest?.callOutcome || '';
  }
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export const clientMasterStore = { list };
