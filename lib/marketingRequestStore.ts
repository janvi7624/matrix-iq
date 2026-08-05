import { MarketingRequestRecord } from './types';
import { createRecordStore } from './recordStore';

export const marketingRequestStore = createRecordStore<MarketingRequestRecord>('data/marketingRequests.json');
