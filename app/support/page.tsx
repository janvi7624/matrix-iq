import type { Metadata } from 'next';
import SupportTicketsView from '@/components/SupportTicketsView';

export const metadata: Metadata = { title: 'Technical Support' };

// Access is enforced by the API (canWorkSupportQueue) — the page renders the
// shell and the view shows a clear refusal if the queue returns 403, rather
// than redirecting someone who merely has no queue role.
export default function SupportPage() {
  return <SupportTicketsView />;
}
