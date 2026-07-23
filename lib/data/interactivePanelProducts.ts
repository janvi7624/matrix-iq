export interface InteractivePanelProduct {
  name: string;
  description: string;
  distributorPrice: number;
  partnerPrice: number;
  customerPrice: number;
  image: string;
}

// Sourced from AVpricelist.xlsx (Nanta Tech Price List - 2026). Distributor < Partner < Customer price.
export const interactivePanelProducts: Record<string, InteractivePanelProduct> = {
  'NTA-IFP65-AI': {
    name: '65" InfiniteView AI Panel',
    description: 'NTA-IFP65-AI | 65" 4K UHD AI-Powered Interactive Flat Panel | Android 14 OS | 8GB RAM | 128GB Storage | Multi-Touch | Zero-Bonding Display | Nanta InfiniteView Series',
    distributorPrice: 73125,
    partnerPrice: 78250,
    customerPrice: 93895,
    image: '/av-assets/IFP-65-75.png'
  },
  'NTA-IFP75-AI': {
    name: '75" InfiniteView AI Panel',
    description: 'NTA-IFP75-AI | 75" 4K UHD AI-Powered Interactive Flat Panel | Android 14 OS | 8GB RAM | 128GB Storage | Multi-Touch | Zero-Bonding Display | Nanta InfiniteView Series',
    distributorPrice: 86400,
    partnerPrice: 92448,
    customerPrice: 110940,
    image: '/av-assets/IFP-65-75.png'
  },
  'NTA-IFP86-AI': {
    name: '86" InfiniteView AI Panel',
    description: 'NTA-IFP86-AI | 86" 4K UHD AI-Powered Interactive Flat Panel | Android 14 OS | 8GB RAM | 128GB Storage | Multi-Touch | Zero-Bonding Display | Nanta InfiniteView Series',
    distributorPrice: 133650,
    partnerPrice: 143010,
    customerPrice: 171610,
    image: '/av-assets/IFP-86-98.png'
  },
  'NTA-IFP98-AI': {
    name: '98" InfiniteView AI Panel',
    description: 'NTA-IFP98-AI | 98" 4K UHD AI-Powered Interactive Flat Panel | Android 14 OS | 8GB RAM | 128GB Storage | Multi-Touch | Zero-Bonding Display | Nanta InfiniteView Series',
    distributorPrice: 445000,
    partnerPrice: 476150,
    customerPrice: 571380,
    image: '/av-assets/IFP-86-98.png'
  }
};
