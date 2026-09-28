import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { QueryTypes } from 'sequelize';
import { sequelize } from './db';

// Attachment storage — bills, business cards, PO documents, demo reports.
//
// Replaces the previous Supabase Storage bucket, whose project stopped
// existing: uploads failed with undici's bare "fetch failed" and every
// already-uploaded file became unreachable.
//
// TWO BACKENDS, one interface:
//   database (default) — bytes in file_objects on our own Postgres. Nothing
//                        extra to run, pay for or authorise; included in the
//                        database backup; works the moment the migration is
//                        applied.
//   s3                 — set FILE_STORAGE=s3 with AWS_S3_BUCKET. Better once
//                        attachments get large, since it keeps the database
//                        small, but it needs a bucket and an IAM policy.
// Switching is one environment variable, and both write the SAME key, so a
// file's stored URL does not change if the backend does.
//
// The security model is unchanged and deliberate for both: storage is PRIVATE
// and nothing here ever produces a public or presigned URL. Files come back
// only through the app's own authenticated routes (/api/uploads/file/...),
// which check the session first. These are employees' expense bills — do not
// swap in public links without revisiting that.

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export type StorageBackend = 'database' | 's3';

// Explicit rather than inferred: a half-set AWS variable should not silently
// change where this company's bills are written.
export function storageBackend(): StorageBackend {
  return (process.env.FILE_STORAGE || '').trim().toLowerCase() === 's3' ? 's3' : 'database';
}

function unavailable(message: string): never {
  throw new StorageUnavailableError(message);
}

/* ------------------------------ database ------------------------------ */

// Raw SQL rather than a Sequelize model on purpose: this is the one table
// whose rows are multi-megabyte binaries, and a model would invite the rest
// of the app to SELECT it by accident.
async function dbPut(pathname: string, bytes: Buffer, contentType: string, uploadedBy: string): Promise<void> {
  try {
    await sequelize.query(
      `INSERT INTO file_objects (path, content_type, size_bytes, data, uploaded_by)
       VALUES ($path, $contentType, $size, $data, $uploadedBy)
       ON CONFLICT (path) DO UPDATE
         SET data = EXCLUDED.data,
             content_type = EXCLUDED.content_type,
             size_bytes = EXCLUDED.size_bytes`,
      {
        // Upsert mirrors the previous backend's upsert:true, so a retried
        // upload replaces rather than colliding.
        bind: { path: pathname, contentType, size: bytes.byteLength, data: bytes, uploadedBy: uploadedBy || null },
        type: QueryTypes.INSERT
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[storage] database write failed for ${pathname}: ${message}`, error);
    if (/relation "?file_objects"? does not exist/i.test(message)) {
      unavailable('File storage is not set up on this server yet — the attachments table is missing. Please report this to IT.');
    }
    unavailable('Attachments cannot be saved right now — the database rejected the file. Please report this to IT.');
  }
}

async function dbGet(pathname: string): Promise<{ blob: Blob; contentType: string } | null> {
  try {
    const rows = await sequelize.query<{ data: Buffer; content_type: string }>(
      `SELECT data, content_type FROM file_objects WHERE path = $path LIMIT 1`,
      { bind: { path: pathname }, type: QueryTypes.SELECT }
    );
    const row = rows[0];
    // A file that genuinely is not here stays a 404 for the caller.
    if (!row) return null;
    const contentType = row.content_type || 'application/octet-stream';
    const bytes = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
    return { blob: new Blob([new Uint8Array(bytes)], { type: contentType }), contentType };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[storage] database read failed for ${pathname}: ${message}`, error);
    if (/relation "?file_objects"? does not exist/i.test(message)) {
      unavailable('File storage is not set up on this server yet — the attachments table is missing. Please report this to IT.');
    }
    // An unreachable database is NOT a missing file: returning null would show
    // every existing attachment as individually deleted and hide the outage.
    unavailable('This attachment cannot be fetched right now — the file store is not reachable. Please report this to IT.');
  }
}

/* --------------------------------- s3 --------------------------------- */

const BUCKET = process.env.AWS_S3_BUCKET || '';
const REGION = process.env.AWS_S3_REGION || process.env.AWS_REGION || '';
const ACCESS_KEY_ID = process.env.AWS_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY = process.env.AWS_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({ region: REGION, credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY } });
  }
  return client;
}

function assertS3Configured(): void {
  const missing = [
    !BUCKET && 'AWS_S3_BUCKET',
    !REGION && 'AWS_S3_REGION (or AWS_REGION)',
    !ACCESS_KEY_ID && 'AWS_S3_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID)',
    !SECRET_ACCESS_KEY && 'AWS_S3_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY)'
  ].filter(Boolean);
  if (missing.length) {
    console.error(`[storage] FILE_STORAGE=s3 but configuration is incomplete — missing: ${missing.join(', ')}`);
    unavailable('File storage is not configured on this server. Please report this to IT.');
  }
}

function isMissingObject(error: { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }): boolean {
  return error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.Code === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
}

function asS3Error(error: unknown, action: string): never {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string }; $metadata?: { httpStatusCode?: number } };
  const detail = err?.cause?.code || err?.cause?.message || err?.message || String(error);
  console.error(`[storage] could not ${action} s3://${BUCKET} in ${REGION}: ${err?.name || ''} ${detail}`, error);
  // A permissions problem is worth separating: it is the difference between
  // "retry later" and "someone must fix the IAM policy".
  const isAuth = err?.name === 'AccessDenied' || err?.$metadata?.httpStatusCode === 403 || /InvalidAccessKeyId|SignatureDoesNotMatch/.test(err?.name || '');
  unavailable(
    isAuth
      ? 'Attachments cannot be saved right now — this server is not permitted to use the file store. Please report this to IT.'
      : 'Attachments cannot be saved right now — the file storage service is not reachable. Please report this to IT; the server log names the bucket.'
  );
}

async function s3Put(pathname: string, bytes: Buffer, contentType: string): Promise<void> {
  assertS3Configured();
  try {
    await s3().send(
      new PutObjectCommand({ Bucket: BUCKET, Key: pathname, Body: bytes, ContentType: contentType, ContentLength: bytes.byteLength })
    );
  } catch (error) {
    asS3Error(error, 'upload to');
  }
}

async function s3Get(pathname: string): Promise<{ blob: Blob; contentType: string } | null> {
  assertS3Configured();
  try {
    const result = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: pathname }));
    if (!result.Body) return null;
    const bytes = await result.Body.transformToByteArray();
    const contentType = result.ContentType || 'application/octet-stream';
    return { blob: new Blob([new Uint8Array(bytes)], { type: contentType }), contentType };
  } catch (error) {
    if (isMissingObject(error as Record<string, never>)) return null;
    asS3Error(error, 'download from');
  }
}

/* ------------------------------ public API ---------------------------- */

// `uploadedBy` is optional so existing call sites keep working unchanged; the
// database backend records it when given.
export async function putFile(pathname: string, file: File, uploadedBy = ''): Promise<{ pathname: string }> {
  // Buffered rather than streamed on purpose: the routes cap uploads at 10MB,
  // and both backends want a known length.
  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || 'application/octet-stream';
  if (storageBackend() === 's3') await s3Put(pathname, bytes, contentType);
  else await dbPut(pathname, bytes, contentType, uploadedBy);
  return { pathname };
}

export async function getFile(pathname: string): Promise<{ blob: Blob; contentType: string } | null> {
  return storageBackend() === 's3' ? s3Get(pathname) : dbGet(pathname);
}
