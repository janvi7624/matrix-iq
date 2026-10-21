import type { Metadata } from 'next';
import SupportTicketDetailView from '@/components/SupportTicketDetailView';

export const metadata: Metadata = { title: 'Support ticket' };

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupportTicketDetailView ticketId={id} />;
}
