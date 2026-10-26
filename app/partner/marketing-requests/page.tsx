import type { Metadata } from 'next';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerMarketingRequestsView from '@/components/PartnerMarketingRequestsView';

export const metadata: Metadata = { title: 'Marketing Requests' };

export default async function PartnerMarketingRequestsPage() {
  const viewer = await requirePartnerPage('partner-marketing-requests');
  return <PartnerMarketingRequestsView partner={viewer.partner} />;
}
