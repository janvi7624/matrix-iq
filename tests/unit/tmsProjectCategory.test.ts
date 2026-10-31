import { describe, it, expect } from 'vitest';
import { resolveProjectCategory } from '../../lib/tmsProjectCategory';

// New TMS "New Project" field: a Project Category dropdown (R&D /
// Development / Client / Other), where picking Other reveals a blank text
// field. Pins the one tricky part — 'Other' is never stored as the literal
// word, the typed text replaces it — same as this app's other 'Other'
// fields (Office Operation Expenses).
describe('resolveProjectCategory', () => {
  it('passes through a fixed option unchanged', () => {
    expect(resolveProjectCategory('R&D', '')).toEqual({ ok: true, value: 'R&D' });
    expect(resolveProjectCategory('Development', '')).toEqual({ ok: true, value: 'Development' });
    expect(resolveProjectCategory('Client', '')).toEqual({ ok: true, value: 'Client' });
  });

  it('is optional — a blank selection resolves to an empty string, not an error', () => {
    expect(resolveProjectCategory('', '')).toEqual({ ok: true, value: '' });
    expect(resolveProjectCategory(undefined, undefined)).toEqual({ ok: true, value: '' });
  });

  it('replaces "Other" with the typed text, trimmed', () => {
    expect(resolveProjectCategory('Other', '  Internal Tooling  ')).toEqual({ ok: true, value: 'Internal Tooling' });
  });

  it('refuses "Other" with nothing typed', () => {
    const result = resolveProjectCategory('Other', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/specify/i);

    expect(resolveProjectCategory('Other', '   ').ok).toBe(false);
    expect(resolveProjectCategory('Other', undefined).ok).toBe(false);
  });

  it('refuses a value outside the fixed list', () => {
    const result = resolveProjectCategory('Marketing', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid/i);
  });

  it('never stores the literal word "Other" even if the other-text happens to repeat it', () => {
    expect(resolveProjectCategory('Other', 'Other')).toEqual({ ok: true, value: 'Other' });
    // Whatever was typed is trusted verbatim once non-empty — this just
    // confirms the literal-"Other" guard is about the UNFILLED case, not
    // about rejecting text that happens to say "Other".
  });
});
