// The single place that maps every hardcoded lib/data/*.ts product catalog
// to a generic (catalog, productKey) -> {name?, priceFields} shape that
// lib/productOverrideStore.ts persists and every estimator + the admin
// catalog editor (app/admin/product-catalog) both read through. Plain data,
// no server-only imports — safe to import from client or server code.
import { standeeModels, STANDEE_CATEGORIES } from './data/standeeModels';
import { ledModels } from './data/ledModels';
import { aioModels } from './data/aioModels';
import { interactivePanelProducts } from './data/interactivePanelProducts';
import { avCameraProducts } from './data/avCameraProducts';
import { cableProducts, CABLE_SERIES } from './data/cableProducts';
import { roboticsProducts } from './data/roboticsProducts';
import { aiAnalytics, AI_SLAB_LABELS } from './data/aiAnalytics';
import { aiBundles } from './data/aiBundles';
import { visitIqPlans, visitIqAddOns } from './data/visitiq';

export interface PriceFieldDef {
  key: string;
  label: string;
  arrayLabels?: string[]; // present only for tiered fields — render one input per slab, not one flat input
}

export interface CreateFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'tiers' | 'string-list' | 'boolean' | 'select';
  options?: string[]; // for 'select'
  optional?: boolean; // e.g. image, badge, popular — omit-safe fields
}

// How a brand-new product's productKey is obtained:
// - 'separate': a free-typed SKU/model code, its own input in the create form.
// - { derivedFrom }: no separate key input — the productKey IS the value of
//   this named createField (e.g. ai-analytics/ai-bundles key off `name`).
// - 'parent-conference': must reuse an existing `conference` product's key
//   (an accessory can't exist without its parent camera).
export type KeySource = 'separate' | { derivedFrom: string } | 'parent-conference';

export interface CatalogDef {
  id: string;
  label: string;
  nameField: string | null; // null = renaming disabled for this catalog (ai-analytics — name is a live join key)
  priceFields: PriceFieldDef[];
  createFields: CreateFieldDef[];
  keySource: KeySource;
  getBaseRecords: () => Record<string, Record<string, unknown>>;
}

const threeTier = (): PriceFieldDef[] => [
  { key: 'distributorPrice', label: 'Distributor Price' },
  { key: 'partnerPrice', label: 'Partner Price' },
  { key: 'customerPrice', label: 'Customer Price' }
];

const threeTierCreateFields = (): CreateFieldDef[] => [
  { key: 'distributorPrice', label: 'Distributor Price', type: 'number' },
  { key: 'partnerPrice', label: 'Partner Price', type: 'number' },
  { key: 'customerPrice', label: 'Customer Price', type: 'number' }
];

const tierField = (): PriceFieldDef[] => [{ key: 'tiers', label: 'Per-camera/year tiers', arrayLabels: AI_SLAB_LABELS }];
const tierCreateField = (): CreateFieldDef => ({ key: 'tiers', label: 'Per-camera/year tiers', type: 'tiers' });

export const CATALOGS: CatalogDef[] = [
  {
    id: 'standee',
    label: 'AV — Standee',
    nameField: 'details',
    priceFields: [
      { key: 'partnerPrice', label: 'Partner Price' },
      { key: 'endUserPrice', label: 'End-User MRP' }
    ],
    createFields: [
      { key: 'category', label: 'Category', type: 'select', options: [...STANDEE_CATEGORIES] },
      { key: 'details', label: 'Details', type: 'text' },
      { key: 'size', label: 'Size', type: 'text' },
      { key: 'partnerPrice', label: 'Partner Price', type: 'number' },
      { key: 'endUserPrice', label: 'End-User MRP', type: 'number' },
      { key: 'fabricationPerUnit', label: 'Fabrication / unit', type: 'number' },
      { key: 'installationPerUnit', label: 'Installation / unit', type: 'number' },
      { key: 'scaffoldingPerUnit', label: 'Scaffolding / unit', type: 'number' }
    ],
    keySource: 'separate',
    getBaseRecords: () => standeeModels as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'led',
    label: 'AV — LED',
    nameField: 'details',
    priceFields: [
      { key: 'b2bPricePerSqFt', label: 'B2B ₹/sq ft' },
      { key: 'b2cPricePerSqFt', label: 'B2C ₹/sq ft' }
    ],
    createFields: [
      { key: 'details', label: 'Details', type: 'text' },
      { key: 'category', label: 'Category', type: 'select', options: ['indoor', 'outdoor', 'cob', 'smd'] },
      { key: 'pitch', label: 'Pitch', type: 'text' },
      { key: 'b2bPricePerSqFt', label: 'B2B ₹/sq ft', type: 'number' },
      { key: 'b2cPricePerSqFt', label: 'B2C ₹/sq ft', type: 'number' },
      { key: 'installationPerSqFt', label: 'Installation ₹/sq ft', type: 'number' },
      { key: 'fabricationPerSqFt', label: 'Fabrication ₹/sq ft', type: 'number' },
      { key: 'scaffoldingFixed', label: 'Scaffolding (fixed)', type: 'number' }
    ],
    keySource: 'separate',
    getBaseRecords: () => ledModels as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'aio',
    label: 'AV — Active LED AIO Series',
    nameField: 'details',
    priceFields: [{ key: 'price', label: 'Price' }],
    createFields: [
      { key: 'details', label: 'Details', type: 'text' },
      { key: 'diagonalInches', label: 'Diagonal (inches)', type: 'number' },
      { key: 'resolutionClass', label: 'Resolution', type: 'select', options: ['FHD', '4K'] },
      { key: 'price', label: 'Price', type: 'number' }
    ],
    keySource: 'separate',
    getBaseRecords: () => aioModels as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'interactive-panel',
    label: 'AV — Interactive Panel',
    nameField: 'name',
    priceFields: threeTier(),
    createFields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      ...threeTierCreateFields(),
      { key: 'image', label: 'Image path/URL', type: 'text', optional: true }
    ],
    keySource: 'separate',
    getBaseRecords: () => interactivePanelProducts as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'conference',
    label: 'AV — Conferencing',
    nameField: 'description',
    priceFields: threeTier(),
    createFields: [
      { key: 'modelTag', label: 'Model Tag', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      ...threeTierCreateFields(),
      { key: 'image', label: 'Image path/URL', type: 'text', optional: true }
    ],
    keySource: 'separate',
    getBaseRecords: () => avCameraProducts as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'conference-accessory',
    label: 'AV — Conferencing Accessories',
    nameField: 'name',
    priceFields: threeTier(),
    createFields: [{ key: 'name', label: 'Name', type: 'text' }, ...threeTierCreateFields()],
    keySource: 'parent-conference',
    getBaseRecords: () =>
      Object.fromEntries(
        Object.entries(avCameraProducts)
          .filter(([, p]) => p.accessory)
          .map(([key, p]) => [key, p.accessory as unknown as Record<string, unknown>])
      )
  },
  {
    id: 'cables',
    label: 'AV — Cables',
    nameField: 'description',
    priceFields: threeTier(),
    createFields: [
      { key: 'series', label: 'Series', type: 'select', options: Object.keys(CABLE_SERIES) },
      { key: 'length', label: 'Length (label)', type: 'text' },
      { key: 'lengthMeters', label: 'Length (meters)', type: 'number' },
      { key: 'description', label: 'Description', type: 'text' },
      ...threeTierCreateFields()
    ],
    keySource: 'separate',
    getBaseRecords: () => cableProducts as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'robotics',
    label: 'Robotics',
    nameField: 'description',
    priceFields: threeTier(),
    createFields: [
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      ...threeTierCreateFields(),
      { key: 'image', label: 'Image path/URL', type: 'text', optional: true }
    ],
    keySource: 'separate',
    getBaseRecords: () => roboticsProducts as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'ai-analytics',
    label: 'AI Video Analytics — Features',
    nameField: null,
    priceFields: tierField(),
    createFields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'desc', label: 'Description', type: 'text' },
      tierCreateField()
    ],
    keySource: { derivedFrom: 'name' },
    getBaseRecords: () => Object.fromEntries(aiAnalytics.map((f) => [f.name, f as unknown as Record<string, unknown>]))
  },
  {
    id: 'ai-bundles',
    label: 'AI Video Analytics — Bundles',
    nameField: 'name',
    priceFields: tierField(),
    createFields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'includedFeatureNames', label: 'Included analytics (comma-separated; empty = all)', type: 'string-list', optional: true },
      { key: 'aLaCarteValue', label: 'À-la-carte value (₹/cam/yr)', type: 'number' },
      tierCreateField(),
      { key: 'savingsPercent', label: 'Savings %', type: 'number' }
    ],
    keySource: { derivedFrom: 'name' },
    getBaseRecords: () => Object.fromEntries(aiBundles.map((b) => [b.name, b as unknown as Record<string, unknown>]))
  },
  {
    id: 'visitiq-plan',
    label: 'VisitIQ — Plans',
    nameField: 'name',
    priceFields: [
      { key: 'monthlyPrice', label: 'Monthly Price' },
      { key: 'annualPricePerMonth', label: 'Annual (₹/mo)' },
      { key: 'annualTotal', label: 'Annual Total' }
    ],
    createFields: [
      { key: 'id', label: 'Plan ID (slug)', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'monthlyPrice', label: 'Monthly Price', type: 'number' },
      { key: 'annualPricePerMonth', label: 'Annual (₹/mo)', type: 'number' },
      { key: 'annualTotal', label: 'Annual Total', type: 'number' },
      { key: 'robots', label: 'Robots included (blank = unlimited)', type: 'number', optional: true },
      { key: 'kiosks', label: 'Kiosks included (blank = unlimited)', type: 'number', optional: true },
      { key: 'employees', label: 'Employees included (blank = unlimited)', type: 'number', optional: true },
      { key: 'admins', label: 'Admins', type: 'text' },
      { key: 'badge', label: 'Badge', type: 'text', optional: true },
      { key: 'features', label: 'Features (comma-separated)', type: 'string-list' }
    ],
    keySource: { derivedFrom: 'id' },
    getBaseRecords: () => Object.fromEntries(visitIqPlans.map((p) => [p.id, p as unknown as Record<string, unknown>]))
  },
  {
    id: 'visitiq-addon',
    label: 'VisitIQ — Add-Ons',
    nameField: 'label',
    priceFields: [{ key: 'monthlyPrice', label: 'Price' }],
    createFields: [
      { key: 'key', label: 'Add-on key (slug)', type: 'text' },
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'monthlyPrice', label: 'Price (blank = quote separately)', type: 'number', optional: true },
      { key: 'oneTime', label: 'One-time charge', type: 'boolean', optional: true }
    ],
    keySource: { derivedFrom: 'key' },
    getBaseRecords: () => Object.fromEntries(visitIqAddOns.map((a) => [a.key, a as unknown as Record<string, unknown>]))
  }
];

export function findCatalog(id: string): CatalogDef | undefined {
  return CATALOGS.find((c) => c.id === id);
}
