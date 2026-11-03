import { describe, it, expect } from 'vitest';
import { clientDirectoryKey } from '../../lib/clientSimilarity';

// The key Client Master groups its rows by.
//
// It used to be trim+lowercase, which left one customer on several rows
// whenever the spelling differed by punctuation, spacing or a legal suffix.
// The risk running the other way is worse though: merging two genuinely
// different clients hides one's projects inside the other's, so these tests
// pin BOTH directions — what must merge, and what must stay apart.

describe('clientDirectoryKey — names that must merge', () => {
  it('ignores case and surrounding space', () => {
    expect(clientDirectoryKey('  Adani  ')).toBe(clientDirectoryKey('adani'));
  });

  it('collapses internal whitespace', () => {
    expect(clientDirectoryKey('Adani   Power')).toBe(clientDirectoryKey('Adani Power'));
  });

  it('ignores punctuation', () => {
    expect(clientDirectoryKey('Adani Pvt. Ltd.')).toBe(clientDirectoryKey('Adani Pvt Ltd'));
    expect(clientDirectoryKey('Shah & Sons')).toBe(clientDirectoryKey('Shah and Sons'.replace(' and ', ' ')));
    expect(clientDirectoryKey('Acme-Industries')).toBe(clientDirectoryKey('Acme Industries'));
  });

  // The main one: the same customer written with and without a legal form.
  it('drops a trailing legal suffix', () => {
    const base = clientDirectoryKey('Acme');
    for (const variant of [
      'Acme Ltd',
      'Acme Limited',
      'Acme Pvt Ltd',
      'Acme Pvt. Ltd.',
      'Acme Private Limited',
      'Acme LLP',
      'Acme Inc',
      'Acme Corporation',
      'Acme Corp',
      'Acme Company',
      'Acme Co'
    ]) {
      expect(clientDirectoryKey(variant), `${variant} should match "Acme"`).toBe(base);
    }
  });

  it('strips several stacked suffixes', () => {
    expect(clientDirectoryKey('Acme Pvt. Ltd. Co.')).toBe(clientDirectoryKey('Acme'));
  });
});

describe('clientDirectoryKey — names that must NOT merge', () => {
  // Different trade words are not noise. Merging these would put one
  // client's projects under another client's name.
  it('keeps different descriptive words apart', () => {
    expect(clientDirectoryKey('Patel Industries')).not.toBe(clientDirectoryKey('Patel Trading'));
    expect(clientDirectoryKey('Shah Enterprises')).not.toBe(clientDirectoryKey('Shah Motors'));
    expect(clientDirectoryKey('Adani Power')).not.toBe(clientDirectoryKey('Adani Ports'));
  });

  it('keeps different names apart', () => {
    expect(clientDirectoryKey('Acme')).not.toBe(clientDirectoryKey('Acne'));
    expect(clientDirectoryKey('Mr. Brijesh')).not.toBe(clientDirectoryKey('Mr. Brijendra'));
  });

  // Not fuzzy: grouping happens with nobody to confirm it, so a typo must
  // not silently merge two clients. textSimilarity handles the "did you
  // mean?" nudge, where a human decides.
  it('does not merge on near-spellings', () => {
    expect(clientDirectoryKey('Reliance')).not.toBe(clientDirectoryKey('Relaince'));
  });
});

describe('clientDirectoryKey — edge cases', () => {
  it('is empty for nothing', () => {
    expect(clientDirectoryKey('')).toBe('');
    expect(clientDirectoryKey('   ')).toBe('');
    expect(clientDirectoryKey('.,-')).toBe('');
  });

  // A client genuinely called "Limited" would otherwise key to '' and get
  // merged with every other unnamed row.
  it('keeps a name that IS a legal word', () => {
    expect(clientDirectoryKey('Limited')).toBe('limited');
    expect(clientDirectoryKey('Co')).toBe('co');
  });

  it('is stable — the same input always gives the same key', () => {
    expect(clientDirectoryKey('Acme Pvt Ltd')).toBe(clientDirectoryKey('Acme Pvt Ltd'));
  });
});
