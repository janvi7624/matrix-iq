import { InstallationRecord } from './types';
import { createRecordStore } from './recordStore';

export const installationStore = createRecordStore<InstallationRecord>('data/installations.json');
