import { DeliveryChallanRecord } from './types';
import { createRecordStore } from './recordStore';
import { readJsonBlob, writeJsonBlob } from './blobStore';
import { getAppConfig } from './appConfigStore';

const DATA_PATHNAME = 'data/deliveryChallans.json';
const base = createRecordStore<DeliveryChallanRecord>(DATA_PATHNAME);

export const deliveryChallanStore = {
  list: base.list,
  create: base.create,
  update: base.update,
  remove: base.remove
};

async function readAll(): Promise<DeliveryChallanRecord[]> {
  return readJsonBlob<DeliveryChallanRecord[]>(DATA_PATHNAME, []);
}

export async function findDeliveryChallanById(id: string): Promise<DeliveryChallanRecord | undefined> {
  const records = await readAll();
  return records.find((r) => r.id === id);
}

// <prefix><seq> — same "read everything, find the max sequence, +1" approach
// as lib/quotationNumber.ts, scoped to this one JSON blob. Prefix is
// admin-configurable (Application Configuration > Number Series); changing
// it only affects new DCs — existing dc_numbers keep whatever prefix they
// were created with.
export async function nextDcNumber(): Promise<string> {
  const [records, config] = await Promise.all([readAll(), getAppConfig()]);
  const prefix = config.dcNumberPrefix || 'NT-DC-';
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedPrefix}(\\d+)$`);
  const max = records.reduce((acc, r) => {
    const match = r.dc_number.match(pattern);
    return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

async function writeAll(records: DeliveryChallanRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
}

export { writeAll as writeDeliveryChallans, readAll as readDeliveryChallans };
