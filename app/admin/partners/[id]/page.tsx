import { use } from 'react';
import PartnerDetailView from '@/components/PartnerDetailView';

// The administrative route to one partner. The screen itself is shared with
// /partners/[id] (the Partner module) — see components/PartnerDetailView.tsx
// on why there is one component rather than two pages.
export default function AdminPartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PartnerDetailView id={id} />;
}
