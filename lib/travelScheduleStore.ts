import { TravelScheduleRecord } from './types';
import { createRecordStore } from './recordStore';

export const travelScheduleStore = createRecordStore<TravelScheduleRecord>('data/travelSchedules.json');
