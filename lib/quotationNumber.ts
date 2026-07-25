import { DomainKey } from './types';

export const DOMAIN_QUOTE_PREFIX: Record<DomainKey, string> = {
  av: 'AV',
  robotics: 'ROBO',
  ai: 'AI',
  si: 'SI',
  visitiq: 'VIQ'
};

export function computeQuotationPrefix(domains: DomainKey[]): string {
  const unique = new Set(domains);
  if (unique.size > 1) return 'COMBO';
  const only = [...unique][0];
  return (only && DOMAIN_QUOTE_PREFIX[only]) || 'NT';
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

// Format: NT-{PREFIX}-{DD}/{MM}/{YYYY}/{sequence}, e.g. NT-ROBO-21/07/2026/001.
// The sequence is per-prefix-per-day and only assigned authoritatively on save
// (see lib/quotationStore.ts) — this just renders the number given a known sequence.
export function formatQuotationNumber(prefix: string, year: number, month: number, day: number, sequence: number): string {
  return `NT-${prefix}-${pad(day, 2)}/${pad(month, 2)}/${year}/${pad(sequence, 3)}`;
}

// Client-side draft number shown before the record is actually saved to the log
// (the real sequence is only known once the server assigns it).
export function generateDraftQuotationNumber(prefix: string, now: Date = new Date()): string {
  return `NT-${prefix}-${pad(now.getDate(), 2)}/${pad(now.getMonth() + 1, 2)}/${now.getFullYear()}/---`;
}

export function refreshDraftQuotationNumber(current: string, prefix: string): string {
  const match = current.match(/^NT-[A-Z]+-(\d{2}\/\d{2}\/\d{4}\/.+)$/);
  if (match) return `NT-${prefix}-${match[1]}`;
  if (!current.trim()) return generateDraftQuotationNumber(prefix);
  return current;
}
