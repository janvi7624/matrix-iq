import { describe, it, expect } from 'vitest';
import { cabinetSizeForPitch, computeCabinetGridOptions, pitchesForCategory } from '../../lib/ledCabinets';

describe('cabinetSizeForPitch', () => {
  it.each([0.7, 0.9, 1.25, 1.56, 1.87])('maps indoor %smm to the 600x337.5mm group', (pitch) => {
    expect(cabinetSizeForPitch(pitch, 'indoor')).toEqual({ width: 600, height: 337.5 });
  });

  it.each([1.53, 1.86, 2, 2.5])('maps indoor %smm to the 640x480mm group', (pitch) => {
    expect(cabinetSizeForPitch(pitch, 'indoor')).toEqual({ width: 640, height: 480 });
  });

  it.each([3, 4, 5, 6, 7, 8, 9, 10])('maps outdoor %smm to the 960x960mm cabinet', (pitch) => {
    expect(cabinetSizeForPitch(pitch, 'outdoor')).toEqual({ width: 960, height: 960 });
  });

  it('outdoor ignores category-crossing pitch values — always the single outdoor cabinet', () => {
    expect(cabinetSizeForPitch(1.25, 'outdoor')).toEqual({ width: 960, height: 960 });
  });

  it('resolves an off-list indoor pitch to the nearest group', () => {
    // 1.0 is nearer to 0.9 (group A) than to 1.53 (group B)
    expect(cabinetSizeForPitch(1.0, 'indoor')).toEqual({ width: 600, height: 337.5 });
    // 2.2 is nearer to 2 (group B) than to 1.87 (group A)
    expect(cabinetSizeForPitch(2.2, 'indoor')).toEqual({ width: 640, height: 480 });
  });
});

describe('pitchesForCategory', () => {
  it('returns the combined, deduped, sorted indoor pitch list', () => {
    expect(pitchesForCategory('indoor')).toEqual([0.7, 0.9, 1.25, 1.53, 1.56, 1.86, 1.87, 2, 2.5]);
  });

  it('returns the outdoor pitch list sorted', () => {
    expect(pitchesForCategory('outdoor')).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('computeCabinetGridOptions', () => {
  it('rounds down and up to whole cabinets for a size that does not divide evenly', () => {
    // 600x337.5mm cabinets, target 3800x2000mm
    // cols: 3800/600 = 6.33 -> down 6, up 7
    // rows: 2000/337.5 = 5.93 -> down 5, up 6
    const { down, up } = computeCabinetGridOptions(3800, 2000, { width: 600, height: 337.5 });
    expect(down).toEqual({ cols: 6, rows: 5, cabinetCount: 30, actualWidthMm: 3600, actualHeightMm: 1687.5 });
    expect(up).toEqual({ cols: 7, rows: 6, cabinetCount: 42, actualWidthMm: 4200, actualHeightMm: 2025 });
  });

  it('never returns fewer than 1 cabinet per axis, even for a target smaller than one cabinet', () => {
    const { down, up } = computeCabinetGridOptions(100, 100, { width: 960, height: 960 });
    expect(down).toEqual({ cols: 1, rows: 1, cabinetCount: 1, actualWidthMm: 960, actualHeightMm: 960 });
    expect(up).toEqual({ cols: 1, rows: 1, cabinetCount: 1, actualWidthMm: 960, actualHeightMm: 960 });
  });

  it('down and up coincide when the target divides evenly', () => {
    const { down, up } = computeCabinetGridOptions(1920, 1920, { width: 960, height: 960 });
    expect(down).toEqual(up);
    expect(down).toEqual({ cols: 2, rows: 2, cabinetCount: 4, actualWidthMm: 1920, actualHeightMm: 1920 });
  });
});
