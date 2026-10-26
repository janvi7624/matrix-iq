// Client-safe mirror of quotationStore.ts's computeEffectiveStatus — that
// file pulls in the Sequelize/db layer (server-only), so 'use client'
// components need this pure copy instead of importing the store directly.
import { QuotationEffectiveStatus, QuotationRecord } from './types';

export function computeEffectiveStatusClient(record: Pick<QuotationRecord, 'status' | 'created_at' | 'validity_days'>): QuotationEffectiveStatus {
  if (record.status === 'sent') {
    const createdAt = new Date(record.created_at).getTime();
    if (!Number.isNaN(createdAt)) {
      const expiresAt = createdAt + (record.validity_days || 0) * 24 * 60 * 60 * 1000;
      if (Date.now() > expiresAt) return 'expired';
    }
  }
  return record.status;
}

/**
 * Which quotation statuses may be shared with a partner.
 *
 * Lives here rather than in lib/partnerQuotationStore.ts because the rule is
 * needed on BOTH sides: the server enforces it, and the Partner Requests
 * queue greys out unshareable options in its dropdown. That store imports
 * Sequelize, so a client component reaching into it for this one constant
 * would pull the ORM into the browser bundle — the same reason
 * computeEffectiveStatusClient above exists.
 *
 * A draft is excluded because it is still being written; sharing one would
 * publish working numbers to an external company. 'rejected' IS shareable:
 * the partner was already shown it, and withdrawing the document the moment
 * our customer declines would erase their own history.
 */
export const SHAREABLE_QUOTATION_STATUSES = ['sent', 'approved', 'rejected'];

export function isShareableQuotationStatus(status: string): boolean {
  return SHAREABLE_QUOTATION_STATUSES.includes(status);
}
