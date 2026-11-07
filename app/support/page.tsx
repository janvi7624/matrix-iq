import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserStatusById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import { canWorkSupportQueue } from '@/lib/supportTicketAccess';
import SupportTicketsView from '@/components/SupportTicketsView';

export const metadata: Metadata = { title: 'Technical Support' };

// Access is STILL enforced by the API (canWorkSupportQueue) — this page does
// not redirect someone who merely has no queue role, and the view still
// shows a clear refusal if the API ever disagrees with what's computed here.
// What's new (OPSQA-DEF-005): computing the same canWorkSupportQueue()
// server-side, once, so a role that can never work the queue (Sales,
// Marketing, Accounts, HR, a raw partner session, etc.) isn't handed a
// client component that unconditionally fires a fetch guaranteed to come
// back 403. The API's own check is unchanged and still the source of truth.
export default async function SupportPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  const status = session ? await findUserStatusById(session.sub) : undefined;
  const canWorkQueue =
    session && status
      ? canWorkSupportQueue({
          userId: status.id,
          username: session.username,
          role: session.role,
          isPrivileged: await resolveIsPrivileged(session.role),
          partnerId: status.partnerId || ''
        })
      : false;

  return <SupportTicketsView canWorkQueue={canWorkQueue} />;
}
