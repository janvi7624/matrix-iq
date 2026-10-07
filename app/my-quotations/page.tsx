import { redirect } from 'next/navigation';

// Merged into /quotation (see components/QuotationsView.tsx) — kept as a
// redirect so any existing bookmark/link (including the Dashboard's
// ?highlight= row-scroll links) still lands on the right tab with its param intact.
export default async function MyQuotationsPage({ searchParams }: { searchParams: Promise<{ highlight?: string }> }) {
  const { highlight } = await searchParams;
  redirect(`/quotation?tab=existing${highlight ? `&highlight=${encodeURIComponent(highlight)}` : ''}`);
}
