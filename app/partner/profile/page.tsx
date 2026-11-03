import type { Metadata } from 'next';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerProfileView from '@/components/PartnerProfileView';

export const metadata: Metadata = { title: 'Company Profile' };

export default async function PartnerProfilePage() {
  const viewer = await requirePartnerPage('partner-profile');
  return <PartnerProfileView companyName={viewer.partner.company_name} partnerCode={viewer.partner.partner_code} />;
}
