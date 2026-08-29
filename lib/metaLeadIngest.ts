import { db } from './db';
import { getMetaEnvConfig } from './metaConfig';
import { fetchLeadDetails, MetaGraphError, MetaLeadDetails } from './metaGraphClient';
import { createOrMergeLead, findLeadByMetaLeadId } from './leadStore';
import { getMetaIntegrationConfig, resolveNextRoundRobinOwnerId } from './metaIntegrationConfigStore';
import { findUserById } from './userStore';
import { logAudit } from './auditLogStore';
import { notifyUsers } from './notificationStore';
import { MetaLeadFieldDatum, UserRecord } from './types';

// The single shared pipeline for "given a Meta leadgen_id, turn it into a
// MatrixIQ Lead Capture / Inquiry record (or merge it into an existing
// one)". Called by both the webhook POST handler (real-time) and the
// manual "Sync Meta Leads" action (recovery/backfill) — there is exactly
// one implementation of what happens for a given leadgen_id, so the two
// entry points can never diverge in behavior.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Common Meta Lead Ads form field-name variants → the MatrixIQ Lead field
// they map onto (spec section 8). Meta form field names are whatever the
// form's author typed as the "key" for a question — these are the
// documented/observed common ones; anything not in this map still isn't
// lost, it just stays only in meta_raw_field_data and gets appended to
// notes as a labeled line instead of populating a dedicated column.
const FIELD_ALIASES: Record<string, 'name' | 'first_name' | 'last_name' | 'email' | 'mobile' | 'company' | 'designation' | 'city' | 'state' | 'country' | 'notes'> = {
  full_name: 'name',
  name: 'name',
  email: 'email',
  'e-mail': 'email',
  phone_number: 'mobile',
  phone: 'mobile',
  mobile: 'mobile',
  mobile_number: 'mobile',
  company_name: 'company',
  company: 'company',
  organization: 'company',
  job_title: 'designation',
  designation: 'designation',
  city: 'city',
  state: 'state',
  province: 'state',
  country: 'country',
  message: 'notes',
  comments: 'notes',
  first_name: 'first_name',
  last_name: 'last_name'
};

interface NormalizedMetaLead {
  name: string;
  mobile: string;
  email: string;
  company: string;
  designation: string;
  city: string;
  notes: string;
}

// Meta forms may contain different, non-standard field names per form —
// unmapped custom fields are never discarded: they're appended to notes as
// a labeled line (in addition to being preserved verbatim in
// meta_raw_field_data on the lead row itself).
function normalizeMetaFields(fieldData: MetaLeadFieldDatum[]): NormalizedMetaLead {
  const mapped: Partial<Record<'name' | 'first_name' | 'last_name' | 'email' | 'mobile' | 'company' | 'designation' | 'city' | 'state' | 'country' | 'notes', string>> = {};
  const unmappedLines: string[] = [];

  for (const field of fieldData) {
    const key = (field.name || '').trim().toLowerCase().replace(/\s+/g, '_');
    const value = (field.values || []).filter(Boolean).join(', ');
    if (!value) continue;
    const target = FIELD_ALIASES[key];
    if (target) {
      mapped[target] = mapped[target] ? `${mapped[target]}, ${value}` : value;
    } else {
      unmappedLines.push(`${field.name}: ${value}`);
    }
  }

  const name = mapped.name || [mapped.first_name, mapped.last_name].filter(Boolean).join(' ').trim();
  const cityParts = [mapped.city, mapped.state, mapped.country].filter(Boolean);
  const noteParts = [mapped.notes, cityParts.length > 1 ? `Location: ${cityParts.join(', ')}` : '', unmappedLines.length ? unmappedLines.join('\n') : ''].filter(Boolean);

  return {
    name,
    mobile: mapped.mobile || '',
    email: mapped.email || '',
    company: mapped.company || '',
    designation: mapped.designation || '',
    city: mapped.city || '',
    notes: noteParts.join('\n')
  };
}

async function resolveOwnerUser(campaignId: string): Promise<UserRecord | undefined> {
  const config = await getMetaIntegrationConfig();
  let ownerId = '';

  if (config.assignmentMode === 'campaign' && campaignId && config.campaignRoutingMap[campaignId]?.ownerId) {
    ownerId = config.campaignRoutingMap[campaignId].ownerId as string;
  } else if (config.assignmentMode === 'round_robin' && config.roundRobinPool.length) {
    ownerId = (await resolveNextRoundRobinOwnerId(config.roundRobinPool)) || '';
  }
  // Fixed mode, or a fallback when campaign/round-robin didn't resolve
  // anyone (e.g. a brand-new campaign not yet mapped) — better to land the
  // lead with a real default owner than lose it.
  if (!ownerId) ownerId = config.defaultOwnerId;
  if (!ownerId) return undefined;
  return findUserById(ownerId);
}

export interface IngestContext {
  pageId?: string;
  formId?: string;
  rawPayloadForLog?: unknown;
}

export type IngestStatus = 'created' | 'merged' | 'ignored_duplicate' | 'failed';

export interface IngestResult {
  status: IngestStatus;
  leadId?: string;
  error?: string;
}

export async function ingestMetaLead(leadgenId: string, context: IngestContext = {}): Promise<IngestResult> {
  // Write-ahead: this event is recorded before any Graph API call is made,
  // so a crash/timeout mid-processing never silently loses the lead — it
  // stays visible (and re-processable via "Sync Meta Leads") as a 'pending'
  // row even if this function never returns normally.
  const event = await db.MetaWebhookEvent.create({
    leadgen_id: leadgenId,
    page_id: context.pageId || null,
    form_id: context.formId || null,
    raw_payload: (context.rawPayloadForLog ?? {}) as never,
    status: 'pending'
  } as never);

  const already = await findLeadByMetaLeadId(leadgenId);
  if (already) {
    await event.update({ status: 'ignored_duplicate', resulting_lead_id: already.id, processed_at: new Date() });
    return { status: 'ignored_duplicate', leadId: already.id };
  }

  const env = getMetaEnvConfig();
  if (!env.pageAccessToken) {
    await event.update({ status: 'failed', last_error: 'META_PAGE_ACCESS_TOKEN is not configured.', attempts: 1 });
    return { status: 'failed', error: 'Meta integration is not fully configured (missing Page Access Token).' };
  }

  // Up to 2 attempts with a short backoff — this app has no background job
  // queue (confirmed: no cron/queue dependency, standalone Next.js
  // server), so a transient Graph API failure gets one retry inline; a
  // failure that persists past that is captured here as 'failed' for the
  // manual "Sync Meta Leads" action to pick up later, rather than retried
  // indefinitely inside this request.
  let details: MetaLeadDetails | undefined;
  let lastError = '';
  let attempts = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    attempts = attempt;
    try {
      details = await fetchLeadDetails(leadgenId, env.pageAccessToken);
      break;
    } catch (err) {
      lastError = err instanceof MetaGraphError ? `${err.kind}: ${err.detail}` : String(err);
      const retryable = !(err instanceof MetaGraphError) || err.kind === 'network' || err.kind === 'rate_limit';
      if (!retryable || attempt === 2) break;
      await sleep(800);
    }
  }
  if (!details) {
    await event.update({ status: 'failed', last_error: lastError, attempts });
    return { status: 'failed', error: 'Could not retrieve lead details from Meta.' };
  }

  const normalized = normalizeMetaFields(details.fieldData);
  const owner = await resolveOwnerUser(details.campaignId);
  if (!owner) {
    await event.update({ status: 'failed', last_error: 'No default owner configured for Meta leads (Administration → Meta Lead Integration).', attempts });
    return { status: 'failed', error: 'No default owner is configured for Meta leads yet.' };
  }

  let result: Awaited<ReturnType<typeof createOrMergeLead>>;
  try {
    result = await createOrMergeLead(
      {
        name: normalized.name,
        mobile: normalized.mobile,
        email: normalized.email,
        designation: normalized.designation,
        company: normalized.company,
        city: normalized.city,
        cardImageUrl: '',
        interests: [],
        subInterests: [],
        followUpActions: [],
        priority: '',
        budget: '',
        notes: normalized.notes,
        source: 'meta_lead_ads',
        meta: {
          leadId: details.leadId,
          pageId: context.pageId || '',
          formId: details.formId,
          formName: details.formName,
          campaignId: details.campaignId,
          campaignName: details.campaignName,
          adsetId: details.adsetId,
          adsetName: details.adsetName,
          adId: details.adId,
          adName: details.adName,
          platform: details.platform,
          createdAt: details.createdAt || new Date().toISOString(),
          rawFieldData: details.fieldData
        }
      },
      owner.username
    );
  } catch (err) {
    // Two concurrent webhook deliveries for the same brand-new leadgen_id
    // can both pass the findLeadByMetaLeadId pre-check above (neither has
    // written yet) and both reach here — the DB-level unique index on
    // leads.meta_lead_id is what actually guarantees only one row exists,
    // by rejecting the second INSERT. That rejection surfaces as a Postgres
    // unique-violation, which this treats the same as the pre-check finding
    // an existing lead (the other request's write already won) rather than
    // letting it propagate as an unhandled failure with the event stuck at
    // 'pending' forever.
    const isUniqueViolation = err instanceof Error && (err.name === 'SequelizeUniqueConstraintError' || /leads_meta_lead_id_unique/i.test(err.message));
    if (isUniqueViolation) {
      const winner = await findLeadByMetaLeadId(leadgenId);
      await event.update({ status: 'ignored_duplicate', resulting_lead_id: winner?.id || null, processed_at: new Date(), attempts });
      return { status: 'ignored_duplicate', leadId: winner?.id };
    }
    await event.update({ status: 'failed', last_error: err instanceof Error ? err.message : String(err), attempts });
    return { status: 'failed', error: 'Could not save this lead.' };
  }

  const platformLabel = details.platform === 'ig' ? 'Instagram' : 'Facebook';
  const label = details.campaignName || details.formName || 'Lead Ad';
  await logAudit({
    by: owner.username,
    role: owner.role,
    entityType: 'meta_lead',
    entityId: result.record.id,
    action: result.merged
      ? `Meta lead merged into existing lead (${platformLabel} — "${label}")`
      : `Meta lead imported (${platformLabel} — "${label}")`,
    previousStatus: '',
    newStatus: result.record.priority || 'unrated',
    remarks: `Meta Lead ID: ${details.leadId}`,
    ip: ''
  });

  await notifyUsers([owner.username], {
    title: result.merged ? 'Meta lead merged into an existing lead' : 'New Meta lead assigned to you',
    body: `${result.record.name || result.record.company || 'A new lead'} via ${platformLabel} — ${label}`,
    type: 'meta_lead_assigned',
    entityType: 'lead',
    entityId: result.record.id
  });

  await event.update({ status: 'processed', resulting_lead_id: result.record.id, processed_at: new Date(), attempts });

  return { status: result.merged ? 'merged' : 'created', leadId: result.record.id };
}
