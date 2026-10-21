import type { Metadata } from 'next';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerSupportView from '@/components/PartnerSupportView';

export const metadata: Metadata = { title: 'Technical Support' };

export default async function PartnerSupportPage() {
  const viewer = await requirePartnerPage('partner-support');
  return <PartnerSupportView partner={viewer.partner} />;
}
