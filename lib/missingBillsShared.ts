// The pure half of lib/missingBills.ts — no database or storage imports, so the
// Reimbursement page's panel (a client component) can use the same types,
// grouping and wording as the server instead of a second copy that drifts.
// Importing lib/missingBills.ts itself from the browser would try to bundle
// Sequelize/pg.

// Both are routes that stream a stored file by key — see app/api/uploads/file
// and app/api/site-visits/image. Anything else (an external link, a data URL)
// can't be checked against our store, so it is never reported as missing.
const URL_PREFIXES = ['/api/uploads/file/', '/api/site-visits/image/'];

export function billKeyFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const prefix = URL_PREFIXES.find((p) => url.startsWith(p));
  if (!prefix) return null;
  try {
    return url.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

export interface MissingBillClaim {
  claimId: string;
  username: string;
  name: string;
  email: string;
  active: boolean;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  missingUrls: string[];
  missingFileNames: string[];
}

export interface MissingBillPerson {
  username: string;
  name: string;
  email: string;
  active: boolean;
  billCount: number;
  claims: MissingBillClaim[];
}

// One entry per person, biggest problem first.
export function groupByPerson(claims: MissingBillClaim[]): MissingBillPerson[] {
  const byUser = new Map<string, MissingBillPerson>();
  for (const claim of claims) {
    let person = byUser.get(claim.username);
    if (!person) {
      person = { username: claim.username, name: claim.name, email: claim.email, active: claim.active, billCount: 0, claims: [] };
      byUser.set(claim.username, person);
    }
    person.claims.push(claim);
    person.billCount += claim.missingUrls.length;
  }
  return [...byUser.values()].sort((a, b) => b.billCount - a.billCount || a.name.localeCompare(b.name));
}

// Stored as <timestamp>-<8 hex>-<original name>; show just the original name.
export function fileNameOfKey(key: string): string {
  const last = key.split('/').pop() || key;
  return last.replace(/^\d+-[0-9a-f]{8}-/, '');
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatBillDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return y && m && d ? `${d} ${MONTH_SHORT[m - 1]} ${y}` : ymd;
}

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const MAX_LISTED = 6;

// The in-app notification for one person. The email lists the same claims.
export function buildReuploadNotice(person: Pick<MissingBillPerson, 'billCount' | 'claims'>): { title: string; body: string } {
  const n = person.billCount;
  const noun = n === 1 ? 'bill' : 'bills';
  const lines = person.claims.slice(0, MAX_LISTED).map((c) => `• ${formatBillDate(c.date)} — ${c.description || 'Claim'} — ${formatRupees(c.amount)}`);
  const more = person.claims.length - MAX_LISTED;
  if (more > 0) lines.push(`…and ${more} more claim${more === 1 ? '' : 's'}`);
  return {
    title: `Please upload ${n} reimbursement ${noun} again`,
    body: [
      `Our old file storage was lost, so ${n} ${noun} on your reimbursement claims can no longer be opened. Your claims and amounts are unchanged — please open Reimbursement and use "Upload bill again" on each one, using the original photo or PDF from your phone or email.`,
      ...lines
    ].join('\n')
  };
}
