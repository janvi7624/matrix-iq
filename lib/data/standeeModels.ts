export interface StandeeModel {
  category: string;
  details: string;
  partnerPrice: number;
  endUserPrice: number;
  fabricationPerUnit: number;
  installationPerUnit: number;
  scaffoldingPerUnit: number;
  size: string;
}

export const standeeModels: Record<string, StandeeModel> = {
  'WM-TV-24-IPS': {
    category: 'Wall Mount',
    details: '24" Wall Mount digital display standee.',
    partnerPrice: 23960,
    endUserPrice: 31946,
    fabricationPerUnit: 500,
    installationPerUnit: 300,
    scaffoldingPerUnit: 120,
    size: '24 Inch'
  },
  'WM-TV-32-IPS': {
    category: 'Wall Mount',
    details: '32" Wall Mount digital display standee.',
    partnerPrice: 27620,
    endUserPrice: 36826,
    fabricationPerUnit: 520,
    installationPerUnit: 320,
    scaffoldingPerUnit: 130,
    size: '32 Inch'
  },
  'WM-TV-43-IPS-FHD': {
    category: 'Wall Mount',
    details: '43" FHD Wall Mount digital display standee.',
    partnerPrice: 36900,
    endUserPrice: 49200,
    fabricationPerUnit: 650,
    installationPerUnit: 420,
    scaffoldingPerUnit: 160,
    size: '43 Inch FHD'
  },
  'WM-TV-43-IPS-4K': {
    category: 'Wall Mount',
    details: '43" 4K Wall Mount digital display standee.',
    partnerPrice: 54527,
    endUserPrice: 72702,
    fabricationPerUnit: 700,
    installationPerUnit: 450,
    scaffoldingPerUnit: 170,
    size: '43 Inch 4K'
  },
  'WM-TV-50-IPS-4K': {
    category: 'Wall Mount',
    details: '50" 4K Wall Mount digital display standee.',
    partnerPrice: 67652,
    endUserPrice: 90202,
    fabricationPerUnit: 800,
    installationPerUnit: 520,
    scaffoldingPerUnit: 180,
    size: '50 Inch 4K'
  },
  'WM-TV-50-IPS-C': {
    category: 'Wall Mount',
    details: '50" Commercial Wall Mount digital display standee.',
    partnerPrice: 90639,
    endUserPrice: 120852,
    fabricationPerUnit: 900,
    installationPerUnit: 560,
    scaffoldingPerUnit: 190,
    size: '50 Inch Commercial'
  },
  'WM-TV-55-IPS-4K': {
    category: 'Wall Mount',
    details: '55" 4K Wall Mount digital display standee.',
    partnerPrice: 71402,
    endUserPrice: 95202,
    fabricationPerUnit: 950,
    installationPerUnit: 600,
    scaffoldingPerUnit: 210,
    size: '55 Inch 4K'
  },
  'WM-TV-65-IPS-4K': {
    category: 'Wall Mount',
    details: '65" 4K Wall Mount digital display standee.',
    partnerPrice: 71402,
    endUserPrice: 95202,
    fabricationPerUnit: 1050,
    installationPerUnit: 650,
    scaffoldingPerUnit: 220,
    size: '65 Inch 4K'
  },
  'WM-TV-75-IPS-4K': {
    category: 'Wall Mount',
    details: '75" 4K Wall Mount digital display standee.',
    partnerPrice: 138900,
    endUserPrice: 185200,
    fabricationPerUnit: 1200,
    installationPerUnit: 700,
    scaffoldingPerUnit: 240,
    size: '75 Inch 4K'
  },
  'WM-TV-85-IPS-4K': {
    category: 'Wall Mount',
    details: '85" 4K Wall Mount digital display standee.',
    partnerPrice: 176400,
    endUserPrice: 235200,
    fabricationPerUnit: 1350,
    installationPerUnit: 760,
    scaffoldingPerUnit: 260,
    size: '85 Inch 4K'
  },
  'WM-TV-98-IPS-4K': {
    category: 'Wall Mount',
    details: '98" 4K Wall Mount digital display standee.',
    partnerPrice: 307652,
    endUserPrice: 410202,
    fabricationPerUnit: 1600,
    installationPerUnit: 850,
    scaffoldingPerUnit: 300,
    size: '98 Inch 4K'
  },
  'WM-32-IMP': {
    category: 'Imported Display - A-Type',
    details: '32" Imported A-Type display standee.',
    partnerPrice: 69207,
    endUserPrice: 92276,
    fabricationPerUnit: 600,
    installationPerUnit: 360,
    scaffoldingPerUnit: 150,
    size: '32 Inch'
  },
  'WM-43-IMP': {
    category: 'Imported Display - A-Type',
    details: '43" Imported A-Type display standee.',
    partnerPrice: 93705,
    endUserPrice: 124940,
    fabricationPerUnit: 700,
    installationPerUnit: 420,
    scaffoldingPerUnit: 180,
    size: '43 Inch'
  },
  'WM-32-IMP-CT': {
    category: 'Touch',
    details: '32" Capacitive touch wall mount display standee.',
    partnerPrice: 92016,
    endUserPrice: 122688,
    fabricationPerUnit: 780,
    installationPerUnit: 430,
    scaffoldingPerUnit: 160,
    size: '32 Inch Capacitive Touch'
  },
  'WM-43-IMP-CT': {
    category: 'Touch',
    details: '43" Capacitive touch wall mount display standee.',
    partnerPrice: 138480,
    endUserPrice: 184640,
    fabricationPerUnit: 900,
    installationPerUnit: 520,
    scaffoldingPerUnit: 180,
    size: '43 Inch Capacitive Touch'
  },
  'WM-32-IMP-IRT': {
    category: 'Touch',
    details: '32" IR touch wall mount display standee.',
    partnerPrice: 83991,
    endUserPrice: 111988,
    fabricationPerUnit: 760,
    installationPerUnit: 440,
    scaffoldingPerUnit: 160,
    size: '32 Inch IR Touch'
  },
  'WM-43-IMP-IRT': {
    category: 'Touch',
    details: '43" IR touch wall mount display standee.',
    partnerPrice: 114470,
    endUserPrice: 148596,
    fabricationPerUnit: 900,
    installationPerUnit: 520,
    scaffoldingPerUnit: 180,
    size: '43 Inch IR Touch'
  },
  'TM-24-IPS': {
    category: 'Totem',
    details: '24" Totem IPS standee.',
    partnerPrice: 32880,
    endUserPrice: 43840,
    fabricationPerUnit: 500,
    installationPerUnit: 300,
    scaffoldingPerUnit: 120,
    size: '24 Inch'
  },
  'TM-32-IPS': {
    category: 'Totem',
    details: '32" Totem IPS standee.',
    partnerPrice: 40800,
    endUserPrice: 54400,
    fabricationPerUnit: 550,
    installationPerUnit: 330,
    scaffoldingPerUnit: 140,
    size: '32 Inch'
  },
  'TM-43-IPS-FHD': {
    category: 'Totem',
    details: '43" FHD Totem IPS standee.',
    partnerPrice: 57600,
    endUserPrice: 76800,
    fabricationPerUnit: 700,
    installationPerUnit: 420,
    scaffoldingPerUnit: 170,
    size: '43 Inch FHD'
  },
  'TM-43-IPS-4K': {
    category: 'Totem',
    details: '43" 4K Totem IPS standee.',
    partnerPrice: 76800,
    endUserPrice: 102400,
    fabricationPerUnit: 750,
    installationPerUnit: 450,
    scaffoldingPerUnit: 180,
    size: '43 Inch 4K'
  },
  'TM-50-IPS-4K': {
    category: 'Totem',
    details: '50" 4K Totem IPS standee.',
    partnerPrice: 96000,
    endUserPrice: 128000,
    fabricationPerUnit: 850,
    installationPerUnit: 520,
    scaffoldingPerUnit: 200,
    size: '50 Inch 4K'
  },
  'TM-50-IPS-C': {
    category: 'Totem',
    details: '50" Commercial Totem IPS standee.',
    partnerPrice: 111600,
    endUserPrice: 148800,
    fabricationPerUnit: 950,
    installationPerUnit: 560,
    scaffoldingPerUnit: 220,
    size: '50 Inch Commercial'
  },
  'TM-55-IPS-4K': {
    category: 'Totem',
    details: '55" 4K Totem IPS standee.',
    partnerPrice: 103200,
    endUserPrice: 137600,
    fabricationPerUnit: 980,
    installationPerUnit: 600,
    scaffoldingPerUnit: 240,
    size: '55 Inch 4K'
  },
  'TM-65-IPS-4K': {
    category: 'Totem',
    details: '65" 4K Totem IPS standee.',
    partnerPrice: 138000,
    endUserPrice: 184000,
    fabricationPerUnit: 1100,
    installationPerUnit: 650,
    scaffoldingPerUnit: 260,
    size: '65 Inch 4K'
  },
  'TM-75-IPS-4K': {
    category: 'Totem',
    details: '75" 4K Totem IPS standee.',
    partnerPrice: 194400,
    endUserPrice: 259200,
    fabricationPerUnit: 1300,
    installationPerUnit: 700,
    scaffoldingPerUnit: 280,
    size: '75 Inch 4K'
  }
};

export const STANDEE_CATEGORIES = ['Wall Mount', 'Imported Display - A-Type', 'Touch', 'Totem'] as const;

export const STANDEE_PREVIEW_BY_CATEGORY: Record<string, string> = {
  'Wall Mount': '/WALLmOUNT.jpg',
  'Imported Display - A-Type': '/ATYPE.jpg',
  Touch: '/TOUCH.jpg',
  Totem: '/TOTEM.jpg'
};
