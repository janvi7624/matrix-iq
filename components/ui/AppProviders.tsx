'use client';

import { ToastProvider } from './ToastProvider';
import { ConfirmProvider } from './ConfirmDialog';
import { PromptProvider } from './PromptDialog';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <PromptProvider>{children}</PromptProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
