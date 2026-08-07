import { PoRecord } from './types';
import { createRecordStore } from './recordStore';
import { db } from './db';

export const poStore = createRecordStore<PoRecord>(db.PurchaseOrder, [
  { name: 'project_id', kind: 'nullable' },
  { name: 'po_number' },
  { name: 'po_date', kind: 'nullable' },
  { name: 'amount', kind: 'number' },
  { name: 'attachment_url' },
  { name: 'advance_received', kind: 'number' },
  { name: 'payment_terms' }
]);
