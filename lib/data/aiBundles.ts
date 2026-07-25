import { aiAnalytics } from './aiAnalytics';

export interface AiBundle {
  name: string;
  description: string;
  // Feature names — must match `name` in aiAnalytics. Empty means "all analytics".
  includedFeatureNames: string[];
  aLaCarteValue: number; // sum of the same analytics bought individually (₹/cam/yr) — informational
  // ₹/cam/yr at each volume slab: [1–25, 26–60, 61–100, 101–500, 500+]
  tiers: [number, number, number, number, number];
  savingsPercent: number; // vs. buying the same analytics à-la-carte, at the 1–25 slab
}

// Source: public/AI_Pricing_Structure.xlsx, section "A. BUNDLE PRICING — PER
// CAMERA / YEAR (VOLUME SLAB-WISE)". Bundle prices already include the volume
// discount — they are the recommended commercial offer over à-la-carte.
export const aiBundles: AiBundle[] = [
  {
    name: 'Basic Surveillance',
    description: 'Entry-level coverage for small sites.',
    includedFeatureNames: ['People Count', 'Object Detection', 'Camera Tampering'],
    aLaCarteValue: 20000,
    tiers: [15100, 13590, 12080, 10570, 9060],
    savingsPercent: 24.5
  },
  {
    name: 'Advanced Security',
    description: 'Perimeter, loitering, and fire risk coverage for corporate/campus security.',
    includedFeatureNames: [
      'People Count',
      'Object Detection',
      'Camera Tampering',
      'Intrusion Detection',
      'Loitering Detection',
      'Unattended Object',
      'Fight Detection',
      'Fire & Smoke'
    ],
    aLaCarteValue: 92000,
    tiers: [26000, 23400, 20800, 18200, 15600],
    savingsPercent: 71.74
  },
  {
    name: 'Vehicle & Traffic',
    description: 'ANPR and traffic/parking compliance analytics.',
    includedFeatureNames: ['ANPR', 'Vehicle Count', 'Speed Detection', 'Wrong Parking', 'No Helmet', 'Triple Rider', 'No Seatbelt'],
    aLaCarteValue: 103000,
    tiers: [28500, 25650, 22800, 19950, 17100],
    savingsPercent: 72.33
  },
  {
    name: 'Face Recognition',
    description: 'Identity matching and watchlist search.',
    includedFeatureNames: ['Face Recognition', 'Face Search', 'People Count'],
    aLaCarteValue: 50000,
    tiers: [27900, 25110, 22320, 19530, 16740],
    savingsPercent: 44.2
  },
  {
    name: 'Industrial & Worker Safety',
    description: 'PPE compliance and workplace incident detection.',
    includedFeatureNames: ['PPE Detection', 'Fire & Smoke', 'Intrusion Detection', 'Person Collapse', 'Unattended Object', 'Camera Tampering'],
    aLaCarteValue: 83000,
    tiers: [26900, 24210, 21520, 18830, 16140],
    savingsPercent: 67.59
  },
  {
    name: 'Retail & Footfall Analytics',
    description: 'Customer traffic, dwell time, and ad engagement for retail.',
    includedFeatureNames: ['People Count', 'Footfall Analytics', 'Customer Footfall & Dwell Time', 'Crowd Count', 'Person Gaze to Advertisement'],
    aLaCarteValue: 41500,
    tiers: [18200, 16380, 14560, 12740, 10920],
    savingsPercent: 56.14
  },
  {
    name: 'Women & Public Safety',
    description: 'Lone-woman and crowd-risk safety monitoring.',
    includedFeatureNames: ['Lone Woman Detection', 'Woman Surrounded By Men', 'Violence Detection', 'Person Collapse', 'Crowd Count'],
    aLaCarteValue: 72000,
    tiers: [24800, 22320, 19840, 17360, 14880],
    savingsPercent: 65.56
  },
  {
    name: 'Smart City / Enterprise (All Analytics)',
    description: 'All analytics across Basic, Security, Face, Vehicle & Industrial/Safety categories.',
    includedFeatureNames: [], // empty = all
    aLaCarteValue: 681500,
    tiers: [49300, 44370, 39440, 34510, 29580],
    savingsPercent: 92.77
  }
];

export function resolveBundleFeatureNames(bundle: AiBundle): string[] {
  return bundle.includedFeatureNames.length ? bundle.includedFeatureNames : aiAnalytics.map((f) => f.name);
}

// Source: xlsx section "B. ONE-TIME SETUP COST — (BY DEPLOYMENT SIZE)". Covers
// integration, configuration, installation & training only — the Nanta VMS
// dashboard itself is included at no separate license cost. Hardware is quoted
// separately. Indexed the same as AI_SLAB_LABELS / getAiSlabIndex.
export const AI_SETUP_COST_BY_SLAB = [35000, 55000, 80000, 95000, 125000];

// Source: xlsx section "D. SAMPLE COMMERCIAL — WORKED EXAMPLE". Fixed
// illustrative figures, not tied to the user's current inputs.
export const AI_WORKED_EXAMPLE = {
  cameras: 100,
  bundleName: 'Advanced Security',
  slabLabel: '61–100 Cameras',
  bundlePricePerCameraYear: 20800,
  annualSubscription: 2080000,
  oneTimeSetup: 80000,
  year1TotalBeforeGst: 2160000,
  gstAmount: 388800,
  year1TotalInclGst: 2548800,
  year2OnwardBeforeGst: 2080000
};

// Source: xlsx section "E. SALES & QUOTING GUIDELINES".
export const AI_SALES_GUIDELINES = [
  'All prices are EXCLUSIVE of GST (currently 18%). Always quote GST as a separate line.',
  'Basis: Analytics = Per Camera / Year (recurring). Dashboard & setup = One-Time. AMC applies from Year 2.',
  'Volume slab is decided by the TOTAL cameras in the order (across all sites), not per site.',
  'Bundle prices already include the volume discount — do NOT stack additional discounts without approval.',
  'Discount authority: up to 5% → Sales Executive · 5–10% → Sales Manager · >10% → Management.',
  'Floor price: never quote below the 500+ slab rate of a bundle for any deal.',
  'Mix & match: if a client needs analytics across bundles, quote the nearest bundle + add à-la-carte features.',
  'Quote validity: 30 days. Benchmarked for Gujarat / West India, FY 2025–26.',
  'On-premise hardware (servers, GPU, storage, cameras, networking) is quoted SEPARATELY and is not part of the prices above.'
];
