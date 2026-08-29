// The ONLY place Meta (Facebook/Instagram) Lead Ads credentials are read
// from. They live exclusively in server env vars — never in the database,
// never returned by any API response, never logged — same pattern every
// other secret in this app already follows (lib/auth.ts's
// ADMIN_SESSION_SECRET, lib/email/emailService.ts's AWS credentials).
//
// If these are unset, the integration is inert: the webhook route rejects
// every event (no secret to verify a signature against), the admin page
// shows "Not configured", and nothing else in the app breaks.

export interface MetaEnvConfig {
  appId: string;
  appSecret: string;
  verifyToken: string;
  pageId: string;
  pageAccessToken: string;
}

export function getMetaEnvConfig(): MetaEnvConfig {
  return {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    verifyToken: process.env.META_VERIFY_TOKEN || '',
    pageId: process.env.META_PAGE_ID || '',
    pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || ''
  };
}

export interface MetaCredentialStatus {
  appId: boolean;
  appSecret: boolean;
  verifyToken: boolean;
  pageId: boolean;
  pageAccessToken: boolean;
}

// Presence-only — never the values themselves. This is what the admin
// settings page's GET response is built from.
export function metaCredentialStatus(): MetaCredentialStatus {
  const env = getMetaEnvConfig();
  return {
    appId: Boolean(env.appId),
    appSecret: Boolean(env.appSecret),
    verifyToken: Boolean(env.verifyToken),
    pageId: Boolean(env.pageId),
    pageAccessToken: Boolean(env.pageAccessToken)
  };
}

export function isMetaFullyConfigured(): boolean {
  const status = metaCredentialStatus();
  return status.appId && status.appSecret && status.verifyToken && status.pageId && status.pageAccessToken;
}

// The signature-verification path only ever needs appSecret + the webhook
// verification handshake only needs verifyToken — the Graph API calls only
// need pageAccessToken. This narrower check is what the webhook route uses
// so it can still verify/reject correctly even if, say, pageAccessToken
// isn't configured yet but appSecret/verifyToken already are.
export function isWebhookSecurityConfigured(): boolean {
  const env = getMetaEnvConfig();
  return Boolean(env.appSecret && env.verifyToken);
}
