import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Op } from 'sequelize';
import type { Model, ModelStatic } from 'sequelize';

vi.mock('../../lib/db', () => ({
  db: { User: { findOne: vi.fn() } },
  isUuid: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}));
vi.mock('../../lib/departmentScope', () => ({ resolveVisibilityScope: vi.fn() }));

import { db } from '../../lib/db';
import { resolveVisibilityScope } from '../../lib/departmentScope';
import { createRecordStore, FieldSpec } from '../../lib/recordStore';
import { fakeModel, fakeRow, fakeUser } from '../helpers/fakeSequelize';

const userFindOneMock = vi.mocked(db.User.findOne);
const resolveVisibilityScopeMock = vi.mocked(resolveVisibilityScope);

const VALID_UUID = '11111111-1111-1111-1111-111111111111';
const SENTINEL = '00000000-0000-0000-0000-000000000000';

interface TestRecord {
  id: string;
  created_at: string;
  created_by: string;
  title: string;
  optional: string;
  scheduled_at: string;
  amount: number;
  tags: unknown;
  updated_at: string;
}

const FIELDS: FieldSpec[] = [
  { name: 'title' },
  { name: 'optional', kind: 'nullable' },
  { name: 'scheduled_at', kind: 'date' },
  { name: 'amount', kind: 'number' },
  { name: 'tags', kind: 'json' },
  { name: 'updated_at', kind: 'date', column: 'updatedAt' }
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe('toRecord', () => {
  function buildStore(model: ModelStatic<Model> = fakeModel()) {
    return createRecordStore<TestRecord>(model, FIELDS);
  }

  it('derives id, created_at, created_by from base plain fields', async () => {
    const model = fakeModel({ findAllResult: [fakeRow({ id: VALID_UUID, createdAt: new Date('2024-01-01T00:00:00.000Z'), creator: { username: 'alice' }, title: 'A' })] });
    const store = buildStore(model);
    const rows = await store.readAll();
    expect(rows[0].id).toBe(VALID_UUID);
    expect(rows[0].created_at).toBe(new Date('2024-01-01T00:00:00.000Z').toISOString());
    expect(rows[0].created_by).toBe('alice');
  });

  it('created_by is empty string when creator is null or missing username', async () => {
    const model = fakeModel({
      findAllResult: [
        fakeRow({ id: '1', createdAt: null, creator: null, title: 'A' }),
        fakeRow({ id: '2', createdAt: null, creator: {}, title: 'B' })
      ]
    });
    const store = buildStore(model);
    const rows = await store.readAll();
    expect(rows[0].created_by).toBe('');
    expect(rows[1].created_by).toBe('');
  });

  it('string kind: passthrough, null/undefined -> "", "" stays ""', async () => {
    const model = fakeModel({
      findAllResult: [
        fakeRow({ id: '1', title: 'hello' }),
        fakeRow({ id: '2', title: null }),
        fakeRow({ id: '3', title: undefined }),
        fakeRow({ id: '4', title: '' })
      ]
    });
    const store = buildStore(model);
    const rows = await store.readAll();
    expect(rows.map((r) => r.title)).toEqual(['hello', '', '', '']);
  });

  it('nullable kind: null -> "", value passthrough, "" stays ""', async () => {
    const model = fakeModel({
      findAllResult: [fakeRow({ id: '1', optional: null }), fakeRow({ id: '2', optional: 'x' }), fakeRow({ id: '3', optional: '' })]
    });
    const store = buildStore(model);
    const rows = await store.readAll();
    expect(rows.map((r) => r.optional)).toEqual(['', 'x', '']);
  });

  it('date kind: Date -> ISO string, null/"" -> "", ISO string passthrough', async () => {
    const d = new Date('2024-06-01T12:00:00.000Z');
    const iso = '2024-06-02T00:00:00.000Z';
    const model = fakeModel({
      findAllResult: [
        fakeRow({ id: '1', scheduled_at: d }),
        fakeRow({ id: '2', scheduled_at: null }),
        fakeRow({ id: '3', scheduled_at: '' }),
        fakeRow({ id: '4', scheduled_at: iso })
      ]
    });
    const store = buildStore(model);
    const rows = await store.readAll();
    expect(rows.map((r) => r.scheduled_at)).toEqual([d.toISOString(), '', '', iso]);
  });

  it('number kind: null/undefined -> 0, string decimal -> Number(), numeric passthrough', async () => {
    const model = fakeModel({
      findAllResult: [
        fakeRow({ id: '1', amount: null }),
        fakeRow({ id: '2', amount: undefined }),
        fakeRow({ id: '3', amount: '1234.50' }),
        fakeRow({ id: '4', amount: 42 })
      ]
    });
    const store = buildStore(model);
    const rows = await store.readAll();
    expect(rows.map((r) => r.amount)).toEqual([0, 0, 1234.5, 42]);
  });

  it('json kind: null preserved as null (not ""), objects/arrays pass through', async () => {
    const model = fakeModel({
      findAllResult: [fakeRow({ id: '1', tags: null }), fakeRow({ id: '2', tags: ['a', 'b'] }), fakeRow({ id: '3', tags: { a: 1 } })]
    });
    const store = buildStore(model);
    const rows = await store.readAll();
    expect(rows[0].tags).toBeNull();
    expect(rows[1].tags).toEqual(['a', 'b']);
    expect(rows[2].tags).toEqual({ a: 1 });
  });

  it('column aliasing reads from the aliased attribute and writes to the declared field name', async () => {
    const model = fakeModel({ findAllResult: [fakeRow({ id: '1', updatedAt: '2024-01-01T00:00:00.000Z' })] });
    const store = buildStore(model);
    const rows = await store.readAll();
    expect(rows[0].updated_at).toBe('2024-01-01T00:00:00.000Z');
  });

  it('a field entirely absent from the row falls back to its kind default', async () => {
    const model = fakeModel({ findAllResult: [fakeRow({ id: '1' })] });
    const store = buildStore(model);
    const rows = await store.readAll();
    expect(rows[0].title).toBe('');
    expect(rows[0].amount).toBe(0);
    expect(rows[0].tags).toBeNull();
  });
});

describe('create', () => {
  it('keys attrs by column, resolves creator by username, and re-reads with the creator include', async () => {
    const createdRow = fakeRow({ id: 'new-id' });
    const reReadRow = fakeRow({ id: 'new-id', createdAt: '2024-01-01T00:00:00.000Z', creator: { username: 'alice' }, title: 'Hello' });
    const model = fakeModel({ createResult: createdRow, findByPkResult: reReadRow });
    userFindOneMock.mockResolvedValue(fakeUser('user-1', 'alice') as never);

    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.create({ id: '', created_at: '', created_by: 'alice', title: 'Hello', optional: '', scheduled_at: '', amount: 5, tags: null, updated_at: '' });

    expect(result.id).toBe('new-id');
    expect(result.created_by).toBe('alice');
    const createCallArgs = vi.mocked(model.create).mock.calls[0][0] as Record<string, unknown>;
    expect(createCallArgs.title).toBe('Hello');
    expect(createCallArgs.created_by).toBe('user-1');
  });

  it('toAttr coerces "" to null for nullable/date fields but preserves "" for string fields', async () => {
    const model = fakeModel({ createResult: fakeRow({ id: 'x' }), findByPkResult: fakeRow({ id: 'x' }) });
    userFindOneMock.mockResolvedValue(null);

    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.create({ id: '', created_at: '', created_by: 'unknown', title: '', optional: '', scheduled_at: '', amount: 0, tags: null, updated_at: '' });

    const attrs = vi.mocked(model.create).mock.calls[0][0] as Record<string, unknown>;
    expect(attrs.title).toBe('');
    expect(attrs.optional).toBeNull();
    expect(attrs.scheduled_at).toBeNull();
  });

  it('unknown creator username -> created_by: null, does not throw', async () => {
    const model = fakeModel({ createResult: fakeRow({ id: 'x' }), findByPkResult: fakeRow({ id: 'x' }) });
    userFindOneMock.mockResolvedValue(null);

    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.create({ id: '', created_at: '', created_by: 'ghost', title: 'A', optional: '', scheduled_at: '', amount: 0, tags: null, updated_at: '' });

    const attrs = vi.mocked(model.create).mock.calls[0][0] as Record<string, unknown>;
    expect(attrs.created_by).toBeNull();
  });

  it('the returned record reflects the re-read row (including its creator join), not the input string', async () => {
    const reReadRow = fakeRow({ id: 'x', creator: { username: 'someone-else' } });
    const model = fakeModel({ createResult: fakeRow({ id: 'x' }), findByPkResult: reReadRow });
    userFindOneMock.mockResolvedValue(fakeUser('u1', 'alice') as never);

    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.create({ id: '', created_at: '', created_by: 'alice', title: 'A', optional: '', scheduled_at: '', amount: 0, tags: null, updated_at: '' });
    expect(result.created_by).toBe('someone-else');
  });

  it('does not write fields absent from the FieldSpec list', async () => {
    const model = fakeModel({ createResult: fakeRow({ id: 'x' }), findByPkResult: fakeRow({ id: 'x' }) });
    userFindOneMock.mockResolvedValue(null);
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.create({ id: '', created_at: '', created_by: '', title: 'A', optional: '', scheduled_at: '', amount: 0, tags: null, updated_at: '' } as TestRecord);
    const attrs = vi.mocked(model.create).mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(attrs).sort()).toEqual(['amount', 'created_by', 'optional', 'scheduled_at', 'tags', 'title', 'updatedAt'].sort());
  });
});

describe('update', () => {
  it('non-UUID id -> null, and findByPk is never called', async () => {
    const model = fakeModel();
    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.update('not-a-uuid', { title: 'x' });
    expect(result).toBeNull();
    expect(model.findByPk).not.toHaveBeenCalled();
  });

  it('missing row -> null, row.update is never called', async () => {
    const model = fakeModel({ findByPkResult: null });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.update(VALID_UUID, { title: 'x' });
    expect(result).toBeNull();
  });

  it('only patch-present keys are written', async () => {
    const row = fakeRow({ id: VALID_UUID });
    const model = fakeModel({ findByPkResult: row });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.update(VALID_UUID, { title: 'New title' });
    const attrs = vi.mocked(row.update).mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(attrs)).toEqual(['title']);
  });

  it('an explicit undefined value for a nullable field IS written, as null', async () => {
    const row = fakeRow({ id: VALID_UUID });
    const model = fakeModel({ findByPkResult: row });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.update(VALID_UUID, { optional: undefined });
    const attrs = vi.mocked(row.update).mock.calls[0][0] as Record<string, unknown>;
    expect('optional' in attrs).toBe(true);
    expect(attrs.optional).toBeNull();
  });

  it('"" coerces to null for nullable/date fields but stays "" for string fields', async () => {
    const row = fakeRow({ id: VALID_UUID });
    const model = fakeModel({ findByPkResult: row });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.update(VALID_UUID, { title: '', optional: '', scheduled_at: '' });
    const attrs = vi.mocked(row.update).mock.calls[0][0] as Record<string, unknown>;
    expect(attrs.title).toBe('');
    expect(attrs.optional).toBeNull();
    expect(attrs.scheduled_at).toBeNull();
  });

  it('patch keys are translated through the column alias', async () => {
    const row = fakeRow({ id: VALID_UUID });
    const model = fakeModel({ findByPkResult: row });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.update(VALID_UUID, { updated_at: '2024-01-01T00:00:00.000Z' });
    const attrs = vi.mocked(row.update).mock.calls[0][0] as Record<string, unknown>;
    expect(attrs.updatedAt).toBe('2024-01-01T00:00:00.000Z');
    expect('updated_at' in attrs).toBe(false);
  });

  it('returns the re-read record with the creator include applied', async () => {
    const row = fakeRow({ id: VALID_UUID });
    const reReadRow = fakeRow({ id: VALID_UUID, creator: { username: 'bob' }, title: 'Updated' });
    const model = fakeModel({ findByPkResult: (id) => (id === VALID_UUID ? row : reReadRow) });
    // First call returns `row` for the update, second call (re-read) should return reReadRow.
    // fakeModel's findByPkResult-as-function receives id only, so simulate sequence explicitly:
    let call = 0;
    (model.findByPk as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      call += 1;
      return call === 1 ? row : reReadRow;
    });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.update(VALID_UUID, { title: 'Updated' });
    expect(result?.title).toBe('Updated');
    expect(result?.created_by).toBe('bob');
  });
});

describe('remove', () => {
  it('not privileged -> false, findByPk never called', async () => {
    const model = fakeModel();
    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.remove(VALID_UUID, 'alice', false);
    expect(result).toBe(false);
    expect(model.findByPk).not.toHaveBeenCalled();
  });

  it('privileged + non-UUID id -> false', async () => {
    const model = fakeModel();
    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.remove('not-a-uuid', 'alice', true);
    expect(result).toBe(false);
  });

  it('privileged + missing row -> false, destroy never called', async () => {
    const model = fakeModel({ findByPkResult: null });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.remove(VALID_UUID, 'alice', true);
    expect(result).toBe(false);
  });

  it('privileged + row exists -> destroy is called once, returns true', async () => {
    const row = fakeRow({ id: VALID_UUID });
    const model = fakeModel({ findByPkResult: row });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.remove(VALID_UUID, 'alice', true);
    expect(result).toBe(true);
    expect(row.destroy).toHaveBeenCalledTimes(1);
  });

  it('viewerUsername has zero effect on the outcome (flagged finding)', async () => {
    const row = fakeRow({ id: VALID_UUID });
    const model = fakeModel({ findByPkResult: row });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    const result = await store.remove(VALID_UUID, 'anyone-at-all', true);
    expect(result).toBe(true);
  });
});

describe('list', () => {
  it('departmentScoped + org-wide scope (scopedUserIds null) -> no created_by filter', async () => {
    resolveVisibilityScopeMock.mockResolvedValue({ seesOrgWide: true, scopedUserIds: null });
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS, { departmentScoped: true });
    await store.list('alice', false);
    const call = vi.mocked(model.findAll).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({});
  });

  it('departmentScoped + explicit scopedUserIds -> where.created_by uses Op.in', async () => {
    resolveVisibilityScopeMock.mockResolvedValue({ seesOrgWide: false, scopedUserIds: ['a', 'b'] });
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS, { departmentScoped: true });
    await store.list('alice', false);
    const call = vi.mocked(model.findAll).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({ created_by: { [Op.in]: ['a', 'b'] } });
  });

  it('not departmentScoped + privileged -> no filter, db.User.findOne not called', async () => {
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.list('alice', true);
    const call = vi.mocked(model.findAll).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({});
    expect(userFindOneMock).not.toHaveBeenCalled();
  });

  it('not departmentScoped + not privileged -> filtered to the viewer\'s own id', async () => {
    userFindOneMock.mockResolvedValue(fakeUser('user-1', 'alice') as never);
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.list('alice', false);
    const call = vi.mocked(model.findAll).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({ created_by: 'user-1' });
  });

  it('not departmentScoped + not privileged + unknown username -> sentinel id', async () => {
    userFindOneMock.mockResolvedValue(null);
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.list('ghost', false);
    const call = vi.mocked(model.findAll).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({ created_by: SENTINEL });
  });

  it('every call includes the creator join and orders by created_at DESC', async () => {
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.list('alice', true);
    const call = vi.mocked(model.findAll).mock.calls[0][0] as { include: unknown[]; order: unknown[] };
    expect(call.include).toEqual([{ model: db.User, as: 'creator', attributes: ['id', 'username'] }]);
    expect(call.order).toEqual([['created_at', 'DESC']]);
  });
});

describe('listOwnedBy', () => {
  it('filters strictly to the given username\'s own records', async () => {
    userFindOneMock.mockResolvedValue(fakeUser('user-1', 'alice') as never);
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS, { departmentScoped: true });
    await store.listOwnedBy('alice');
    const call = vi.mocked(model.findAll).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({ created_by: 'user-1' });
    expect(resolveVisibilityScopeMock).not.toHaveBeenCalled();
  });

  it('unknown username -> sentinel id', async () => {
    userFindOneMock.mockResolvedValue(null);
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.listOwnedBy('ghost');
    const call = vi.mocked(model.findAll).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({ created_by: SENTINEL });
  });

  it('uses attributes:["id"] on the user lookup', async () => {
    userFindOneMock.mockResolvedValue(fakeUser('user-1', 'alice') as never);
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.listOwnedBy('alice');
    const userCall = userFindOneMock.mock.calls[0][0] as { attributes: string[] };
    expect(userCall.attributes).toEqual(['id']);
  });
});

describe('readAll', () => {
  it('applies no where filter, includes creator, orders by created_at DESC', async () => {
    const model = fakeModel({ findAllResult: [] });
    const store = createRecordStore<TestRecord>(model, FIELDS);
    await store.readAll();
    const call = vi.mocked(model.findAll).mock.calls[0][0] as { where?: unknown; include: unknown[]; order: unknown[] };
    expect(call.where).toBeUndefined();
    expect(call.include).toEqual([{ model: db.User, as: 'creator', attributes: ['id', 'username'] }]);
    expect(call.order).toEqual([['created_at', 'DESC']]);
  });
});
