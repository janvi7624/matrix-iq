// AIO (All-In-One) LED series — fixed-size integrated units, sold as a
// single product rather than built from cabinets. See
// components/estimators/LedEstimator.tsx's "AIO Series" mode.
export interface AioModel {
  details: string;
  diagonalInches: number;
  resolutionClass: 'FHD' | '4K';
  price: number;
}

// Prices start at 0 — deliberately left for the business to fill in via the
// admin Product Catalog (same override mechanism every other product here
// uses), not guessed at.
export const aioModels: Record<string, AioModel> = {
  'AIO 108" FHD': { details: 'AIO Series 108" Full HD all-in-one LED display.', diagonalInches: 108, resolutionClass: 'FHD', price: 0 },
  'AIO 135" FHD': { details: 'AIO Series 135" Full HD all-in-one LED display.', diagonalInches: 135, resolutionClass: 'FHD', price: 0 },
  'AIO 162" 4K': { details: 'AIO Series 162" 4K all-in-one LED display.', diagonalInches: 162, resolutionClass: '4K', price: 0 },
  'AIO 216" 4K': { details: 'AIO Series 216" 4K all-in-one LED display.', diagonalInches: 216, resolutionClass: '4K', price: 0 }
};
