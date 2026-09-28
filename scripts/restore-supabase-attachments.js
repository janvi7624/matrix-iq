'use strict';

/*
 * Restores the attachments that were lost when the old Supabase Storage
 * project stopped existing.
 *
 * Copies every file still referenced in the database out of the Supabase
 * bucket and into whichever backend the app uses now — the database by
 * default, or S3 when FILE_STORAGE=s3 — keeping the SAME key. Because the
 * stored URLs are app routes (/api/uploads/file/<key>) rather than provider
 * URLs, nothing in the database needs rewriting: once a file is back under its
 * original key, its existing link works again.
 *
 * WHY THIS EXISTS UNRUN: at the time of writing the Supabase project host
 * (SUPABASE_URL) no longer resolves in DNS, so there is nothing to copy from.
 * If that project is restored from the Supabase dashboard, run this and the
 * 319 business cards and 71 reimbursement bills come back.
 *
 *   node scripts/restore-supabase-attachments.js                    # report only
 *   node scripts/restore-supabase-attachments.js --apply            # copy everything
 *   node scripts/restore-supabase-attachments.js --only=bills --apply
 *
 * --only=bills restores just the reimbursement bills — the ones that matter
 * for accounts — and skips scanned business cards, which are re-scannable and
 * were explicitly not worth restoring. --only=cards does the opposite.
 *
 * Safe to re-run: a key already present in the destination is skipped, and
 * nothing is ever deleted from Supabase.
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env.local'), quiet: true });

const { Client } = require(path.join(ROOT, 'node_modules/pg'));
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'));

const APPLY = process.argv.includes('--apply');
const USE_S3 = (process.env.FILE_STORAGE || '').trim().toLowerCase() === 's3';
const SUPABASE_BUCKET = 'app-files';

const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'all';
if (!['all', 'bills', 'cards'].includes(ONLY)) {
  console.error(`--only must be one of: all, bills, cards (got "${ONLY}")`);
  process.exit(1);
}
// Which tables each selection draws from. `bills` is the reimbursement money
// trail; `cards` is scanned business cards, which can simply be re-scanned.
const ONLY_TABLES = { bills: ['reimbursements'], cards: ['leads'] };

// The two URL shapes the app stores, both of which encode the storage key.
const PREFIXES = ['/api/uploads/file/', '/api/site-visits/image/'];

function keyFromUrl(url) {
  if (typeof url !== 'string') return null;
  const prefix = PREFIXES.find((p) => url.startsWith(p));
  if (!prefix) return null;
  return url.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
}

// Every column that can hold one or more of those URLs.
const SOURCES = [
  { table: 'leads', column: 'card_image_url', kind: 'text' },
  { table: 'reimbursements', column: 'attachment_urls', kind: 'json' },
  { table: 'reimbursements', column: 'payment_proof_urls', kind: 'json' },
  { table: 'site_visits', column: 'image_urls', kind: 'json' },
  { table: 'projects', column: 'attachments', kind: 'json' },
  { table: 'purchase_orders', column: 'attachment_url', kind: 'text' },
  { table: 'marketing_requests', column: 'attachments', kind: 'json' },
  { table: 'marketing_requests', column: 'marketing_attachments', kind: 'json' },
  { table: 'marketing_requests', column: 'delivered_files', kind: 'json' },
  { table: 'marketing_requests', column: 'final_submission_files', kind: 'json' },
  { table: 'office_operation_expenses', column: 'payment_proof_urls', kind: 'json' },
  { table: 'tms_projects', column: 'attachments', kind: 'json' },
  { table: 'tms_tasks', column: 'attachments', kind: 'json' },
  { table: 'tms_task_updates', column: 'attachments', kind: 'json' },
  { table: 'tms_bom_requests', column: 'attachments', kind: 'json' },
  { table: 'tms_bom_requests', column: 'payment_proof_attachments', kind: 'json' },
  { table: 'tms_project_deadline_extensions', column: 'attachments', kind: 'json' }
];

async function collectKeys(pg) {
  const keys = new Map(); // key -> which column referenced it
  const allowed = ONLY === 'all' ? null : new Set(ONLY_TABLES[ONLY]);
  for (const src of SOURCES) {
    if (allowed && !allowed.has(src.table)) continue;
    let rows;
    try {
      rows = (await pg.query(`select "${src.column}" v from "${src.table}" where "${src.column}" is not null`)).rows;
    } catch (e) {
      console.log(`  (skipping ${src.table}.${src.column}: ${e.message.split('\n')[0]})`);
      continue;
    }
    for (const row of rows) {
      const values = src.kind === 'json' ? (Array.isArray(row.v) ? row.v : []) : [row.v];
      for (const value of values) {
        const key = keyFromUrl(value);
        if (key && !keys.has(key)) keys.set(key, `${src.table}.${src.column}`);
      }
    }
  }
  return keys;
}

// --- destination: the same two backends lib/fileStorage.ts serves ---

function makeDestination(pg) {
  if (!USE_S3) {
    return {
      label: 'this database (file_objects)',
      async has(key) {
        return (await pg.query('select 1 from file_objects where path=$1', [key])).rowCount > 0;
      },
      async put(key, buffer, contentType) {
        await pg.query(
          `insert into file_objects (path, content_type, size_bytes, data, uploaded_by)
           values ($1,$2,$3,$4,$5)
           on conflict (path) do update set data=excluded.data, content_type=excluded.content_type, size_bytes=excluded.size_bytes`,
          [key, contentType, buffer.length, buffer, 'restore-script']
        );
      }
    };
  }

  const { S3Client, PutObjectCommand, HeadObjectCommand } = require(path.join(ROOT, 'node_modules/@aws-sdk/client-s3'));
  const bucket = process.env.AWS_S3_BUCKET || '';
  if (!bucket) {
    console.error('FILE_STORAGE=s3 but AWS_S3_BUCKET is not set.');
    process.exit(1);
  }
  const s3 = new S3Client({
    region: process.env.AWS_S3_REGION || process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
    }
  });
  return {
    label: `s3://${bucket}`,
    async has(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    async put(key, buffer, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType, ContentLength: buffer.length }));
    }
  };
}

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  const destination = makeDestination(pg);
  console.log(`Destination: ${destination.label}`);
  console.log(`Restoring: ${ONLY === 'all' ? 'every attachment' : ONLY === 'bills' ? 'reimbursement bills only' : 'business cards only'}\n`);

  console.log('Scanning the database for referenced attachments…');
  const keys = await collectKeys(pg);
  console.log(`Found ${keys.size} distinct file(s) referenced.\n`);
  if (!keys.size) {
    await pg.end();
    return;
  }

  if (!APPLY) {
    console.log('DRY RUN — nothing will be copied. Re-run with --apply to perform the copy.\n');
    let shown = 0;
    for (const [key, origin] of keys) {
      if (shown++ < 10) console.log(`  would restore  ${key}   (from ${origin})`);
    }
    if (keys.size > 10) console.log(`  …and ${keys.size - 10} more`);
    await pg.end();
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '', {
    auth: { persistSession: false }
  });

  let copied = 0;
  let skipped = 0;
  let missing = 0;
  let failed = 0;

  for (const [key, origin] of keys) {
    if (await destination.has(key)) {
      skipped++;
      continue;
    }

    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(key);
    if (error || !data) {
      const why = error ? error.message : 'no data';
      if (/not found|does not exist/i.test(why)) {
        missing++;
        console.log(`  MISSING in Supabase  ${key}  (${origin})`);
      } else {
        failed++;
        console.log(`  FAILED to read  ${key}: ${why}`);
      }
      continue;
    }

    try {
      const buffer = Buffer.from(await data.arrayBuffer());
      await destination.put(key, buffer, data.type || 'application/octet-stream');
      copied++;
      if (copied % 25 === 0) console.log(`  …${copied} restored so far`);
    } catch (e) {
      failed++;
      console.log(`  FAILED to write  ${key}: ${e.name} ${e.message}`);
    }
  }

  console.log(`\nDone. restored ${copied}, already present ${skipped}, missing in Supabase ${missing}, failed ${failed}.`);
  console.log('Stored URLs were not modified — they point at app routes, so restored files are reachable immediately.');
  await pg.end();
})();
