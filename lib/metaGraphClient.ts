import { MetaLeadFieldDatum } from './types';

// Meta Graph API — Lead Ads. Version pinned to what Meta's own developer
// docs listed as current as of this integration being built (Aug 2026);
// v20.0 and earlier are scheduled to stop working 24 Sep 2026. Bump this
// when Meta deprecates v25.0 — see developers.facebook.com/docs/graph-api/changelog.
const GRAPH_API_VERSION = 'v25.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export type MetaGraphErrorKind = 'invalid_token' | 'expired_token' | 'missing_permission' | 'rate_limit' | 'invalid_lead_id' | 'network' | 'unknown';

export class MetaGraphError extends Error {
  kind: MetaGraphErrorKind;
  // Full technical detail — logged server-side only, never surfaced as-is
  // to a browser (spec: "Log technical details server-side. Show
  // user-friendly messages in UI.").
  detail: string;

  constructor(kind: MetaGraphErrorKind, message: string, detail: string) {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}

// Meta's Graph API error codes that map to a specific, actionable kind —
// everything else falls back to 'unknown' rather than guessing.
function classifyGraphError(status: number, body: { error?: { code?: number; type?: string; message?: string } }): MetaGraphError {
  const err = body?.error;
  const detail = err ? `[${err.code ?? status} ${err.type ?? ''}] ${err.message ?? ''}` : `HTTP ${status}`;
  if (err?.code === 190) return new MetaGraphError('expired_token', 'The Meta access token is invalid or has expired. Reconnect via Meta Business Suite and update META_PAGE_ACCESS_TOKEN.', detail);
  if (err?.code === 200 || err?.code === 10) return new MetaGraphError('missing_permission', 'The Meta access token is missing a required permission (leads_retrieval, pages_manage_metadata, pages_show_list, pages_read_engagement, or ads_management).', detail);
  if (err?.code === 4 || err?.code === 17 || err?.code === 32) return new MetaGraphError('rate_limit', 'Meta API rate limit reached — this will be retried automatically.', detail);
  if (status === 400 && err?.type === 'GraphMethodException') return new MetaGraphError('invalid_lead_id', 'This Meta lead ID could not be found (it may be older than Meta’s 90-day retention window).', detail);
  return new MetaGraphError('unknown', 'Meta API request failed.', detail);
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let response: Response;
  try {
    response = await fetch(url.toString(), { method: 'GET' });
  } catch (networkErr) {
    throw new MetaGraphError('network', 'Could not reach the Meta Graph API — network error.', String(networkErr));
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw classifyGraphError(response.status, body);
  return body as T;
}

interface RawLeadResponse {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  field_data?: MetaLeadFieldDatum[];
}

export interface MetaLeadDetails {
  leadId: string;
  createdAt: string;
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  formId: string;
  formName: string;
  platform: 'fb' | 'ig' | '';
  fieldData: MetaLeadFieldDatum[];
}

function normalizePlatform(raw?: string): 'fb' | 'ig' | '' {
  const v = (raw || '').toLowerCase();
  if (v.includes('instagram') || v === 'ig') return 'ig';
  if (v.includes('facebook') || v === 'fb') return 'fb';
  return '';
}

// Fetches the full lead record for a leadgen_id — the webhook POST only
// ever carries the id, never the actual answers (spec section 5: "Do not
// assume that the POST contains the complete lead information").
export async function fetchLeadDetails(leadgenId: string, pageAccessToken: string): Promise<MetaLeadDetails> {
  const raw = await graphGet<RawLeadResponse>(`/${leadgenId}`, {
    fields: 'field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,created_time',
    access_token: pageAccessToken
  });

  // form_name isn't part of the lead node itself — a second, best-effort
  // call resolves it. Not fatal if it fails (rate limit, missing
  // permission on this particular sub-resource): the lead is still fully
  // usable without a form name, so this failure is swallowed rather than
  // bubbled up as a whole fetchLeadDetails failure.
  let formName = '';
  if (raw.form_id) {
    try {
      const form = await graphGet<{ name?: string }>(`/${raw.form_id}`, { fields: 'name', access_token: pageAccessToken });
      formName = form.name || '';
    } catch {
      formName = '';
    }
  }

  return {
    leadId: raw.id,
    createdAt: raw.created_time || '',
    adId: raw.ad_id || '',
    adName: raw.ad_name || '',
    adsetId: raw.adset_id || '',
    adsetName: raw.adset_name || '',
    campaignId: raw.campaign_id || '',
    campaignName: raw.campaign_name || '',
    formId: raw.form_id || '',
    formName,
    platform: normalizePlatform(raw.platform),
    fieldData: Array.isArray(raw.field_data) ? raw.field_data : []
  };
}

export interface MetaConnectionCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface MetaConnectionTestResult {
  ok: boolean;
  checks: MetaConnectionCheck[];
}

// Verifies credentials, page access, and Graph API reachability without
// ever putting the token itself into the result (spec section 22: "Do not
// expose secrets in the error").
export async function testConnection(pageAccessToken: string, pageId: string): Promise<MetaConnectionTestResult> {
  const checks: MetaConnectionCheck[] = [];

  try {
    const me = await graphGet<{ id: string; name?: string }>('/me', { fields: 'id,name', access_token: pageAccessToken });
    checks.push({ label: 'Credentials valid', ok: true, detail: `Authenticated as ${me.name || me.id}` });
  } catch (err) {
    const e = err instanceof MetaGraphError ? err : new MetaGraphError('unknown', 'Could not validate credentials.', String(err));
    checks.push({ label: 'Credentials valid', ok: false, detail: e.message });
    return { ok: false, checks };
  }

  if (!pageId) {
    checks.push({ label: 'Page accessible', ok: false, detail: 'No Page ID configured.' });
    return { ok: false, checks };
  }

  try {
    const page = await graphGet<{ id: string; name?: string }>(`/${pageId}`, { fields: 'id,name', access_token: pageAccessToken });
    checks.push({ label: 'Page accessible', ok: true, detail: page.name || page.id });
  } catch (err) {
    const e = err instanceof MetaGraphError ? err : new MetaGraphError('unknown', 'Could not access the configured Page.', String(err));
    checks.push({ label: 'Page accessible', ok: false, detail: e.message });
    return { ok: false, checks };
  }

  try {
    const perms = await graphGet<{ data?: { permission?: string; status?: string }[] }>('/me/permissions', { access_token: pageAccessToken });
    const hasLeadsRetrieval = (perms.data || []).some((p) => p.permission === 'leads_retrieval' && p.status === 'granted');
    checks.push({ label: 'Lead access available', ok: hasLeadsRetrieval, detail: hasLeadsRetrieval ? 'leads_retrieval permission is granted.' : 'leads_retrieval permission is missing or not yet approved — required to fetch lead details.' });
  } catch (err) {
    const e = err instanceof MetaGraphError ? err : new MetaGraphError('unknown', 'Could not check lead access permission.', String(err));
    checks.push({ label: 'Lead access available', ok: false, detail: e.message });
  }

  try {
    const subs = await graphGet<{ data?: { subscribed_fields?: string[] }[] }>(`/${pageId}/subscribed_apps`, { access_token: pageAccessToken });
    const hasLeadgen = (subs.data || []).some((s) => (s.subscribed_fields || []).includes('leadgen'));
    checks.push({ label: 'Webhook configured', ok: hasLeadgen, detail: hasLeadgen ? 'This app is subscribed to leadgen events on the Page.' : 'This app is not subscribed to the Page’s leadgen field yet.' });
  } catch (err) {
    const e = err instanceof MetaGraphError ? err : new MetaGraphError('unknown', 'Could not check webhook subscription.', String(err));
    checks.push({ label: 'Webhook configured', ok: false, detail: e.message });
  }

  return { ok: checks.every((c) => c.ok), checks };
}
