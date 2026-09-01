// Feature-facing email functions. Each one composes a template + the common
// sendEmail() service and never throws — a notification failure must never
// surface as a failure of the feature that triggered it (see callers).
// Future additions live here too: sendQuotationEmail(), sendDemoScheduledEmail(), sendGenericEmail().
import { sendEmail } from './emailService';
import { renderUserCreatedEmail, UserCreatedEmailData } from './templates/userCreated';
import { renderAccountChangedEmail, AccountChangedEmailData } from './templates/accountChanged';
import { renderPasswordChangedEmail, PasswordChangedEmailData } from './templates/passwordChanged';
import { renderQuotationStatusChangedEmail, QuotationStatusChangedEmailData } from './templates/quotationStatusChanged';
import { renderDemoLifecycleEmail, DemoLifecycleEmailData } from './templates/demoLifecycle';
import { renderProjectLifecycleEmail, ProjectLifecycleEmailData } from './templates/projectLifecycle';
import { renderTaskLifecycleEmail, TaskLifecycleEmailData } from './templates/taskLifecycle';
import { renderProcurementLifecycleEmail, ProcurementLifecycleEmailData } from './templates/procurementLifecycle';
import { renderMarketingRequestLifecycleEmail, MarketingRequestLifecycleEmailData } from './templates/marketingRequestLifecycle';
import { renderFieldOpsLifecycleEmail, FieldOpsLifecycleEmailData } from './templates/fieldOpsLifecycle';
import { renderReimbursementLifecycleEmail, ReimbursementLifecycleEmailData } from './templates/reimbursementLifecycle';

// APP_URL must be this app's absolute public origin (e.g.
// https://app.example.com, see .env.example) — every link embedded in an
// outgoing email (login, project, task, quotation, ...) is built from it.
// A missing/blank APP_URL used to fail silently: callers fell back to a bare
// relative path like "/projects/<id>", which has no meaning inside an email
// — there is no "current page" for a mail client to resolve a relative href
// against, so the link either does nothing or resolves against the wrong
// origin entirely and 404s there. That produced exactly this symptom: a
// real, well-formed email whose "View Project" button 404s on click. Since
// this function never throws (see the file header — a notification failure
// must never break the feature that triggered it), the fallback behavior is
// unchanged; what changes is that a misconfigured deployment now logs a
// loud, unmistakable server-side error the first time it happens, instead of
// only surfacing when a user reports a broken link days later.
let warnedMissingAppUrl = false;
function resolveAppUrl(): string {
  const value = process.env.APP_URL?.replace(/\/+$/, '') || '';
  if (!value && !warnedMissingAppUrl) {
    warnedMissingAppUrl = true;
    console.error(
      '[email] APP_URL is not set. Every link in outgoing emails (login, project, task, quotation, ...) will be a relative path and will not resolve correctly when clicked from an email client. Set APP_URL to this deployment\'s public origin (e.g. https://matrix-iq.nantatech.com) in the server environment — see .env.example.'
    );
  }
  return value;
}

function resolveLoginUrl(): string {
  const base = resolveAppUrl();
  return base ? `${base}/login` : '/login';
}

export async function sendUserCreatedEmail(data: Omit<UserCreatedEmailData, 'loginUrl'>): Promise<void> {
  if (!data.email) return;

  try {
    const { subject, html, text } = renderUserCreatedEmail({ ...data, loginUrl: resolveLoginUrl() });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(
      `[email] User "${data.username}" was created successfully but the welcome email could not be sent:`,
      error instanceof Error ? error.message : error
    );
  }
}

export async function sendAccountChangedEmail(data: { email: string; username: string } & Omit<AccountChangedEmailData, 'loginUrl'>): Promise<void> {
  if (!data.email) return;

  try {
    const { subject, html, text } = renderAccountChangedEmail({ ...data, loginUrl: resolveLoginUrl() });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(
      `[email] User "${data.username}" was updated successfully but the account-change email could not be sent:`,
      error instanceof Error ? error.message : error
    );
  }
}

export async function sendPasswordChangedEmail(data: { email: string } & Omit<PasswordChangedEmailData, 'loginUrl'>): Promise<void> {
  if (!data.email) return;

  try {
    const { subject, html, text } = renderPasswordChangedEmail({ ...data, loginUrl: resolveLoginUrl() });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(
      `[email] User "${data.username}"'s password was changed successfully but the notification email could not be sent:`,
      error instanceof Error ? error.message : error
    );
  }
}

export async function sendQuotationStatusEmail(
  data: { email: string } & Omit<QuotationStatusChangedEmailData, 'quotationsUrl'>
): Promise<void> {
  if (!data.email) return;

  try {
    const appUrl = resolveAppUrl();
    const quotationsUrl = appUrl ? `${appUrl}/my-quotations` : '/my-quotations';
    const { subject, html, text } = renderQuotationStatusChangedEmail({ ...data, quotationsUrl });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(
      `[email] Quotation "${data.quotationNumber}" status changed successfully but the notification email could not be sent:`,
      error instanceof Error ? error.message : error
    );
  }
}

// Sends to one recipient at a time (called in a loop at the route level for
// group recipients like "all department managers") so each person gets a
// personalized "Hello <name>" rather than one email addressed to a group.
export async function sendDemoLifecycleEmail(data: { email: string } & Omit<DemoLifecycleEmailData, 'demoUrl'>): Promise<void> {
  if (!data.email) return;

  try {
    const appUrl = resolveAppUrl();
    const demoUrl = appUrl ? `${appUrl}/demo-schedule` : '/demo-schedule';
    const { subject, html, text } = renderDemoLifecycleEmail({ ...data, demoUrl });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(`[email] Demo lifecycle event "${data.event}" processed successfully but the notification email could not be sent:`, error instanceof Error ? error.message : error);
  }
}

export async function sendProjectLifecycleEmail(
  data: { email: string; projectId: string; projectKind: 'sales' | 'tms' } & Omit<ProjectLifecycleEmailData, 'projectUrl'>
): Promise<void> {
  if (!data.email) return;

  try {
    const appUrl = resolveAppUrl();
    const path = data.projectKind === 'tms' ? `/tms/projects/${data.projectId}` : `/projects/${data.projectId}`;
    const projectUrl = appUrl ? `${appUrl}${path}` : path;
    const { subject, html, text } = renderProjectLifecycleEmail({ ...data, projectUrl });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(`[email] Project lifecycle event "${data.event}" processed successfully but the notification email could not be sent:`, error instanceof Error ? error.message : error);
  }
}

export async function sendTaskLifecycleEmail(data: { email: string } & Omit<TaskLifecycleEmailData, 'tasksUrl'>): Promise<void> {
  if (!data.email) return;

  try {
    const appUrl = resolveAppUrl();
    const tasksUrl = appUrl ? `${appUrl}/tms/tasks` : '/tms/tasks';
    const { subject, html, text } = renderTaskLifecycleEmail({ ...data, tasksUrl });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(`[email] Task lifecycle event "${data.event}" processed successfully but the notification email could not be sent:`, error instanceof Error ? error.message : error);
  }
}

// urlPath is the exact route to link to (the BOM/procurement/PO pipeline
// spans three different detail pages — /tms/bom-requests/:id,
// /tms/procurement/:id, and the parent project's page for a PO — so the
// caller supplies it directly rather than this function guessing from event).
export async function sendProcurementLifecycleEmail(
  data: { email: string; urlPath: string } & Omit<ProcurementLifecycleEmailData, 'procurementUrl'>
): Promise<void> {
  if (!data.email) return;

  try {
    const appUrl = resolveAppUrl();
    const procurementUrl = appUrl ? `${appUrl}${data.urlPath}` : data.urlPath;
    const { subject, html, text } = renderProcurementLifecycleEmail({ ...data, procurementUrl });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(`[email] Procurement lifecycle event "${data.event}" processed successfully but the notification email could not be sent:`, error instanceof Error ? error.message : error);
  }
}

export async function sendMarketingRequestLifecycleEmail(
  data: { email: string } & Omit<MarketingRequestLifecycleEmailData, 'requestsUrl'>
): Promise<void> {
  if (!data.email) return;

  try {
    const appUrl = resolveAppUrl();
    const requestsUrl = appUrl ? `${appUrl}/marketing-requests` : '/marketing-requests';
    const { subject, html, text } = renderMarketingRequestLifecycleEmail({ ...data, requestsUrl });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(`[email] Marketing request lifecycle event "${data.event}" processed successfully but the notification email could not be sent:`, error instanceof Error ? error.message : error);
  }
}

// urlPath varies by event (/site-visits, /installation, /backoffice) — see
// callers.
export async function sendFieldOpsLifecycleEmail(data: { email: string; urlPath: string } & Omit<FieldOpsLifecycleEmailData, 'url'>): Promise<void> {
  if (!data.email) return;

  try {
    const appUrl = resolveAppUrl();
    const url = appUrl ? `${appUrl}${data.urlPath}` : data.urlPath;
    const { subject, html, text } = renderFieldOpsLifecycleEmail({ ...data, url });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(`[email] Field ops lifecycle event "${data.event}" processed successfully but the notification email could not be sent:`, error instanceof Error ? error.message : error);
  }
}

export async function sendReimbursementLifecycleEmail(
  data: { email: string } & Omit<ReimbursementLifecycleEmailData, 'reimbursementUrl'>
): Promise<void> {
  if (!data.email) return;

  try {
    const appUrl = resolveAppUrl();
    const reimbursementUrl = appUrl ? `${appUrl}/reimbursement` : '/reimbursement';
    const { subject, html, text } = renderReimbursementLifecycleEmail({ ...data, reimbursementUrl });
    await sendEmail({ to: data.email, subject, html, text });
  } catch (error) {
    console.error(`[email] Reimbursement lifecycle event "${data.event}" processed successfully but the notification email could not be sent:`, error instanceof Error ? error.message : error);
  }
}
