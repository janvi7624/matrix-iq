// The single place that maps every hardcoded lib/data/*.ts product catalog
// to a generic (catalog, productKey) -> {name?, priceFields} shape that
// lib/productOverrideStore.ts persists and every estimator + the admin
// catalog editor (app/admin/product-catalog) both read through. Plain data,
// no server-only imports — safe to import from client or server code.
import { standeeModels } from './data/standeeModels';
import { ledModels } from './data/ledModels';
import { interactivePanelProducts } from './data/interactivePanelProducts';
import { avCameraProducts } from './data/avCameraProducts';
import { cableProducts } from './data/cableProducts';
import { roboticsProducts } from './data/roboticsProducts';
import { aiAnalytics, AI_SLAB_LABELS } from './data/aiAnalytics';
import { aiBundles } from './data/aiBundles';
import { visitIqPlans, visitIqAddOns } from './data/visitiq';

export interface PriceFieldDef {
  key: string;
  label: string;
  arrayLabels?: string[]; // present only for tiered fields — render one input per slab, not one flat input
}

export interface CatalogDef {
  id: string;
  label: string;
  nameField: string | null; // null = renaming disabled for this catalog (ai-analytics — name is a live join key)
  priceFields: PriceFieldDef[];
  getBaseRecords: () => Record<string, Record<string, unknown>>;
}

const threeTier = (): PriceFieldDef[] => [
  { key: 'distributorPrice', label: 'Distributor Price' },
  { key: 'partnerPrice', label: 'Partner Price' },
  { key: 'customerPrice', label: 'Customer Price' }
];

const tierField = (): PriceFieldDef[] => [{ key: 'tiers', label: 'Per-camera/year tiers', arrayLabels: AI_SLAB_LABELS }];

export const CATALOGS: CatalogDef[] = [
  {
    id: 'standee',
    label: 'AV — Standee',
    nameField: 'details',
    priceFields: [
      { key: 'partnerPrice', label: 'Partner Price' },
      { key: 'endUserPrice', label: 'End-User MRP' }
    ],
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
    getBaseRecords: () => ledModels as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'interactive-panel',
    label: 'AV — Interactive Panel',
    nameField: 'name',
    priceFields: threeTier(),
    getBaseRecords: () => interactivePanelProducts as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'conference',
    label: 'AV — Conferencing',
    nameField: 'description',
    priceFields: threeTier(),
    getBaseRecords: () => avCameraProducts as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'conference-accessory',
    label: 'AV — Conferencing Accessories',
    nameField: 'name',
    priceFields: threeTier(),
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
    getBaseRecords: () => cableProducts as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'robotics',
    label: 'Robotics',
    nameField: 'description',
    priceFields: threeTier(),
    getBaseRecords: () => roboticsProducts as unknown as Record<string, Record<string, unknown>>
  },
  {
    id: 'ai-analytics',
    label: 'AI Video Analytics — Features',
    nameField: null,
    priceFields: tierField(),
    getBaseRecords: () => Object.fromEntries(aiAnalytics.map((f) => [f.name, f as unknown as Record<string, unknown>]))
  },
  {
    id: 'ai-bundles',
    label: 'AI Video Analytics — Bundles',
    nameField: 'name',
    priceFields: tierField(),
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
    getBaseRecords: () => Object.fromEntries(visitIqPlans.map((p) => [p.id, p as unknown as Record<string, unknown>]))
  },
  {
    id: 'visitiq-addon',
    label: 'VisitIQ — Add-Ons',
    nameField: 'label',
    priceFields: [{ key: 'monthlyPrice', label: 'Price' }],
    getBaseRecords: () => Object.fromEntries(visitIqAddOns.map((a) => [a.key, a as unknown as Record<string, unknown>]))
  }
];

export function findCatalog(id: string): CatalogDef | undefined {
  return CATALOGS.find((c) => c.id === id);
}
