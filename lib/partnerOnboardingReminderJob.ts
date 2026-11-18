import { db } from './db';
import { logAudit } from './auditLogStore';
import { notifyUsers } from './notificationStore';
import { sendEmail } from './email/emailService';
import { escapeHtml, renderEmailShell, renderHeadline, renderInfoBox } from './email/templates/layout';
import { onboardingProgress, PARTNER_DOCUMENT_LABEL } from './partnerOnboarding';
import { PARTNER_APPROVAL_LABEL, isPartnerApprovalStage } from './partnerApprovalChain';
import { stageApprovers } from './partnerApprovalStore';
import { dayOfWeek, istClock, istDate } from './dailyReportTime';

// Partner onboarding reminders — twice a week (Monday and Thursday, from
// 10:00 IST) until the partner is fully onboarded.
//
//   Documents still outstanding  -> the partner's logins + the person who
//                                   created the partner (and the relationship
//                                   manager): "these documents are pending".
//   Waiting on a sign-off        -> the managers of the current step
//                                   (Sales -> Accounts -> Administration):
//                                   "your approval is pending"; the creator
//                                   is copied so they know where it sits.
//
// Runs from the in-app sweep (lib/dailyReportAutoSweep.ts), which wakes
// several times a day. A slot is claimed per partner per IST date through an
// audit_logs row, so later wake-ups the same day send nothing — no migration
// needed. sendPartnerOnboardingReminder() is also called right after a
// partner login is created, so the first mail goes out immediately.

const REMINDER_DAYS = new Set([1, 4]); // Monday, Thursday
const REMINDER_FROM = '10:00';
const CLAIM_ACTION = 'Partner onboarding reminder sent';

function appUrl(path: string): string {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  return `${base}${path}`;
}

async function usersByIds(ids: string[]): Promise<{ username: string; email: string; name: string }[]> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return [];
  const rows = await db.User.findAll({ where: { id: clean } as never, attributes: ['username', 'email', 'name'] });
  return rows.map((r) => ({ username: r.get('username') as string, email: (r.get('email') as string) || '', name: (r.get('name') as string) || '' }));
}

async function alreadySentToday(partnerId: string, date: string): Promise<boolean> {
  const row = await db.AuditLog.findOne({
    where: { entity_type: 'partner', entity_id: partnerId, action: CLAIM_ACTION, remarks: date } as never,
    attributes: ['id']
  });
  return !!row;
}

/** Sends the reminder for one partner now. Returns false when nothing is pending. */
export async function sendPartnerOnboardingReminder(partnerId: string): Promise<boolean> {
  const partner = await db.Partner.findByPk(partnerId);
  if (!partner) return false;
  if (partner.get('onboarded_at') || partner.get('approval_stage') === 'approved') return false;
  if (partner.get('status') === 'inactive') return false;

  const company = (partner.get('company_name') as string) || 'Partner';
  const stage = partner.get('approval_stage');
  const owners = await usersByIds([partner.get('created_by') as string, partner.get('relationship_manager_id') as string]);
  const partnerUsers = (await db.User.findAll({ where: { partnerId } as never, attributes: ['username', 'email', 'name', 'status'] }))
    .filter((r) => r.get('status') !== 'inactive')
    .map((r) => ({ username: r.get('username') as string, email: (r.get('email') as string) || '', name: (r.get('name') as string) || '' }));

  const emails = (list: { email: string }[]) => [...new Set(list.map((u) => u.email).filter(Boolean))];

  if (isPartnerApprovalStage(stage)) {
    const approvers = await stageApprovers(stage);
    const approverUsers = await usersByIds(approvers.map((a) => a.id));
    const label = PARTNER_APPROVAL_LABEL[stage];
    const subject = `Reminder: your approval is pending — ${company} partner onboarding`;
    const link = appUrl(`/admin/partners/${partnerId}`);
    const html = renderEmailShell(
      subject,
      `${renderHeadline('Your approval is pending')}<p><strong>${escapeHtml(company)}</strong> has submitted all onboarding documents. They are waiting for your sign-off as <strong>${escapeHtml(label)}</strong>.</p>` +
        `${renderInfoBox('Order of approval: Sales Manager → Accounts Manager → Admin Manager. The partner gets full portal access only after all three approve.')}` +
        `<p><a href="${link}">Review and approve</a></p><p>You will be reminded every Monday and Thursday until this step is done.</p>`
    );
    const text = `${company} partner onboarding is waiting for your approval as ${label}.\nReview: ${link}`;
    if (emails(approverUsers).length) await sendEmail({ to: [...new Set([...emails(approverUsers), ...emails(owners)])], subject, html, text });
    await notifyUsers(approverUsers.map((u) => u.username), {
      title: 'Partner onboarding — your approval is pending',
      body: `${company} — waiting for your sign-off as ${label}.`,
      type: 'partner_approval_pending',
      entityType: 'partner_approval',
      entityId: partnerId
    });
    return true;
  }

  // Waiting on the partner's documents.
  const docs = await db.PartnerDocument.findAll({ where: { partner_id: partnerId } as never, attributes: ['kind', 'status', 'review_remarks'] });
  const progress = onboardingProgress(docs.map((d) => ({ kind: d.get('kind') as string, status: d.get('status') as string, review_remarks: (d.get('review_remarks') as string) || '' })));
  const pending = [
    ...progress.missing.map((k) => `${PARTNER_DOCUMENT_LABEL[k]} — not uploaded yet`),
    ...progress.rejected.map((k) => {
      const remark = progress.steps.find((s) => s.kind === k)?.remarks;
      return `${PARTNER_DOCUMENT_LABEL[k]} — needs to be replaced${remark ? ` (${remark})` : ''}`;
    })
  ];
  if (!pending.length) return false;

  const subject = `Reminder: onboarding documents pending — ${company}`;
  const list = `<ul>${pending.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
  const link = appUrl('/partner/onboarding');
  const html = renderEmailShell(
    subject,
    `${renderHeadline('Documents pending')}<p>Hello ${escapeHtml(company)} team,</p><p>To complete your partner onboarding, please upload the following:</p>${renderInfoBox(list)}` +
      `<p><a href="${link}">Upload documents</a></p><p>After upload, the documents are approved by our Sales, Accounts and Admin managers. You will receive this reminder every Monday and Thursday until it is complete.</p>`
  );
  const text = `Onboarding documents pending for ${company}:\n- ${pending.join('\n- ')}\nUpload: ${link}`;
  const to = emails(partnerUsers);
  const cc = emails(owners);
  const all = [...new Set([...to, ...cc])];
  if (all.length) await sendEmail({ to: all, subject, html, text });
  await notifyUsers([...partnerUsers, ...owners].map((u) => u.username), {
    title: `${company}: onboarding documents pending`,
    body: pending.join('; '),
    type: 'partner_document_pending',
    entityType: 'partner_approval',
    entityId: partnerId
  });
  return true;
}

/** The twice-weekly pass. Safe to call on every sweep wake-up. */
export async function runPartnerOnboardingReminders(now = new Date()): Promise<{ sent: number }> {
  const today = istDate(now);
  if (!REMINDER_DAYS.has(dayOfWeek(today)) || istClock(now) < REMINDER_FROM) return { sent: 0 };

  const partners = await db.Partner.findAll({ where: { onboarded_at: null } as never, attributes: ['id', 'approval_stage', 'status'] });
  let sent = 0;
  for (const p of partners) {
    const id = p.get('id') as string;
    if (p.get('approval_stage') === 'approved' || p.get('status') === 'inactive') continue;
    try {
      if (await alreadySentToday(id, today)) continue;
      // Claim before sending, so an overlapping wake-up cannot double-mail.
      await logAudit({ by: 'system', role: 'system', entityType: 'partner', entityId: id, action: CLAIM_ACTION, previousStatus: '', newStatus: '', remarks: today });
      if (await sendPartnerOnboardingReminder(id)) sent++;
    } catch (error) {
      console.error(`[partner-onboarding-reminder] partner ${id} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return { sent };
}
