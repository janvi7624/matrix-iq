import { getFile, safeServeHeaders } from '@/lib/fileStorage';
import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { partnerMayReadUpload } from '@/lib/partnerUploads';
import { findMaterialByUploadPath, partnerMayReadMaterialFile } from '@/lib/partnerMaterialStore';
import { stampConfidentialFooter } from '@/lib/materialPdfStamp';

// Content type is the first check; the extension is a fallback for a stored
// file whose type was never recorded (one legacy row has mime_type NULL).
function isPdf(contentType: string, pathname: string): boolean {
  return contentType.toLowerCase().includes('pdf') || /\.pdf$/i.test(pathname);
}

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
    // Marketing Materials — and ONLY those — carry the confidentiality
    // footer. This route also serves bills, PO scans and installation
    // photos; stamping a supplier's invoice "not for distribution by Nanta
    // Tech" would be both wrong and confusing, so the material lookup is
    // what gates it. A non-PDF, or anything that is not a material, falls
    // straight through to the original bytes below.
    if (isPdf(result.contentType, pathname)) {
      const material = await findMaterialByUploadPath(pathname);
      if (material) {
        const stamped = await stampConfidentialFooter(new Uint8Array(await result.blob.arrayBuffer()), {
          // Partners get the stronger treatment: their copy is the one most
          // likely to be forwarded outside the company, and the recipient
          // line is what makes a leaked copy traceable to the account that
          // pulled it.
          recipient: viewer.partnerId ? `${viewer.name} (partner)` : viewer.name,
          diagonal: Boolean(viewer.partnerId)
        });
        // null means the PDF could not be rewritten — serve it unstamped
        // rather than failing. Sales materials have to open.
        if (stamped) {
          return new NextResponse(Buffer.from(stamped), {
            headers: {
              ...safeServeHeaders(result.contentType, pathname),
              // private + no-store: the footer names the person who
              // downloaded it, so a shared cache must never hand one
              // viewer's stamped copy to somebody else.
              'Cache-Control': 'private, no-store'
            }
          });
        }
      }
    }

    // no-transform asks the hosting CDN not to re-encode these files (live
    // turns .jpg/.png URLs into WebP) — they're bills and documents, which
    // should reach the user byte-for-byte as uploaded.
    return new NextResponse(result.blob, {
      headers: {
        ...safeServeHeaders(result.contentType, pathname),
        'Cache-Control': 'private, max-age=86400, no-transform'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
