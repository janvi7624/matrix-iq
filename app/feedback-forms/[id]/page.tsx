import type { Metadata } from 'next';
import FeedbackFormFillView from '@/components/FeedbackFormFillView';

export const metadata: Metadata = { title: 'Feedback form' };

// Open to any signed-in internal user — the whole point is colleagues other
// than the form's owner can fill it out. The [id] route itself checks the
// form exists / is open.
export default async function FeedbackFormFillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FeedbackFormFillView formId={id} />;
}
