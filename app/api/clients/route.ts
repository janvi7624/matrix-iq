import { NextRequest, NextResponse } from 'next/server';
import { Model } from 'sequelize';
import { getViewerContext } from '@/lib/viewerContext';
import { db } from '@/lib/db';
import { apiErrorResponse } from '@/lib/apiError';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { ClientContact, ClientSummary, DomainKey } from '@/lib/types';

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

// Client Master is a read-only directory derived entirely from existing
// Project (+ their Quotations' line items) records — there is no separate
// clients table to maintain. Deliberately org-wide and unscoped (no
// resolveVisibilityScope call, unlike Leads/Quotations/Projects' own list
// endpoints) since the module is meant to be visible to everyone regardless
// of who created a given project.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const projects = await db.Project.findAll({
      include: [
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
        group = { key, displayName: company || clientName, contacts: [], productHandlers: [], projectCount: 0, statusCounts: {} };
        groups.set(key, group);
      }
      // Prefer the fullest company name seen across this client's projects.
      if (company.length > group.displayName.length) group.displayName = company;

      group.projectCount += 1;
      const status = String(p.status || 'active');
      group.statusCounts[status] = (group.statusCounts[status] || 0) + 1;

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

      const salesPerson = String(p.sales_person || '').trim();
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
          if (!salesPerson) continue;
          const label = DOMAIN_DISPLAY_NAME[domainKey as DomainKey] || domainKey;
          const alreadyListed = group.productHandlers.some((h) => h.product === label && h.handledBy === salesPerson);
          if (!alreadyListed) group.productHandlers.push({ product: label, handledBy: salesPerson });
        }
      }
    }

    const clients = Array.from(groups.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
    return NextResponse.json({ clients });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
