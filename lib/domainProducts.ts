// Per-domain product catalog used by the Demo Schedule "products demonstrated"
// picker — lets a demo cover more than one domain (e.g. AV + AI) and lists
// the actual sellable products/bundles/models within each selected domain,
// not just the domain name. Pure data, safe to import client-side.
import { DomainKey } from './types';
import { aiBundles } from './data/aiBundles';
import { visitIqPlans } from './data/visitiq';
import { roboticsProducts } from './data/roboticsProducts';
import { standeeModels } from './data/standeeModels';
import { ledModels } from './data/ledModels';
import { interactivePanelProducts } from './data/interactivePanelProducts';
import { aioModels } from './data/aioModels';
import { avCameraProducts } from './data/avCameraProducts';
import { cableProducts } from './data/cableProducts';
import { aiAnalytics } from './data/aiAnalytics';

export const AV_PRODUCT_LABELS = [
  'Standee',
  'LED Display',
  'Interactive Flat Panel',
  'Conferencing Cameras & Microphones',
  'AV Cables',
  'AV Solution (room-based)'
];

export function getDomainProducts(domain: DomainKey): string[] {
  switch (domain) {
    case 'av':
      return AV_PRODUCT_LABELS;
    case 'ai':
      return aiBundles.map((b) => b.name);
    case 'robotics':
      return Object.keys(roboticsProducts);
    case 'visitiq':
      return visitIqPlans.map((p) => p.name);
    case 'si':
      return [];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Demo Schedule picker: product → model, two levels.
// e.g. AV → Conferencing Cameras & Microphones → NT-EC-VB-4K (Video Bar).
// `models` is the dropdown; an "Other" option lets the rep type any model not
// in the catalog. Kept separate from getDomainProducts() because Site Visit
// still uses that flat list.
// ---------------------------------------------------------------------------

export interface DemoProductGroup {
  product: string;
  models: string[];
}

/** Line separator between the product and its model in a stored demo line. */
export const DEMO_MODEL_SEPARATOR = ' — ';

function groupBy<T>(entries: [string, T][], key: (v: T) => string): DemoProductGroup[] {
  const map = new Map<string, string[]>();
  for (const [name, value] of entries) {
    const k = key(value) || 'Other';
    map.set(k, [...(map.get(k) ?? []), name]);
  }
  return [...map].map(([product, models]) => ({ product, models }));
}

export function getDemoProductGroups(domain: DomainKey): DemoProductGroup[] {
  switch (domain) {
    case 'av':
      return [
        { product: 'Standee', models: Object.keys(standeeModels) },
        { product: 'LED Display', models: Object.keys(ledModels) },
        {
          product: 'Interactive Flat Panel',
          models: [...Object.values(interactivePanelProducts).map((p) => p.name), ...Object.keys(aioModels)]
        },
        {
          product: 'Conferencing Cameras & Microphones',
          models: Object.entries(avCameraProducts).map(([key, p]) => `${key} (${p.category})`)
        },
        { product: 'AV Cables', models: Object.keys(cableProducts) },
        { product: 'AV Solution (room-based)', models: [] }
      ];
    case 'robotics':
      return groupBy(Object.entries(roboticsProducts), (p) => p.category);
    case 'ai':
      return [
        { product: 'AI Bundle', models: aiBundles.map((b) => b.name) },
        { product: 'AI Analytics (individual)', models: aiAnalytics.map((a) => a.name) }
      ];
    case 'visitiq':
      return [{ product: 'VisitIQ Plan', models: visitIqPlans.map((p) => p.name) }];
    default:
      return [];
  }
}
