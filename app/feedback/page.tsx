import type { Metadata } from 'next';
import FeedbackView from '@/components/FeedbackView';

export const metadata: Metadata = { title: 'Your Feedback' };

// Open to every signed-in member of staff — this is the one module that is
// deliberately not role-restricted, because the whole point is to hear from
// everybody. What each person is ASKED about is still scoped to their own
// role and department (see app/api/feedback/route.ts).
//
// The page itself stays reachable after the collection window closes and
// renders a "closed" message instead of the form, so a bookmark or the link
// in the announcement email lands somewhere that explains itself rather
// than on a 404.
export default function FeedbackPage() {
  return <FeedbackView />;
}
