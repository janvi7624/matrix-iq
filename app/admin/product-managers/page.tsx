import type { Metadata } from 'next';
import AdminProductManagersView from '@/components/AdminProductManagersView';

export const metadata: Metadata = { title: 'Product Managers' };

// Under /admin/* so it inherits that prefix's privilege gate (proxy.ts),
// with the API doing its own strict admin/superadmin-only check as well —
// "visible to admin and super admin only" means not resting on the generic
// isPrivileged bypass that also covers the 'manager' role.
export default function AdminProductManagersPage() {
  return <AdminProductManagersView />;
}
