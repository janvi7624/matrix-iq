import type { Metadata } from 'next';
import ProductManagerView from '@/components/ProductManagerView';

export const metadata: Metadata = { title: 'My Products' };

// Open to every signed-in user — ownership is just Product.createdBy, not a
// separate role, so there's nothing to gate on here. Someone who has
// created nothing just sees an empty state (see app/api/product-manager/route.ts).
export default function ProductManagerPage() {
  return <ProductManagerView />;
}
