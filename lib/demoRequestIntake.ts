import { createOrMergeLead } from './leadStore';
import { listDepartmentManagers } from './departmentStore';
import { findUserById } from './userStore';
import { logAudit } from './auditLogStore';
import { notifyUsers } from './notificationStore';
import { sendEmail } from './email/emailService';
import { escapeHtml, renderEmailShell, renderHeadline, renderInfoBox } from './email/templates/layout';
import { SITE } from './landingContent';

// Public "Request a demo" form (matrix-iq.nantatech.com/request-demo) → a Lead
// in Lead Capture / Inquiry, the same way a Meta ad lead lands: created or
// merged into an existing lead by mobile/email, owned by the Sales department
// manager, audit-logged and notified. Origin is 'website'.

export interface DemoRequestInput {
  name: string;
  company: string;
  mobile: string;
  email: string;
  designation: string;
  city: string;
  teamSize: string;
  interests: string[];
  preferredDate: string;
  message: string;
}

export interface DemoRequestResult {
  leadId: string;
  merged: boolean;
}

/** Sales department manager(s): the department named exactly "Sales". */
async function findSalesManagers() {
  const all = await listDepartmentManagers();
  const key = Object.keys(all).find((k) => /^sales$/i.test(k.trim())) ?? Object.keys(all).find((k) => /\bsales\b/i.test(k));
  return key ? all[key] : [];
}

export async function ingestDemoRequest(input: DemoRequestInput, ip: string): Promise<DemoRequestResult> {
  const managers = await findSalesManagers();
  const owner = managers[0];

  const noteLines = [
    'Website demo request (matrix-iq.nantatech.com).',
    input.teamSize && `Team size: ${input.teamSize}`,
    input.interests.length ? `Interested in: ${input.interests.join(', ')}` : '',
    input.preferredDate && `Preferred demo date: ${input.preferredDate}`,
    input.message && `Message: ${input.message}`
  ].filter(Boolean);

  const result = await createOrMergeLead(
    {
      name: input.name,
      mobile: input.mobile,
      email: input.email,
      designation: input.designation,
      company: input.company,
      city: input.city,
      cardImageUrl: '',
      interests: [],
      subInterests: [],
      followUpActions: ['Schedule demo'],
      priority: 'warm',
      budget: '',
      notes: noteLines.join('\n'),
      source: 'manual',
      leadSource: 'website'
    },
    owner?.username || ''
  );

  const leadId = result.record.id;
  await logAudit({
    by: owner?.username || 'system',
    role: 'system',
    entityType: 'lead',
    entityId: leadId,
    action: result.merged ? 'Website demo request merged into existing lead' : 'Website demo request received',
    previousStatus: '',
    newStatus: result.record.priority || 'warm',
    remarks: `${input.company} — ${input.name}`,
    ip
  });

  if (managers.length) {
    await notifyUsers(
      managers.map((m) => m.username),
      {
        title: result.merged ? 'Website demo request (existing lead)' : 'New website demo request',
        body: `${input.name} from ${input.company} asked for a MatrixIQ demo.`,
        type: 'website_demo_request',
        entityType: 'lead',
        entityId: leadId
      }
    );
  }

  // Emails are fire-and-forget: the lead is already saved, a mail failure
  // must not turn the visitor's submission into an error.
  void sendDemoEmails(input, managers.map((m) => m.id)).catch((error) =>
    console.error('[demo-request] email failed:', error instanceof Error ? error.message : error)
  );

  return { leadId, merged: result.merged };
}

async function sendDemoEmails(input: DemoRequestInput, managerIds: string[]) {
  const managerEmails = (await Promise.all(managerIds.map((id) => findUserById(id))))
    .map((u) => u?.email)
    .filter((e): e is string => !!e);

  const rows: [string, string][] = [
    ['Name', input.name],
    ['Company', input.company],
    ['Designation', input.designation],
    ['Mobile', input.mobile],
    ['Email', input.email],
    ['City', input.city],
    ['Team size', input.teamSize],
    ['Interested in', input.interests.join(', ')],
    ['Preferred date', input.preferredDate],
    ['Message', input.message]
  ];
  const table = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`)
    .join('');

  if (managerEmails.length) {
    const subject = `New MatrixIQ demo request — ${input.company}`;
    await sendEmail({
      to: managerEmails,
      subject,
      html: renderEmailShell(
        subject,
        `${renderHeadline('New website demo request')}<p>A visitor asked for a MatrixIQ demo. It is in <strong>Lead Capture / Inquiry</strong>, assigned to Sales.</p>${renderInfoBox(`<table style="border-collapse:collapse;font-size:14px">${table}</table>`)}`
      ),
      text: rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
    });
  }

  const subject = 'Thanks — your MatrixIQ demo request is in';
  await sendEmail({
    to: input.email,
    subject,
    html: renderEmailShell(
      subject,
      `${renderHeadline(`Thank you, ${escapeHtml(input.name.split(' ')[0] || input.name)}!`)}<p>We have received your request for a MatrixIQ demo. Our team will contact you shortly to fix a convenient time.</p><p>Need us sooner? Call <a href="${SITE.phoneHref}">${SITE.phoneDisplay}</a> or write to <a href="mailto:${SITE.email}">${SITE.email}</a>.</p><p>— Team MatrixIQ, ${SITE.company}</p>`
    ),
    text: `Thank you, ${input.name}! We have received your request for a MatrixIQ demo and will contact you shortly.\n\nCall ${SITE.phoneDisplay} or write to ${SITE.email}.\n\n— Team MatrixIQ, ${SITE.company}`
  });
}
