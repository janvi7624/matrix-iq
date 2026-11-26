import { describe, it, expect } from 'vitest';
import { columnLabels, headerLabel, rowCellLabels, CellLike } from '../../lib/tableLabels';

const cell = (text: string, colSpan = 1, attrs: Record<string, string> = {}): CellLike => ({
  colSpan,
  textContent: text,
  getAttribute: (n: string) => attrs[n] ?? null
});

describe('headerLabel', () => {
  it('collapses whitespace and drops sort arrows', () => {
    expect(headerLabel(cell('  Due\n   Date  ▲ '))).toBe('Due Date');
  });
  it('prefers aria-label / title over visible text', () => {
    expect(headerLabel(cell('☑', 1, { 'aria-label': 'Select row' }))).toBe('Select row');
    expect(headerLabel(cell('#', 1, { title: 'Row number' }))).toBe('Row number');
  });
  it('an empty actions header gives an empty label', () => {
    expect(headerLabel(cell(''))).toBe('');
  });
});

describe('columnLabels', () => {
  it('repeats a spanning header for every column it covers', () => {
    expect(columnLabels([cell('Name'), cell('Amount', 2), cell('')])).toEqual(['Name', 'Amount', 'Amount', '']);
  });
});

describe('rowCellLabels', () => {
  const labels = ['Name', 'Status', 'Amount', 'Actions'];
  it('labels each cell by its column', () => {
    expect(rowCellLabels([cell('A'), cell('B'), cell('C'), cell('D')], labels)).toEqual(labels);
  });
  it('a full-width cell (empty state / expanded detail row) is unlabelled', () => {
    expect(rowCellLabels([cell('No records', 4)], labels)).toEqual(['']);
  });
  it('keeps column positions after a spanning cell', () => {
    expect(rowCellLabels([cell('x', 2), cell('y'), cell('z')], labels)).toEqual(['', 'Amount', 'Actions']);
  });
  it('extra cells beyond the headers get no label', () => {
    expect(rowCellLabels([cell('a'), cell('b'), cell('c'), cell('d'), cell('e')], labels)[4]).toBe('');
  });
});
