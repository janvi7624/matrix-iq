import type { Metadata } from 'next';
import { requirePartnerPage } from '@/lib/partnerPageGuard';
import PartnerProjectDetailView from '@/components/PartnerProjectDetailView';

export const metadata: Metadata = { title: 'Project progress' };

export default async function PartnerProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // The guard resolves the partner; the ROUTE never trusts the id in the URL
  // — /api/partner/projects/[id] scopes its query by partnerId, so another
  // partner's id simply 404s. See lib/partnerProjectStore.ts.
  const viewer = await requirePartnerPage('partner-projects');
  const { id } = await params;
  return <PartnerProjectDetailView projectId={id} partner={viewer.partner} />;
}
