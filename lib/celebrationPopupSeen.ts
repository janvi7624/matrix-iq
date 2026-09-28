// Remembers that this login has already been shown today's birthday /
// anniversary popup.
//
// The popup used to reappear on every single visit to the dashboard, all day:
// dismissing it only set a piece of React state, which a reload or a trip to
// another page and back threw away. The intent was "available all day"; in
// practice it meant the same person was interrupted by the same popup several
// times a day.
//
// Now it shows once, and is shown again only after a fresh login — every
// logout path clears this (see forgetCelebrationPopups), so signing out and
// back in on a birthday still shows it.
//
// Deliberately localStorage, not sessionStorage: sessionStorage is per TAB, so
// a second dashboard tab would count as a fresh showing. This is keyed by user
// and date, so it cannot leak between people sharing a machine or survive into
// tomorrow. No imports — safe for any client component.

const PREFIX = 'mx:celebrations-seen:';

function todayKey(username: string): string {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${PREFIX}${username}:${date}`;
}

// Every access is guarded: storage throws in a private window, and can be
// disabled outright. Losing this only means the popup shows again, so failing
// open is the right way to fail.
export function hasSeenCelebrationPopup(username: string): boolean {
  if (!username) return false;
  try {
    return window.localStorage.getItem(todayKey(username)) === '1';
  } catch {
    return false;
  }
}

export function markCelebrationPopupSeen(username: string): void {
  if (!username) return;
  try {
    window.localStorage.setItem(todayKey(username), '1');
  } catch {
    // Popup shows again next visit — acceptable, and better than breaking the
    // dashboard over a storage permission.
  }
}

// Called from every sign-out path so "once per login" really means per login
// rather than per day. Clears yesterday's leftovers at the same time, since
// nothing else ever would.
export function forgetCelebrationPopups(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX)) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // As above.
  }
}
