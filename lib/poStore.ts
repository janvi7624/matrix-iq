import { PoRecord } from './types';
import { createRecordStore } from './recordStore';

export const poStore = createRecordStore<PoRecord>('data/purchaseOrders.json');
