'use client';

import { useState } from 'react';
import AppShell from './AppShell';
import GeneralTaskDetailPanel from './GeneralTaskDetailPanel';

interface MyTaskDetailViewProps {
  taskId: string;
  currentUser: { username: string; name: string };
}

// Thin AppShell wrapper around the shared GeneralTaskDetailPanel (the actual
// detail/workflow-action UI, reused unchanged by Task Planner's drawer) —
// keeps this route's page chrome (back link, browser-tab-worthy title) while
// the real content lives in one place.
export default function MyTaskDetailView({ taskId, currentUser }: MyTaskDetailViewProps) {
  void currentUser;
  const [header, setHeader] = useState({ title: 'Task', subtitle: '' });

  return (
    <AppShell title={header.title} subtitle={header.subtitle} showBackLink>
      <GeneralTaskDetailPanel taskId={taskId} onTitleChange={(title, subtitle) => setHeader({ title, subtitle })} />
    </AppShell>
  );
}
