import { createClient } from '@supabase/supabase-js';

// Server-only client using the service-role key — files are stored in a
// private bucket and only ever served through an authenticated server route,
// never a public bucket URL. Never import this from client components.
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '', {
  auth: { persistSession: false }
});

const BUCKET = 'app-files';

export async function putFile(pathname: string, file: File): Promise<{ pathname: string }> {
  const { error } = await supabase.storage.from(BUCKET).upload(pathname, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true
  });
  if (error) throw error;
  return { pathname };
}

export async function getFile(pathname: string): Promise<{ blob: Blob; contentType: string } | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(pathname);
  if (error || !data) return null;
  return { blob: data, contentType: data.type || 'application/octet-stream' };
}
