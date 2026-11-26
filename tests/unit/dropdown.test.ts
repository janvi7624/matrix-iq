import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Dropdown, { filterOptions, inSelection, summarizeSelection } from '../../components/ui/Dropdown';
import SearchInput from '../../components/ui/SearchInput';

const opts = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress', group: 'Active' },
  { value: 'done', label: 'Completed', description: 'Finished work' },
  { value: 'cafe', label: 'Café' }
];

describe('summarizeSelection', () => {
  it('first label plus how many more', () => {
    expect(summarizeSelection(opts, [])).toEqual({ text: '', more: 0 });
    expect(summarizeSelection(opts, ['done'])).toEqual({ text: 'Completed', more: 0 });
    expect(summarizeSelection(opts, ['open', 'done', 'cafe'])).toEqual({ text: 'Open', more: 2 });
  });
});

describe('filterOptions', () => {
  it('matches label, description and group, ignoring case and accents', () => {
    expect(filterOptions(opts, 'prog').map((o) => o.value)).toEqual(['in_progress']);
    expect(filterOptions(opts, 'finished').map((o) => o.value)).toEqual(['done']);
    expect(filterOptions(opts, 'active').map((o) => o.value)).toEqual(['in_progress']);
    expect(filterOptions(opts, 'cafe').map((o) => o.value)).toEqual(['cafe']);
    expect(filterOptions(opts, '  ')).toHaveLength(4);
  });
});

describe('inSelection (filter semantics)', () => {
  it('empty selection = no filter', () => {
    expect(inSelection('x', [])).toBe(true);
    expect(inSelection(null, [])).toBe(true);
  });
  it('otherwise the value must be selected', () => {
    expect(inSelection('open', ['open', 'done'])).toBe(true);
    expect(inSelection('cafe', ['open', 'done'])).toBe(false);
    expect(inSelection(null, ['open'])).toBe(false);
  });
});

describe('Dropdown trigger', () => {
  it('shows the placeholder when nothing is selected', () => {
    const html = renderToStaticMarkup(h(Dropdown, { options: opts, value: '', onChange: () => {}, placeholder: 'All statuses' }));
    expect(html).toContain('All statuses');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).not.toContain('Clear selection');
  });
  it('multi: shows the first choice, a +N badge and a clear control', () => {
    const html = renderToStaticMarkup(h(Dropdown, { options: opts, multiple: true, value: ['open', 'done'], onChange: () => {}, label: 'Status' }));
    expect(html).toContain('>Open<');
    expect(html).toContain('+1');
    expect(html).toContain('Clear selection');
    expect(html).toContain('>Status<');
  });
});

describe('SearchInput', () => {
  it('is a labelled search box with a clear button only when it has text', () => {
    const empty = renderToStaticMarkup(h(SearchInput, { value: '', onChange: () => {}, placeholder: 'Search leads…', shortcut: '/' }));
    expect(empty).toContain('type="search"');
    expect(empty).toContain('aria-label="Search leads"');
    expect(empty).toContain('<kbd');
    expect(empty).not.toContain('Clear search');
    const filled = renderToStaticMarkup(h(SearchInput, { value: 'acme', onChange: () => {} }));
    expect(filled).toContain('Clear search');
  });
});

describe('multiselect prop', () => {
  it('multiselect={true} and multiple={true} both give a multi-select trigger', () => {
    const a = renderToStaticMarkup(h(Dropdown, { options: opts, multiselect: true, value: ['open', 'done'], onChange: () => {} }));
    const b = renderToStaticMarkup(h(Dropdown, { options: opts, multiple: true, value: ['open', 'done'], onChange: () => {} }));
    expect(a).toContain('+1');
    expect(b).toContain('+1');
  });
  it('single-select is the default', () => {
    const html = renderToStaticMarkup(h(Dropdown, { options: opts, value: 'done', onChange: () => {} }));
    expect(html).toContain('>Completed<');
    expect(html).not.toContain('+');
  });
});
