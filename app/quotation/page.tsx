import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { canEditQuotationPricing, resolveIsPrivileged } from '@/lib/permissions';
import QuotationsView from '@/components/QuotationsView';

export default async function QuotationPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);
  // Not the same question as isPrivileged any more: pricing is grantable on
  // its own through Role Management's quotation.manage switch, so a Sales
  // manager can discount without also getting the admin panel. Falls back to
  // isPrivileged for any role with no override, so this is a no-op for every
  // role that existed before the switch — see canEditQuotationPricing.
  const canEditPricing = await canEditQuotationPricing({ role: user.role, isPrivileged });

  return (
    <Suspense fallback={null}>
      <QuotationsView
        currentUser={{ id: user.id, username: user.username, name: user.name, phone: user.phone, email: user.email, role: user.role }}
        canEditPricing={canEditPricing}
        isPrivileged={isPrivileged}
      />
    </Suspense>
  );
}
