import { putFile } from '@/lib/supabaseStorage';
import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';

// Generic attachment upload used by the project-pipeline modules (Demo
// report attachments, PO documents, installation completion reports/client
// signature) — same private-blob + authenticated-proxy pattern as
// /api/site-visits/upload, but accepts any file type, not just images.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await request.formData();
    const folder = typeof formData.get('folder') === 'string' ? String(formData.get('folder')).replace(/[^a-z0-9_-]/gi, '') || 'misc' : 'misc';
    const files = formData.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

    const urls: string[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${file.name} is larger than 10MB` }, { status: 400 });
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const pathname = `uploads/${folder}/${viewer.username}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
      const { pathname: stored } = await putFile(pathname, file);
      urls.push(`/api/uploads/file/${stored.split('/').map(encodeURIComponent).join('/')}`);
    }

    return NextResponse.json({ urls });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
