// Every <textarea> in the app grows with its text: it starts at its own
// `rows` height, expands line by line up to MAX_LINES, and only then scrolls
// inside. Installed once (components/ui/AutoGrowTextareas), so each form and
// view gets it without changes. Opt out with data-autogrow="off".

export const MAX_LINES = 6;

/** Height for a textarea: content height, between its rows-height and the max. Pure — exported for tests. */
export function growHeight(opts: { scrollHeight: number; lineHeight: number; extra: number; rows: number; maxLines?: number }): { height: number; scroll: boolean } {
  const maxLines = Math.max(opts.maxLines ?? MAX_LINES, opts.rows); // a textarea already taller than the cap keeps its size
  const min = opts.lineHeight * opts.rows + opts.extra;
  const max = opts.lineHeight * maxLines + opts.extra;
  const height = Math.min(Math.max(opts.scrollHeight, min), max);
  return { height, scroll: opts.scrollHeight > max };
}

function resize(el: HTMLTextAreaElement) {
  if (el.dataset.autogrow === 'off') return;
  const cs = getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 14;
  const lineHeight = cs.lineHeight === 'normal' ? fontSize * 1.35 : parseFloat(cs.lineHeight) || fontSize * 1.35;
  const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const borderBox = cs.boxSizing === 'border-box';
  el.style.height = 'auto';
  // scrollHeight = text + padding (no border). Convert to the box-sizing's height.
  const { height, scroll } = growHeight({
    scrollHeight: borderBox ? el.scrollHeight + border : el.scrollHeight - padding,
    lineHeight,
    extra: borderBox ? padding + border : 0,
    rows: el.rows || 2
  });
  el.style.height = `${Math.ceil(height)}px`;
  el.style.overflowY = scroll ? 'auto' : 'hidden';
}

let installed = false;

/** Starts auto-growing every textarea on the page (now and later). Returns an uninstall function. */
export function installAutoGrowTextareas(): () => void {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;

  const onInput = (e: Event) => {
    if (e.target instanceof HTMLTextAreaElement) resize(e.target);
  };
  document.addEventListener('input', onInput, true);

  // Text set by code (a loaded draft, an edit form opening) — resize after DOM changes, once per frame.
  let frame = 0;
  const sweep = () => {
    frame = 0;
    document.querySelectorAll('textarea').forEach((el) => resize(el));
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(sweep);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  // React sets a controlled textarea's value as a property (no DOM mutation) — catch it on focus too.
  const onFocus = (e: Event) => {
    if (e.target instanceof HTMLTextAreaElement) resize(e.target);
  };
  document.addEventListener('focusin', onFocus, true);
  window.addEventListener('resize', schedule);
  schedule();

  return () => {
    installed = false;
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('focusin', onFocus, true);
    window.removeEventListener('resize', schedule);
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
