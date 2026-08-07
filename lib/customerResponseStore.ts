import { CustomerResponseRecord } from './types';
import { createRecordStore } from './recordStore';
import { db } from './db';

export const customerResponseStore = createRecordStore<CustomerResponseRecord>(db.CustomerResponse, [
  { name: 'project_id', kind: 'nullable' },
  { name: 'demo_id', kind: 'nullable' },
  { name: 'feedback' },
  { name: 'response_type', kind: 'nullable' },
  { name: 'expected_decision_date', kind: 'nullable' },
  { name: 'remarks' }
]);
