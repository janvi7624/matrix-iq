import type { Metadata } from 'next';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerProjectsView from '@/components/PartnerProjectsView';

export const metadata: Metadata = { title: 'My Leads / Projects' };

export default async function PartnerProjectsPage() {
  const viewer = await requirePartnerPage('partner-projects');
  return <PartnerProjectsView viewerName={viewer.name} partner={viewer.partner} />;
}
