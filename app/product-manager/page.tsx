import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { isProductManager } from '@/lib/productManagerStore';
import ProductManagerView from '@/components/ProductManagerView';

export const metadata: Metadata = { title: 'My Products' };

// Product Managers only — anyone managing at least one product
// (lib/productManagerStore.ts's isProductManager). Everyone else is sent
// back to the dashboard; the sidebar tile is hidden for them too
// (lib/moduleConfigStore.ts), and the API refuses them.
export default async function ProductManagerPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');
  if (!(await isProductManager(session.sub))) redirect('/');
  return <ProductManagerView />;
}
