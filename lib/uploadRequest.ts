import { NextRequest } from 'next/server';

// Shared guard for the multipart upload routes.
//
// Next buffers request bodies for proxy-enabled apps up to
// experimental.proxyClientMaxBodySize (next.config.ts). Past that the body is
// truncated silently, and request.formData() then throws a bare TypeError —
// the user just sees a failed upload with no reason. This turns both cases
// into one clear, catchable error so routes can answer 413 instead of 500.

// Kept just under the configured proxy buffer so an over-sized batch is
// refused with a real message BEFORE it can be cut off mid-file.
export const MAX_UPLOAD_REQUEST_BYTES = 45 * 1024 * 1024;

export class UploadTooLargeError extends Error {}

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export async function readUploadFormData(request: NextRequest): Promise<FormData> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_UPLOAD_REQUEST_BYTES) {
    throw new UploadTooLargeError(`These files add up to ${mb(declared)} — more than the ${mb(MAX_UPLOAD_REQUEST_BYTES)} allowed in one upload. Please upload them in smaller batches.`);
  }
  try {
    return await request.formData();
  } catch {
    // Almost always the truncated-body case above (a proxy/CDN can also cap
    // the request before it reaches us), so say something the user can act on.
    throw new UploadTooLargeError('The upload was cut off before it finished — it is likely too large. Try fewer or smaller files.');
  }
}
