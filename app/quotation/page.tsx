import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import QuotationCalculator from '@/components/QuotationCalculator';

export default async function QuotationPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);

  return (
    <QuotationCalculator
      currentUser={{ username: user.username, name: user.name, phone: user.phone, email: user.email, role: user.role }}
      canEditPricing={isPrivileged}
      isPrivileged={isPrivileged}
    />
  );
}
