import type { Metadata } from 'next';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerQuotationsView from '@/components/PartnerQuotationsView';

export const metadata: Metadata = { title: 'Quotations' };

export default async function PartnerQuotationsPage() {
  const viewer = await requirePartnerPage('partner-quotations');
  return <PartnerQuotationsView partner={viewer.partner} />;
}
