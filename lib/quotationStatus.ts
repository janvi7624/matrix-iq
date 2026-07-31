// Client-safe mirror of quotationStore.ts's computeEffectiveStatus — that
// file pulls in @vercel/blob (server-only), so 'use client' components need
// this pure copy instead of importing the store directly.
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
