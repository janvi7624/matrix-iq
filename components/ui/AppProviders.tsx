'use client';

import { ToastProvider } from './ToastProvider';
import { ConfirmProvider } from './ConfirmDialog';
import { PromptProvider } from './PromptDialog';
import { ProjectQuickCreateProvider } from './ProjectQuickCreateDialog';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <PromptProvider>
          <ProjectQuickCreateProvider>{children}</ProjectQuickCreateProvider>
        </PromptProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
