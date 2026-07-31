import { readJsonBlob, writeJsonBlob } from './blobStore';
import { AppConfig, PublicAppConfig } from './types';

const DATA_PATHNAME = 'data/appConfig.json';

// Seeded from the values that were previously hardcoded in lib/pdf.ts /
// lib/deliveryChallanStore.ts, so nothing changes on the first read — an
// Admin only sees a difference once they actually edit something in
// /admin/settings.
export const DEFAULT_APP_CONFIG: AppConfig = {
  companyName: 'NANTA',
  companyLegalName: 'NANTA Technology Limited',
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
  notificationTemplates: [
    { key: 'demo_approval_pending', label: 'Demo Approval Pending', subject: 'Demo request awaiting your approval', body: 'Hi {{name}}, a demo request for {{client}} is awaiting your approval.' },
    { key: 'dc_generated', label: 'Delivery Challan Generated', subject: 'DC {{dcNumber}} generated', body: 'Delivery Challan {{dcNumber}} has been generated for {{client}}.' },
    { key: 'material_return_pending', label: 'Material Return Pending', subject: 'Materials pending return', body: 'Materials for DC {{dcNumber}} are due for return verification.' }
  ],
  updated_at: '',
  updated_by: ''
};

function normalize(config: Partial<AppConfig>): AppConfig {
  return { ...DEFAULT_APP_CONFIG, ...config };
}

export async function getAppConfig(): Promise<AppConfig> {
  const stored = await readJsonBlob<Partial<AppConfig> | null>(DATA_PATHNAME, null);
  return normalize(stored || {});
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
  const current = await getAppConfig();
  const next: AppConfig = { ...current, ...patch, updated_at: new Date().toISOString(), updated_by: updatedBy };
  await writeJsonBlob(DATA_PATHNAME, next);
  return next;
}
