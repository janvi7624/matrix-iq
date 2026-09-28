import { NextResponse } from 'next/server';

// Without this, an unhandled throw in a route handler (e.g. a Postgres
// constraint violation, or Supabase Storage rejecting because
// SUPABASE_SERVICE_ROLE_KEY isn't set) surfaces as a bare framework 500 with
// no detail in the response body — hard to diagnose from the client. This
// turns any thrown error into a JSON response with a real message, while
// still logging the full error server-side for the app's own logs.
export function apiErrorResponse(error: unknown): NextResponse {
  console.error(error);
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  // Storage being down is not the caller's fault and not a bug in the request
  // — 503 says "try later", and the message is already written for the person
  // reading it (see lib/fileStorage.ts). Matched by name rather than by
  // importing the class, so this file stays free of the storage client and
  // every route that imports it doesn't drag the S3 SDK in.
  if (error instanceof Error && error.name === 'StorageUnavailableError') {
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}
