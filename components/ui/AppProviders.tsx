'use client';

// Side-effect import: joins identical concurrent GET /api/... requests app-wide
// (see the file). Imported here because AppProviders wraps every page from the
// root layout, so it is installed before any page component fetches.
import '@/lib/fetchDedupe';
import { ToastProvider } from './ToastProvider';
import { ConfirmProvider } from './ConfirmDialog';
import { PromptProvider } from './PromptDialog';
import { ProjectQuickCreateProvider } from './ProjectQuickCreateDialog';
import ResponsiveTables from './ResponsiveTables';
import TableScrollHints from './TableScrollHints';
import AutoGrowTextareas from './AutoGrowTextareas';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <PromptProvider>
          <ProjectQuickCreateProvider>
            {children}
            {/* Phone card layout for tables — labels cells from their headers. */}
            <ResponsiveTables />
            {/* "Scroll for more columns" cues + pinned-column shadow on wide tables. */}
            <TableScrollHints />
            {/* Text boxes grow with what you type, up to 6 lines, then scroll inside. */}
            <AutoGrowTextareas />
          </ProjectQuickCreateProvider>
        </PromptProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
