import { SiteVisitRecord } from './types';
import { createRecordStore } from './recordStore';

export const siteVisitStore = createRecordStore<SiteVisitRecord>('data/siteVisits.json');
