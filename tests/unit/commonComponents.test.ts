import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';


import CommonButton, { commonButtonClassName } from '../../components/ui/CommonButton';
import CommonChip, { CommonChipGroup, commonChipClassName, nextChipSelection } from '../../components/ui/CommonChip';
import { CommonHeaderView } from '../../components/ui/CommonHeader';
import { resolveFallbackRoute } from '../../lib/backNavigation';

// CommonHeader = useBackNavigation() + CommonHeaderView; the view is rendered
// directly here so no app router is needed, with the back target resolved by
// the same resolveFallbackRoute the hook uses.
const header = (props: Record<string, unknown>, path = '/tms/tasks/abc') =>
  renderToStaticMarkup(
    h(CommonHeaderView, {
      title: 'T',
      showBackButton: true,
      backHref: (props.fallbackRoute as string | undefined) ?? resolveFallbackRoute(path),
      ...props
    } as Parameters<typeof CommonHeaderView>[0])
  );

describe('CommonButton', () => {
  it('renders a type=button by default with the label', () => {
    const html = renderToStaticMarkup(h(CommonButton, { variant: 'primary' }, 'Save'));
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('Save');
  });

  it('selected and unselected produce different classes and aria-pressed', () => {
    const off = commonButtonClassName({ variant: 'outlined', selected: false });
    const on = commonButtonClassName({ variant: 'outlined', selected: true });
    expect(on).not.toBe(off);
    expect(renderToStaticMarkup(h(CommonButton, { selected: true }, 'A'))).toContain('aria-pressed="true"');
    expect(renderToStaticMarkup(h(CommonButton, { selected: false }, 'A'))).toContain('aria-pressed="false"');
    // A plain (non-toggle) button carries no aria-pressed at all.
    expect(renderToStaticMarkup(h(CommonButton, {}, 'A'))).not.toContain('aria-pressed');
  });

  it('every variant and size produces a distinct class list', () => {
    const variants = ['primary', 'secondary', 'outlined', 'ghost', 'destructive', 'destructiveSolid', 'success', 'link'] as const;
    const seen = new Set(variants.map((v) => commonButtonClassName({ variant: v })));
    expect(seen.size).toBe(variants.length);
    const sizes = new Set((['sm', 'md', 'lg'] as const).map((s) => commonButtonClassName({ size: s })));
    expect(sizes.size).toBe(3);
  });

  it('loading disables the button and sets aria-busy', () => {
    const html = renderToStaticMarkup(h(CommonButton, { loading: true, loadingLabel: 'Saving…' }, 'Save'));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Saving…');
    expect(html).not.toContain('>Save<');
  });

  it('respects an explicit submit type and disabled', () => {
    const html = renderToStaticMarkup(h(CommonButton, { type: 'submit', disabled: true }, 'Go'));
    expect(html).toContain('type="submit"');
    expect(html).toContain('disabled=""');
  });

  it('renders a link when given href, and an inert anchor when disabled', () => {
    expect(renderToStaticMarkup(h(CommonButton, { href: '/leads' }, 'Leads'))).toMatch(/^<a[^>]*href="\/leads"/);
    const disabled = renderToStaticMarkup(h(CommonButton, { href: '/leads', disabled: true }, 'Leads'));
    expect(disabled).not.toContain('href=');
    expect(disabled).toContain('aria-disabled="true"');
  });

  it('icon-only renders no visible label and keeps the aria-label', () => {
    const html = renderToStaticMarkup(h(CommonButton, { iconOnly: true, 'aria-label': 'Delete', leadingIcon: h('svg') }));
    expect(html).toContain('aria-label="Delete"');
    expect(html).toContain('<svg');
  });
});

describe('CommonChip', () => {
  it('is a static tag without handlers', () => {
    expect(renderToStaticMarkup(h(CommonChip, { label: 'Draft' }))).toMatch(/^<span/);
  });

  it('is a toggle button when selectable, with aria-pressed and a check when selected', () => {
    const on = renderToStaticMarkup(h(CommonChip, { label: 'Hot', selected: true, onSelectedChange: () => {} }));
    const off = renderToStaticMarkup(h(CommonChip, { label: 'Hot', selected: false, onSelectedChange: () => {} }));
    expect(on).toMatch(/^<button/);
    expect(on).toContain('aria-pressed="true"');
    expect(off).toContain('aria-pressed="false"');
    expect(on).toContain('<svg'); // check mark
    expect(off).not.toContain('<svg');
  });

  it('selected and unselected chips get different classes', () => {
    expect(commonChipClassName({ selected: true, interactive: true })).not.toBe(commonChipClassName({ selected: false, interactive: true }));
  });

  it('uncontrolled chips honour defaultSelected', () => {
    expect(renderToStaticMarkup(h(CommonChip, { label: 'A', defaultSelected: true }))).toContain('aria-pressed="true"');
  });

  it('disabled chips are disabled buttons', () => {
    expect(renderToStaticMarkup(h(CommonChip, { label: 'A', onClick: () => {}, disabled: true }))).toContain('disabled=""');
  });

  it('removable chips expose a labelled remove button', () => {
    const html = renderToStaticMarkup(h(CommonChip, { label: 'Pune', onRemove: () => {} }));
    expect(html).toMatch(/^<span/);
    expect(html).toContain('aria-label="Remove Pune"');
  });
});

describe('CommonChipGroup', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C', disabled: true }
  ];

  it('marks only the selected option in single mode', () => {
    const html = renderToStaticMarkup(h(CommonChipGroup, { ariaLabel: 'Pick', options, value: 'b' }));
    expect(html).toContain('role="group"');
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(2);
  });

  it('marks every selected option in multi mode', () => {
    const html = renderToStaticMarkup(h(CommonChipGroup, { ariaLabel: 'Pick', options, multiple: true, value: ['a', 'b'] }));
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(2);
  });

  it('selection reducer: single, single+deselect, multi', () => {
    expect(nextChipSelection(['a'], 'b', false, false)).toEqual(['b']);
    expect(nextChipSelection(['a'], 'a', false, false)).toEqual(['a']);
    expect(nextChipSelection(['a'], 'a', false, true)).toEqual([]);
    expect(nextChipSelection(['a'], 'b', true, false)).toEqual(['a', 'b']);
    expect(nextChipSelection(['a', 'b'], 'a', true, false)).toEqual(['b']);
  });
});

describe('CommonHeader', () => {
  it('renders the back button as the first interactive element, left of the title', () => {
    const html = header({ title: 'Task', subtitle: 'Sub', rightActions: [{ key: 'x', label: 'Export', onClick: () => {} }] });
    const firstInteractive = html.match(/<(a|button)\b[^>]*>/)?.[0] ?? '';
    expect(firstInteractive).toContain('aria-label="Go back"');
    // Falls back to the nearest parent page, not a hard-coded '/'.
    expect(firstInteractive).toContain('href="/tms/tasks"');
    expect(html.indexOf('Go back')).toBeLessThan(html.indexOf('>Task<'));
    expect(html.indexOf('>Task<')).toBeLessThan(html.indexOf('Export'));
    // Icon, not the word "Back".
    expect(html).not.toMatch(/>\s*Back\s*</);
  });

  it('honours an explicit fallbackRoute', () => {
    const html = header({ title: 'T', fallbackRoute: '/projects' });
    expect(html).toContain('href="/projects"');
  });

  it('uses a button when onBack is supplied', () => {
    const html = header({ title: 'T', onBack: () => {} });
    expect(html.match(/<(a|button)\b[^>]*>/)?.[0]).toMatch(/^<button/);
  });

  it('can hide the back button', () => {
    const html = header({ title: 'T', showBackButton: false });
    expect(html).not.toContain('Go back');
  });

  it('the dark app bar has no back button by default; light in-page headers do', () => {
    const dark = renderToStaticMarkup(h(CommonHeaderView, { title: 'T', backHref: '/' }));
    const light = renderToStaticMarkup(h(CommonHeaderView, { title: 'T', backHref: '/x', tone: 'light' }));
    expect(dark).not.toContain('Go back');
    expect(light).toContain('Go back');
  });

  it('renders the built-in search input when showSearch is on', () => {
    const html = header({ title: 'T', showSearch: true, searchPlaceholder: 'Search leads…' });
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Search leads"');
  });
});

import StatCard, { statCardClassName } from '../../components/ui/StatCard';

describe('StatCard', () => {
  it('static cards are a div with no open affordance', () => {
    const html = renderToStaticMarkup(h(StatCard, { value: 31, label: 'Total Projects' }));
    expect(html).toMatch(/^<div/);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('View details');
  });

  it('clickable cards are buttons with the open affordance icon and an accessible hint', () => {
    const html = renderToStaticMarkup(h(StatCard, { value: 22, label: 'Active Projects', onClick: () => {}, actionLabel: 'View active projects' }));
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('<svg');
    expect(html).toContain('View active projects');
  });

  it('href cards are links with the affordance', () => {
    const html = renderToStaticMarkup(h(StatCard, { value: 5, label: 'Delayed', href: '/tms/projects?f=delayed', tone: 'danger' }));
    expect(html).toMatch(/^<a[^>]*href="\/tms\/projects\?f=delayed"/);
    expect(html).toContain('<svg');
  });

  it('selected filter cards set aria-pressed and a distinct class', () => {
    expect(renderToStaticMarkup(h(StatCard, { value: 1, label: 'x', onClick: () => {}, selected: true }))).toContain('aria-pressed="true"');
    expect(statCardClassName({ interactive: true, selected: true })).not.toBe(statCardClassName({ interactive: true, selected: false }));
  });

  it('interactive and static cards get different classes', () => {
    expect(statCardClassName({ interactive: true })).not.toBe(statCardClassName({ interactive: false }));
  });
});

describe('CommonChip checkbox mode / CommonButton extras', () => {
  it('checkbox chips use role=checkbox + aria-checked, not aria-pressed', () => {
    const html = renderToStaticMarkup(h(CommonChip, { label: 'Freight', checkbox: true, selected: true, onClick: () => {} }));
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('aria-pressed');
  });

  it('expanded sets aria-expanded; warning is its own variant', () => {
    expect(renderToStaticMarkup(h(CommonButton, { expanded: false }, 'Filters'))).toContain('aria-expanded="false"');
    expect(commonButtonClassName({ variant: 'warning' })).not.toBe(commonButtonClassName({ variant: 'primary' }));
  });
});
