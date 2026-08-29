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
  return NextResponse.json({ error: message }, { status: 500 });
}
