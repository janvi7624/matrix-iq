import { InstallationRecord } from './types';
import { createRecordStore } from './recordStore';
import { db } from './db';

export const installationStore = createRecordStore<InstallationRecord>(db.Installation, [
  { name: 'project_id', kind: 'nullable' },
  { name: 'installation_date', kind: 'nullable' },
  { name: 'assigned_engineer' },
  { name: 'status' },
  { name: 'completion_report' },
  { name: 'client_signature' }
]);
