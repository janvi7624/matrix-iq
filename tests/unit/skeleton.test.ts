import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkeletonTable, SkeletonStatCards, SkeletonCards, SkeletonList, SkeletonDetail, SkeletonForm, SkeletonPage, SkeletonText, SkeletonRows } from '../../components/ui/Skeleton';

describe('skeleton layouts', () => {
  const all = { SkeletonTable, SkeletonStatCards, SkeletonCards, SkeletonList, SkeletonDetail, SkeletonForm, SkeletonPage, SkeletonText, SkeletonRows };
  for (const [name, C] of Object.entries(all)) {
    it(`${name} is an accessible busy region with a screen-reader label`, () => {
      const html = renderToStaticMarkup(h(C as () => null));
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-busy="true"');
      expect(html).toMatch(/Loading/);
    });
  }
  it('is deterministic (SSR-safe — same markup every render)', () => {
    expect(renderToStaticMarkup(h(SkeletonTable, { rows: 4, columns: 4 }))).toBe(renderToStaticMarkup(h(SkeletonTable, { rows: 4, columns: 4 })));
  });
  it('renders the requested number of table rows', () => {
    const html = renderToStaticMarkup(h(SkeletonTable, { rows: 3, columns: 2 }));
    // header + 3 rows, each with 2 blocks
    expect(html.match(/aria-hidden="true"/g)?.length).toBe(2 + 3 * 2);
  });
});
