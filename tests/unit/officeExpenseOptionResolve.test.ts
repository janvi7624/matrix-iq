import { describe, it, expect } from 'vitest';
import {
  BASE_EXPENSE_OPTIONS,
  ExpenseOptionError,
  cleanOptionList,
  overridesFromEdit,
  resolveExpenseOptions
} from '../../lib/officeExpenseOptionResolve';

// The distinction this module turns on is null vs [] — "never customised"
// against "deliberately emptied". Collapse them and either a list can never
// be emptied, or emptying one silently restores options nobody asked for.

describe('resolveExpenseOptions', () => {
  it('falls back to the hardcoded vocabulary when nothing is customised', () => {
    const r = resolveExpenseOptions(null);
    expect(r.usecases).toEqual([...BASE_EXPENSE_OPTIONS.usecases]);
    expect(r.items).toEqual([...BASE_EXPENSE_OPTIONS.items]);
    expect(r.itemSubOptions.Pantry).toContain('Milk');
  });

  it('treats a missing list as not-customised, not as emptied', () => {
    const r = resolveExpenseOptions({ items: ['Pantry'] });
    expect(r.items).toEqual(['Pantry']);
    // usecases untouched, so still the base.
    expect(r.usecases).toEqual([...BASE_EXPENSE_OPTIONS.usecases]);
  });

  it('honours a deliberately emptied list', () => {
    expect(resolveExpenseOptions({ usecaseSubOptions: {} }).usecaseSubOptions).toEqual({});
  });

  it('drops a sub-list whose parent no longer exists', () => {
    // Otherwise it is unreachable data that would resurrect if the parent
    // were ever re-added under the same name.
    const r = resolveExpenseOptions({ items: ['Pantry'], itemSubOptions: { Pantry: ['Milk'], Tempo: ['CNG'] } });
    expect(Object.keys(r.itemSubOptions)).toEqual(['Pantry']);
  });

  it('matches a sub-list to its parent regardless of spacing or case', () => {
    const r = resolveExpenseOptions({ items: ['Pantry'], itemSubOptions: { '  pantry ': ['Milk'] } });
    expect(r.itemSubOptions.Pantry).toEqual(['Milk']);
  });

  it('prunes the base sub-lists when a category is removed', () => {
    const r = resolveExpenseOptions({ items: ['Pantry'] });
    expect(r.itemSubOptions.Tempo).toBeUndefined();
    expect(r.itemSubOptions.Pantry).toContain('Tea');
  });
});

describe('cleanOptionList', () => {
  it('trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(cleanOptionList([' Pantry ', '', 'pantry', '   ', 'Tempo'])).toEqual(['Pantry', 'Tempo']);
  });

  it('survives a non-array', () => {
    expect(cleanOptionList(null)).toEqual([]);
    expect(cleanOptionList('Pantry')).toEqual([]);
  });
});

describe('overridesFromEdit', () => {
  it('stores NULL for a list left at the built-in values', () => {
    // So a person who only edited Items keeps following the code for
    // Categories as it changes.
    const out = overridesFromEdit({ ...BASE_EXPENSE_OPTIONS });
    expect(out.usecases).toBeNull();
    expect(out.items).toBeNull();
    expect(out.itemSubOptions).toBeNull();
  });

  it('stores only the list that actually changed', () => {
    const out = overridesFromEdit({ ...BASE_EXPENSE_OPTIONS, usecases: [...BASE_EXPENSE_OPTIONS.usecases, 'Workshop'] });
    expect(out.usecases).toContain('Workshop');
    expect(out.items).toBeNull();
  });

  it('refuses to leave a required dropdown with nothing in it', () => {
    expect(() => overridesFromEdit({ ...BASE_EXPENSE_OPTIONS, usecases: [] })).toThrow(ExpenseOptionError);
    expect(() => overridesFromEdit({ ...BASE_EXPENSE_OPTIONS, items: ['  '] })).toThrow(/at least one option/);
  });

  it('round-trips an edit back through resolve unchanged', () => {
    const edited = {
      ...BASE_EXPENSE_OPTIONS,
      usecases: [...BASE_EXPENSE_OPTIONS.usecases, 'Workshop'],
      usecaseSubOptions: { Workshop: ['Tools', 'Consumables'] },
      itemSubOptions: { ...BASE_EXPENSE_OPTIONS.itemSubOptions, Pantry: ['Milk', 'Tea'] }
    };
    const resolved = resolveExpenseOptions(overridesFromEdit(edited));
    expect(resolved.usecases).toContain('Workshop');
    expect(resolved.usecaseSubOptions.Workshop).toEqual(['Tools', 'Consumables']);
    expect(resolved.itemSubOptions.Pantry).toEqual(['Milk', 'Tea']);
  });

  it('never stores a sub-list for a parent the edit removed', () => {
    const out = overridesFromEdit({
      ...BASE_EXPENSE_OPTIONS,
      items: ['Pantry'],
      itemSubOptions: { Pantry: ['Milk'], Tempo: ['CNG'] }
    });
    expect(Object.keys(out.itemSubOptions!)).toEqual(['Pantry']);
  });
});
