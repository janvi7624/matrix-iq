import { TravelScheduleRecord } from './types';
import { createRecordStore } from './recordStore';
import { db } from './db';

export const travelScheduleStore = createRecordStore<TravelScheduleRecord>(db.TravelSchedule, [
  { name: 'origin' },
  { name: 'destination' },
  { name: 'start_date', kind: 'nullable' },
  { name: 'end_date', kind: 'nullable' },
  { name: 'purpose' },
  { name: 'linked_client' },
  { name: 'expense_note' }
]);
