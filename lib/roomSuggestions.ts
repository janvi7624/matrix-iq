import { AvProjectType } from './types';
import { getConferenceSuggestion } from './conferenceSuggestions';

// Room-size (seat count) based product suggestions spanning every AV project
// type where seat count actually matters: Interactive Flat Panel, LED Display,
// Conferencing Camera & Microphone, and AV Cables. Every recommended model is
// a real, quotable SKU already in the relevant catalog — this only picks
// which one fits, it never invents a product.
//
// Standee is intentionally not included: standees are lobby/signage kiosks,
// not meeting-room displays, so seat count has no real bearing on which one
// to pick. Robotics / AI Video Analytics / System Integration are unrelated
// domains and are likewise out of scope for a "room size" suggestion.

export interface RoomProductSuggestion {
  avProjectType: AvProjectType;
  categoryLabel: string;
  modelKey: string;
  modelLabel: string;
  reason: string;
  ledDimensions?: { heightFt: number; widthFt: number };
}

export interface RoomSuggestions {
  tierLabel: string;
  items: RoomProductSuggestion[];
}

interface Tier {
  tierLabel: string;
  panelModel: string;
  panelLabel: string;
  panelReason: string;
  ledHeightFt: number;
  ledWidthFt: number;
  ledModel: string;
  ledReason: string;
  cableModel: string;
  cableReason: string;
}

const TIERS: { maxSeats: number; tier: Tier }[] = [
  {
    maxSeats: 4,
    tier: {
      tierLabel: 'Huddle room (up to 4 seats)',
      panelModel: 'NTA-IFP65-AI',
      panelLabel: '65" InfiniteView AI Panel',
      panelReason: 'Comfortably legible at huddle-room viewing distances without dominating a small space.',
      ledHeightFt: 4,
      ledWidthFt: 6,
      ledModel: 'Indoor SMD P2.5',
      ledReason: 'Fine 2.5mm pitch keeps text sharp up close, if an LED wall is preferred over a flat panel.',
      cableModel: 'NTA-HAA4K-005',
      cableReason: '5M HDMI run — enough for a short table-to-display connection.'
    }
  },
  {
    maxSeats: 8,
    tier: {
      tierLabel: 'Small/medium room (5–8 seats)',
      panelModel: 'NTA-IFP75-AI',
      panelLabel: '75" InfiniteView AI Panel',
      panelReason: 'Readable from the far end of a standard conference table.',
      ledHeightFt: 5,
      ledWidthFt: 8,
      ledModel: 'Indoor SMDP3',
      ledReason: '3mm pitch balances clarity and cost for a slightly larger room.',
      cableModel: 'NTA-HAA4K-010',
      cableReason: '10M HDMI run for a larger room layout.'
    }
  },
  {
    maxSeats: 14,
    tier: {
      tierLabel: 'Medium/large room (9–14 seats)',
      panelModel: 'NTA-IFP86-AI',
      panelLabel: '86" InfiniteView AI Panel',
      panelReason: 'Scales up for a longer table where seats further back still need a clear view.',
      ledHeightFt: 6,
      ledWidthFt: 10,
      ledModel: 'Indoor SMD P4',
      ledReason: 'Coarser 4mm pitch is fine once viewers sit further from the screen, at lower cost per sq ft.',
      cableModel: 'NTA-HAA4K-020',
      cableReason: '20M HDMI run for a larger boardroom-style layout.'
    }
  }
];

const BOARDROOM_TIER: Tier = {
  tierLabel: 'Boardroom (15+ seats)',
  panelModel: 'NTA-IFP98-AI',
  panelLabel: '98" InfiniteView AI Panel',
  panelReason: 'Largest panel in the range, sized for a full boardroom where the back row is well away from the screen.',
  ledHeightFt: 8,
  ledWidthFt: 14,
  ledModel: 'Indoor SMD P4',
  ledReason: 'A video-wall-style display at this size reads well at 4mm pitch for a large room.',
  cableModel: 'NTA-HAA4K-030',
  cableReason: '30M HDMI run for a large boardroom.'
};

function getTier(seats: number): Tier {
  const n = Math.max(1, Math.round(seats) || 1);
  const found = TIERS.find((t) => n <= t.maxSeats);
  return found ? found.tier : BOARDROOM_TIER;
}

export function getRoomSuggestions(seats: number): RoomSuggestions {
  const tier = getTier(seats);
  const conference = getConferenceSuggestion(seats);

  const items: RoomProductSuggestion[] = [
    {
      avProjectType: 'interactive-panel',
      categoryLabel: 'Interactive Flat Panel',
      modelKey: tier.panelModel,
      modelLabel: tier.panelLabel,
      reason: tier.panelReason
    },
    {
      avProjectType: 'conference',
      categoryLabel: 'Conferencing Camera & Microphone',
      modelKey: conference.primaryModel,
      modelLabel: conference.primaryModel,
      reason: conference.primaryReason
    },
    {
      avProjectType: 'led',
      categoryLabel: 'LED Display (alternative to a flat panel)',
      modelKey: tier.ledModel,
      modelLabel: `${tier.ledModel} — ${tier.ledHeightFt}×${tier.ledWidthFt} ft`,
      reason: tier.ledReason,
      ledDimensions: { heightFt: tier.ledHeightFt, widthFt: tier.ledWidthFt }
    },
    {
      avProjectType: 'cables',
      categoryLabel: 'AV Cables',
      modelKey: tier.cableModel,
      modelLabel: tier.cableModel,
      reason: tier.cableReason
    }
  ];

  return { tierLabel: tier.tierLabel, items };
}
