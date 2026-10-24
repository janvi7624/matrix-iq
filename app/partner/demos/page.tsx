import type { Metadata } from 'next';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerDemosView from '@/components/PartnerDemosView';

export const metadata: Metadata = { title: 'Demo Requests' };

export default async function PartnerDemosPage() {
  const viewer = await requirePartnerPage('partner-demos');
  return <PartnerDemosView partner={viewer.partner} />;
}
