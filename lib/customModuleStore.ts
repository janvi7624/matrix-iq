import { Model } from 'sequelize';
import { CustomFieldDef, CustomModuleDef } from './types';
import { db, isUuid, sequelize } from './db';
import { upsertCustomModuleTile, removeCustomModuleTile, isModuleVisibleToRole } from './moduleConfigStore';
import { ViewerContext } from './viewerContext';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const fieldsInclude = { model: db.CustomModuleField, as: 'fields', separate: true, order: [['order', 'ASC']] };

function toRecord(row: Model): CustomModuleDef {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const fields = ((plain.fields as Record<string, unknown>[]) ?? []).map(
    (f): CustomFieldDef => ({
      id: f.id as string,
      label: (f.label as string) ?? '',
      type: f.type as CustomFieldDef['type'],
      required: f.required as boolean,
      options: (f.options as string[]) ?? [],
      order: f.order as number
    })
  );
  return {
    id: plain.id as string,
    key: plain.key as string,
    name: (plain.name as string) ?? '',
    icon: (plain.icon as string) ?? '',
    section: (plain.section as string) ?? '',
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    fields,
    requiresApproval: plain.requiresApproval as boolean,
    approverRole: (plain.approverRole as string) ?? '',
    enabled: plain.enabled as boolean
  };
}

export async function listCustomModules(): Promise<CustomModuleDef[]> {
  const rows = await db.CustomModule.findAll({ include: [creatorInclude, fieldsInclude] as never, order: [['createdAt', 'DESC']] });
  return rows.map(toRecord);
}

export async function findCustomModuleById(id: string): Promise<CustomModuleDef | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.CustomModule.findByPk(id, { include: [creatorInclude, fieldsInclude] as never });
  return row ? toRecord(row) : undefined;
}

export async function findCustomModuleByKey(key: string): Promise<CustomModuleDef | undefined> {
  const row = await db.CustomModule.findOne({ where: { key } as never, include: [creatorInclude, fieldsInclude] as never });
  return row ? toRecord(row) : undefined;
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
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `module-${Date.now()}`
  );
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
  const existingKeys = new Set((await db.CustomModule.findAll({ attributes: ['key'] })).map((m) => m.get('key') as string));
  let key = slugify(input.name);
  let suffix = 1;
  while (existingKeys.has(key)) {
    key = `${slugify(input.name)}-${++suffix}`;
  }
  const creator = await db.User.findOne({ where: { username: createdBy } as never });

  const id = await sequelize.transaction(async (t) => {
    const row = await db.CustomModule.create(
      { key, name: input.name, icon: input.icon || '🧩', section: input.section || 'Custom Modules', createdBy: creator ? creator.get('id') : null, requiresApproval: input.requiresApproval, approverRole: input.approverRole, enabled: input.enabled } as never,
      { transaction: t }
    );
    if (input.fields.length) {
      await db.CustomModuleField.bulkCreate(
        input.fields.map((f, i) => ({ customModuleId: row.get('id'), label: f.label, type: f.type, required: f.required, options: f.options, order: i })) as never,
        { transaction: t }
      );
    }
    return row.get('id') as string;
  });

  const created = (await findCustomModuleById(id)) as CustomModuleDef;
  await upsertCustomModuleTile({ key: created.key, label: created.name, icon: created.icon, section: created.section, enabled: created.enabled });
  return created;
}

export async function updateCustomModule(id: string, patch: Partial<CustomModuleInput>): Promise<CustomModuleDef | null> {
  if (!isUuid(id)) return null;
  const row = await db.CustomModule.findByPk(id);
  if (!row) return null;

  await sequelize.transaction(async (t) => {
    const attrs: Record<string, unknown> = {};
    if (patch.name !== undefined) attrs.name = patch.name;
    if (patch.icon !== undefined) attrs.icon = patch.icon;
    if (patch.section !== undefined) attrs.section = patch.section;
    if (patch.requiresApproval !== undefined) attrs.requiresApproval = patch.requiresApproval;
    if (patch.approverRole !== undefined) attrs.approverRole = patch.approverRole;
    if (patch.enabled !== undefined) attrs.enabled = patch.enabled;
    if (Object.keys(attrs).length) await row.update(attrs as never, { transaction: t });

    if (patch.fields) {
      // Diff-sync rather than delete-and-recreate: existing field ids are
      // real UUIDs already referenced by custom_module_records.values keys,
      // so a retained field must keep its id, not get a fresh one.
      const existingRows = await db.CustomModuleField.findAll({ where: { customModuleId: id } as never, transaction: t });
      const existingIds = new Set(existingRows.map((f) => f.get('id') as string));
      const incomingIds = new Set(patch.fields.filter((f) => existingIds.has(f.id)).map((f) => f.id));

      const toDelete = existingRows.filter((f) => !incomingIds.has(f.get('id') as string));
      if (toDelete.length) {
        await db.CustomModuleField.destroy({ where: { id: toDelete.map((f) => f.get('id')) } as never, transaction: t });
      }

      for (let i = 0; i < patch.fields.length; i++) {
        const f = patch.fields[i];
        const attrs = { label: f.label, type: f.type, required: f.required, options: f.options, order: i };
        if (existingIds.has(f.id)) {
          await db.CustomModuleField.update(attrs as never, { where: { id: f.id } as never, transaction: t });
        } else {
          await db.CustomModuleField.create({ customModuleId: id, ...attrs } as never, { transaction: t });
        }
      }
    }
  });

  const updated = (await findCustomModuleById(id)) as CustomModuleDef;
  await upsertCustomModuleTile({ key: updated.key, label: updated.name, icon: updated.icon, section: updated.section, enabled: updated.enabled });
  return updated;
}

export async function deleteCustomModule(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.CustomModule.findByPk(id);
  if (!row) return false;
  const key = row.get('key') as string;
  await row.destroy();
  await removeCustomModuleTile(key);
  return true;
}
