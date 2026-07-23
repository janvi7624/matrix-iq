import { LED_CONTROLLER_RULES, LED_CONTROLLER_SPECS, LedControllerRule, LedControllerSpec } from './data/ledControllerData';

export type LedUnit = 'ft' | 'm' | 'in';
export type LedInstallCategory = 'indoor' | 'outdoor';
export type LedRedundancyMode = 'auto' | 'yes' | 'no';

export interface LedDimensions {
  height: number;
  width: number;
  unit: LedUnit;
}

export function getLedDimensionsFt({ height, width, unit }: LedDimensions): { widthFt: number; heightFt: number } {
  let heightFt = height;
  let widthFt = width;
  if (unit === 'm') {
    heightFt *= 3.28084;
    widthFt *= 3.28084;
  } else if (unit === 'in') {
    heightFt /= 12;
    widthFt /= 12;
  }
  return { widthFt, heightFt };
}

export function getAreaSqFt({ height, width, unit }: LedDimensions): number {
  const area = height * width;
  if (unit === 'm') return area * 10.7639;
  if (unit === 'in') return area * 0.00694444;
  return area;
}

export const LED_ASPECT_PRESETS: Record<string, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
  '1:1': 1,
  '3:2': 3 / 2
};

export function ftToCurrentUnit(ft: number, unit: LedUnit): number {
  if (unit === 'm') return ft / 3.28084;
  if (unit === 'in') return ft * 12;
  return ft;
}

// Converts a single length value between LED dimension units, preserving the
// physical size (used when the unit dropdown changes so the numbers in the
// height/width fields don't silently get reinterpreted under the new unit).
export function convertLedLength(value: number, fromUnit: LedUnit, toUnit: LedUnit): number {
  if (fromUnit === toUnit) return value;
  let ft = value;
  if (fromUnit === 'm') ft = value * 3.28084;
  else if (fromUnit === 'in') ft = value / 12;
  return ftToCurrentUnit(ft, toUnit);
}

export function getNearestAspectPreset(ratio: number): string {
  let best = '16:9';
  let bestDiff = Infinity;
  Object.entries(LED_ASPECT_PRESETS).forEach(([label, value]) => {
    const diff = Math.abs(value - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = label;
    }
  });
  return best;
}

export function parseCustomRatio(text: string): number | null {
  const parts = String(text || '').split(':').map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
  return null;
}

export function pitchStringToMm(pitchStr: string): number {
  const n = parseFloat(String(pitchStr || '').replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? n : 2.5;
}

export function pixelPitchBand(pitchMm: number): string {
  if (pitchMm <= 1.25) return 'P0.9-P1.25';
  if (pitchMm <= 2.5) return 'P1.53-P2.5';
  if (pitchMm <= 5) return 'P3-P5';
  return 'P6-P10';
}

export interface LedPixelSpec {
  widthFt: number;
  heightFt: number;
  widthMm: number;
  heightMm: number;
  pitchMm: number;
  horizontalPixels: number;
  verticalPixels: number;
  totalPixels: number;
  pitchBand: string;
  installationType: 'Indoor' | 'Outdoor';
  controlMode: string;
  areaSqFt: number;
}

export function computeLedPixelSpec(input: {
  dimensions: LedDimensions;
  category: LedInstallCategory;
  modelPitch: string;
  controlMode: string;
}): LedPixelSpec {
  const { widthFt, heightFt } = getLedDimensionsFt(input.dimensions);
  const widthMm = widthFt * 304.8;
  const heightMm = heightFt * 304.8;
  const pitchMm = pitchStringToMm(input.modelPitch);
  const horizontalPixels = Math.max(1, Math.round(widthMm / pitchMm));
  const verticalPixels = Math.max(1, Math.round(heightMm / pitchMm));
  const totalPixels = horizontalPixels * verticalPixels;
  const pitchBand = pixelPitchBand(pitchMm);
  const installationType = input.category === 'outdoor' ? 'Outdoor' : 'Indoor';
  const areaSqFt = getAreaSqFt(input.dimensions);
  return {
    widthFt,
    heightFt,
    widthMm,
    heightMm,
    pitchMm,
    horizontalPixels,
    verticalPixels,
    totalPixels,
    pitchBand,
    installationType,
    controlMode: input.controlMode || 'Synchronous',
    areaSqFt
  };
}

export function matchLedControllerRule(spec: LedPixelSpec, rules: LedControllerRule[] = LED_CONTROLLER_RULES): LedControllerRule | null {
  for (const r of rules) {
    const c = r.c;
    if (spec.totalPixels <= c.gt || spec.totalPixels > c.lte) continue;
    if (spec.horizontalPixels > c.w || spec.verticalPixels > c.h) continue;
    if (c.pb !== 'Any' && c.pb !== spec.pitchBand) continue;
    if (c.it !== 'Any' && c.it !== spec.installationType) continue;
    if (c.cm && c.cm !== spec.controlMode) continue;
    return r;
  }
  return null;
}

export interface LedControllerSelection {
  matched: boolean;
  spec: LedPixelSpec;
  redundant: boolean;
  redundancyReason: string;
  name: string;
  brand: string;
  model: string;
  series: string;
  baseUnits: number;
  units: number;
  unitPrice: number;
  totalPrice: number;
  confidence: number;
  reason: string;
  specSheet: LedControllerSpec | null;
}

export function getLedControllerSelection(
  spec: LedPixelSpec,
  redundancyMode: LedRedundancyMode,
  rules: LedControllerRule[] = LED_CONTROLLER_RULES,
  specs: Record<string, LedControllerSpec> = LED_CONTROLLER_SPECS
): LedControllerSelection {
  const rule = matchLedControllerRule(spec, rules);

  let redundant = false;
  let redundancyReason = '';
  if (redundancyMode === 'yes') {
    redundant = true;
    redundancyReason = 'Manually forced by user.';
  } else if (redundancyMode !== 'no') {
    if (spec.installationType === 'Outdoor' && spec.areaSqFt > 400) {
      redundant = true;
      redundancyReason = 'Outdoor display area exceeds 400 sq ft (weather-exposed, high-visibility asset).';
    } else if (spec.totalPixels > 4000000) {
      redundant = true;
      redundancyReason = 'Total pixel count exceeds 4,000,000 px (large commercial wall).';
    }
  }

  if (!rule) {
    return {
      matched: false,
      spec,
      redundant,
      redundancyReason,
      name: 'No controller match found',
      brand: '',
      model: '',
      series: '',
      baseUnits: 0,
      units: 0,
      unitPrice: 0,
      totalPrice: 0,
      confidence: 0,
      reason: 'Display exceeds the engineering dataset range. Consult NANTA engineering for a custom multi-controller cascade.',
      specSheet: null
    };
  }

  const baseUnits = rule.rec.units || 1;
  const units = redundant ? baseUnits * 2 : baseUnits;
  const key = `${rule.rec.brand} ${rule.rec.model}`;
  const specSheet = specs[key] || null;
  const unitPrice = specSheet ? specSheet.priceInr ?? Math.round((specSheet.msrpUsd || 0) * 84) : 0;
  const totalPrice = unitPrice * units;

  return {
    matched: true,
    spec,
    redundant,
    redundancyReason,
    name: key,
    brand: rule.rec.brand,
    model: rule.rec.model,
    series: rule.rec.series || '',
    baseUnits,
    units,
    unitPrice,
    totalPrice,
    confidence: rule.conf,
    reason: rule.reason,
    specSheet
  };
}
