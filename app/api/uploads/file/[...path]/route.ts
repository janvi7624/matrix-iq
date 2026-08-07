import { getFile } from '@/lib/supabaseStorage';
import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';

// Authenticated read-through proxy for generic attachments — see
// app/api/uploads/route.ts. Same pattern as /api/site-visits/image/[...path].
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { path } = await params;
  const pathname = path.join('/');

  try {
    const result = await getFile(pathname);
    if (!result) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    return new NextResponse(result.blob, {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'private, max-age=86400'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
