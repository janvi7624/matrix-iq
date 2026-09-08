import { Model } from 'sequelize';
import { db } from './db';
import { DOMAIN_DISPLAY_NAME } from './domainLabels';
import { ClientContact, ClientOwner, ClientProductHandler, ClientProject, ClientSummary, DomainKey } from './types';

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

// Client Master is a read-only directory derived entirely from existing
// Project (+ their Quotations' line items) records — there is no separate
// clients table to maintain (see lib/types.ts's ClientSummary comment).
// Shared by the JSON API (app/api/clients/route.ts) and the CSV export
// (app/api/clients/export.csv/route.ts) so both stay in sync off one
// implementation.
async function list(): Promise<ClientSummary[]> {
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

  const groups = new Map<string, ClientSummary>();

  for (const row of projects as Model[]) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    const company = String(p.company || '').trim();
    const clientName = String(p.client_name || '').trim();
    const key = normalizeKey(company || clientName);
    if (!key) continue;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        displayName: company || clientName,
        contacts: [],
        productHandlers: [],
        projects: [],
        projectCount: 0,
        statusCounts: {},
        owners: [],
        remarks: [],
        createdAt: '',
        updatedAt: ''
      };
      groups.set(key, group);
    }
    // Prefer the fullest company name seen across this client's projects.
    if (company.length > group.displayName.length) group.displayName = company;

    group.projectCount += 1;
    const status = String(p.status || 'active');
    group.statusCounts[status] = (group.statusCounts[status] || 0) + 1;

    const createdAt = isoOrEmpty(p.createdAt);
    const updatedAt = isoOrEmpty(p.updatedAt);
    if (createdAt && (!group.createdAt || createdAt < group.createdAt)) group.createdAt = createdAt;
    if (updatedAt && (!group.updatedAt || updatedAt > group.updatedAt)) group.updatedAt = updatedAt;

    const contact: ClientContact = {
      clientName,
      phone: String(p.phone || '').trim(),
      email: String(p.email || '').trim(),
      altContactName: String(p.contact_person || '').trim(),
      altContactPhone: String(p.alt_contact_phone || '').trim(),
      projectId: String(p.id)
    };
    const isDuplicateContact = group.contacts.some(
      (c) => c.clientName === contact.clientName && c.phone === contact.phone && c.email === contact.email &&
        c.altContactName === contact.altContactName && c.altContactPhone === contact.altContactPhone
    );
    if (!isDuplicateContact && (contact.clientName || contact.phone || contact.email)) {
      group.contacts.push(contact);
    }

    const creator = p.creator as { id?: string; username?: string; name?: string } | null;
    if (creator?.id) {
      const owner: ClientOwner = { id: creator.id, username: creator.username || '', name: creator.name || creator.username || '' };
      if (!group.owners.some((o) => o.id === owner.id)) group.owners.push(owner);
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

  return Array.from(groups.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export const clientMasterStore = { list };
