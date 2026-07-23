import { get, put } from '@vercel/blob';

// Vercel's serverless functions have a read-only filesystem, so plain
// fs.writeFileSync (the local-dev approach) throws in production. This keeps
// the same "whole JSON file, read-modify-write" shape but backs it with
// Vercel Blob storage instead of local disk. Requires BLOB_READ_WRITE_TOKEN
// (added automatically when you create a Blob store and link it to the
// project) both on Vercel and in local .env for `npm run dev`.

export async function readJsonBlob<T>(pathname: string, fallback: T): Promise<T> {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return fallback;
  const text = await new Response(result.stream).text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonBlob<T>(pathname: string, data: T): Promise<void> {
  await put(pathname, JSON.stringify(data, null, 2) + '\n', {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true
  });
}
