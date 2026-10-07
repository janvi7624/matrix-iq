import { redirect } from 'next/navigation';

// Merged into /admin/products (see components/ProductsAdminView.tsx) — kept
// as a redirect so any existing bookmark/link to this URL still lands on the
// right tab.
export default function ProductCatalogPage() {
  redirect('/admin/products?tab=catalog');
}
