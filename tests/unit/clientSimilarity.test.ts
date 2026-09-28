import { describe, it, expect } from 'vitest';
import { normalizeClientText, textSimilarity, findClosestClient } from '@/lib/clientSimilarity';

describe('normalizeClientText', () => {
  it('trims, lowercases, and collapses internal whitespace', () => {
    expect(normalizeClientText('  Acme   Corp  ')).toBe('acme corp');
  });
});

describe('textSimilarity', () => {
  it('is 1 for identical strings once normalized', () => {
    expect(textSimilarity('Acme Corp', '  acme   corp ')).toBe(1);
  });

  it('is 0 if either side is empty', () => {
    expect(textSimilarity('', 'Acme')).toBe(0);
    expect(textSimilarity('Acme', '')).toBe(0);
  });

  it('scores a substring containment highly', () => {
    expect(textSimilarity('Acme', 'Acme Corporation')).toBeGreaterThan(0.8);
  });

  it('scores a small typo highly but not perfectly', () => {
    const score = textSimilarity('Rohan Shah', 'Rohan Shahh');
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(1);
  });

  it('scores unrelated names low', () => {
    expect(textSimilarity('Acme Corporation', 'Zenith Industries')).toBeLessThan(0.4);
  });
});

describe('findClosestClient', () => {
  const candidates = [
    { id: 'p1', clientName: 'Rohan Shah', company: 'Acme Corporation' },
    { id: 'p2', clientName: 'Priya Mehta', company: 'Zenith Industries' }
  ];

  it('finds a close match on company name', () => {
    const match = findClosestClient('', 'Acme Corp', candidates);
    expect(match?.project.id).toBe('p1');
  });

  it('finds a close match on client name (typo)', () => {
    const match = findClosestClient('Rohan Shahh', '', candidates);
    expect(match?.project.id).toBe('p1');
  });

  it('returns null when nothing is close enough', () => {
    expect(findClosestClient('Totally Different Name', 'Unrelated Co', candidates)).toBeNull();
  });

  it('returns null for very short input, to avoid noise while still typing', () => {
    expect(findClosestClient('Ro', '', candidates)).toBeNull();
  });

  it('returns null when both fields are blank', () => {
    expect(findClosestClient('', '', candidates)).toBeNull();
  });

  it('picks the single best match across all candidates', () => {
    const match = findClosestClient('Priya Mehtaa', '', candidates);
    expect(match?.project.id).toBe('p2');
  });
});
