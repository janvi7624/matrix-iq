import type { Metadata } from 'next';
import RequestDemoPage from '@/components/landing/RequestDemoPage';

export const metadata: Metadata = {
  title: { absolute: 'Request a demo — MatrixIQ' },
  description:
    'Book a 30-minute MatrixIQ walkthrough. See CRM, AI lead intelligence, quotations, project delivery, partner portal, HR and accounts mapped onto your own workflow.',
  alternates: { canonical: '/request-demo' }
};

export default function Page() {
  return <RequestDemoPage />;
}
