// Shared icon set for the 5 built-in nav/dashboard categories, reused by
// Sidebar.tsx and Dashboard.tsx so a category's icon matches everywhere it
// appears. A custom-module section (arbitrary admin-typed name) falls back
// to a generic folder icon rather than going iconless.
const SECTION_ICON: Record<string, string> = {
  Sales: '📁',
  Marketing: '📣',
  Operations: '📦',
  Reports: '📊',
  Administration: '🏢'
};

const DEFAULT_SECTION_ICON = '🗂️';

export function iconForSection(label: string): string {
  return SECTION_ICON[label] || DEFAULT_SECTION_ICON;
}
