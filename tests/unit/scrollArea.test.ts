import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScrollArea from '../../components/ui/ScrollArea';

describe('ScrollArea', () => {
  it('scrolls vertically by default with containment and a cap', () => {
    const html = renderToStaticMarkup(h(ScrollArea, { maxHeight: 320 }, 'x'));
    expect(html).toContain('overflow-y:auto');
    expect(html).toContain('overflow-x:hidden');
    expect(html).toContain('overscroll-behavior:contain');
    expect(html).toContain('max-height:320px');
  });
  it('a labelled area is a focusable region for keyboard scrolling', () => {
    const html = renderToStaticMarkup(h(ScrollArea, { label: 'Comments', axis: 'both' }, 'x'));
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Comments"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('overflow:auto');
  });
  it('unlabelled areas are not tab stops', () => {
    expect(renderToStaticMarkup(h(ScrollArea, {}, 'x'))).not.toContain('tabindex');
  });
});
