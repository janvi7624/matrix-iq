import { db } from './db';
import { listAllFeedback } from './feedbackStore';
import { isFeedbackWindowOpen, feedbackWindowLastDayLabel, feedbackDaysRemaining } from './feedbackWindow';
import { listUsers } from './userStore';
import { listPartnerUserIds } from './partnerUserStore';

// The staff feedback drive is feedback on MatrixIQ itself, so the Product
// Manager of the "MatrixIQ" product reads it alongside the admins, with names
// (decided 18 Nov 2026). Matched by product name, so reassigning the
// product's manager in Products hands the feedback over with it.
export const MATRIXIQ_PRODUCT_NAME = 'MatrixIQ';

export async function managesMatrixIqProduct(userId: string): Promise<boolean> {
  if (!userId) return false;
  const count = await db.Product.count({ where: { name: MATRIXIQ_PRODUCT_NAME, managerId: userId } as never });
  return count > 0;
}

/** Every staff feedback response plus take-up figures, as the admin Feedback screen shows them. */
export async function buildStaffFeedbackReport() {
  const responses = await listAllFeedback();
  // Partner-portal accounts are external and were never asked, so they stay
  // out of the "of N eligible" denominator.
  const [users, partnerIds] = await Promise.all([listUsers(), listPartnerUserIds()]);
  const eligible = users.filter((u) => u.status === 'active' && !partnerIds.has(u.id));
  const respondedUsernames = new Set(responses.map((r) => r.username));
  return {
    open: isFeedbackWindowOpen(),
    lastDay: feedbackWindowLastDayLabel(),
    daysRemaining: feedbackDaysRemaining(),
    total: responses.length,
    eligible: eligible.length,
    pending: eligible
      .filter((u) => !respondedUsernames.has(u.username))
      .map((u) => ({ username: u.username, name: u.name, department: u.department }))
      .sort((a, b) => (a.department || '').localeCompare(b.department || '') || a.name.localeCompare(b.name)),
    responses
  };
}
