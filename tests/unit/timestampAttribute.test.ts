import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';

// Guards a mistake that hit five files at once and failed silently.
//
// Sequelize's `underscored: true` changes the COLUMN name to created_at but
// leaves the ATTRIBUTE named createdAt. Reading `plain.created_at` therefore
// yields undefined — which surfaced as "Invalid Date" in the partner portal,
// and, far quieter, emptied the analytics trend (every date unparseable, so
// every row silently dropped) and stopped SLA due dates being stamped at all.
//
// Source-level because that is where the mistake lives: the value is
// undefined at runtime, so a behavioural test would need a database to
// notice, and the symptom is absence rather than an error.

const FILES = [
  'lib/partnerDemoStore.ts',
  'lib/partnerProjectStore.ts',
  'lib/partnerQuotationStore.ts',
  'lib/partnerAnalytics.ts',
  'lib/supportTicketStore.ts'
];

// SupportTicketComment is the one model that explicitly configures
// `createdAt: 'created_at'`, so for THAT model the column name is correct.
const ALLOWED = [
  // lib/supportTicketStore.ts — listComments(), reading a comment row.
  { file: 'lib/supportTicketStore.ts', count: 1 }
];

describe('timestamp attribute reads', () => {
  it.each(FILES)('%s reads createdAt, not the column name', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    // Ignore comments — several of these files explain the trap in prose.
    const code = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');

    const hits = (code.match(/plain\.created_at|get\('created_at'\)/g) ?? []).length;
    const allowed = ALLOWED.find((a) => a.file === file)?.count ?? 0;
    expect(hits).toBe(allowed);
  });

  it('every one of these files does read createdAt somewhere', () => {
    // The inverse check: a file that reads neither spelling would pass the
    // assertion above while still showing no date at all.
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).toMatch(/createdAt/);
    }
  });
});
