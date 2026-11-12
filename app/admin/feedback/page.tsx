import type { Metadata } from 'next';
import AdminFeedbackView from '@/components/AdminFeedbackView';

export const metadata: Metadata = { title: 'Staff Feedback' };

// Under /admin/* so it inherits that prefix's existing privilege gate
// (proxy.ts), with the API doing its own isPrivileged check as well. The
// responses name individual colleagues and quote their candid opinions, so
// this is not a screen to leave resting on a single layer of access control.
export default function AdminFeedbackPage() {
  return <AdminFeedbackView />;
}
