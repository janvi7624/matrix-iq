import type { Metadata } from 'next';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerDashboardView from '@/components/PartnerDashboardView';

export const metadata: Metadata = { title: 'Partner Dashboard' };

export default async function PartnerHomePage() {
  // Guards the page AND resolves the viewer in one call — see
  // lib/partnerPageGuard.ts. 'partner-dashboard' is the Module Manager key,
  // so switching the tile off genuinely closes the page rather than just
  // unlinking it.
  const viewer = await requirePartnerPage('partner-dashboard');
  return <PartnerDashboardView viewerName={viewer.name} partner={viewer.partner} />;
}
