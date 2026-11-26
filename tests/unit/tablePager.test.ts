import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TablePager, { pageWindow } from '../../components/ui/TablePager';

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('collapses the middle with gaps', () => {
    expect(pageWindow(6, 20)).toEqual([1, 'gap', 5, 6, 7, 'gap', 20]);
  });
  it('no leading gap near the start, no trailing gap near the end', () => {
    expect(pageWindow(2, 20)).toEqual([1, 2, 3, 'gap', 20]);
    expect(pageWindow(19, 20)).toEqual([1, 'gap', 18, 19, 20]);
  });
});

describe('TablePager', () => {
  const base = { onPageChange: () => {}, onPageSizeChange: () => {} };
  it('shows the visible range and total', () => {
    const html = renderToStaticMarkup(h(TablePager, { ...base, page: 2, pageSize: 25, total: 142, noun: 'expenses' }));
    expect(html).toContain('<strong>26–50</strong>');
    expect(html).toContain('<strong>142</strong> expenses');
    expect(html).toContain('aria-current="page"');
  });
  it('"All" shows everything and hides page buttons', () => {
    const html = renderToStaticMarkup(h(TablePager, { ...base, page: 1, pageSize: 0, total: 142 }));
    expect(html).toContain('<strong>1–142</strong>');
    expect(html).not.toContain('Next page');
  });
  it('the last page shows a partial range', () => {
    expect(renderToStaticMarkup(h(TablePager, { ...base, page: 6, pageSize: 25, total: 142 }))).toContain('<strong>126–142</strong>');
  });
  it('renders nothing for an empty table', () => {
    expect(renderToStaticMarkup(h(TablePager, { ...base, page: 1, pageSize: 25, total: 0 }))).toBe('');
  });
});
