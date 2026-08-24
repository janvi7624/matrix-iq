import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import TravelScheduleDetailView from '@/components/TravelScheduleDetailView';

export default async function TravelScheduleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const [user, isPrivileged] = await Promise.all([
    findUserById(session.sub),
    resolveIsPrivileged(session.role)
  ]);
  if (!user) redirect('/login');

  const { id } = await params;
  return (
    <TravelScheduleDetailView
      requestId={id}
      currentUser={{ id: user.id, username: user.username, role: user.role, isPrivileged }}
    />
  );
}
