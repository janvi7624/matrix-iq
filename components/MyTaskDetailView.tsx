'use client';

import { useState } from 'react';
import AppShell from './AppShell';
import GeneralTaskDetailPanel from './GeneralTaskDetailPanel';
import PageBackButton from './ui/PageBackButton';

interface MyTaskDetailViewProps {
  taskId: string;
  currentUser: { username: string; name: string };
}

// Thin AppShell wrapper around the shared GeneralTaskDetailPanel (the actual
// detail/workflow-action UI, reused unchanged by Task Planner's drawer) —
// keeps this route's page chrome (in-page back button, browser-tab-worthy title) while
// the real content lives in one place.
export default function MyTaskDetailView({ taskId, currentUser }: MyTaskDetailViewProps) {
  void currentUser;
  const [header, setHeader] = useState({ title: 'Task', subtitle: '' });

  return (
    <AppShell title={header.title} subtitle={header.subtitle}>
      {/* Back lives here rather than inside GeneralTaskDetailPanel, which is
          also rendered in Task Planner's drawer where a back button is wrong. */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <PageBackButton fallbackRoute="/my-tasks" />
      </div>
      <GeneralTaskDetailPanel taskId={taskId} onTitleChange={(title, subtitle) => setHeader({ title, subtitle })} />
    </AppShell>
  );
}
