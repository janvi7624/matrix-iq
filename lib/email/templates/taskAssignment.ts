import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

export interface TaskAssignmentEmailData {
  name: string;
  taskName: string;
  departmentName: string;
  assignedBy: string;
  deadline: string; // YYYY-MM-DD, same raw format the in-app notification already uses
  priority?: string;
  tasksUrl: string;
}

export function renderTaskAssignmentEmail(data: TaskAssignmentEmailData): RenderedEmail {
  const appName = BRAND.appName;
  const subject = `Task Assigned to You — ${data.taskName}`;
  const intro = `This task has been assigned to you and needs to be completed by ${data.deadline}.`;

  const detailLines = [
    `Task: ${data.taskName}`,
    `Department: ${data.departmentName}`,
    `Assigned By: ${data.assignedBy}`,
    `Deadline: ${data.deadline}`,
    ...(data.priority ? [`Priority: ${data.priority}`] : [])
  ];

  const text = [
    `Hello ${data.name},`,
    '',
    intro,
    '',
    ...detailLines,
    '',
    `View task: ${data.tasksUrl}`,
    '',
    'Regards,',
    `${appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(intro)}</p>
                ${renderInfoBox(detailLines.map((line) => `<p style="margin:0 0 6px; font-size:14px; color:#111827;">${escapeHtml(line)}</p>`).join(''))}
                ${renderButton(data.tasksUrl, 'View Task', '#2563eb')}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
