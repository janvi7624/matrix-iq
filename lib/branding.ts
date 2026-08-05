// Single source of truth for every user-facing brand string in the app —
// login page, dashboard, headers, PDFs/DCs, metadata, manifest, error pages.
// To rebrand the whole platform, change the values here; nothing else should
// ever hardcode the product name. `companyName` is the real legal company
// (NANTA Technology Limited) and stays separate from `appName` (the internal
// platform's own product name) — PDFs/quotations/DCs sent to clients are
// business documents from the company, not from "the app", so they keep
// referencing companyName/companyLegalName regardless of appName.
export const BRAND = {
  appName: 'MatrixIQ',
  shortName: 'MatrixIQ',
  tagline: 'Every process, connected.',
  description: 'MatrixIQ — an interconnected business network linking teams, tasks, and information, unifying CRM, sales, projects, and operations for NANTA Technology Limited.',
  version: '1.0.0',
  companyName: 'NANTA',
  companyLegalName: 'NANTA Technology Limited',
  logo: '/NANTA.png',
  favicon: '/NANTA.png',
  themeColor: '#111827',
  accentColor: '#dc2626'
} as const;
