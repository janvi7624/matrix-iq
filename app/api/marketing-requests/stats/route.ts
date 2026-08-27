import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager, isModuleActionAllowed } from '@/lib/permissions';
import { apiErrorResponse } from '@/lib/apiError';
import { isMarketingRequestOpen, summarizeMarketingReminders } from '@/lib/marketingRequestReminder';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const isReviewer = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'approve'));
    const isTechnical = viewer.role === 'engineer' || viewer.isPrivileged;
    const records = await marketingRequestStore.list(viewer.username, isReviewer || isTechnical);

    const awaitingMarketing = records.filter(
      (r) => r.status === 'submitted' || r.status === 'marketing_in_progress' || r.status === 'tech_changes_requested'
    ).length;
    const pendingTechnical = records.filter((r) => r.status === 'pending_technical_review').length;
    const readyForDelivery = records.filter((r) => r.status === 'technical_approved' || r.status === 'marketing_final_review').length;

    const myPendingTechnical = records.filter(
      (r) => r.status === 'pending_technical_review' && (r.technical_member_username === viewer.username || isTechnical)
    ).length;

    const myOpenCount = records.filter((r) => r.created_by === viewer.username && isMarketingRequestOpen(r.status)).length;
    const reminderBreakdown = summarizeMarketingReminders(records);

    return NextResponse.json({
      isReviewer,
      isTechnical,
      awaitingReview: records.filter((r) => r.status === 'submitted').length,
      awaitingMarketing,
      pendingTechnical,
      readyForDelivery,
      myPendingTechnical,
      myOpenCount,
      reminderBreakdown
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
