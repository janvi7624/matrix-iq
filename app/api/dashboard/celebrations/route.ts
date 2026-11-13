import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { processTodaysCelebrations, shouldShowCelebrationsPopup } from '@/lib/celebrationStore';
import { processTodaysFestival } from '@/lib/festivalStore';
import { triggerFestivalCampaignSweep } from '@/lib/festivalCampaignStore';
import { apiErrorResponse } from '@/lib/apiError';

// No cron/scheduler exists anywhere in this app — this GET is what actually
// triggers today's celebration emails, the first time ANY logged-in user's
// dashboard loads that day (processTodaysCelebrations() is idempotent per
// celebrant per day, so the 2nd/3rd/... dashboard load that day is a no-op
// beyond re-fetching the list for the popup).
//
// processTodaysFestival() (lib/festivalStore.ts) rides the same trigger —
// a company-wide Indian festival greeting, keyed off a fixed yearly
// calendar rather than a per-user field, idempotent per festival per day
// the same way.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Client festival campaign (banner request / festival-day send) — fire
  // and forget, throttled; see lib/festivalCampaignStore.ts.
  triggerFestivalCampaignSweep();

  try {
    const [celebrations, festival] = await Promise.all([processTodaysCelebrations(), processTodaysFestival()]);
    // Emails/announcements above still fire regardless — only the popup
    // itself is capped, per viewer, at a few appearances per day.
    const hasAnything = celebrations.length > 0 || !!festival;
    const showPopup = hasAnything && (await shouldShowCelebrationsPopup(viewer.userId));
    return NextResponse.json({
      celebrations: showPopup ? celebrations : [],
      festival: showPopup ? festival : null
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
