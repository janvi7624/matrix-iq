import type { Metadata } from 'next';
import PricingPage from '@/components/landing/PricingPage';

// Rendered per request for the same CDN-caching reason as app/login/page.tsx:
// a year-long cached copy would point at build chunks a later deploy removed.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Plans and pricing for organizations using the platform — priced by users, storage and modules.',
};

export default function Pricing() {
  return <PricingPage />;
}
