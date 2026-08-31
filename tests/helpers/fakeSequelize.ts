import { vi } from 'vitest';
import type { Model, ModelStatic } from 'sequelize';

// Minimal stand-ins for the two Sequelize shapes lib/recordStore.ts touches:
// a row instance (get/update/destroy) and a model static (findAll/findByPk/create).

export interface FakeRow {
  get: (arg?: unknown) => unknown;
  update: (attrs: unknown) => Promise<void>;
  destroy: () => Promise<void>;
}

export function fakeRow(plain: Record<string, unknown>): FakeRow {
  const get = vi.fn((arg?: unknown) => {
    if (arg === undefined) return plain;
    if (typeof arg === 'object') return plain; // { plain: true }
    return plain[arg as string];
  });
  const update = vi.fn(async (attrs: Record<string, unknown>) => {
    Object.assign(plain, attrs);
  });
  const destroy = vi.fn(async () => {});
  return { get, update, destroy };
}

export function fakeUser(id: string, username: string): FakeRow {
  return fakeRow({ id, username });
}

interface FakeModelOptions {
  findAllResult?: FakeRow[];
  findByPkResult?: FakeRow | null | ((id: string) => FakeRow | null);
  createResult?: FakeRow;
  findOneResult?: FakeRow | null;
}

export function fakeModel(opts: FakeModelOptions = {}) {
  const findAll = vi.fn(async () => opts.findAllResult ?? []);
  const findByPk = vi.fn(async (id: string) => {
    if (typeof opts.findByPkResult === 'function') return opts.findByPkResult(id);
    return opts.findByPkResult ?? null;
  });
  const create = vi.fn(async () => opts.createResult ?? fakeRow({ id: 'new-id' }));
  const findOne = vi.fn(async () => opts.findOneResult ?? null);
  return { findAll, findByPk, create, findOne } as unknown as ModelStatic<Model> & {
    findAll: typeof findAll;
    findByPk: typeof findByPk;
    create: typeof create;
    findOne: typeof findOne;
  };
}
