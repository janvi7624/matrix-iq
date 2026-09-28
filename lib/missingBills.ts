import { QueryTypes } from 'sequelize';
import { sequelize } from './db';
import { filesExist } from './fileStorage';
import { billKeyFromUrl, fileNameOfKey, MissingBillClaim } from './missingBillsShared';

export * from './missingBillsShared';

// Reimbursement bills whose file can no longer be opened.
//
// The old Supabase Storage project stopped existing, so bill images/PDFs that
// were uploaded to it are unreachable — while the claims themselves (date,
// description, amount, who) are untouched in our database. The only way to get
// a bill back is for the person who uploaded it to send the original again
// (most are WhatsApp photos and emailed receipts). This module works out which
// claims that applies to, and validates a re-upload; the routes and the
// Reimbursement page's panel are built on it. scripts/list-missing-bills.js is
// the same idea as a one-off CSV.

interface ClaimRow {
  id: string;
  date: string;
  description: string | null;
  amount: string | number | null;
  attachment_urls: unknown;
  username: string;
  name: string | null;
  email: string | null;
  status: string;
}

// Every claim (optionally limited to some people) that has at least one bill
// file the store no longer holds. `usernames` narrows the SEARCH itself, not
// just the output — a caller asking about one person never even reads anyone
// else's claims.
export async function listMissingBillClaims(opts: { usernames?: string[] } = {}): Promise<MissingBillClaim[]> {
  const scoped = Array.isArray(opts.usernames);
  if (scoped && !opts.usernames!.length) return [];

  const rows = await sequelize.query<ClaimRow>(
    `SELECT r.id, to_char(r.date, 'YYYY-MM-DD') AS date, r.description, r.amount, r.attachment_urls,
            u.username, u.name, u.email, u.status
       FROM reimbursements r
       JOIN users u ON u.id = r.created_by
      WHERE jsonb_typeof(r.attachment_urls) = 'array' AND jsonb_array_length(r.attachment_urls) > 0
        ${scoped ? 'AND u.username = ANY($usernames)' : ''}
      ORDER BY r.date, r.created_at`,
    { bind: scoped ? { usernames: opts.usernames } : {}, type: QueryTypes.SELECT }
  );

  const keys: string[] = [];
  for (const row of rows) {
    for (const url of (row.attachment_urls as unknown[]) ?? []) {
      const key = billKeyFromUrl(url);
      if (key) keys.push(key);
    }
  }
  const present = await filesExist(keys);

  const claims: MissingBillClaim[] = [];
  for (const row of rows) {
    const missingUrls: string[] = [];
    const missingFileNames: string[] = [];
    for (const url of (row.attachment_urls as unknown[]) ?? []) {
      const key = billKeyFromUrl(url);
      if (!key || present.has(key)) continue;
      missingUrls.push(url as string);
      missingFileNames.push(fileNameOfKey(key));
    }
    if (!missingUrls.length) continue;
    claims.push({
      claimId: row.id,
      username: row.username,
      name: row.name || row.username,
      email: row.email || '',
      active: row.status === 'active',
      date: row.date,
      description: row.description || '',
      amount: Number(row.amount) || 0,
      missingUrls,
      missingFileNames
    });
  }
  return claims;
}

/* ------------------------------- re-uploading ------------------------------- */

export interface ReplaceBillResult {
  ok: boolean;
  status: number;
  error?: string;
  attachmentUrls?: string[];
}

// Swaps ONE missing bill on a claim for a freshly uploaded file, and nothing
// else — no other field is touched, so it works on an already-approved claim
// (which the normal edit form deliberately won't let anyone change). The
// narrow rules are what keep that safe: only the claim's owner, only a bill
// that really is missing right now, only a file that owner just uploaded.
export async function replaceMissingBill(input: { claimId: string; username: string; oldUrl: string; newUrl: string }): Promise<ReplaceBillResult> {
  const rows = await sequelize.query<{ id: string; attachment_urls: unknown; username: string }>(
    `SELECT r.id, r.attachment_urls, u.username
       FROM reimbursements r JOIN users u ON u.id = r.created_by
      WHERE r.id = $id LIMIT 1`,
    { bind: { id: input.claimId }, type: QueryTypes.SELECT }
  );
  const claim = rows[0];
  if (!claim) return { ok: false, status: 404, error: 'Claim not found' };
  if (claim.username !== input.username) return { ok: false, status: 403, error: 'You can only re-upload bills on your own claims' };

  const urls = Array.isArray(claim.attachment_urls) ? (claim.attachment_urls as string[]) : [];
  const index = urls.indexOf(input.oldUrl);
  if (index === -1) return { ok: false, status: 400, error: 'That bill is not on this claim' };

  const oldKey = billKeyFromUrl(input.oldUrl);
  if (!oldKey) return { ok: false, status: 400, error: 'That bill cannot be replaced' };
  if ((await filesExist([oldKey])).has(oldKey)) {
    return { ok: false, status: 400, error: 'That bill can still be opened — there is nothing to replace' };
  }

  const newKey = billKeyFromUrl(input.newUrl);
  const ownFolder = `uploads/reimbursement/${input.username}/`;
  if (!newKey || !newKey.startsWith(ownFolder)) return { ok: false, status: 400, error: 'Upload the bill again from this page, then try once more' };
  if (urls.includes(input.newUrl)) return { ok: false, status: 400, error: 'That file is already on this claim' };
  if (!(await filesExist([newKey])).has(newKey)) return { ok: false, status: 400, error: 'The new file did not upload — please try again' };

  const next = urls.map((u, i) => (i === index ? input.newUrl : u));
  await sequelize.query(
    `UPDATE reimbursements SET attachment_urls = $urls::jsonb, updated_at = NOW() WHERE id = $id`,
    { bind: { urls: JSON.stringify(next), id: input.claimId }, type: QueryTypes.UPDATE }
  );
  return { ok: true, status: 200, attachmentUrls: next };
}
