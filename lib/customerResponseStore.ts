import { CustomerResponseRecord } from './types';
import { createRecordStore } from './recordStore';

export const customerResponseStore = createRecordStore<CustomerResponseRecord>('data/customerResponses.json');
