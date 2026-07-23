// Room-size based product suggestions for the Conference Estimator. Tiers and
// reasoning follow common AV sizing conventions (huddle / small / medium /
// boardroom); every recommended model is a real, quotable SKU already in
// avCameraProducts — this only picks which one fits, it never invents a product.

export interface ConferenceAdditionalSuggestion {
  model: string;
  reason: string;
}

export interface ConferenceSuggestion {
  tierLabel: string;
  primaryModel: string;
  primaryReason: string;
  additional: ConferenceAdditionalSuggestion[];
}

export function getConferenceSuggestion(seats: number): ConferenceSuggestion {
  const n = Math.max(1, Math.round(seats) || 1);

  if (n <= 4) {
    return {
      tierLabel: `Huddle room (up to 4 seats)`,
      primaryModel: 'NT-EC-VB-4K',
      primaryReason: 'All-in-one 4K video bar with built-in camera, mic array and speaker — enough for a small huddle space without extra devices.',
      additional: []
    };
  }
  if (n <= 8) {
    return {
      tierLabel: `Small/medium room (5–8 seats)`,
      primaryModel: 'NT-EC-VB360-4K',
      primaryReason: '360° panoramic video bar with six-array microphones — captures everyone around a table without a separate PTZ camera.',
      additional: []
    };
  }
  if (n <= 14) {
    return {
      tierLabel: `Medium/large room (9–14 seats)`,
      primaryModel: 'NT-M2000S',
      primaryReason: '12x optical zoom dual-lens video bar with AI tracking — reaches further down a longer table.',
      additional: [{ model: 'NT-A10W', reason: 'Extends microphone/speaker pickup to ~10m for seats far from the table center.' }]
    };
  }
  return {
    tierLabel: `Boardroom (15+ seats)`,
    primaryModel: 'NT-EC-HD-30X',
    primaryReason: '30x optical zoom PTZ camera with presenter tracking for large boardrooms.',
    additional: [
      { model: 'NT-A10W', reason: 'Speakerphone with ~10m pickup range for the main seating area.' },
      { model: 'NT-M702A/C', reason: 'PoE-cascadable microphone — add one at the far end of a long table for full coverage.' }
    ]
  };
}
