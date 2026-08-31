import { describe, it, expect } from 'vitest';
import {
  getLedDimensionsFt,
  getAreaSqFt,
  LED_ASPECT_PRESETS,
  ftToCurrentUnit,
  convertLedLength,
  getNearestAspectPreset,
  parseCustomRatio,
  pitchStringToMm,
  pixelPitchBand,
  computeLedPixelSpec,
  matchLedControllerRule,
  getLedControllerSelection,
  LedPixelSpec
} from '../../lib/ledEngineering';
import { LED_CONTROLLER_RULES } from '../../lib/data/ledControllerData';
import type { LedControllerRule, LedControllerSpec } from '../../lib/data/ledControllerData';

describe('getLedDimensionsFt', () => {
  it('passes ft through unchanged', () => {
    expect(getLedDimensionsFt({ height: 5, width: 10, unit: 'ft' })).toEqual({ widthFt: 10, heightFt: 5 });
  });
  it('converts m to ft', () => {
    const { widthFt, heightFt } = getLedDimensionsFt({ height: 5, width: 10, unit: 'm' });
    expect(widthFt).toBeCloseTo(32.8084);
    expect(heightFt).toBeCloseTo(16.4042);
  });
  it('converts in to ft', () => {
    const { widthFt, heightFt } = getLedDimensionsFt({ height: 24, width: 12, unit: 'in' });
    expect(widthFt).toBeCloseTo(1);
    expect(heightFt).toBeCloseTo(2);
  });
});

describe('getAreaSqFt', () => {
  it('computes ft area directly', () => {
    expect(getAreaSqFt({ height: 5, width: 10, unit: 'ft' })).toBe(50);
  });
  it('converts m^2 area to sqft', () => {
    expect(getAreaSqFt({ height: 5, width: 10, unit: 'm' })).toBeCloseTo(50 * 10.7639);
  });
  it('converts in^2 area to sqft', () => {
    expect(getAreaSqFt({ height: 5, width: 10, unit: 'in' })).toBeCloseTo(50 * 0.00694444);
  });
});

describe('ftToCurrentUnit / convertLedLength', () => {
  it('ftToCurrentUnit: ft identity, m divides, in multiplies', () => {
    expect(ftToCurrentUnit(10, 'ft')).toBe(10);
    expect(ftToCurrentUnit(10, 'm')).toBeCloseTo(10 / 3.28084);
    expect(ftToCurrentUnit(1, 'in')).toBeCloseTo(12);
  });

  it('convertLedLength: same-unit returns the exact input', () => {
    expect(convertLedLength(7.3, 'm', 'm')).toBe(7.3);
  });

  it('convertLedLength: round-trips ft -> m -> ft within float tolerance', () => {
    const toM = convertLedLength(10, 'ft', 'm');
    const backToFt = convertLedLength(toM, 'm', 'ft');
    expect(backToFt).toBeCloseTo(10, 5);
  });

  it('convertLedLength: m -> in and in -> m', () => {
    expect(convertLedLength(1, 'm', 'in')).toBeCloseTo(1 * 3.28084 * 12);
    expect(convertLedLength(12, 'in', 'm')).toBeCloseTo(1 / 3.28084);
  });
});

describe('LED_ASPECT_PRESETS', () => {
  it('has the 5 expected presets with correct values, in insertion order', () => {
    expect(Object.keys(LED_ASPECT_PRESETS)).toEqual(['16:9', '4:3', '21:9', '1:1', '3:2']);
    expect(LED_ASPECT_PRESETS['16:9']).toBeCloseTo(16 / 9);
    expect(LED_ASPECT_PRESETS['4:3']).toBeCloseTo(4 / 3);
    expect(LED_ASPECT_PRESETS['21:9']).toBeCloseTo(21 / 9);
    expect(LED_ASPECT_PRESETS['1:1']).toBe(1);
    expect(LED_ASPECT_PRESETS['3:2']).toBeCloseTo(1.5);
  });
});

describe('getNearestAspectPreset', () => {
  it('matches exact presets', () => {
    expect(getNearestAspectPreset(16 / 9)).toBe('16:9');
    expect(getNearestAspectPreset(1)).toBe('1:1');
    expect(getNearestAspectPreset(21 / 9)).toBe('21:9');
  });

  it('breaks a tie in favor of the first-declared preset (strict < comparison)', () => {
    // Equidistant between 4:3 (1.3333) and 3:2 (1.5): midpoint 1.41667
    const ratio = (4 / 3 + 3 / 2) / 2;
    expect(getNearestAspectPreset(ratio)).toBe('4:3');
  });

  it('falls back to the nearest preset for an extreme ratio', () => {
    expect(getNearestAspectPreset(100)).toBe('21:9');
  });
});

describe('parseCustomRatio', () => {
  it('parses valid ratios', () => {
    expect(parseCustomRatio('16:9')).toBeCloseTo(16 / 9);
    expect(parseCustomRatio('21:9')).toBeCloseTo(21 / 9);
  });
  it('is whitespace-tolerant', () => {
    expect(parseCustomRatio('16 : 9')).toBeCloseTo(16 / 9);
  });
  it.each(['16:0', '0:9', 'a:b', '16:9:2', '', null as unknown as string])('returns null for invalid input %p', (input) => {
    expect(parseCustomRatio(input)).toBeNull();
  });
});

describe('pitchStringToMm', () => {
  it.each([
    ['P2.5', 2.5],
    ['2.5mm', 2.5],
    ['P10', 10],
    ['P0.9', 0.9]
  ])('parses %s to %s', (input, expected) => {
    expect(pitchStringToMm(input)).toBe(expected);
  });
  it.each(['', 'abc', '0'])('defaults invalid input %p to 2.5', (input) => {
    expect(pitchStringToMm(input)).toBe(2.5);
  });
});

describe('pixelPitchBand', () => {
  it.each([
    [0.9, 'P0.9-P1.25'],
    [1.25, 'P0.9-P1.25'],
    [1.26, 'P1.53-P2.5'],
    [2.5, 'P1.53-P2.5'],
    [2.51, 'P3-P5'],
    [5, 'P3-P5'],
    [5.01, 'P6-P10'],
    [10, 'P6-P10']
  ])('bands pitch %s as %s', (pitch, expected) => {
    expect(pixelPitchBand(pitch)).toBe(expected);
  });
});

describe('computeLedPixelSpec', () => {
  it('computes pixel counts, floors at 1, and derives installationType/controlMode/area', () => {
    const spec = computeLedPixelSpec({
      dimensions: { height: 10, width: 10, unit: 'in' },
      category: 'outdoor',
      modelPitch: 'P10',
      controlMode: ''
    });
    expect(spec.horizontalPixels).toBeGreaterThanOrEqual(1);
    expect(spec.verticalPixels).toBeGreaterThanOrEqual(1);
    expect(spec.totalPixels).toBe(spec.horizontalPixels * spec.verticalPixels);
    expect(spec.installationType).toBe('Outdoor');
    expect(spec.controlMode).toBe('Synchronous');
  });

  it('marks indoor category correctly and preserves an explicit controlMode', () => {
    const spec = computeLedPixelSpec({
      dimensions: { height: 3, width: 3, unit: 'm' },
      category: 'indoor',
      modelPitch: 'P2.5',
      controlMode: 'Asynchronous'
    });
    expect(spec.installationType).toBe('Indoor');
    expect(spec.controlMode).toBe('Asynchronous');
    expect(spec.areaSqFt).toBeCloseTo(getAreaSqFt({ height: 3, width: 3, unit: 'm' }));
  });
});

function makeSpec(over: Partial<LedPixelSpec> = {}): LedPixelSpec {
  return {
    widthFt: 10,
    heightFt: 5,
    widthMm: 3048,
    heightMm: 1524,
    pitchMm: 2.5,
    horizontalPixels: 1219,
    verticalPixels: 610,
    totalPixels: 1219 * 610,
    pitchBand: 'P1.53-P2.5',
    installationType: 'Indoor',
    controlMode: 'Synchronous',
    areaSqFt: 50,
    ...over
  };
}

function makeRule(over: Partial<LedControllerRule> = {}): LedControllerRule {
  return {
    c: { gt: 0, lte: 1000000, w: 4096, h: 2160, pb: 'Any', it: 'Any' },
    rec: { brand: 'TestBrand', model: 'X1', units: 1 },
    conf: 90,
    reason: 'test rule',
    ...over
  };
}

describe('matchLedControllerRule', () => {
  it('rejects a spec exactly on the exclusive lower bound (gt)', () => {
    const rule = makeRule({ c: { gt: 100, lte: 200, w: 4096, h: 2160, pb: 'Any', it: 'Any' } });
    const spec = makeSpec({ totalPixels: 100 });
    expect(matchLedControllerRule(spec, [rule])).toBeNull();
  });

  it('accepts a spec exactly on the inclusive upper bound (lte)', () => {
    const rule = makeRule({ c: { gt: 100, lte: 200, w: 4096, h: 2160, pb: 'Any', it: 'Any' } });
    const spec = makeSpec({ totalPixels: 200 });
    expect(matchLedControllerRule(spec, [rule])).toBe(rule);
  });

  it('rejects when horizontal or vertical pixels exceed the rule caps even if total pixels fit', () => {
    const rule = makeRule({ c: { gt: 0, lte: 1000000, w: 100, h: 100, pb: 'Any', it: 'Any' } });
    const spec = makeSpec({ totalPixels: 500, horizontalPixels: 200, verticalPixels: 2 });
    expect(matchLedControllerRule(spec, [rule])).toBeNull();
  });

  it('matches "Any" pitch band and installation type wildcards', () => {
    const rule = makeRule({ c: { gt: 0, lte: 1000000, w: 4096, h: 2160, pb: 'Any', it: 'Any' } });
    expect(matchLedControllerRule(makeSpec({ pitchBand: 'P6-P10', installationType: 'Outdoor' }), [rule])).toBe(rule);
  });

  it('requires an exact pitch band / installation type match when not "Any"', () => {
    const rule = makeRule({ c: { gt: 0, lte: 1000000, w: 4096, h: 2160, pb: 'P3-P5', it: 'Indoor' } });
    expect(matchLedControllerRule(makeSpec({ pitchBand: 'P6-P10' }), [rule])).toBeNull();
    expect(matchLedControllerRule(makeSpec({ pitchBand: 'P3-P5', installationType: 'Outdoor' }), [rule])).toBeNull();
    expect(matchLedControllerRule(makeSpec({ pitchBand: 'P3-P5', installationType: 'Indoor' }), [rule])).toBe(rule);
  });

  it('when cm is absent any control mode matches; when present it must match exactly', () => {
    const noCm = makeRule({ c: { gt: 0, lte: 1000000, w: 4096, h: 2160, pb: 'Any', it: 'Any' } });
    expect(matchLedControllerRule(makeSpec({ controlMode: 'Whatever' }), [noCm])).toBe(noCm);

    const withCm = makeRule({ c: { gt: 0, lte: 1000000, w: 4096, h: 2160, pb: 'Any', it: 'Any', cm: 'Synchronous' } });
    expect(matchLedControllerRule(makeSpec({ controlMode: 'Asynchronous' }), [withCm])).toBeNull();
    expect(matchLedControllerRule(makeSpec({ controlMode: 'Synchronous' }), [withCm])).toBe(withCm);
  });

  it('returns the first matching rule when multiple rules overlap', () => {
    const first = makeRule({ rec: { brand: 'First', model: 'A', units: 1 } });
    const second = makeRule({ rec: { brand: 'Second', model: 'B', units: 1 } });
    expect(matchLedControllerRule(makeSpec(), [first, second])).toBe(first);
  });

  it('returns null when nothing matches', () => {
    const rule = makeRule({ c: { gt: 0, lte: 10, w: 4096, h: 2160, pb: 'Any', it: 'Any' } });
    expect(matchLedControllerRule(makeSpec({ totalPixels: 99999 }), [rule])).toBeNull();
  });
});

describe('getLedControllerSelection', () => {
  it('returns the exact unmatched shape, still computing redundancy', () => {
    const spec = makeSpec({ installationType: 'Outdoor', areaSqFt: 500, totalPixels: 100 });
    const result = getLedControllerSelection(spec, 'auto', [], {});
    expect(result).toMatchObject({
      matched: false,
      name: 'No controller match found',
      brand: '',
      model: '',
      baseUnits: 0,
      units: 0,
      unitPrice: 0,
      totalPrice: 0,
      confidence: 0,
      specSheet: null,
      reason: 'Display exceeds the engineering dataset range. Consult NANTA engineering for a custom multi-controller cascade.'
    });
    expect(result.redundant).toBe(true);
    expect(result.redundancyReason).toBe('Outdoor display area exceeds 400 sq ft (weather-exposed, high-visibility asset).');
  });

  it('redundancyMode "yes" forces redundancy regardless of size', () => {
    const spec = makeSpec({ installationType: 'Indoor', areaSqFt: 5, totalPixels: 100 });
    const result = getLedControllerSelection(spec, 'yes', [], {});
    expect(result.redundant).toBe(true);
    expect(result.redundancyReason).toBe('Manually forced by user.');
  });

  it('redundancyMode "no" never redundant even for a large outdoor wall', () => {
    const spec = makeSpec({ installationType: 'Outdoor', areaSqFt: 600, totalPixels: 5_000_000 });
    const result = getLedControllerSelection(spec, 'no', [], {});
    expect(result.redundant).toBe(false);
    expect(result.redundancyReason).toBe('');
  });

  it('auto redundancy: outdoor area boundary at exactly 400 sqft is not redundant, over it is', () => {
    const rule = makeRule();
    const atBoundary = makeSpec({ installationType: 'Outdoor', areaSqFt: 400, totalPixels: 100 });
    const overBoundary = makeSpec({ installationType: 'Outdoor', areaSqFt: 400.01, totalPixels: 100 });
    expect(getLedControllerSelection(atBoundary, 'auto', [rule], {}).redundant).toBe(false);
    expect(getLedControllerSelection(overBoundary, 'auto', [rule], {}).redundant).toBe(true);
  });

  it('auto redundancy: pixel-count boundary at exactly 4,000,000 is not redundant, over it is', () => {
    const rule = makeRule({ c: { gt: 0, lte: 5_000_000, w: 40960, h: 21600, pb: 'Any', it: 'Any' } });
    const atBoundary = makeSpec({ installationType: 'Indoor', areaSqFt: 5, totalPixels: 4_000_000 });
    const overBoundary = makeSpec({ installationType: 'Indoor', areaSqFt: 5, totalPixels: 4_000_001 });
    expect(getLedControllerSelection(atBoundary, 'auto', [rule], {}).redundant).toBe(false);
    const overResult = getLedControllerSelection(overBoundary, 'auto', [rule], {});
    expect(overResult.redundant).toBe(true);
    expect(overResult.redundancyReason).toBe('Total pixel count exceeds 4,000,000 px (large commercial wall).');
  });

  it('when both area and pixel thresholds trip, the area reason wins', () => {
    const rule = makeRule({ c: { gt: 0, lte: 5_000_000, w: 40960, h: 21600, pb: 'Any', it: 'Any' } });
    const spec = makeSpec({ installationType: 'Outdoor', areaSqFt: 500, totalPixels: 5_000_000 });
    const result = getLedControllerSelection(spec, 'auto', [rule], {});
    expect(result.redundancyReason).toBe('Outdoor display area exceeds 400 sq ft (weather-exposed, high-visibility asset).');
  });

  it('price falls back priceInr -> msrpUsd*84 -> 0, and doubles totalPrice when redundant', () => {
    const rule = makeRule({ rec: { brand: 'Acme', model: 'M1', units: 2 } });
    const specsWithInr: Record<string, LedControllerSpec> = {
      'Acme M1': { brand: 'Acme', model: 'M1', priceInr: 50000, maxPixels: 999999, ethPorts: 1, fiberPorts: 0 }
    };
    const spec = makeSpec({ installationType: 'Outdoor', areaSqFt: 500, totalPixels: 100 });
    const result = getLedControllerSelection(spec, 'auto', [rule], specsWithInr);
    expect(result.unitPrice).toBe(50000);
    expect(result.baseUnits).toBe(2);
    expect(result.units).toBe(4); // doubled because redundant
    expect(result.totalPrice).toBe(200000);

    const specsWithUsdOnly: Record<string, LedControllerSpec> = {
      'Acme M1': { brand: 'Acme', model: 'M1', msrpUsd: 100, maxPixels: 999999, ethPorts: 1, fiberPorts: 0 }
    };
    const usdResult = getLedControllerSelection(makeSpec({ totalPixels: 100 }), 'no', [rule], specsWithUsdOnly);
    expect(usdResult.unitPrice).toBe(8400);

    const noSpecResult = getLedControllerSelection(makeSpec({ totalPixels: 100 }), 'no', [rule], {});
    expect(noSpecResult.unitPrice).toBe(0);
    expect(noSpecResult.specSheet).toBeNull();
    expect(noSpecResult.matched).toBe(true);
  });

  it('defaults baseUnits to 1 when rule.rec.units is 0/absent', () => {
    const rule = makeRule({ rec: { brand: 'Acme', model: 'M2', units: 0 } });
    const result = getLedControllerSelection(makeSpec({ totalPixels: 100 }), 'no', [rule], {});
    expect(result.baseUnits).toBe(1);
    expect(result.units).toBe(1);
  });

  it('passes through confidence and reason from the matched rule, and defaults series to empty string', () => {
    const rule = makeRule({ conf: 77, reason: 'because reasons' });
    const result = getLedControllerSelection(makeSpec({ totalPixels: 100 }), 'no', [rule], {});
    expect(result.confidence).toBe(77);
    expect(result.reason).toBe('because reasons');
    expect(result.series).toBe('');
  });
});

describe('real dataset smoke tests', () => {
  it('has a substantial rule set (guards against a truncated data file)', () => {
    expect(LED_CONTROLLER_RULES.length).toBeGreaterThan(1000);
  });

  it('matches a plausible indoor P2.5 3m x 2m synchronous wall to a real controller', () => {
    const spec = computeLedPixelSpec({
      dimensions: { height: 2, width: 3, unit: 'm' },
      category: 'indoor',
      modelPitch: 'P2.5',
      controlMode: 'Synchronous'
    });
    const result = getLedControllerSelection(spec, 'auto');
    expect(result.matched).toBe(true);
    expect(result.brand.length).toBeGreaterThan(0);
    expect(result.model.length).toBeGreaterThan(0);
  });
});
