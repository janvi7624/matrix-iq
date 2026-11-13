import { NextRequest, NextResponse } from 'next/server';
import { getFile, safeServeHeaders } from '@/lib/fileStorage';
import { isUuid } from '@/lib/db';
import { approvedBannerPath } from '@/lib/festivalCampaignStore';

// PUBLIC (no session) — a client's mail app has to load the banner. Serves
// exactly one file: the banner of a campaign a human has APPROVED, looked up
// by the campaign's random UUID. The file path is never a URL parameter, so
// this cannot be used to read any other upload; before approval it is a 404.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const path = await approvedBannerPath(id);
    if (!path) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const file = await getFile(path);
    if (!file || !file.contentType.startsWith('image/')) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(file.blob, {
      headers: { ...safeServeHeaders(file.contentType, path), 'Cache-Control': 'public, max-age=86400, no-transform' }
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
