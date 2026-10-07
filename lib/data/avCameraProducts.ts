export interface CameraAccessory {
  name: string;
  distributorPrice: number;
  partnerPrice: number;
  customerPrice: number;
}

export interface CameraProduct {
  modelTag: string;
  category: string;
  description: string;
  distributorPrice: number;
  partnerPrice: number;
  customerPrice: number;
  image: string;
  accessory?: CameraAccessory;
}

// Distributor < Partner < Customer price.
//
// Conferencing prices updated 2026-10-07 from "Audio video oct 6 2026.pdf"
// (10 products, all reductions). Descriptions, categories, images and the
// accessory blocks are untouched — that list carried prices only, and its
// descriptions are shorter than the ones already here.
// Earlier source for everything else: AVpricelist.xlsx (Nanta Tech Price
// List - 2026).
export const avCameraProducts: Record<string, CameraProduct> = {
  'NT-4K-CC-8X': {
    modelTag: '4K-CC-8X',
    category: 'Webcam',
    description: 'Video Camera, 4K Business Webcam, USB 3.0,120 degree HFOV, Built in Microphone,  NT-4K-CC-8X',
    distributorPrice: 21000,
    partnerPrice: 23000,
    customerPrice: 25000,
    image: '/av-assets/NT-4K-CC-8X.jpeg'
  },
  'NT-EC-VB360-4K': {
    modelTag: 'EC-VB360-4K',
    category: 'Video Bar',
    description: '4K BYOM 360°, Panoramic Camera, All-In-One Tabletop camera for Huddle Rooms. Four ultra-wide-angle lenses for 360° views, six-array microphones, and full-range speakers, with built-in AI-powered framing and noise cancellation. One-cable USB-C connection, BYOM mode.',
    distributorPrice: 87000,
    partnerPrice: 100000,
    customerPrice: 115000,
    image: '/av-assets/NT-EC-VB360-4K.png'
  },
  'NT-EC-VB-4K': {
    modelTag: 'EC-VB-4K',
    category: 'Video Bar',
    description: 'Conferencing Device (ADPM), 4K Video bar with 6X Digital Zoom Camera with AI tracking Features, NT-EC-VB-4K',
    distributorPrice: 80000,
    partnerPrice: 89000,
    customerPrice: 97000,
    image: '/av-assets/NT-EC-VB-4K.png',
    accessory: {
      name: 'Wireless Dongle for BYOD, Compatible with NT-EC-VB-4K',
      distributorPrice: 6100,
      partnerPrice: 6900,
      customerPrice: 8280
    }
  },
  'NT-M2000S': {
    modelTag: 'M2000S',
    category: 'Video Bar',
    description: 'Conferencing Device (ADPM), 12X optical zoom 4K Dual-Lens Video Bar with AI tracking features, NT-M2000S.',
    distributorPrice: 128000,
    partnerPrice: 141000,
    customerPrice: 155000,
    image: '/av-assets/NT-M2000S.png',
    accessory: {
      name: 'Wireless Dongle for BYOD, Compatible with NT-M2000s',
      distributorPrice: 9100,
      partnerPrice: 10350,
      customerPrice: 12420
    }
  },
  'NT-EC-HD-12X': {
    modelTag: 'EC-HD-12X',
    category: 'PTZ',
    description: 'Conferencing Device (ADPM), HD Video Camera with Presenter Tracking, 12X Optical Zoom, HDMI+3G-SDI+RJ45+USB3.0, NT-EC-HD-12X',
    distributorPrice: 59000,
    partnerPrice: 65000,
    customerPrice: 71000,
    image: '/av-assets/NT-EC-HD-12X.png'
  },
  'NT-EC-HD-30X': {
    modelTag: 'EC-HD-30X',
    category: 'PTZ',
    description: 'Conferencing Device (ADPM), HD Video Camera with Presenter Tracking, 30X Optical Zoom, HDMI+3G-SDI+RJ45+USB3.0, NT-EC-HD-30X',
    distributorPrice: 64000,
    partnerPrice: 70000,
    customerPrice: 77000,
    image: '/av-assets/NT-EC-HD-30X.png'
  },
  'NT-VX71UVS': {
    modelTag: 'VX71UVS',
    category: 'PTZ',
    description: '4K video conferencing camera, DC 12V/PoE, 1/2.5" CMOS, 8.51MP, 12x optical zoom, 71° HFOV, 4K/30/25 & 1080p/30/25. USB + HDMI + RJ45, line-in, RS232, RS485, gesture control.',
    distributorPrice: 65000,
    partnerPrice: 71000,
    customerPrice: 79000,
    image: '/av-assets/NT-VX71UVS.jpeg'
  },
  'NT-VX630AL': {
    modelTag: 'VX630AL',
    category: 'PTZ',
    description: 'Conferencing Device (ADPM), 4K PTZ camera, 1/1.8" sensor, 4K60, 30x optical zoom, AI tracking, ReID. SDI + HDMI + LAN + USB 2.0, NDI/Dante. Built for large / broadcast rooms.',
    distributorPrice: 99000,
    partnerPrice: 109000,
    customerPrice: 120000,
    image: '/av-assets/NT-VX630AL.png'
  },
  'NT-M702A/C': {
    modelTag: 'M702A/C',
    category: 'Microphone',
    description: 'USB microphone, PoE cascading, black.',
    distributorPrice: 28000,
    partnerPrice: 31000,
    customerPrice: 34000,
    image: '/av-assets/NT-M702AC.png'
  },
  'NT-A10W': {
    modelTag: 'A10W',
    category: 'Mic/Speaker',
    description: 'USB speakerphone with full range speaker and microphone, range up to 10 meters, with wireless dongle connectivity.',
    distributorPrice: 55000,
    partnerPrice: 61000,
    customerPrice: 67000,
    image: '/av-assets/NT-A10W.png'
  }
};
