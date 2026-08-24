import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// Centralized AWS SES sender — every feature (user creation now, quotations/
// demos/approvals later) goes through this one function instead of touching
// the AWS SDK directly. Credentials/config come entirely from env vars (see
// .env.example); nothing here is hardcoded.
export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

let sesClient: SESClient | null = null;

function getClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({ region: process.env.AWS_REGION });
  }
  return sesClient;
}

// Lets callers skip the send (and log a clear reason) instead of throwing
// when SES hasn't been configured yet — keeps the app usable before AWS
// credentials are provisioned, per the "configuration-ready, no fake
// credentials" requirement.
export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_SES_FROM_EMAIL
  );
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const toAddresses = Array.isArray(input.to) ? input.to : [input.to];

  if (!isEmailConfigured()) {
    console.warn(
      `[email] AWS SES is not configured (missing AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SES_FROM_EMAIL) — skipped "${input.subject}" to ${toAddresses.join(', ')}`
    );
    return;
  }

  const command = new SendEmailCommand({
    Source: process.env.AWS_SES_FROM_EMAIL,
    Destination: { ToAddresses: toAddresses },
    Message: {
      Subject: { Data: input.subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: input.html, Charset: 'UTF-8' },
        ...(input.text ? { Text: { Data: input.text, Charset: 'UTF-8' } } : {})
      }
    }
  });

  await getClient().send(command);
}
