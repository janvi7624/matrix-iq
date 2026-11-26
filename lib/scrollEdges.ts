/**
 * Whether a horizontally scrollable box has content hidden off its left
 * and/or right edge. A 2px tolerance absorbs sub-pixel rounding (and zoom),
 * so a table that fits exactly never shows a "scroll for more" cue.
 */
export function scrollEdges(scrollLeft: number, scrollWidth: number, clientWidth: number, tolerance = 2): { left: boolean; right: boolean } {
  const overflow = scrollWidth - clientWidth;
  if (overflow <= tolerance) return { left: false, right: false };
  // RTL layouts report a negative scrollLeft — use its magnitude.
  const pos = Math.abs(scrollLeft);
  return { left: pos > tolerance, right: pos < overflow - tolerance };
}
