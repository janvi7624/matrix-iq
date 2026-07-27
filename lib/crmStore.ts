import { CrmRecord } from './types';
import { createRecordStore } from './recordStore';

export const crmStore = createRecordStore<CrmRecord>('data/crm.json');
