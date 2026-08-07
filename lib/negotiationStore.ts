import { NegotiationRecord } from './types';
import { createRecordStore } from './recordStore';
import { db } from './db';

export const negotiationStore = createRecordStore<NegotiationRecord>(db.Negotiation, [
  { name: 'project_id', kind: 'nullable' },
  { name: 'discussion_date', kind: 'nullable' },
  { name: 'person' },
  { name: 'discussion' },
  { name: 'offer_given' },
  { name: 'discount' },
  { name: 'revised_price', kind: 'number' },
  { name: 'expected_closure', kind: 'nullable' }
]);
