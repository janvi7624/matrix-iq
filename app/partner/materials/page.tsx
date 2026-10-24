import type { Metadata } from 'next';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerMaterialsView from '@/components/PartnerMaterialsView';

export const metadata: Metadata = { title: 'Marketing Materials' };

export default async function PartnerMaterialsPage() {
  const viewer = await requirePartnerPage('partner-materials');
  return <PartnerMaterialsView partner={viewer.partner} />;
}
