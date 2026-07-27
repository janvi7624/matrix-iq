import { DemoScheduleRecord } from './types';
import { createRecordStore } from './recordStore';

export const demoScheduleStore = createRecordStore<DemoScheduleRecord>('data/demoSchedules.json');
