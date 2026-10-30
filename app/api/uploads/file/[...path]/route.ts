import { getFile } from '@/lib/fileStorage';
import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { partnerMayReadUpload } from '@/lib/partnerUploads';
import { partnerMayReadMaterialFile } from '@/lib/partnerMaterialStore';

// Authenticated read-through proxy for generic attachments — see
// app/api/uploads/route.ts. Same pattern as /api/site-visits/image/[...path].
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const viewer = await getViewerContext(request, { allowPartner: true });
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { path } = await params;
  const pathname = path.join('/');

  // This route authenticates but — until partners existed — never checked
  // ownership, because any employee may read any company attachment. An
  // external partner may read only their own prefix, or Partner A could pull
  // Partner B's documents by iterating a path. Internal access is unchanged.
  //
  // A second, separate carve-out: a Marketing Material uploaded directly
  // (not pasted as a Drive/external link) lives under an INTERNAL path —
  // Marketing staff uploaded it, not the partner — so it would never match
  // partnerMayReadUpload's own-prefix rule even once "Share with partners"
  // is ticked. partnerMayReadMaterialFile re-checks it against the actual
  // publication rule instead of the ownership-by-prefix one.
  if (viewer.partnerId && !partnerMayReadUpload(pathname, viewer.partnerId) && !(await partnerMayReadMaterialFile(pathname, viewer.partnerId))) {
    // 404, not 403: a 403 would confirm the file exists.
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  try {
    const result = await getFile(pathname);
    if (!result) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    // no-transform asks the hosting CDN not to re-encode these files (live
    // turns .jpg/.png URLs into WebP) — they're bills and documents, which
    // should reach the user byte-for-byte as uploaded.
    return new NextResponse(result.blob, {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'private, max-age=86400, no-transform'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
