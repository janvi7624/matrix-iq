import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export type TaskLifecycleEvent = 'assigned' | 'status_changed';

export interface TaskLifecycleEmailData {
  name: string;
  event: TaskLifecycleEvent;
  taskName: string;
  projectName: string;
  detail?: string;
  tasksUrl: string;
}

const EVENT_COPY: Record<TaskLifecycleEvent, { subject: string; intro: (taskName: string, projectName: string) => string; accentColor: string }> = {
  assigned: {
    subject: 'A Task Was Assigned to You',
    intro: (taskName, projectName) => `You have been assigned the task "${taskName}" on ${projectName}.`,
    accentColor: '#2563eb'
  },
  status_changed: {
    subject: 'Task Status Updated',
    intro: (taskName, projectName) => `The status of "${taskName}" on ${projectName} has changed.`,
    accentColor: '#2563eb'
  }
};

export function renderTaskLifecycleEmail(data: TaskLifecycleEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const copy = EVENT_COPY[data.event];
  const subject = `${copy.subject} — ${data.taskName}`;
  const intro = copy.intro(data.taskName, data.projectName);

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...(data.detail ? [data.detail, ''] : []),
    `View tasks: ${data.tasksUrl}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${data.detail ? renderInfoBox(`<p style="margin:0; font-size:14px; color:#111827;">${escapeHtml(data.detail)}</p>`) : ''}
                ${renderButton(data.tasksUrl, 'View Tasks', copy.accentColor)}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
