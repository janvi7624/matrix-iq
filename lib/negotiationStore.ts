import { NegotiationRecord } from './types';
import { createRecordStore } from './recordStore';

export const negotiationStore = createRecordStore<NegotiationRecord>('data/negotiations.json');
