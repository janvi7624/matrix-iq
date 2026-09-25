// Single source of truth for every user-facing brand string in the app —
// login page, dashboard, headers, PDFs/DCs, metadata, manifest, error pages.
// To rebrand the whole platform, change the values here; nothing else should
// ever hardcode the product name. `companyName` is the real legal company
// (NANTA TECH LIMITED) and stays separate from `appName` (the internal
// platform's own product name) — PDFs/quotations/DCs sent to clients are
// business documents from the company, not from "the app", so they keep
// referencing companyName/companyLegalName regardless of appName.
export const BRAND = {
  appName: 'MatrixIQ',
  shortName: 'MatrixIQ',
  tagline: 'Every process, connected.',
  description: 'MatrixIQ — an interconnected business network linking teams, tasks, and information, unifying CRM, sales, projects, and operations for NANTA TECH LIMITED.',
  version: '1.0.0',
  companyName: 'NANTA',
  companyLegalName: 'NANTA TECH LIMITED',
  // The full icon+wordmark lockup (~3.6:1 wide) — correct for every current
  // `logo` usage (login, change-password, error/not-found headers, portal
  // header) because they all size it by height only (CSS `width: auto`), so
  // it renders at its real aspect ratio and stays legible.
  // The PNG stays the canonical asset because the PDF and XLSX exporters
  // embed it directly (lib/deliveryChallanPdf.ts, lib/expenseVoucherPdf.ts,
  // lib/officeOperationExpenseXlsx.ts) and jsPDF/ExcelJS want PNG, not WebP.
  logo: '/NANTA.png',
  // Same lockup, same 935x267, as WebP: 16.2KB against the PNG's 72.8KB for
  // no visible difference on a flat two-colour mark. Every on-screen use goes
  // through this one — it was 22% of the login page's entire transfer, and it
  // loads on every page of the app, so it was the single largest saving
  // available anywhere in the product.
  logoWeb: '/nanta-logo.webp',
  // A browser/PWA favicon is always forced into a fixed square regardless of
  // CSS, so the wide lockup above would shrink to an illegible sliver there
  // — this is a tightly-cropped square export of just the mark (see
  // public/nanta_technologies_logo.svg for the source vector), which is also
  // what Sidebar's fixed 32x32 badge uses (BRAND.iconMark) for the same
  // reason.
  favicon: '/nanta-icon.png',
  iconMark: '/nanta-icon.png',
  themeColor: '#111827',
  accentColor: '#dc2626'
} as const;
