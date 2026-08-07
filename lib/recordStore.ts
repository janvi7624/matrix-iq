import type { Model, ModelStatic } from 'sequelize';
import { db, isUuid } from './db';

// Shared CRUD helper for the simple "one table, list/create/update/delete,
// scoped by created_by" modules (customer responses, negotiations, purchase
// orders, installations, travel schedules, leads). Sorted newest-first, same
// as quotation history.
//
// `created_by` stays a **username string** on the TS record (unchanged API
// contract) — internally it's a UUID FK to `users`, resolved via the
// `creator` association on read and a username lookup on write.
//
// Field `kind` matters because Postgres rejects `''` for UUID/ENUM/DATE
// columns, while several TS record types use `''` as their "unset" value:
//   - 'string' (default): TEXT/STRING/always-set ENUM — passthrough, '' stays ''.
//   - 'nullable': optional UUID FK / blank-able ENUM / DATEONLY — '' <-> null.
//   - 'date': DATE (timestamp) column — ISO string on read, '' <-> null on write.
//   - 'number': DECIMAL column (pg returns these as strings) — Number() on read.
//   - 'json': JSONB array/object column — passthrough (DB always has a default).
export type FieldKind = 'string' | 'nullable' | 'date' | 'number' | 'json';
export interface FieldSpec {
  name: string;
  kind?: FieldKind;
  // The actual Sequelize attribute name, if it differs from `name` — needed
  // for auto-managed timestamp attributes (createdAt/updatedAt), which stay
  // camelCase on the model instance even on an `underscored: true` table
  // (underscored only renames the SQL column, not the JS attribute key).
  column?: string;
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: FieldKind): unknown {
  if (kind === 'nullable' || kind === 'date') return value === '' || value === undefined ? null : value;
  return value;
}

function toField(raw: unknown, kind: FieldKind): unknown {
  switch (kind) {
    case 'date':
      return isoOrEmpty(raw);
    case 'nullable':
      return raw ?? '';
    case 'number':
      return raw === null || raw === undefined ? 0 : Number(raw);
    case 'json':
      return raw ?? null;
    default:
      return raw ?? '';
  }
}

const creatorInclude = () => ({ model: db.User, as: 'creator', attributes: ['id', 'username'] });

export function createRecordStore<T extends { id: string; created_at: string; created_by: string }>(
  model: ModelStatic<Model>,
  fields: FieldSpec[]
) {
  function toRecord(row: Model): T {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const record: Record<string, unknown> = {
      id: plain.id,
      created_at: isoOrEmpty(plain.createdAt),
      created_by: (plain.creator as { username?: string } | null)?.username ?? ''
    };
    for (const { name, kind = 'string', column = name } of fields) {
      record[name] = toField(plain[column], kind);
    }
    return record as T;
  }

  async function readAll(): Promise<T[]> {
    const rows = await model.findAll({ include: [creatorInclude()], order: [['created_at', 'DESC']] });
    return rows.map(toRecord);
  }

  async function list(viewerUsername: string, viewerIsPrivileged: boolean): Promise<T[]> {
    const where: Record<string, unknown> = {};
    if (!viewerIsPrivileged) {
      const user = await db.User.findOne({ where: { username: viewerUsername } as never });
      where.created_by = user ? user.get('id') : '00000000-0000-0000-0000-000000000000';
    }
    const rows = await model.findAll({ where: where as never, include: [creatorInclude()], order: [['created_at', 'DESC']] });
    return rows.map(toRecord);
  }

  async function create(record: T): Promise<T> {
    const attrs: Record<string, unknown> = {};
    for (const { name, kind = 'string', column = name } of fields) {
      attrs[column] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
    }
    const creator = await db.User.findOne({ where: { username: record.created_by } as never });
    const row = await model.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never);
    const withCreator = await model.findByPk(row.get('id') as string, { include: [creatorInclude()] });
    return toRecord(withCreator as Model);
  }

  async function update(id: string, patch: Partial<T>): Promise<T | null> {
    if (!isUuid(id)) return null;
    const row = await model.findByPk(id);
    if (!row) return null;
    const attrs: Record<string, unknown> = {};
    const patchObj = patch as unknown as Record<string, unknown>;
    for (const { name, kind = 'string', column = name } of fields) {
      if (name in patchObj) attrs[column] = toAttr(patchObj[name], kind);
    }
    await row.update(attrs as never);
    const withCreator = await model.findByPk(id, { include: [creatorInclude()] });
    return toRecord(withCreator as Model);
  }

  // Deletion is admin/superadmin-only across every module here — plain
  // "user" accounts can create/edit their own records but not remove them.
  async function remove(id: string, viewerUsername: string, viewerIsPrivileged: boolean): Promise<boolean> {
    if (!viewerIsPrivileged) return false;
    if (!isUuid(id)) return false;
    const row = await model.findByPk(id);
    if (!row) return false;
    await row.destroy();
    return true;
  }

  return { list, create, update, remove, readAll, toRecord };
}
