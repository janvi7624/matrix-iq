import { createElement as h, Fragment } from 'react';
import { describe, expect, it } from 'vitest';
import { parseSelectChildren } from '@/components/ui/Select';

describe('parseSelectChildren', () => {
  it('reads options, the empty placeholder, groups, fragments and conditionals', () => {
    const show = false;
    const parsed = parseSelectChildren(
      h(
        Fragment,
        null,
        h('option', { value: '' }, 'All statuses'),
        h('option', { value: 'open' }, 'Open'),
        show && h('option', { value: 'hidden' }, 'Hidden'),
        [1, 2].map((n) => h('option', { key: n, value: n }, 'Level ', n)),
        h('optgroup', { label: 'Closed' }, h('option', { value: 'won' }, 'Won'), h('option', { value: 'lost', disabled: true }, 'Lost')),
        h('option', null, 'No value attr')
      )
    );
    expect(parsed.emptyLabel).toBe('All statuses');
    expect(parsed.options.map((o) => o.value)).toEqual(['open', '1', '2', 'won', 'lost', 'No value attr']);
    expect(parsed.options.find((o) => o.value === '2')?.label).toBe('Level 2');
    expect(parsed.options.find((o) => o.value === 'won')?.group).toBe('Closed');
    expect(parsed.options.find((o) => o.value === 'lost')?.disabled).toBe(true);
  });

  it('has no placeholder when there is no empty option', () => {
    const parsed = parseSelectChildren([h('option', { key: 'a', value: 'a' }, 'A')]);
    expect(parsed.emptyLabel).toBeNull();
    expect(parsed.options).toHaveLength(1);
  });
});
