import { Suspense } from 'react';
import MyQuotationsView from '@/components/MyQuotationsView';

export default function MyQuotationsPage() {
  return (
    <Suspense fallback={null}>
      <MyQuotationsView />
    </Suspense>
  );
}
