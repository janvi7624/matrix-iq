import { NextResponse } from 'next/server';

// Without this, an unhandled throw in a route handler (e.g. Vercel Blob
// rejecting because BLOB_READ_WRITE_TOKEN isn't set) surfaces as a bare
// framework 500 with no detail in the response body — hard to diagnose from
// the client. This turns any thrown error into a JSON response with a real
// message, while still logging the full error server-side for the Vercel
// function logs.
export function apiErrorResponse(error: unknown): NextResponse {
  console.error(error);
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  return NextResponse.json({ error: message }, { status: 500 });
}
