import { redirect } from 'next/navigation';

// Merged into /quotation as its third tab (see components/QuotationsView.tsx)
// — kept as a redirect so the sidebar entry, notification links and any
// bookmark still land on the right tab with ?highlight= intact. Same
// arrangement as /my-quotations.
export default async function QuotationRequestsPage({
  searchParams
}: {
  searchParams: Promise<{ highlight?: string }>;
}) {
  const { highlight } = await searchParams;
  redirect(`/quotation?tab=partner-requests${highlight ? `&highlight=${encodeURIComponent(highlight)}` : ''}`);
}
