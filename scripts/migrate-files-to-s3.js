'use strict';

/*
 * Moves every file currently held in the database (file_objects) into the S3
 * bucket, under the SAME key.
 *
 * Run this BEFORE switching FILE_STORAGE to s3. Both backends address a file
 * by the same key, and the stored URLs are app routes (/api/uploads/file/<key>)
 * rather than provider URLs — so once a file is in the bucket, its existing
 * link keeps working and nothing in the database needs rewriting. Skip this
 * step and any file uploaded while the database backend was active becomes
 * unreachable the moment the switch is flipped.
 *
 *   node scripts/migrate-files-to-s3.js            # report only, copies nothing
 *   node scripts/migrate-files-to-s3.js --apply    # copy into the bucket
 *   node scripts/migrate-files-to-s3.js --apply --prune
 *                                                  # ...and delete the rows it
 *                                                  # has verified are in S3
 *
 * Safe to re-run. A key already present in the bucket is skipped. Nothing is
 * deleted from the database unless --prune is given, and then only after the
 * copy has been read back from S3 and byte-compared.
 */

const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env.local'), quiet: true });

const { Client } = require(path.join(ROOT, 'node_modules/pg'));
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require(path.join(ROOT, 'node_modules/@aws-sdk/client-s3'));

const APPLY = process.argv.includes('--apply');
const PRUNE = process.argv.includes('--prune');

const BUCKET = process.env.AWS_S3_BUCKET || '';
const REGION = process.env.AWS_S3_REGION || process.env.AWS_REGION || '';
const creds = {
  accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
};

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  if (!BUCKET) {
    console.error('AWS_S3_BUCKET is not set in .env.local — nothing to migrate into.');
    process.exit(1);
  }

  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  const { rows: summary } = await pg.query('select count(*)::int n, coalesce(sum(size_bytes),0)::bigint b from file_objects');
  const total = summary[0].n;
  console.log(`Destination : s3://${BUCKET} (${REGION})`);
  console.log(`In database : ${total} file(s), ${(Number(summary[0].b) / 1024 / 1024).toFixed(2)} MB\n`);

  if (!total) {
    console.log('Nothing to migrate.');
    await pg.end();
    return;
  }

  if (!APPLY) {
    const { rows } = await pg.query('select path, size_bytes, uploaded_by from file_objects order by created_at limit 10');
    console.log('DRY RUN — nothing will be copied. Re-run with --apply.\n');
    for (const r of rows) console.log(`  would copy  ${(Number(r.size_bytes) / 1024).toFixed(0).padStart(6)} KB  ${r.path}`);
    if (total > 10) console.log(`  …and ${total - 10} more`);
    await pg.end();
    return;
  }

  const s3 = new S3Client({ region: REGION, credentials: creds });

  let copied = 0;
  let skipped = 0;
  let failed = 0;
  let pruned = 0;

  // Streamed one at a time rather than loaded together: these rows hold whole
  // files, and pulling them all into memory would be the one way this script
  // could take down the machine it runs on.
  const { rows: keys } = await pg.query('select path from file_objects order by created_at');
  for (const { path: key } of keys) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      skipped++;
      continue;
    } catch {
      // Not in the bucket yet — the normal case.
    }

    try {
      const { rows } = await pg.query('select data, content_type from file_objects where path = $1', [key]);
      if (!rows.length) continue;
      const body = Buffer.isBuffer(rows[0].data) ? rows[0].data : Buffer.from(rows[0].data);
      const contentType = rows[0].content_type || 'application/octet-stream';

      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));

      // Read it back and compare before trusting it. A copy that silently
      // truncated would otherwise only be discovered by whoever opens the bill.
      const back = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const bytes = Buffer.from(await back.Body.transformToByteArray());
      if (sha(bytes) !== sha(body)) {
        failed++;
        console.log(`  MISMATCH after copy — left in the database: ${key}`);
        continue;
      }

      copied++;
      if (PRUNE) {
        await pg.query('delete from file_objects where path = $1', [key]);
        pruned++;
      }
      if (copied % 25 === 0) console.log(`  …${copied} copied`);
    } catch (e) {
      failed++;
      console.log(`  FAILED ${key}: ${e.name} ${e.message}`);
    }
  }

  console.log(`\nDone. copied ${copied}, already in the bucket ${skipped}, failed ${failed}${PRUNE ? `, removed from the database ${pruned}` : ''}.`);
  if (!PRUNE && copied) {
    console.log('The database still holds its copies — re-run with --prune once you are satisfied, or leave them as a fallback.');
  }
  if (failed) {
    console.log('Some files did NOT copy. Do not switch FILE_STORAGE to s3 until that is resolved, or those files will be unreachable.');
    process.exitCode = 1;
  } else {
    console.log('Safe to set FILE_STORAGE=s3 in .env.local.');
  }

  await pg.end();
})();
