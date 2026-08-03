'use client';

import { ToastProvider } from './ToastProvider';
import { ConfirmProvider } from './ConfirmDialog';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
