'use strict';

/*
 * Lists every reimbursement bill whose file cannot be opened, grouped by the
 * person who uploaded it.
 *
 * Context: attachments used to live in a Supabase Storage bucket whose project
 * no longer exists, so 71 bill files across 60 claims became unreachable. The
 * claims themselves — date, description, amount, who — are all still in the
 * database and untouched; only the image or PDF is gone. Nothing here deletes
 * or changes anything.
 *
 * The output is the practical recovery route: most of these are WhatsApp
 * photos and emailed PDF receipts, so the people listed can very likely
 * re-send the originals from their own phone or mailbox.
 *
 *   node scripts/list-missing-bills.js                # print the summary
 *   node scripts/list-missing-bills.js --csv          # also write missing-bills.csv
 *
 * Re-run it after any restore: a bill whose file is back stops being listed.
 */

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env.local'), quiet: true });
const { Client } = require(path.join(ROOT, 'node_modules/pg'));

const WRITE_CSV = process.argv.includes('--csv');
const PREFIXES = ['/api/uploads/file/', '/api/site-visits/image/'];

function keyFromUrl(url) {
  if (typeof url !== 'string') return null;
  const prefix = PREFIXES.find((p) => url.startsWith(p));
  if (!prefix) return null;
  return url.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
}

// The uploader is encoded in the key itself: uploads/<folder>/<username>/<file>
function uploaderFromKey(key) {
  const parts = key.split('/');
  return parts.length >= 3 ? parts[2] : '(unknown)';
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  const claims = (await pg.query(
    `select r.id, r.date, r.description, r.amount, r.created_by, r.attachment_urls, r.payment_proof_urls,
            r.approval_status, r.payment_status, u.name uploader_name
       from reimbursements r
       left join users u on u.id = r.created_by
      where (jsonb_typeof(r.attachment_urls) = 'array' and jsonb_array_length(r.attachment_urls) > 0)
         or (jsonb_typeof(r.payment_proof_urls) = 'array' and jsonb_array_length(r.payment_proof_urls) > 0)
      order by r.date`
  )).rows;

  // Anything already restored into our own store is no longer missing.
  const present = new Set(
    (await pg.query('select path from file_objects')).rows.map((r) => r.path)
  );

  const missing = [];
  for (const claim of claims) {
    for (const url of [...(claim.attachment_urls || []), ...(claim.payment_proof_urls || [])]) {
      const key = keyFromUrl(url);
      if (!key || present.has(key)) continue;
      missing.push({
        uploader: uploaderFromKey(key),
        uploaderName: claim.uploader_name || '',
        date: String(claim.date).slice(0, 15),
        description: claim.description || '',
        amount: claim.amount,
        approval: claim.approval_status || '',
        payment: claim.payment_status || '',
        fileName: key.split('/').pop(),
        claimId: claim.id,
        key
      });
    }
  }

  const restored = claims.reduce((n, c) => n + [...(c.attachment_urls || []), ...(c.payment_proof_urls || [])]
    .filter((u) => { const k = keyFromUrl(u); return k && present.has(k); }).length, 0);

  console.log(`Claims with attachments: ${claims.length}`);
  console.log(`Bill files already available: ${restored}`);
  console.log(`Bill files still missing: ${missing.length}\n`);

  if (!missing.length) {
    console.log('Nothing is missing — every referenced bill can be opened.');
    await pg.end();
    return;
  }

  const byUploader = new Map();
  for (const m of missing) {
    if (!byUploader.has(m.uploader)) byUploader.set(m.uploader, []);
    byUploader.get(m.uploader).push(m);
  }

  for (const [uploader, items] of [...byUploader].sort((a, b) => b[1].length - a[1].length)) {
    const who = items[0].uploaderName ? `${uploader} (${items[0].uploaderName})` : uploader;
    console.log(`${who} — ${items.length} bill${items.length === 1 ? '' : 's'} to re-send:`);
    for (const m of items) {
      const amount = m.amount === null ? '' : `₹${Number(m.amount).toLocaleString('en-IN')}`;
      console.log(`   ${m.date}  ${amount.padStart(12)}  ${(m.description || '').slice(0, 34).padEnd(34)}  ${m.fileName}`);
    }
    console.log('');
  }

  if (WRITE_CSV) {
    const out = path.join(ROOT, 'missing-bills.csv');
    const header = ['Uploader', 'Name', 'Claim date', 'Description', 'Amount', 'Approval', 'Payment', 'Missing file', 'Claim id'];
    const lines = [header.join(',')];
    for (const m of missing) {
      lines.push([m.uploader, m.uploaderName, m.date, m.description, m.amount, m.approval, m.payment, m.fileName, m.claimId].map(csvCell).join(','));
    }
    fs.writeFileSync(out, lines.join('\r\n'), 'utf8');
    console.log(`Written: ${out}`);
  } else {
    console.log('Re-run with --csv to write missing-bills.csv for circulating.');
  }

  await pg.end();
})();
