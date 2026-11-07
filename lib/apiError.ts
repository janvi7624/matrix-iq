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
  // A delete/update blocked by a foreign-key constraint (e.g. deleting a
  // user who still has a RESTRICT-protected row pointing at them, such as an
  // assigned general task — see OPSQA-DEF-003) is a real, expected business
  // rule outcome, not a server bug. Left unhandled it surfaced as a raw
  // Postgres constraint message in a bare 500. 409 Conflict says "this is
  // blocked by current state, fix that first" rather than "something broke";
  // matched by name for the same reason as StorageUnavailableError above —
  // this file stays free of a direct Sequelize import.
  if (error instanceof Error && error.name === 'SequelizeForeignKeyConstraintError') {
    return NextResponse.json(
      { error: 'This cannot be deleted because other records still depend on it. Resolve those first.' },
      { status: 409 }
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}
