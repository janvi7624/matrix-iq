// LED walls are built from fixed-size cabinets, not a continuous sheet — a
// requested wall size almost never divides evenly into whole cabinets, so
// any pixel-pitch-driven size calculation has to work in terms of an actual
// achievable cabinet grid, not the raw requested dimensions. See
// components/estimators/LedEstimator.tsx's "mm" unit mode, which is the only
// caller of this module.

export interface CabinetSize {
  width: number; // mm
  height: number; // mm
}

interface CabinetGroup {
  pitches: number[]; // mm
  cabinet: CabinetSize;
}

// Confirmed with the business: indoor 1.25mm belongs to the 600x337.5mm
// group, not the 640x480mm group (the two lists happened to overlap on that
// one value in the original spec).
export const INDOOR_CABINET_GROUPS: CabinetGroup[] = [
  { pitches: [0.7, 0.9, 1.25, 1.56, 1.87], cabinet: { width: 600, height: 337.5 } },
  { pitches: [1.53, 1.86, 2, 2.5], cabinet: { width: 640, height: 480 } }
];

export const OUTDOOR_CABINET: CabinetGroup = {
  pitches: [3, 4, 5, 6, 7, 8, 9, 10],
  cabinet: { width: 960, height: 960 }
};

// Every selectable pitch for a category, sorted — backs the pitch <select>
// in LedEstimator.tsx (only shown in "mm" unit mode).
export function pitchesForCategory(category: 'indoor' | 'outdoor'): number[] {
  const pitches = category === 'outdoor' ? OUTDOOR_CABINET.pitches : INDOOR_CABINET_GROUPS.flatMap((g) => g.pitches);
  return [...new Set(pitches)].sort((a, b) => a - b);
}

function nearest(value: number, candidates: number[]): number {
  return candidates.reduce((best, c) => (Math.abs(c - value) < Math.abs(best - value) ? c : best));
}

// Outdoor has one cabinet family, so the pitch only matters for indoor,
// where it picks between the two cabinet groups. Nearest-match (not just
// exact) so a pitch typed outside the exact listed values still resolves to
// a sensible cabinet rather than failing outright.
export function cabinetSizeForPitch(pitchMm: number, category: 'indoor' | 'outdoor'): CabinetSize {
  if (category === 'outdoor') return OUTDOOR_CABINET.cabinet;
  const nearestPerGroup = INDOOR_CABINET_GROUPS.map((g) => ({ group: g, nearest: nearest(pitchMm, g.pitches) }));
  const closest = nearestPerGroup.reduce((best, g) =>
    Math.abs(g.nearest - pitchMm) < Math.abs(best.nearest - pitchMm) ? g : best
  );
  return closest.group.cabinet;
}

export interface CabinetGridOption {
  cols: number;
  rows: number;
  cabinetCount: number;
  actualWidthMm: number;
  actualHeightMm: number;
}

function buildOption(cols: number, rows: number, cabinet: CabinetSize): CabinetGridOption {
  return {
    cols,
    rows,
    cabinetCount: cols * rows,
    actualWidthMm: cols * cabinet.width,
    actualHeightMm: rows * cabinet.height
  };
}

// Two achievable sizes for a requested target — round every dimension down
// to the nearest whole cabinet, and separately round every dimension up —
// so the rep can choose "slightly smaller" or "slightly larger than asked
// for" rather than the system silently picking one. At least 1 cabinet per
// axis even if the target is smaller than a single cabinet.
export function computeCabinetGridOptions(targetWidthMm: number, targetHeightMm: number, cabinet: CabinetSize): { down: CabinetGridOption; up: CabinetGridOption } {
  const colsExact = targetWidthMm / cabinet.width;
  const rowsExact = targetHeightMm / cabinet.height;
  const down = buildOption(Math.max(1, Math.floor(colsExact)), Math.max(1, Math.floor(rowsExact)), cabinet);
  const up = buildOption(Math.max(1, Math.ceil(colsExact)), Math.max(1, Math.ceil(rowsExact)), cabinet);
  return { down, up };
}
