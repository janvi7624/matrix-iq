import { describe, it, expect } from 'vitest';
import { billKeyFromUrl, buildReuploadNotice, fileNameOfKey, formatBillDate, formatRupees, groupByPerson, MissingBillClaim } from '../../lib/missingBillsShared';

function claim(over: Partial<MissingBillClaim>): MissingBillClaim {
  return {
    claimId: 'c1', username: 'jaimin', name: 'Jaimin', email: 'j@example.com', active: true,
    date: '2026-07-21', description: 'Lunch', amount: 300, missingUrls: ['/api/uploads/file/a'], missingFileNames: ['a.pdf'], ...over
  };
}

describe('billKeyFromUrl', () => {
  it('turns a stored-file route back into its storage key', () => {
    expect(billKeyFromUrl('/api/uploads/file/uploads/reimbursement/jaimin/1788-ab12cd34-Invoice%201.pdf')).toBe('uploads/reimbursement/jaimin/1788-ab12cd34-Invoice 1.pdf');
    expect(billKeyFromUrl('/api/site-visits/image/site-visits/x/y.jpg')).toBe('site-visits/x/y.jpg');
  });
  it('returns null for anything it cannot check against our store', () => {
    for (const bad of ['https://example.com/bill.pdf', 'data:image/png;base64,AAA', '', null, undefined, 42]) expect(billKeyFromUrl(bad)).toBeNull();
  });
  it('returns null for a malformed escape instead of throwing', () => {
    expect(billKeyFromUrl('/api/uploads/file/%E0%A4%A')).toBeNull();
  });
});

describe('fileNameOfKey', () => {
  it('drops the timestamp and random prefix', () => {
    expect(fileNameOfKey('uploads/reimbursement/jaimin/1788758618545-0ee3a64b-Invoice_8382878998.pdf')).toBe('Invoice_8382878998.pdf');
  });
  it('leaves a name without that prefix alone', () => {
    expect(fileNameOfKey('uploads/x/plain.pdf')).toBe('plain.pdf');
  });
});

describe('groupByPerson', () => {
  it('groups claims by person and counts BILLS, not claims, biggest first', () => {
    const people = groupByPerson([
      claim({ claimId: 'a', username: 'manali', name: 'Manali', missingUrls: ['u1'], missingFileNames: ['1'] }),
      claim({ claimId: 'b', username: 'jaimin', name: 'Jaimin', missingUrls: ['u2', 'u3'], missingFileNames: ['2', '3'] }),
      claim({ claimId: 'c', username: 'manali', name: 'Manali', missingUrls: ['u4'], missingFileNames: ['4'] })
    ]);
    expect(people.map((p) => [p.username, p.billCount, p.claims.length])).toEqual([['jaimin', 2, 1], ['manali', 2, 2]]);
  });
  it('breaks ties by name', () => {
    const people = groupByPerson([claim({ username: 'zed', name: 'Zed' }), claim({ username: 'amy', name: 'Amy' })]);
    expect(people.map((p) => p.username)).toEqual(['amy', 'zed']);
  });
  it('is empty for no claims', () => {
    expect(groupByPerson([])).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats the claim date and the amount the way the app shows them', () => {
    expect(formatBillDate('2026-07-21')).toBe('21 Jul 2026');
    expect(formatBillDate('not-a-date')).toBe('not-a-date');
    expect(formatRupees(1250000)).toBe('₹12,50,000');
    expect(formatRupees(300)).toBe('₹300');
  });
});

describe('buildReuploadNotice', () => {
  it('counts bills, lists the claims, and says nothing was lost but the file', () => {
    const [person] = groupByPerson([
      claim({ claimId: 'a', date: '2026-07-21', description: 'Lunch & dinner', amount: 300 }),
      claim({ claimId: 'b', date: '2026-07-23', description: 'Dinner', amount: 385, missingUrls: ['x', 'y'], missingFileNames: ['x', 'y'] })
    ]);
    const { title, body } = buildReuploadNotice(person);
    expect(title).toBe('Please upload 3 reimbursement bills again');
    expect(body).toContain('• 21 Jul 2026 — Lunch & dinner — ₹300');
    expect(body).toContain('• 23 Jul 2026 — Dinner — ₹385');
    expect(body).toContain('claims and amounts are unchanged');
  });
  it('uses the singular for one bill', () => {
    const [person] = groupByPerson([claim({})]);
    expect(buildReuploadNotice(person).title).toBe('Please upload 1 reimbursement bill again');
  });
  it('caps the list and says how many more there are', () => {
    const many = Array.from({ length: 9 }, (_, i) => claim({ claimId: `c${i}`, description: `Item ${i}` }));
    const [person] = groupByPerson(many);
    const { body } = buildReuploadNotice(person);
    expect(body).toContain('Item 5');
    expect(body).not.toContain('Item 6');
    expect(body).toContain('…and 3 more claims');
  });
});
