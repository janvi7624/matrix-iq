import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';

// This project's Blob store is locked to private access (same as the JSON
// data blobs), so images are uploaded private too and served back through
// the authenticated proxy at /api/site-visits/image/[...path] rather than
// via a directly-public URL.
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await request.formData();
    const files = formData.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

    const urls: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        return NextResponse.json({ error: `${file.name} is not an image` }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${file.name} is larger than 8MB` }, { status: 400 });
      }
      const pathname = `site-visit-images/${viewer.username}/${Date.now()}-${file.name}`;
      const blob = await put(pathname, file, { access: 'private', addRandomSuffix: true });
      urls.push(`/api/site-visits/image/${blob.pathname.split('/').map(encodeURIComponent).join('/')}`);
    }

    return NextResponse.json({ urls });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
