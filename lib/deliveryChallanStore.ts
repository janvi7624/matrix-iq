import { DeliveryChallanRecord } from './types';
import { createRecordStore } from './recordStore';
import { readJsonBlob, writeJsonBlob } from './blobStore';

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

// NT-DC-<seq> — same "read everything, find the max sequence, +1" approach
// as lib/quotationNumber.ts, scoped to this one JSON blob.
export async function nextDcNumber(): Promise<string> {
  const records = await readAll();
  const pattern = /^NT-DC-(\d+)$/;
  const max = records.reduce((acc, r) => {
    const match = r.dc_number.match(pattern);
    return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
  }, 0);
  return `NT-DC-${String(max + 1).padStart(4, '0')}`;
}

async function writeAll(records: DeliveryChallanRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
}

export { writeAll as writeDeliveryChallans, readAll as readDeliveryChallans };
