import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RowActions, { splitRowActions, RowAction } from '../../components/ui/RowActions';

const edit: RowAction = { key: 'edit', label: 'Edit', onClick: () => {} };
const del: RowAction = { key: 'del', label: 'Delete', destructive: true, onClick: () => {} };
const view: RowAction = { key: 'view', label: 'View', href: '/projects/1' };
const approve: RowAction = { key: 'approve', label: 'Approve', pinned: true, onClick: () => {} };
const reject: RowAction = { key: 'reject', label: 'Reject', pinned: true, destructive: true, onClick: () => {} };

describe('splitRowActions', () => {
  it('a single action stays a plain button', () => {
    expect(splitRowActions([view])).toEqual({ inline: [view], menu: [] });
  });
  it('Edit + Delete (two or more) go into the ⋮ menu', () => {
    expect(splitRowActions([edit, del])).toEqual({ inline: [], menu: [edit, del] });
    expect(splitRowActions([view, edit, del])).toEqual({ inline: [], menu: [view, edit, del] });
  });
  it('Approve / Reject are always shown directly, never in the menu', () => {
    expect(splitRowActions([approve, reject])).toEqual({ inline: [approve, reject], menu: [] });
    expect(splitRowActions([approve, reject, edit, del])).toEqual({ inline: [approve, reject], menu: [edit, del] });
  });
  it('pinned + one other action → all buttons', () => {
    expect(splitRowActions([approve, edit])).toEqual({ inline: [approve, edit], menu: [] });
  });
  it('hidden (permission-gated) actions do not count', () => {
    expect(splitRowActions([edit, { ...del, hidden: true }])).toEqual({ inline: [edit], menu: [] });
  });
  it('maxInline changes the threshold', () => {
    expect(splitRowActions([edit, del], 2).menu).toEqual([]);
  });
  it('nothing visible → nothing', () => {
    expect(splitRowActions([{ ...edit, hidden: true }])).toEqual({ inline: [], menu: [] });
  });
});

describe('RowActions rendering', () => {
  it('a single action renders as a labelled button, no ⋮', () => {
    const html = renderToStaticMarkup(h(RowActions, { actions: [view] }));
    expect(html).toContain('>View<');
    expect(html).not.toContain('aria-haspopup');
  });
  it('Edit + Delete render ONE ⋮ trigger (menu closed until clicked)', () => {
    const html = renderToStaticMarkup(h(RowActions, { actions: [edit, del], label: 'Actions for MEETIQ' }));
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Actions for MEETIQ"');
    expect(html).not.toContain('>Delete<');
  });
  it('Approve/Reject buttons sit next to the ⋮ for the rest', () => {
    const html = renderToStaticMarkup(h(RowActions, { actions: [approve, reject, edit, del] }));
    expect(html).toContain('>Approve<');
    expect(html).toContain('>Reject<');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('>Edit<');
  });
  it('renders nothing when every action is hidden', () => {
    expect(renderToStaticMarkup(h(RowActions, { actions: [{ ...edit, hidden: true }] }))).toBe('');
  });
});
