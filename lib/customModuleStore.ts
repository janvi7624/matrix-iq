import { readJsonBlob, writeJsonBlob } from './blobStore';
import { CustomFieldDef, CustomModuleDef } from './types';
import { upsertCustomModuleTile, removeCustomModuleTile, isModuleVisibleToRole } from './moduleConfigStore';
import { ViewerContext } from './viewerContext';

const DATA_PATHNAME = 'data/customModules.json';

async function readAll(): Promise<CustomModuleDef[]> {
  return readJsonBlob<CustomModuleDef[]>(DATA_PATHNAME, []);
}

async function writeAll(records: CustomModuleDef[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
}

export async function listCustomModules(): Promise<CustomModuleDef[]> {
  const records = await readAll();
  return [...records].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function findCustomModuleById(id: string): Promise<CustomModuleDef | undefined> {
  const records = await readAll();
  return records.find((m) => m.id === id);
}

export async function findCustomModuleByKey(key: string): Promise<CustomModuleDef | undefined> {
  const records = await readAll();
  return records.find((m) => m.key === key);
}

// Shared by every /api/custom-modules/[key]/* route — resolves the module
// AND enforces that it's enabled + visible to the caller's role, so a
// direct API call can't bypass what Module Manager says this role may see.
export async function getModuleForViewer(key: string, viewer: ViewerContext): Promise<CustomModuleDef | null> {
  const module_ = await findCustomModuleByKey(key);
  if (!module_ || !module_.enabled) return null;
  if (!viewer.isPrivileged && !(await isModuleVisibleToRole(`custom:${key}`, viewer.role))) return null;
  return module_;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `module-${Date.now()}`;
}

export interface CustomModuleInput {
  name: string;
  icon: string;
  section: string;
  fields: CustomFieldDef[];
  requiresApproval: boolean;
  approverRole: CustomModuleDef['approverRole'];
  enabled: boolean;
}

export async function createCustomModule(input: CustomModuleInput, createdBy: string): Promise<CustomModuleDef> {
  const records = await readAll();
  let key = slugify(input.name);
  let suffix = 1;
  while (records.some((m) => m.key === key)) {
    key = `${slugify(input.name)}-${++suffix}`;
  }

  const record: CustomModuleDef = {
    id: `${Date.now()}`,
    key,
    name: input.name,
    icon: input.icon || '🧩',
    section: input.section || 'Custom Modules',
    created_at: new Date().toISOString(),
    created_by: createdBy,
    fields: input.fields.map((f, i) => ({ ...f, order: i })),
    requiresApproval: input.requiresApproval,
    approverRole: input.approverRole,
    enabled: input.enabled
  };
  records.push(record);
  await writeAll(records);
  await upsertCustomModuleTile({ key: record.key, label: record.name, icon: record.icon, section: record.section, enabled: record.enabled });
  return record;
}

export async function updateCustomModule(id: string, patch: Partial<CustomModuleInput>): Promise<CustomModuleDef | null> {
  const records = await readAll();
  const index = records.findIndex((m) => m.id === id);
  if (index === -1) return null;

  const updated: CustomModuleDef = {
    ...records[index],
    name: patch.name ?? records[index].name,
    icon: patch.icon ?? records[index].icon,
    section: patch.section ?? records[index].section,
    fields: patch.fields ? patch.fields.map((f, i) => ({ ...f, order: i })) : records[index].fields,
    requiresApproval: patch.requiresApproval ?? records[index].requiresApproval,
    approverRole: patch.approverRole ?? records[index].approverRole,
    enabled: patch.enabled ?? records[index].enabled
  };
  records[index] = updated;
  await writeAll(records);
  await upsertCustomModuleTile({ key: updated.key, label: updated.name, icon: updated.icon, section: updated.section, enabled: updated.enabled });
  return updated;
}

export async function deleteCustomModule(id: string): Promise<boolean> {
  const records = await readAll();
  const existing = records.find((m) => m.id === id);
  if (!existing) return false;
  await writeAll(records.filter((m) => m.id !== id));
  await removeCustomModuleTile(existing.key);
  return true;
}
