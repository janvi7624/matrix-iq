// Per-domain product catalog used by the Demo Schedule "products demonstrated"
// picker — lets a demo cover more than one domain (e.g. AV + AI) and lists
// the actual sellable products/bundles/models within each selected domain,
// not just the domain name. Pure data, safe to import client-side.
import { DomainKey } from './types';
import { aiBundles } from './data/aiBundles';
import { visitIqPlans } from './data/visitiq';
import { roboticsProducts } from './data/roboticsProducts';

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
