import { Suspense } from 'react';
import ProductsAdminView from '@/components/ProductsAdminView';

export default function ProductsAdminPage() {
  return (
    <Suspense fallback={null}>
      <ProductsAdminView />
    </Suspense>
  );
}
