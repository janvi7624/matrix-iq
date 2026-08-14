import { Model } from 'sequelize';
import { AppConfig, PublicAppConfig } from './types';
import { db } from './db';
import { cached, invalidateCache } from './memoCache';

// One singleton row, read on nearly every quotation/DC/PDF/pricing
// calculation (tax rate, company details) but written only from the rare
// /admin/settings edit — same cache-with-explicit-invalidation pattern as
// roleStore.ts/departmentStore.ts/moduleConfigStore.ts.
const APP_CONFIG_CACHE_KEY = 'appConfig';
const APP_CONFIG_CACHE_TTL_MS = 30_000;

// Seeded from the values that were previously hardcoded in lib/pdf.ts /
// lib/deliveryChallanStore.ts, so nothing changes on the first read — an
// Admin only sees a difference once they actually edit something in
// /admin/settings.
export const DEFAULT_APP_CONFIG: AppConfig = {
  companyName: 'NANTA',
  companyLegalName: 'NANTA TECH LIMITED',
  gstNumber: '',
  panNumber: '',
  addressLine1: '205, F Block, Shivalik Sharda Harmony,',
  addressLine2: 'Panjarapole Cross Rd, Ambawadi,',
  addressLine3: 'Ahmedabad, Gujarat - 380015',
  contactPhone: '',
  contactEmail: 'sales@nantatech.com',
  website: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankName: '',
  bankBranch: '',
  currencyCode: 'INR',
  currencySymbol: '₹',
  defaultTaxPercent: 18,
  taxLabel: 'GST',
  quotationTerms: [
    'Any items other than mentioned in the above BOQ will be charged additional as per the feasibility of the solution.',
    'Standard delivery period: 20-25 working days approx from the date of order. Installation after delivery.',
    'Payment - 100% advance or as mutually agreed.',
    "Above charges are only for supply of components. Installation is in the partner's scope; commissioning, if required, will be provided by NANTA Technology on a chargeable basis.",
    'Any drawings / layout / placement details / DB level / modular reports will be charged additional under documentation charges.',
    'All post-sales support and installation support is virtual (telephonic and remote support).',
    'Onsite support charges will be extra after complete handover of the project.',
    'Payment needs to be done as per agreed terms and cannot be put on hold for any performance-related issues.',
    'NANTA Technology reserves the right to change the above quote at any given point of time.',
    'Warranty will be guided by the OEM warranty terms for the items listed above and is void if not installed / operated per OEM guidelines.',
    'Taxes will be charged as per applicable government terms.',
    'The scope of supply includes only the items listed above. Prices are for the complete bill of material and are not valid for partial purchases.',
    'SITC (Supply, Installation, Testing & Commissioning) is included in the above scope unless mentioned otherwise.'
  ],
  dcNumberPrefix: 'NT-DC-',
  marketingOwnerId: '',
  marketingOwnerUsername: '',
  notificationTemplates: [
    { key: 'demo_approval_pending', label: 'Demo Approval Pending', subject: 'Demo request awaiting your approval', body: 'Hi {{name}}, a demo request for {{client}} is awaiting your approval.' },
    { key: 'dc_generated', label: 'Delivery Challan Generated', subject: 'DC {{dcNumber}} generated', body: 'Delivery Challan {{dcNumber}} has been generated for {{client}}.' },
    { key: 'material_return_pending', label: 'Material Return Pending', subject: 'Materials pending return', body: 'Materials for DC {{dcNumber}} are due for return verification.' }
  ],
  updated_at: '',
  updated_by: ''
};

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const updaterInclude = { model: db.User, as: 'updater', attributes: ['id', 'username'] };
const marketingOwnerInclude = { model: db.User, as: 'marketingOwner', attributes: ['id', 'username'] };

function toRecord(row: Model): AppConfig {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    companyName: (plain.companyName as string) ?? '',
    companyLegalName: (plain.companyLegalName as string) ?? '',
    gstNumber: (plain.gstNumber as string) ?? '',
    panNumber: (plain.panNumber as string) ?? '',
    addressLine1: (plain.addressLine1 as string) ?? '',
    addressLine2: (plain.addressLine2 as string) ?? '',
    addressLine3: (plain.addressLine3 as string) ?? '',
    contactPhone: (plain.contactPhone as string) ?? '',
    contactEmail: (plain.contactEmail as string) ?? '',
    website: (plain.website as string) ?? '',
    bankAccountName: (plain.bankAccountName as string) ?? '',
    bankAccountNumber: (plain.bankAccountNumber as string) ?? '',
    bankIfsc: (plain.bankIfsc as string) ?? '',
    bankName: (plain.bankName as string) ?? '',
    bankBranch: (plain.bankBranch as string) ?? '',
    currencyCode: (plain.currencyCode as string) ?? '',
    currencySymbol: (plain.currencySymbol as string) ?? '',
    defaultTaxPercent: Number(plain.defaultTaxPercent ?? 0),
    taxLabel: (plain.taxLabel as string) ?? '',
    quotationTerms: (plain.quotationTerms as string[]) ?? [],
    dcNumberPrefix: (plain.dcNumberPrefix as string) ?? '',
    notificationTemplates: (plain.notificationTemplates as AppConfig['notificationTemplates']) ?? [],
    marketingOwnerId: (plain.marketingOwnerId as string) ?? '',
    marketingOwnerUsername: (plain.marketingOwner as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    updated_by: (plain.updater as { username?: string } | null)?.username ?? ''
  };
}

// Singleton — always exactly one row. Created lazily from DEFAULT_APP_CONFIG
// on first read/write since a fresh DB starts with none.
async function getOrCreateRow() {
  const existing = await db.AppConfig.findOne({ include: [updaterInclude, marketingOwnerInclude] });
  if (existing) return existing;
  const { updated_at: _updatedAt, updated_by: _updatedBy, marketingOwnerUsername: _marketingOwnerUsername, marketingOwnerId: _marketingOwnerId, ...defaults } = DEFAULT_APP_CONFIG;
  void _updatedAt;
  void _updatedBy;
  void _marketingOwnerUsername;
  void _marketingOwnerId;
  // marketingOwnerId is a UUID column — must be null, not '', or Postgres
  // rejects the insert (same reason updated_by/updated_at are excluded here).
  const row = await db.AppConfig.create({ ...defaults, marketingOwnerId: null } as never);
  return (await db.AppConfig.findByPk(row.get('id') as string, { include: [updaterInclude, marketingOwnerInclude] })) as NonNullable<typeof row>;
}

export async function getAppConfig(): Promise<AppConfig> {
  return cached(APP_CONFIG_CACHE_KEY, APP_CONFIG_CACHE_TTL_MS, async () => {
    const row = await getOrCreateRow();
    return toRecord(row);
  });
}

export async function getPublicAppConfig(): Promise<PublicAppConfig> {
  const config = await getAppConfig();
  const { bankAccountName, bankAccountNumber, bankIfsc, bankName, bankBranch, notificationTemplates, updated_at, updated_by, ...rest } = config;
  void bankAccountName;
  void bankAccountNumber;
  void bankIfsc;
  void bankName;
  void bankBranch;
  void notificationTemplates;
  void updated_at;
  void updated_by;
  return rest;
}

export async function updateAppConfig(patch: Partial<AppConfig>, updatedBy: string): Promise<AppConfig> {
  const row = await getOrCreateRow();
  const updater = await db.User.findOne({ where: { username: updatedBy } as never });
  const { updated_at: _updatedAt, updated_by: _updatedBy, marketingOwnerUsername: _marketingOwnerUsername, ...attrs } = patch;
  void _updatedAt;
  void _updatedBy;
  void _marketingOwnerUsername;
  // defaultTaxPercent is the one numeric column here — coerced the same way
  // every other numeric field in the app is, so a non-numeric value (or a
  // string from a form field) can't reach Postgres raw and crash with a 500.
  if (attrs.defaultTaxPercent !== undefined) attrs.defaultTaxPercent = Number(attrs.defaultTaxPercent) || 0;
  // marketingOwnerId is a UUID column — '' (the "no owner selected" state
  // from the settings dropdown) must become null, not an empty string.
  if (attrs.marketingOwnerId !== undefined) {
    (attrs as Record<string, unknown>).marketingOwnerId = attrs.marketingOwnerId || null;
  }
  await row.update({ ...attrs, updatedBy: updater ? updater.get('id') : null } as never);
  invalidateCache(APP_CONFIG_CACHE_KEY);
  return getAppConfig();
}
