import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import AppShell from './AppShell';
import EmptyState from './ui/EmptyState';
import { BRAND } from '@/lib/branding';

interface AccessDeniedProps {
  title: string;
  message: string;
}

// What a page renders when the viewer is signed in but not allowed to see
// it. The alternative — redirect('/') — is what Audit Log did, and it is
// indistinguishable from a broken link: the click appears to do nothing, so
// nobody can tell whether the page is restricted or simply broken.
//
// Built on the shared EmptyState inside AppShell, so a denied page still has
// the sidebar and header and the viewer can get somewhere else in one click
// rather than being bounced without explanation.
export default function AccessDenied({ title, message }: AccessDeniedProps) {
  return (
    <AppShell title={title} subtitle={BRAND.tagline} showBackLink>
      <EmptyState
        icon={ShieldAlert}
        title={title}
        message={message}
        action={<Link href="/">Back to Dashboard</Link>}
      />
    </AppShell>
  );
}
