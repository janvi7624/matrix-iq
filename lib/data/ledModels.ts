export interface LedModel {
  details: string;
  category: 'indoor' | 'outdoor' | 'cob' | 'smd';
  pitch: string;
  b2bPricePerSqFt: number;
  b2cPricePerSqFt: number;
  installationPerSqFt: number;
  fabricationPerSqFt: number;
  scaffoldingFixed: number;
}

export const LED_INSTALLATION_RATE_PER_SQFT = 400;

export const ledModels: Record<string, LedModel> = {
  'Indoor SMD P2.5': {
    details: 'Indoor COB P1.2 panel with B2B/B2C pricing.',
    category: 'indoor',
    pitch: 'P2.5',
    b2bPricePerSqFt: 6500,
    b2cPricePerSqFt: 8125,
    installationPerSqFt: 75,
    fabricationPerSqFt: 50,
    scaffoldingFixed: 300
  },
  'Indoor SMDP3': {
    details: 'Indoor SMD P3 panel with B2B/B2C pricing.',
    category: 'indoor',
    pitch: 'P3',
    b2bPricePerSqFt: 5500,
    b2cPricePerSqFt: 6875,
    installationPerSqFt: 70,
    fabricationPerSqFt: 45,
    scaffoldingFixed: 300
  },
  'Indoor SMD P4': {
    details: 'Indoor SMD P4 panel with B2B/B2C pricing.',
    category: 'indoor',
    pitch: 'P4',
    b2bPricePerSqFt: 4200,
    b2cPricePerSqFt: 5250,
    installationPerSqFt: 65,
    fabricationPerSqFt: 40,
    scaffoldingFixed: 300
  },
  'Outdoor P2.5': {
    details: 'Outdoor SMD P2.5 panel with B2B/B2C pricing.',
    category: 'outdoor',
    pitch: 'P2.5',
    b2bPricePerSqFt: 8000,
    b2cPricePerSqFt: 10000,
    installationPerSqFt: 90,
    fabricationPerSqFt: 60,
    scaffoldingFixed: 400
  },
  'Outdoor P3': {
    details: 'Outdoor SMD P3 panel with B2B/B2C pricing.',
    category: 'outdoor',
    pitch: 'P3',
    b2bPricePerSqFt: 6000,
    b2cPricePerSqFt: 7500,
    installationPerSqFt: 85,
    fabricationPerSqFt: 55,
    scaffoldingFixed: 400
  },
  'Outdoor P4': {
    details: 'Outdoor SMD P4 panel with B2B/B2C pricing.',
    category: 'outdoor',
    pitch: 'P4',
    b2bPricePerSqFt: 4600,
    b2cPricePerSqFt: 5750,
    installationPerSqFt: 80,
    fabricationPerSqFt: 50,
    scaffoldingFixed: 400
  },
  'Outdoor P5': {
    details: 'Outdoor SMD P5 panel with B2B/B2C pricing.',
    category: 'outdoor',
    pitch: 'P5',
    b2bPricePerSqFt: 4500,
    b2cPricePerSqFt: 5625,
    installationPerSqFt: 80,
    fabricationPerSqFt: 50,
    scaffoldingFixed: 400
  },
  'Outdoor P6': {
    details: 'Outdoor SMD P6 panel with B2B/B2C pricing.',
    category: 'outdoor',
    pitch: 'P6',
    b2bPricePerSqFt: 4200,
    b2cPricePerSqFt: 5250,
    installationPerSqFt: 78,
    fabricationPerSqFt: 48,
    scaffoldingFixed: 400
  },
  'Outdoor P10': {
    details: 'Outdoor SMD P10 panel with B2B/B2C pricing.',
    category: 'outdoor',
    pitch: 'P10',
    b2bPricePerSqFt: 3800,
    b2cPricePerSqFt: 4750,
    installationPerSqFt: 75,
    fabricationPerSqFt: 45,
    scaffoldingFixed: 400
  },
  'INDOOR COB P1.86': {
    details: 'Indoor COB P1.86 panel with B2B/B2C pricing.',
    category: 'cob',
    pitch: 'P1.86',
    b2bPricePerSqFt: 13800,
    b2cPricePerSqFt: 17250,
    installationPerSqFt: 100,
    fabricationPerSqFt: 70,
    scaffoldingFixed: 450
  },
  'INDOOR COB P1.5': {
    details: 'Indoor COB P1.5 panel with B2B/B2C pricing.',
    category: 'cob',
    pitch: 'P1.5',
    b2bPricePerSqFt: 14800,
    b2cPricePerSqFt: 18500,
    installationPerSqFt: 105,
    fabricationPerSqFt: 75,
    scaffoldingFixed: 450
  },
  'INDOOR COB P1.2': {
    details: 'Indoor COB P1.2 panel with B2B/B2C pricing.',
    category: 'cob',
    pitch: 'P1.2',
    b2bPricePerSqFt: 15500,
    b2cPricePerSqFt: 19375,
    installationPerSqFt: 110,
    fabricationPerSqFt: 80,
    scaffoldingFixed: 450
  },
  'INDOOR SMD P1.83': {
    details: 'Indoor SMD P1.83 panel with B2B/B2C pricing.',
    category: 'smd',
    pitch: 'P1.83',
    b2bPricePerSqFt: 9500,
    b2cPricePerSqFt: 11875,
    installationPerSqFt: 90,
    fabricationPerSqFt: 60,
    scaffoldingFixed: 400
  },
  'INDOOR SMD P2': {
    details: 'Indoor SMD P2 panel with B2B/B2C pricing.',
    category: 'smd',
    pitch: 'P2',
    b2bPricePerSqFt: 8500,
    b2cPricePerSqFt: 10625,
    installationPerSqFt: 88,
    fabricationPerSqFt: 58,
    scaffoldingFixed: 400
  }
};

export const LED_ASPECT_PRESETS: Record<string, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
  '1:1': 1,
  '3:2': 3 / 2
};
