import { FocusEvent } from 'react';

// Attach as onFocus on a numeric <input> whose bound value defaults to 0 —
// selects the "0" so the next keystroke replaces it instead of appending
// (typing "1" after a displayed 0 previously produced "01" instead of "1").
export function selectAllOnFocusIfZero(e: FocusEvent<HTMLInputElement>) {
  if (Number(e.target.value) === 0) e.target.select();
}
