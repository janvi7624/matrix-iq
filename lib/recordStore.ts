import { readJsonBlob, writeJsonBlob } from './blobStore';

// Shared CRUD helper for the simple "one JSON array, list/create/update/delete"
// modules (site visits, CRM, demo schedule, travel schedule) — same shape as
// quotationStore.ts/userStore.ts, factored out since four modules need
// near-identical logic. Sorted newest-first, same as quotation history.
export function createRecordStore<T extends { id: string; created_at: string; created_by: string }>(pathname: string) {
  async function readAll(): Promise<T[]> {
    return readJsonBlob<T[]>(pathname, []);
  }

  async function writeAll(records: T[]): Promise<void> {
    await writeJsonBlob(pathname, records);
  }

  // `viewerUsername`/`viewerIsPrivileged` implement the access rule used by
  // every module here: admins/superadmins see everything, plain "user"
  // accounts only see records they created themselves.
  async function list(viewerUsername: string, viewerIsPrivileged: boolean): Promise<T[]> {
    const records = await readAll();
    const scoped = viewerIsPrivileged ? records : records.filter((r) => r.created_by === viewerUsername);
    return [...scoped].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  async function create(record: T): Promise<T> {
    const records = await readAll();
    records.push(record);
    await writeAll(records);
    return record;
  }

  async function update(id: string, patch: Partial<T>): Promise<T | null> {
    const records = await readAll();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return null;
    const updated = { ...records[index], ...patch };
    records[index] = updated;
    await writeAll(records);
    return updated;
  }

  async function remove(id: string, viewerUsername: string, viewerIsPrivileged: boolean): Promise<boolean> {
    const records = await readAll();
    const existing = records.find((r) => r.id === id);
    if (!existing) return false;
    if (!viewerIsPrivileged && existing.created_by !== viewerUsername) return false;
    const next = records.filter((r) => r.id !== id);
    await writeAll(next);
    return true;
  }

  return { list, create, update, remove };
}
