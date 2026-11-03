import { describe, it, expect } from 'vitest';
import { partnerCodeSegment, partnerCodePrefix } from '../../lib/partnerCode';

// The actual request: PTR-AI-0002 for an AI-only partner, PTR-ROB-0002 for
// Robotics, PTR-AV-0002 for AV, PTR-ALL-0002 when the partner spans all
// three TMS departments — falling back to the plain PTR-#### series for
// anything that doesn't cleanly fit one of those buckets.
describe('partnerCodeSegment', () => {
  it('abbreviates a single TMS department', () => {
    expect(partnerCodeSegment(['ai'])).toBe('AI');
    expect(partnerCodeSegment(['robotics'])).toBe('ROB');
    expect(partnerCodeSegment(['av'])).toBe('AV');
  });

  it('is ALL when all three TMS departments are present', () => {
    expect(partnerCodeSegment(['ai', 'av', 'robotics'])).toBe('ALL');
    expect(partnerCodeSegment(['robotics', 'ai', 'av'])).toBe('ALL');
  });

  it('is case-insensitive', () => {
    expect(partnerCodeSegment(['AI'])).toBe('AI');
    expect(partnerCodeSegment(['Robotics'])).toBe('ROB');
  });

  it('ignores "other" — it names no real department to abbreviate', () => {
    expect(partnerCodeSegment(['ai', 'other'])).toBe('AI');
    expect(partnerCodeSegment(['other'])).toBe('');
  });

  it('falls back to no segment for two of three, or none at all', () => {
    expect(partnerCodeSegment(['ai', 'av'])).toBe('');
    expect(partnerCodeSegment([])).toBe('');
    expect(partnerCodeSegment(undefined)).toBe('');
    expect(partnerCodeSegment(null)).toBe('');
  });
});

describe('partnerCodePrefix', () => {
  it('builds the PTR-<segment>- prefix, or plain PTR- with no segment', () => {
    expect(partnerCodePrefix(['ai'])).toBe('PTR-AI-');
    expect(partnerCodePrefix(['ai', 'av', 'robotics'])).toBe('PTR-ALL-');
    expect(partnerCodePrefix([])).toBe('PTR-');
  });
});
