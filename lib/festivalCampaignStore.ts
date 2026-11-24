import { Op } from 'sequelize';
import { db } from './db';
import { BRAND } from './branding';
import { marketingRequestStore } from './marketingRequestStore';
import { getAppConfig } from './appConfigStore';
import { notifyUsers } from './notificationStore';
import { listUsers, findUserByUsername } from './userStore';
import { listDepartmentManagers, findHrManagers } from './departmentStore';
import { isMarketingManager } from './permissions';
import { requireHrModule } from './hrAccess';
import { ViewerContext } from './viewerContext';
import { sendEmail, isEmailConfigured } from './email/emailService';
import { renderFestivalClientEmail } from './email/templates/festivalClient';
import { buildUnsubscribeUrl } from './unsubscribeToken';
import { MarketingRequestRecord } from './types';
import {
  FestivalCampaignStatus,
  CampaignRecipient,
  RecipientPlan,
  DEFAULT_LEAD_DAYS,
  DEFAULT_SEND_HOUR_IST,
  addDays,
  buildRecipients,
  campaignDayAction,
  creativeDueDate,
  defaultHeadline,
  istDateOnly,
  istHour,
  normalizeEmail,
  pickBannerPath,
  readPositiveInt,
  shouldRaiseRequest
} from './festivalCampaignPlan';

// Client festival greeting campaigns.
//
//   1. runFestivalCampaignSweep() — called hourly by the cron route and also
//      opportunistically from the dashboard — raises a Marketing Request for
//      the banner LEAD_DAYS before each festival. No human creates it.
//   2. Marketing works it through their normal flow; when it reaches
//      'completed', the sweep picks up the first delivered image as the
//      banner and moves the campaign to pending_approval.
//   3. HR / Marketing manager / Admin reviews (banner + editable wording),
//      sends themselves a test, and approves or sends it back to Marketing.
//   4. On the festival day at SEND_HOUR IST the sweep mails every valid,
//      de-duplicated, not-unsubscribed email in Client Master. An unapproved
//      campaign is skipped — nothing reaches a client unreviewed.
//
// SAFETY: real client mail goes out only when FESTIVAL_CLIENT_MAIL_ENABLED
// is exactly 'true'. Otherwise the whole send runs as a dry run — recipient
// rows are recorded with status 'dry_run' and no email leaves the server.

export const SYSTEM_ACTOR = 'MatrixIQ (automatic)';

function leadDays(): number {
  return readPositiveInt(process.env.FESTIVAL_CAMPAIGN_LEAD_DAYS, DEFAULT_LEAD_DAYS, 60);
}

function sendHourIst(): number {
  return readPositiveInt(process.env.FESTIVAL_CAMPAIGN_SEND_HOUR_IST, DEFAULT_SEND_HOUR_IST, 23);
}

export function isClientMailLive(): boolean {
  return process.env.FESTIVAL_CLIENT_MAIL_ENABLED === 'true';
}

function appUrl(): string {
  return process.env.APP_URL?.replace(/\/+$/, '') || '';
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface FestivalCampaignRecord {
  id: string;
  festival_id: string;
  festival_name: string;
  festival_date: string;
  festival_greeting: string;
  marketing_request_id: string;
  marketing_request_status: string;
  marketing_request_assignee: string;
  status: FestivalCampaignStatus;
  headline: string;
  message: string;
  has_banner: boolean;
  banner_preview_url: string; // authenticated in-app URL, for the review screen
  approved_by_name: string;
  approved_at: string;
  rejection_reason: string;
  sent_at: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  dry_run: boolean;
}

export interface FestivalCampaignOverviewRow {
  festival_id: string;
  festival_name: string;
  festival_date: string;
  campaign: FestivalCampaignRecord | null;
}

const campaignIncludes = [
  { model: db.Festival, as: 'festival' },
  { model: db.MarketingRequest, as: 'marketingRequest', attributes: ['id', 'status', 'assigned_to_id'], include: [{ model: db.User, as: 'assignee', attributes: ['id', 'username', 'name'] }] },
  { model: db.User, as: 'approver', attributes: ['id', 'username', 'name'] }
];

function iso(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function bannerPreviewUrl(path: string | null): string {
  return path ? `/api/uploads/file/${path.split('/').map(encodeURIComponent).join('/')}` : '';
}

function toRecord(row: InstanceType<typeof db.FestivalCampaign>): FestivalCampaignRecord {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const festival = (p.festival || {}) as Record<string, unknown>;
  const mr = (p.marketingRequest || null) as Record<string, unknown> | null;
  const assignee = (mr?.assignee || null) as { name?: string; username?: string } | null;
  const approver = (p.approver || null) as { name?: string; username?: string } | null;
  return {
    id: p.id as string,
    festival_id: p.festival_id as string,
    festival_name: (festival.name as string) || '',
    festival_date: (festival.date as string) || '',
    festival_greeting: (festival.greeting as string) || '',
    marketing_request_id: (p.marketing_request_id as string) || '',
    marketing_request_status: (mr?.status as string) || '',
    marketing_request_assignee: assignee?.name || assignee?.username || '',
    status: p.status as FestivalCampaignStatus,
    headline: (p.headline as string) || '',
    message: (p.message as string) || '',
    has_banner: Boolean(p.banner_path),
    banner_preview_url: bannerPreviewUrl((p.banner_path as string) || null),
    approved_by_name: approver?.name || approver?.username || '',
    approved_at: iso(p.approved_at),
    rejection_reason: (p.rejection_reason as string) || '',
    sent_at: iso(p.sent_at),
    recipient_count: Number(p.recipient_count) || 0,
    sent_count: Number(p.sent_count) || 0,
    failed_count: Number(p.failed_count) || 0,
    dry_run: Boolean(p.dry_run)
  };
}

export async function findCampaign(id: string): Promise<FestivalCampaignRecord | null> {
  const row = await db.FestivalCampaign.findByPk(id, { include: campaignIncludes });
  return row ? toRecord(row) : null;
}

/** Upcoming festivals (plus the last 30 days) with their campaign, soonest first. */
export async function listCampaignOverview(now: Date = new Date()): Promise<FestivalCampaignOverviewRow[]> {
  const today = istDateOnly(now);
  const festivals = await db.Festival.findAll({ where: { date: { [Op.gte]: addDays(today, -30) } } as never, order: [['date', 'ASC']] });
  const campaigns = await db.FestivalCampaign.findAll({ include: campaignIncludes });
  const byFestival = new Map(campaigns.map((c) => [c.get('festival_id') as string, toRecord(c)]));
  return festivals.map((f) => {
    const plain = f.get({ plain: true }) as Record<string, unknown>;
    return {
      festival_id: plain.id as string,
      festival_name: plain.name as string,
      festival_date: plain.date as string,
      campaign: byFestival.get(plain.id as string) || null
    };
  });
}

// ---------------------------------------------------------------------------
// Who approves
// ---------------------------------------------------------------------------

/** HR (festival module), the Marketing manager, or an Admin. */
export async function canApproveCampaigns(viewer: ViewerContext): Promise<boolean> {
  if (viewer.isPrivileged) return true;
  if (await requireHrModule(viewer, 'hr-festivals')) return true;
  return isMarketingManager(viewer);
}

/** Everyone to notify when a campaign needs a decision (or was sent/skipped). */
async function approverUsernames(): Promise<string[]> {
  const managers = await listDepartmentManagers();
  const names = new Set<string>();
  findHrManagers(managers).forEach((m) => names.add(m.username));
  (managers['Marketing'] || []).forEach((m) => names.add(m.username));
  (await listUsers())
    .filter((u) => u.status === 'active' && (u.role === 'admin' || u.role === 'superadmin'))
    .forEach((u) => names.add(u.username));
  return [...names];
}

async function notifyApprovers(campaignId: string, title: string, body: string, type: string): Promise<void> {
  await notifyUsers(await approverUsernames(), { title, body, type, entityType: 'festival_campaign', entityId: campaignId });
}

// ---------------------------------------------------------------------------
// Step 1 — raise the banner request to Marketing
// ---------------------------------------------------------------------------

interface FestivalRow { id: string; key: string; name: string; date: string; greeting: string }

function festivalPlain(row: InstanceType<typeof db.Festival>): FestivalRow {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  return { id: p.id as string, key: p.key as string, name: p.name as string, date: p.date as string, greeting: p.greeting as string };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.name === 'SequelizeUniqueConstraintError';
}

/**
 * Creates the campaign row FIRST (its unique festival_id index is the claim —
 * two overlapping sweeps can't both raise a request), then the Marketing
 * Request, then links them.
 */
export async function raiseCampaign(festival: FestivalRow, now: Date = new Date(), raisedBy = SYSTEM_ACTOR): Promise<FestivalCampaignRecord | null> {
  let campaignRow: InstanceType<typeof db.FestivalCampaign>;
  try {
    campaignRow = await db.FestivalCampaign.create({
      festival_id: festival.id,
      status: 'awaiting_creative',
      headline: defaultHeadline(festival.name),
      message: festival.greeting
    } as never);
  } catch (error) {
    if (isUniqueViolation(error)) return null; // already raised
    throw error;
  }

  const today = istDateOnly(now);
  const due = creativeDueDate(festival.date, today);
  const appConfig = await getAppConfig();
  const nowIso = now.toISOString();

  const record: MarketingRequestRecord = {
    id: `${Date.now()}`,
    created_at: nowIso,
    created_by: '',
    assigned_to: appConfig.marketingOwnerUsername || '',
    assigned_to_id: appConfig.marketingOwnerId || '',
    technical_member_id: '',
    technical_member_username: '',
    technical_member_name: '',
    updated_at: nowIso,
    project_id: '',
    title: `Festival banner — ${festival.name} (${festival.date})`,
    product_category: 'Festival Greeting',
    request_type: 'email_campaign',
    description: [
      `Raised automatically by ${BRAND.appName} for the client festival greeting email.`,
      '',
      `Festival: ${festival.name}`,
      `Festival date: ${festival.date}`,
      `Please deliver by: ${due}`,
      '',
      'Deliverable: ONE banner image for the client email.',
      '• Format: JPG or PNG (upload the file itself — Drive links cannot be embedded in email)',
      '• Size: 1200 × 600 px (2:1), under 1 MB',
      `• Include the ${BRAND.companyName} logo and a "${festival.name}" greeting`,
      '',
      'Optional: put suggested email wording in "Prepared content".',
      '',
      'Once you submit the final result, HR / Marketing manager / Admin will review and approve it, and the email goes to every client in Client Master on the festival morning.'
    ].join('\n'),
    additional_info: `Suggested greeting: ${festival.greeting}`,
    priority: 'high',
    needed_by_date: due,
    attachments: [],
    status: 'submitted',
    marketing_prepared_content: '',
    marketing_attachments: [],
    marketing_remarks: '',
    technical_instructions: '',
    technical_review_decision: '',
    technical_remarks: '',
    technical_reviewed_at: '',
    technical_reviewed_by: '',
    final_submission_notes: '',
    final_submission_files: [],
    timeline: null,
    rejection_reason: '',
    completion_notes: '',
    delivered_files: [],
    assignment_status: appConfig.marketingOwnerUsername ? 'pending' : '',
    assignment_decline_reason: '',
    comments: [{ id: '', at: nowIso, by: raisedBy, text: `Auto-raised for the ${festival.name} client greeting campaign.` }]
  };

  let request: MarketingRequestRecord;
  try {
    request = await marketingRequestStore.create(record);
  } catch (error) {
    // Release the claim so the next sweep retries instead of leaving a
    // campaign with no request behind it.
    await campaignRow.destroy();
    throw error;
  }
  await campaignRow.update({ marketing_request_id: request.id } as never);

  const marketingTargets = new Set<string>();
  if (request.assigned_to) marketingTargets.add(request.assigned_to);
  (await listDepartmentManagers())['Marketing']?.forEach((m) => marketingTargets.add(m.username));
  await notifyUsers([...marketingTargets], {
    title: `Festival banner needed: ${festival.name}`,
    body: `Client greeting email for ${festival.name} (${festival.date}) — please deliver the banner by ${due}.`,
    type: 'festival_campaign_request',
    entityType: 'marketing_request',
    entityId: request.id
  });

  return findCampaign(campaignRow.get('id') as string);
}

// ---------------------------------------------------------------------------
// Step 2 — pick up Marketing's delivery
// ---------------------------------------------------------------------------

async function syncCreative(row: InstanceType<typeof db.FestivalCampaign>): Promise<boolean> {
  const mrId = row.get('marketing_request_id') as string | null;
  if (!mrId) return false;
  const mr = await db.MarketingRequest.findByPk(mrId);
  if (!mr || mr.get('status') !== 'completed') return false;

  const files = [
    ...((mr.get('final_submission_files') as string[]) || []),
    ...((mr.get('delivered_files') as string[]) || []),
    ...((mr.get('marketing_attachments') as string[]) || [])
  ];
  const bannerPath = pickBannerPath(files);
  const prepared = String(mr.get('marketing_prepared_content') || '').trim();

  const patch: Record<string, unknown> = { status: 'pending_approval', banner_path: bannerPath, rejection_reason: '' };
  if (prepared) patch.message = prepared;
  const [count] = await db.FestivalCampaign.update(patch as never, { where: { id: row.get('id'), status: 'awaiting_creative' } as never });
  if (!count) return false;

  const festival = await db.Festival.findByPk(row.get('festival_id') as string);
  const name = (festival?.get('name') as string) || 'festival';
  await notifyApprovers(
    row.get('id') as string,
    `Approve festival email: ${name}`,
    bannerPath
      ? `Marketing delivered the ${name} banner. Review and approve it before it goes to all clients.`
      : `Marketing completed the ${name} request but no image file was attached — review it (it will use the plain festive header) or send it back.`,
    'festival_campaign_pending_approval'
  );
  return true;
}

// ---------------------------------------------------------------------------
// Step 3 — approval
// ---------------------------------------------------------------------------

export interface CampaignEdit { headline?: string; message?: string }

function cleanEdit(edit: CampaignEdit): Record<string, string> {
  const patch: Record<string, string> = {};
  if (typeof edit.headline === 'string' && edit.headline.trim()) patch.headline = edit.headline.trim().slice(0, 200);
  if (typeof edit.message === 'string' && edit.message.trim()) patch.message = edit.message.trim().slice(0, 5000);
  return patch;
}

export type ActionResult = { ok: true; campaign: FestivalCampaignRecord } | { ok: false; status: number; error: string };

export async function updateCampaignWording(id: string, edit: CampaignEdit): Promise<ActionResult> {
  const patch = cleanEdit(edit);
  if (!Object.keys(patch).length) return { ok: false, status: 400, error: 'Nothing to update' };
  const [count] = await db.FestivalCampaign.update(patch as never, {
    where: { id, status: { [Op.in]: ['awaiting_creative', 'pending_approval', 'approved'] } } as never
  });
  if (!count) return { ok: false, status: 409, error: 'This campaign can no longer be edited' };
  const campaign = await findCampaign(id);
  return campaign ? { ok: true, campaign } : { ok: false, status: 404, error: 'Campaign not found' };
}

export async function approveCampaign(id: string, viewer: ViewerContext, edit: CampaignEdit, now: Date = new Date()): Promise<ActionResult> {
  const current = await findCampaign(id);
  if (!current) return { ok: false, status: 404, error: 'Campaign not found' };
  if (current.festival_date < istDateOnly(now)) return { ok: false, status: 409, error: 'This festival has already passed' };

  const [count] = await db.FestivalCampaign.update(
    { ...cleanEdit(edit), status: 'approved', approved_by: viewer.userId, approved_at: now, rejection_reason: '' } as never,
    { where: { id, status: 'pending_approval' } as never }
  );
  if (!count) return { ok: false, status: 409, error: 'Only a campaign awaiting approval can be approved' };

  const campaign = (await findCampaign(id))!;
  await notifyApprovers(id, `Festival email approved: ${campaign.festival_name}`, `${viewer.name || viewer.username} approved it. It will go to all clients on ${campaign.festival_date} at ${sendHourIst()}:00 IST.`, 'festival_campaign_approved');
  return { ok: true, campaign };
}

/** Back to Marketing with a reason — reopens their request so they can resubmit. */
export async function rejectCampaign(id: string, viewer: ViewerContext, reason: string): Promise<ActionResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, status: 400, error: 'A reason is required so Marketing knows what to change' };

  const [count] = await db.FestivalCampaign.update(
    { status: 'awaiting_creative', banner_path: null, rejection_reason: trimmed, approved_by: null, approved_at: null } as never,
    { where: { id, status: { [Op.in]: ['pending_approval', 'approved'] } } as never }
  );
  if (!count) return { ok: false, status: 409, error: 'This campaign cannot be sent back now' };

  const campaign = (await findCampaign(id))!;
  if (campaign.marketing_request_id) {
    const existing = (await marketingRequestStore.list(viewer.username, true)).find((r) => r.id === campaign.marketing_request_id);
    if (existing) {
      await marketingRequestStore.update(existing.id, {
        status: 'marketing_in_progress',
        comments: [...existing.comments, { id: '', at: new Date().toISOString(), by: viewer.username, text: `Festival banner sent back for changes: ${trimmed}` }]
      });
      if (existing.assigned_to) {
        await notifyUsers([existing.assigned_to], {
          title: `Festival banner needs changes: ${campaign.festival_name}`,
          body: trimmed,
          type: 'festival_campaign_changes_requested',
          entityType: 'marketing_request',
          entityId: existing.id
        });
      }
    }
  }
  return { ok: true, campaign };
}

// ---------------------------------------------------------------------------
// Rendering + recipients
// ---------------------------------------------------------------------------

function bannerPublicUrl(campaignId: string): string {
  const base = appUrl();
  return base ? `${base}/api/public/festival-banner/${campaignId}` : '';
}

function renderFor(campaign: FestivalCampaignRecord, recipient: CampaignRecipient, bannerUrl: string) {
  const base = appUrl();
  return renderFestivalClientEmail({
    recipientName: recipient.name,
    company: recipient.company,
    festivalName: campaign.festival_name,
    headline: campaign.headline || defaultHeadline(campaign.festival_name),
    message: campaign.message || campaign.festival_greeting,
    bannerUrl,
    logoUrl: base ? `${base}${BRAND.logo}` : '',
    unsubscribeUrl: buildUnsubscribeUrl(base, recipient.email),
    websiteUrl: process.env.COMPANY_WEBSITE_URL || ''
  });
}

/** HTML preview for the review screen. The banner uses the in-app URL since it isn't public yet. */
export function previewCampaign(campaign: FestivalCampaignRecord): { subject: string; html: string } {
  const { subject, html } = renderFor(campaign, { email: 'client@example.com', name: 'Mr. Sharma', company: 'Example Industries' }, campaign.banner_preview_url);
  return { subject, html };
}

/** Every Client Master contact with an email: project contacts + leads. */
export async function loadRecipientPlan(): Promise<RecipientPlan> {
  const [projects, leads, unsubscribes] = await Promise.all([
    db.Project.findAll({ attributes: ['email', 'client_name', 'company'] }),
    db.Lead.findAll({ attributes: ['email', 'name', 'company'] }),
    db.EmailUnsubscribe.findAll({ attributes: ['email'] })
  ]);
  const contacts = [
    ...projects.map((p) => ({ email: String(p.get('email') || ''), name: String(p.get('client_name') || ''), company: String(p.get('company') || '') })),
    ...leads.map((l) => ({ email: String(l.get('email') || ''), name: String(l.get('name') || ''), company: String(l.get('company') || '') }))
  ];
  const optedOut = new Set(unsubscribes.map((u) => normalizeEmail(String(u.get('email')))));
  return buildRecipients(contacts, optedOut);
}

/** A real test send to the reviewer's own address — never to a client. */
export async function sendTestEmail(id: string, viewer: ViewerContext): Promise<{ ok: true; to: string } | { ok: false; status: number; error: string }> {
  const campaign = await findCampaign(id);
  if (!campaign) return { ok: false, status: 404, error: 'Campaign not found' };
  const me = await findUserByUsername(viewer.username);
  if (!me?.email) return { ok: false, status: 400, error: 'Your account has no email address to send the test to' };
  if (!isEmailConfigured()) return { ok: false, status: 503, error: 'Email (AWS SES) is not configured on this server' };

  // The banner route only serves APPROVED campaigns, so a pre-approval test
  // shows the coloured header in place of the banner — said in the subject.
  const bannerUrl = campaign.has_banner && ['approved', 'sending', 'sent'].includes(campaign.status) ? bannerPublicUrl(id) : '';
  const rendered = renderFor(campaign, { email: me.email, name: me.name || me.username, company: '' }, bannerUrl);
  const note = campaign.has_banner && !bannerUrl ? ' (banner appears after approval)' : '';
  await sendEmail({ to: me.email, subject: `[TEST${note}] ${rendered.subject}`, html: rendered.html, text: rendered.text });
  return { ok: true, to: me.email };
}

// ---------------------------------------------------------------------------
// Step 4 — the festival-day send
// ---------------------------------------------------------------------------

const BATCH_SIZE = 8; // SES default sandbox-exit rate is 14/s; stay well under it
const BATCH_PAUSE_MS = 1000;
const STALE_SENDING_MS = 20 * 60_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function claimForSending(id: string, now: Date): Promise<boolean> {
  const [count] = await db.FestivalCampaign.update({ status: 'sending' } as never, { where: { id, status: 'approved' } as never });
  if (count) return true;
  // A sweep that died mid-send leaves 'sending' behind; once it has been
  // quiet for a while, take it over. Already-recorded recipients are skipped
  // by the unique (campaign_id, email) index, so nobody is mailed twice.
  const [stale] = await db.FestivalCampaign.update({ status: 'sending' } as never, {
    where: { id, status: 'sending', updated_at: { [Op.lt]: new Date(now.getTime() - STALE_SENDING_MS) } } as never
  });
  return stale > 0;
}

export interface SendSummary { campaignId: string; festival: string; recipients: number; sent: number; failed: number; alreadyDone: number; dryRun: boolean }

export async function executeCampaignSend(id: string, now: Date = new Date()): Promise<SendSummary | null> {
  if (!(await claimForSending(id, now))) return null;
  const campaign = (await findCampaign(id))!;
  const live = isClientMailLive() && isEmailConfigured();
  const plan = await loadRecipientPlan();
  const bannerUrl = campaign.has_banner ? bannerPublicUrl(id) : '';

  await db.FestivalCampaign.update({ recipient_count: plan.recipients.length, dry_run: !live } as never, { where: { id } as never });

  let sent = 0;
  let failed = 0;
  let alreadyDone = 0;

  for (let i = 0; i < plan.recipients.length; i += BATCH_SIZE) {
    const batch = plan.recipients.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (recipient) => {
      let sendRow: InstanceType<typeof db.FestivalCampaignSend>;
      try {
        sendRow = await db.FestivalCampaignSend.create({
          campaign_id: id,
          email: recipient.email,
          name: recipient.name.slice(0, 200),
          company: recipient.company.slice(0, 300),
          status: live ? 'pending' : 'dry_run'
        } as never);
      } catch (error) {
        if (isUniqueViolation(error)) { alreadyDone++; return; }
        failed++;
        console.error(`[festival-campaign] could not record ${recipient.email}:`, error instanceof Error ? error.message : error);
        return;
      }
      if (!live) { sent++; return; }
      try {
        const { subject, html, text } = renderFor(campaign, recipient, bannerUrl);
        await sendEmail({ to: recipient.email, subject, html, text });
        await sendRow.update({ status: 'sent' } as never);
        sent++;
      } catch (error) {
        failed++;
        await sendRow.update({ status: 'failed', error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) } as never).catch(() => undefined);
      }
    }));
    // Progress doubles as the heartbeat that keeps a live send from looking stale.
    await db.FestivalCampaign.update({ sent_count: sent, failed_count: failed } as never, { where: { id } as never });
    if (live && i + BATCH_SIZE < plan.recipients.length) await pause(BATCH_PAUSE_MS);
  }

  // Totals from the table, so a resumed send reports the whole campaign, not just this pass.
  const [totalSent, totalFailed] = await Promise.all([
    db.FestivalCampaignSend.count({ where: { campaign_id: id, status: { [Op.in]: ['sent', 'dry_run'] } } as never }),
    db.FestivalCampaignSend.count({ where: { campaign_id: id, status: 'failed' } as never })
  ]);
  await db.FestivalCampaign.update({ status: 'sent', sent_at: new Date(), sent_count: totalSent, failed_count: totalFailed } as never, { where: { id } as never });

  await notifyApprovers(
    id,
    `${live ? 'Festival email sent' : 'Festival email DRY RUN'}: ${campaign.festival_name}`,
    live
      ? `Sent to ${totalSent} client${totalSent === 1 ? '' : 's'}${totalFailed ? `, ${totalFailed} failed` : ''}. Skipped ${plan.invalid} invalid and ${plan.unsubscribed} unsubscribed address(es).`
      : `Real client mail is switched off (FESTIVAL_CLIENT_MAIL_ENABLED), so nothing was sent. It would have gone to ${totalSent} client(s).`,
    'festival_campaign_sent'
  );

  return { campaignId: id, festival: campaign.festival_name, recipients: plan.recipients.length, sent, failed, alreadyDone, dryRun: !live };
}

async function skipCampaign(row: InstanceType<typeof db.FestivalCampaign>, festivalName: string): Promise<boolean> {
  const [count] = await db.FestivalCampaign.update({ status: 'skipped' } as never, {
    where: { id: row.get('id'), status: { [Op.in]: ['awaiting_creative', 'pending_approval', 'approved'] } } as never
  });
  if (!count) return false;
  await notifyApprovers(row.get('id') as string, `Festival email NOT sent: ${festivalName}`, `It was not approved in time, so no client was emailed for ${festivalName}.`, 'festival_campaign_skipped');
  return true;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export interface SweepResult {
  raised: string[];
  readyForApproval: number;
  sends: SendSummary[];
  skipped: string[];
  errors: string[];
}

/** Idempotent — safe to call every hour, on every dashboard load, or twice at once. */
export async function runFestivalCampaignSweep(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { raised: [], readyForApproval: 0, sends: [], skipped: [], errors: [] };
  const today = istDateOnly(now);
  const hour = istHour(now);
  const lead = leadDays();

  // 1. Raise requests for festivals entering the window.
  try {
    const upcoming = await db.Festival.findAll({ where: { date: { [Op.gt]: today, [Op.lte]: addDays(today, lead) } } as never });
    const existing = new Set((await db.FestivalCampaign.findAll({ attributes: ['festival_id'] })).map((c) => c.get('festival_id') as string));
    for (const row of upcoming) {
      const festival = festivalPlain(row);
      if (existing.has(festival.id) || !shouldRaiseRequest(festival.date, today, lead)) continue;
      try {
        if (await raiseCampaign(festival, now)) result.raised.push(festival.name);
      } catch (error) {
        result.errors.push(`raise ${festival.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    result.errors.push(`raise: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2 + 3. Sync Marketing deliveries, then act on festival-day campaigns.
  try {
    const open = await db.FestivalCampaign.findAll({
      where: { status: { [Op.in]: ['awaiting_creative', 'pending_approval', 'approved', 'sending'] } } as never,
      include: [{ model: db.Festival, as: 'festival' }]
    });
    for (const row of open) {
      const festival = row.get('festival') as InstanceType<typeof db.Festival> | null;
      if (!festival) continue;
      const { name, date } = festivalPlain(festival);
      try {
        if (row.get('status') === 'awaiting_creative' && (await syncCreative(row))) {
          result.readyForApproval++;
          await row.reload();
        }
        const status = row.get('status') as FestivalCampaignStatus;
        if (status === 'sending') {
          const resumed = await executeCampaignSend(row.get('id') as string, now);
          if (resumed) result.sends.push(resumed);
          continue;
        }
        const action = campaignDayAction(status, date, today, hour, sendHourIst());
        if (action === 'send') {
          const summary = await executeCampaignSend(row.get('id') as string, now);
          if (summary) result.sends.push(summary);
        } else if (action === 'skip' && (await skipCampaign(row, name))) {
          result.skipped.push(name);
        }
      } catch (error) {
        result.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    result.errors.push(`process: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

// Dashboard fallback trigger. The cron route is the primary scheduler, but
// this app's staff greetings have always fired off the first dashboard load
// (app/api/dashboard/celebrations) — so the client campaign rides the same
// trigger, throttled per server instance so a busy morning of dashboard
// loads costs one sweep, not hundreds. Never awaited by the caller and
// never throws.
let lastOpportunisticSweep = 0;
const OPPORTUNISTIC_INTERVAL_MS = 10 * 60_000;

export function triggerFestivalCampaignSweep(): void {
  const now = Date.now();
  if (now - lastOpportunisticSweep < OPPORTUNISTIC_INTERVAL_MS) return;
  lastOpportunisticSweep = now;
  runFestivalCampaignSweep().catch((error) => {
    console.error('[festival-campaign] background sweep failed:', error instanceof Error ? error.message : error);
  });
}

/** Manual "raise now" from the review screen, for a festival outside the automatic window. */
export async function raiseCampaignNow(festivalId: string, viewer: ViewerContext, now: Date = new Date()): Promise<ActionResult> {
  const row = await db.Festival.findByPk(festivalId);
  if (!row) return { ok: false, status: 404, error: 'Festival not found' };
  const festival = festivalPlain(row);
  if (festival.date <= istDateOnly(now)) return { ok: false, status: 409, error: 'This festival is today or already over' };
  const campaign = await raiseCampaign(festival, now, viewer.username);
  if (!campaign) return { ok: false, status: 409, error: 'A banner request already exists for this festival' };
  return { ok: true, campaign };
}

/** Banner bytes for the public route — only once a human approved the campaign. */
export async function approvedBannerPath(id: string): Promise<string | null> {
  const row = await db.FestivalCampaign.findByPk(id, { attributes: ['banner_path', 'status'] });
  if (!row) return null;
  if (!['approved', 'sending', 'sent'].includes(row.get('status') as string)) return null;
  return (row.get('banner_path') as string) || null;
}

export async function recordUnsubscribe(email: string): Promise<void> {
  try {
    await db.EmailUnsubscribe.create({ email: normalizeEmail(email), source: 'festival' } as never);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error; // already unsubscribed is success
  }
}
