// Plain constants only, no imports — so the browser bundle can share these
// numbers with the server without pulling lib/auth.ts (and its signing code)
// into the client. The countdown a person sees and the token it is counting
// down must come from the same place, or the warning lies.

// No interaction for this long and the session is over. The signed token is
// only valid this long, so the server enforces it; the browser side is there to
// say so politely rather than to be the rule.
export const SESSION_IDLE_MS = 30 * 60 * 1000;

// How long the warning is on screen before the session actually ends.
export const SESSION_WARN_BEFORE_MS = 2 * 60 * 1000;

// The soonest a renewal may be sent again. Interaction is constant while
// someone works, so without this the heartbeat would fire on every mouse move.
export const SESSION_HEARTBEAT_MIN_GAP_MS = 5 * 60 * 1000;

// Shared across tabs through localStorage: working in one tab must not time out
// another. Reads/writes are always wrapped — storage can throw or come back
// empty in a private window.
export const SESSION_ACTIVITY_STORAGE_KEY = 'mx:last-activity';
