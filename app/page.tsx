import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById, findUserStatusById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import Dashboard from '@/components/Dashboard';
import { PARTNER_HOME } from '@/lib/partnerRoles';
import type { Metadata } from 'next';
import LandingPage from '@/components/landing/LandingPage';
import { SITE } from '@/lib/landingContent';

export const metadata: Metadata = {
  title: { absolute: SITE.seoTitle },
  description: SITE.seoDescription,
  alternates: { canonical: '/' }
};

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: SITE.company,
      url: SITE.url,
      email: SITE.email,
      telephone: SITE.phoneDisplay,
      address: { '@type': 'PostalAddress', streetAddress: SITE.addressLines.slice(0, 2).join(', '), addressLocality: 'Ahmedabad', postalCode: '380015', addressRegion: 'Gujarat', addressCountry: 'IN' }
    },
    {
      '@type': 'SoftwareApplication',
      name: 'MatrixIQ',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Android, iOS, Windows, macOS',
      description: SITE.seoDescription,
      url: SITE.url,
      publisher: { '@type': 'Organization', name: SITE.company }
    }
  ]
};

export default async function Home() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  // Logged out: the public landing page (login lives at /login).
  if (!session) {
    return (
      <>
        <LandingPage />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
      </>
    );
  }

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  // A partner landing on '/' belongs in the portal, not on the internal
  // dashboard.
  //
  // Checked against the LIVE binding rather than session.partnerId. The token
  // claim is what proxy.ts gates on, but a claim can be absent — issued
  // before the account was bound to a partner, or dropped by a token reissue
  // that forgot to carry it forward. This is the one page every session hits
  // first, so it reads the database rather than trusting the cookie.
  const binding = await findUserStatusById(session.sub);
  if (binding?.partnerId) redirect(PARTNER_HOME);

  const isPrivileged = await resolveIsPrivileged(user.role);

  return <Dashboard currentUser={{ id: user.id, username: user.username, name: user.name, role: user.role, department: user.department, designation: user.designation, isPrivileged }} />;
}
